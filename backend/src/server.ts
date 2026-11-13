/*
 Express request augmentation is kept local to this service; refine to typed request state as route modules split out. */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createDatabasePool, databaseConnectionDiagnostics, databaseFailureCategory } from './database.js';
import { z } from 'zod';
import { createSafeZip, projectFilesSchema } from './security/files.js';
import { requestValidationFields, requestValidationMessage } from './security/requestValidation.js';
import { generateVanillaWebsiteWithFallback, GenerationFailure, validateVanillaProject } from './ai/provider.js';
import type { GeminiDiagnosticEvent, GenerationEvent } from './ai/provider.js';
import { persistGeneratedVersion } from './generation/persistence.js';
import { GenerationEventHistory } from './generation/eventHistory.js';
import { generationFailureForClient, storedGenerationFailure } from './generation/failure.js';
import { failInterruptedGenerations } from './generation/recovery.js';
import { isUsableSignupIdentity, registrationProfileData, registrationSchema, registrationValidationMessage, signupConfirmationUrl, SIGNUP_CONFIRMATION_MESSAGE, signupFailure, type SupabaseSignupUser } from './auth/registration.js';
import { resendSignupCodeSchema, SIGNUP_CODE_SENT_MESSAGE, verificationFailure, verifySignupCodeSchema } from './auth/emailVerification.js';
import { decideGoogleProfile, googleClientProfileData } from './auth/googleOAuth.js';
import { mergeGeneratedFiles } from './generation/files.js';
import { consumeDistributedRateLimit, rateLimitBucketKey } from './security/rateLimit.js';
import { classifySupabasePasswordFailure } from './auth/passwordLoginErrors.js';
import { authorizeAuthenticatedProfile, authorizeClientLogin, passwordLoginSchema, passwordLoginValidationMessage } from './auth/passwordLogin.js';
import { sessionCookieOptions } from './auth/cookies.js';
import { establishAdministratorSession } from './auth/adminLoginPolicy.js';
import { GitHubIntegrationError, publishProjectPullRequest } from './integrations/github.js';
import { createDeploymentPackage, DeploymentPreparationError } from './integrations/deployment.js';

const logger = pino({ redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.accessToken', 'req.body.refreshToken', 'req.body.prompt'] });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const databasePool = createDatabasePool(databaseUrl);
logger.info(databaseConnectionDiagnostics(databaseUrl), 'database connection configuration loaded');
databasePool.on('error', (error) => logger.error({ category: databaseFailureCategory(error), code: (error as any)?.code }, 'database pool error'));
const prisma = new PrismaClient({ adapter: new PrismaPg(databasePool, { disposeExternalPool: true }) });
const app = express();
const port = Number(process.env.PORT || 8787);
const secure = process.env.COOKIE_SECURE === 'true';
if (process.env.NODE_ENV === 'production' && !secure) throw new Error('COOKIE_SECURE=true is required in production');
const aiProvider = process.env.AI_PROVIDER || 'groq';
if (aiProvider !== 'groq') throw new Error('AI_PROVIDER must be groq; mock generation is disabled');
if (process.env.AI_FALLBACK_PROVIDER !== 'gemini') throw new Error('AI_FALLBACK_PROVIDER must be gemini');
const groqBaseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const geminiBaseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const openRouterBaseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
for (const [label, value] of [['GROQ_BASE_URL', groqBaseUrl], ['GEMINI_BASE_URL', geminiBaseUrl], ['OPENROUTER_BASE_URL', openRouterBaseUrl]] as const) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment`);
}
if (!process.env.GROQ_API_KEY || !process.env.GEMINI_API_KEY) throw new Error('GROQ_API_KEY and GEMINI_API_KEY are required for real generation and fallback');
const aiTimeoutMs = z.coerce.number().int().min(1_000).max(120_000).default(90_000).parse(process.env.AI_TIMEOUT_MS);
const providerTimeout = (name: string, fallback: number) => z.coerce.number().int().min(1_000).max(120_000).default(Math.min(aiTimeoutMs, fallback)).parse(process.env[name]);
const geminiTimeoutMs = providerTimeout('GEMINI_TIMEOUT_MS', 55_000);
const groqTimeoutMs = providerTimeout('GROQ_TIMEOUT_MS', 25_000);
const openRouterTimeoutMs = providerTimeout('OPENROUTER_TIMEOUT_MS', 45_000);
const huggingFaceTimeoutMs = providerTimeout('HF_TIMEOUT_MS', 10_000);
const generationTotalTimeoutMs = z.coerce.number().int().min(30_000).max(120_000).default(110_000).parse(process.env.AI_GENERATION_TOTAL_TIMEOUT_MS);
const supabaseAuthTimeoutMs = z.coerce.number().int().min(1_000).max(30_000).default(12_000).parse(process.env.SUPABASE_AUTH_TIMEOUT_MS);
const aiModels = {
  reasoning: process.env.AI_MODEL || 'openai/gpt-oss-120b',
  coding: process.env.AI_CODER_MODEL || 'qwen/qwen3.8-27b',
  fallback: process.env.AI_FALLBACK_MODEL || 'gemini-3.8-flash',
};
const openRouterConfig = process.env.OPENROUTER_API_KEY ? {
  baseUrl: openRouterBaseUrl,
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL || '',
  timeoutMs: openRouterTimeoutMs,
} : undefined;
if (openRouterConfig && !openRouterConfig.model) throw new Error('OPENROUTER_MODEL is required when OPENROUTER_API_KEY is configured');
logger.info({ gemini: aiModels.fallback, groqConfigured: !!process.env.GROQ_API_KEY, openRouterConfigured: !!openRouterConfig }, 'website generation provider routing configured');
const huggingFaceToken = process.env.HF_TOKEN || '';
const huggingFaceModel = process.env.HF_MODEL || 'Qwen/Qwen2.5-Coder-32B-Instruct';
const huggingFaceProvider = process.env.HF_PROVIDER || 'featherless-ai';
if (huggingFaceProvider !== 'featherless-ai') throw new Error('HF_PROVIDER must be featherless-ai');
const huggingFaceFreeOnly = process.env.HF_FREE_CREDITS_ONLY === 'true';
const huggingFaceMaxOutputTokens = z.coerce.number().int().min(64).max(4_096).default(4_096).parse(process.env.HF_MAX_OUTPUT_TOKENS);
const huggingFaceConfig = huggingFaceToken && huggingFaceFreeOnly ? {
  token: huggingFaceToken,
  model: huggingFaceModel,
  provider: 'featherless-ai' as const,
  timeoutMs: huggingFaceTimeoutMs,
  maxOutputTokens: huggingFaceMaxOutputTokens,
  freeCreditsOnly: huggingFaceFreeOnly,
} : undefined;
logger.info({ configured: !!huggingFaceToken, model: huggingFaceModel, provider: 'featherless-ai', enabled: huggingFaceFreeOnly }, 'Hugging Face provider configuration loaded');
const trustedProxyHops = process.env.TRUST_PROXY ? z.coerce.number().int().min(0).max(3).parse(process.env.TRUST_PROXY) : 0;
app.set('trust proxy', trustedProxyHops);

app.disable('x-powered-by');
app.use((req, res, next) => {
  const requestId = randomUUID(); const started = Date.now();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  res.on('finish', () => logger.info({ requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started }));
  next();
});
app.use(helmet());
const origins = [...new Set((process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()))];
for (const origin of origins) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error('FRONTEND_ORIGIN must contain exact origins; production origins must use HTTPS');
}
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)), credentials: true }));
app.use(express.json({ limit: '1mb', strict: true }));
app.use(cookieParser());
app.use(rateLimit(600, 60_000, false));

const fail = (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
const accessCookie = 'dguy_access';
const refreshCookie = 'dguy_refresh';
const csrfCookie = 'dguy_csrf';
class SupabaseUnavailableError extends Error { constructor() { super('Supabase Auth is unavailable'); this.name = 'SupabaseUnavailableError'; } }
const activeControllers = new Map<string, AbortController>();
const generationClients = new Map<string, Set<express.Response>>();
const generationEventHistory = new GenerationEventHistory();
const attemptBuckets = new Map<string, { count: number; resetAt: number }>();
let lastRateLimitSweep = 0;
const distributedRateLimits = process.env.NODE_ENV === 'production';
function rateLimit(limit: number, windowMs: number, byPath = true): express.RequestHandler {
  return async (req, res, next) => {
    if (!byPath && (req.path === '/api/v1/health' || req.path === '/api/v1/ready')) return next();
    const scope = `${byPath ? req.path : 'global'}:${req.method}`;
    if (distributedRateLimits) {
      try {
        const key = rateLimitBucketKey(scope, req.ip || req.socket.remoteAddress || 'unknown', databaseUrl!);
        const result = await consumeDistributedRateLimit(databasePool, key, limit, windowMs);
        if (!result.allowed) { res.setHeader('Retry-After', result.retryAfterSeconds); return fail(res, 429, 'RATE_LIMITED', 'Too many requests'); }
        return next();
      } catch (error) {
        logger.error({ category: databaseFailureCategory(error), code: (error as any)?.code }, 'distributed rate limit store unavailable');
        return fail(res, 503, 'RATE_LIMIT_UNAVAILABLE', 'Request protection is temporarily unavailable');
      }
    }
    const now = Date.now();
    if (now - lastRateLimitSweep > 30_000) { for (const [entry, value] of attemptBuckets) if (value.resetAt <= now) attemptBuckets.delete(entry); lastRateLimitSweep = now; }
    const key = `${scope}:${req.ip}`; let bucket = attemptBuckets.get(key);
    if (!bucket && attemptBuckets.size >= 20_000) return fail(res, 429, 'RATE_LIMITED', 'Too many distinct client addresses');
    if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + windowMs }; attemptBuckets.set(key, bucket); }
    bucket.count += 1;
    if (bucket.count > limit) { res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000)); return fail(res, 429, 'RATE_LIMITED', 'Too many requests'); }
    next();
  };
}
if (distributedRateLimits) {
  const cleanupTimer = setInterval(() => {
    void databasePool.query('DELETE FROM "ApiRateLimitBucket" WHERE "resetAt" < NOW() - INTERVAL \'1 day\'')
      .catch((error) => logger.error({ category: databaseFailureCategory(error), code: (error as any)?.code }, 'rate limit bucket cleanup failed'));
  }, 60 * 60_000);
  cleanupTimer.unref();
}
function publishGeneration(jobId: string, event: string, data: unknown) {
  const eventId = generationEventHistory.append(jobId, event, data);
  const clients = generationClients.get(jobId);
  if (!clients) return;
  const frame = `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.writableLength > 1_000_000) {
      client.end();
      clients.delete(client);
      continue;
    }
    client.write(frame);
    if (['complete', 'failed', 'cancelled'].includes(event)) client.end();
  }
  if (!clients.size) generationClients.delete(jobId);
}
async function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    let token = req.cookies[accessCookie] as string | undefined;
    if (!token) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in required');
    let identity = await verifySupabaseToken(token);
    if (!identity && typeof req.cookies[refreshCookie] === 'string') {
      const refreshed = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: req.cookies[refreshCookie] }) });
      if (refreshed.ok) { const tokens = await refreshed.json() as SupabaseSession; if (!issueAuthCookies(res, tokens, false)) return fail(res, 500, 'SESSION_CREATION_FAILED', 'Could not restore your sign-in session. Please sign in again.'); token = tokens.access_token; identity = await verifySupabaseToken(token); }
      else if (refreshed.status === 429 || refreshed.status >= 500) return fail(res, 503, 'AUTH_UNAVAILABLE', 'Supabase session refresh is temporarily unavailable. Please try again shortly.');
    }
    if (!identity?.id || !identity.email) { clearAuthCookies(res); return fail(res, 401, 'SESSION_EXPIRED', 'Sign in required'); }
    const user = await prisma.user.findUnique({ where: { id: identity.id } });
    const profileDecision = authorizeAuthenticatedProfile(identity.id, identity.email, user);
    if (profileDecision === 'profile_missing') { clearAuthCookies(res); return fail(res, 403, 'PROFILE_NOT_FOUND', 'Your account profile is missing. Contact support.'); }
    if (profileDecision === 'identity_mismatch') {
      clearAuthCookies(res);
      return fail(res, 403, 'AUTH_PROFILE_MISMATCH', 'Your account profile could not be verified. Contact support.');
    }
    if (profileDecision === 'client_profile_required') {
      clearAuthCookies(res);
      return fail(res, 403, 'CLIENT_PROFILE_REQUIRED', 'A client profile is required to use this workspace.');
    }
    (req as any).user = user;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = req.get('x-csrf-token'); if (!csrf || csrf !== req.cookies[csrfCookie]) return fail(res, 403, 'CSRF_INVALID', 'Request could not be verified');
    }
    next();
  } catch (error) {
    if (error instanceof SupabaseUnavailableError) return fail(res, 503, 'AUTH_UNAVAILABLE', 'Supabase session verification is temporarily unavailable. Please try again shortly.');
    next(error);
  }
}
interface SupabaseSession { access_token: string; refresh_token: string; expires_in?: number; user?: { id: string; email?: string; identities?: unknown[] | null; user_metadata?: Record<string, unknown> | null } }
async function supabaseRequest(path: string, init: RequestInit = {}) {
  const timeoutSignal = AbortSignal.timeout(supabaseAuthTimeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(`${supabaseUrl}${path}`, { ...init, signal, headers: { apikey: supabaseAnonKey!, 'content-type': 'application/json', ...init.headers } });
}
interface SupabaseAuthIdentity extends SupabaseSignupUser {
  id?: string;
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  app_metadata?: { provider?: string; providers?: unknown } | null;
  user_metadata?: { full_name?: unknown; name?: unknown } | null;
}
async function verifySupabaseToken(token: string): Promise<{
  id: string;
  email: string;
  fullName?: string;
  provider: string;
  emailVerified: boolean;
} | null> {
  let response: Response;
  try { response = await supabaseRequest('/auth/v1/user', { headers: { authorization: `Bearer ${token}` } }); }
  catch { throw new SupabaseUnavailableError(); }
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) { if (response.status >= 500) throw new SupabaseUnavailableError(); return null; }
  const identity = await response.json() as SupabaseAuthIdentity;
  if (!identity.id || !identity.email) return null;
  const identities = Array.isArray(identity.identities) ? identity.identities as Array<{ provider?: unknown }> : [];
  const appProviders = Array.isArray(identity.app_metadata?.providers) ? identity.app_metadata.providers : [];
  const providers = [
    identity.app_metadata?.provider,
    ...appProviders,
    ...identities.map((entry) => entry.provider),
  ].filter((provider): provider is string => typeof provider === 'string');
  const googleLinked = providers.includes('google');
  const fullName = typeof identity.user_metadata?.full_name === 'string'
    ? identity.user_metadata.full_name
    : typeof identity.user_metadata?.name === 'string' ? identity.user_metadata.name : undefined;
  return {
    id: identity.id,
    email: identity.email,
    fullName,
    provider: googleLinked ? 'google' : identity.app_metadata?.provider || 'email',
    emailVerified: Boolean(identity.email_confirmed_at || identity.confirmed_at),
  };
}
function setAuthCookies(res: express.Response, session: SupabaseSession, issueCsrf = true) {
  const maxAge = Math.min(Math.max(session.expires_in ?? 3600, 60), 86400) * 1000;
  res.cookie(accessCookie, session.access_token, sessionCookieOptions(secure, true, maxAge));
  res.cookie(refreshCookie, session.refresh_token, sessionCookieOptions(secure, true, 30 * 86400000));
  if (issueCsrf) res.cookie(csrfCookie, randomBytes(24).toString('base64url'), sessionCookieOptions(secure, false, 30 * 86400000));
}
function issueAuthCookies(res: express.Response, session: SupabaseSession, issueCsrf = true): boolean {
  try { setAuthCookies(res, session, issueCsrf); return true; }
  catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'authentication cookie creation failed');
    try { clearAuthCookies(res); } catch { /* A partially-written response cannot be repaired here. */ }
    return false;
  }
}
function clearAuthCookies(res: express.Response) { for (const name of [accessCookie, refreshCookie, csrfCookie]) res.clearCookie(name, sessionCookieOptions(secure, name !== csrfCookie)); }
const ownerProject = async (id: string, ownerId: string) => prisma.project.findFirst({ where: { id, ownerId }, include: { versions: { orderBy: { number: 'desc' }, take: 1 } } });
const emailSchema = z.string().email().max(254).transform((v) => v.toLowerCase());
const writeAudit = (userId: string, action: string, resourceId?: string) => prisma.auditEvent.create({ data: { userId, action, resourceId } }).catch((error) => logger.error({ code: (error as any)?.code, action }, 'audit event could not be stored'));

app.get('/api/v1/health', (_req, res) => {
  const providers = ['Gemini', 'Groq'];
  if (openRouterConfig) providers.push('OpenRouter');
  if (huggingFaceConfig && huggingFaceFreeOnly) providers.push('Hugging Face Featherless');
  res.json({ status: 'ok', generationProvider: providers.join(' → ') });
});
app.get('/api/v1/ready', async (_req, res) => { try { const result = await databasePool.query('SELECT 1 AS ok'); if (result.rows[0]?.ok !== 1) throw new Error('unexpected_readiness_query_result'); res.json({ status: 'ready' }); } catch (error) { logger.error({ category: databaseFailureCategory(error), code: (error as any)?.code }, 'readiness database query failed'); fail(res, 503, 'NOT_READY', 'Service unavailable'); } });
app.post('/api/v1/auth/register', rateLimit(5, 15 * 60_000), async (req, res, next) => {
  try {
    if (process.env.ALLOW_REGISTRATION === 'false') return fail(res, 403, 'REGISTRATION_DISABLED', 'Registration is disabled');
    const parsedBody = registrationSchema.safeParse(req.body);
    if (!parsedBody.success) return fail(res, 400, 'VALIDATION_ERROR', registrationValidationMessage(parsedBody.error.issues));
    const body = parsedBody.data;
    let response: Response;
    const redirectTo = signupConfirmationUrl(req.get('origin'), origins);
    try { response = await supabaseRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: JSON.stringify({ email: body.email, password: body.password, data: { full_name: body.fullName, name: body.fullName } }) }); }
    catch { return fail(res, 503, 'AUTH_UNAVAILABLE', 'Supabase account creation is temporarily unavailable. Please try again shortly.'); }
    if (!response.ok) {
      const failure = signupFailure(response.status);
      return fail(res, failure.status, failure.code, failure.message);
    }
    const result = await response.json() as SupabaseSession & { user?: SupabaseSignupUser };
    const identity = result.user;
    // Supabase can return a synthetic empty-identity user for duplicate emails when
    // email enumeration protection is enabled. Never create a profile for it.
    if (!isUsableSignupIdentity(identity)) return res.status(202).json({ confirmationRequired: true, message: SIGNUP_CONFIRMATION_MESSAGE });
    const profileData = registrationProfileData(identity, body.fullName);
    const user = await prisma.user.upsert({
      where: { id: identity.id },
      create: profileData,
      update: { email: profileData.email },
    });
    if (!user.fullName) await prisma.user.updateMany({ where: { id: user.id, fullName: null }, data: { fullName: profileData.fullName } });
    if (!result.access_token || !result.refresh_token) {
      await writeAudit(user.id, 'auth.registered');
      return res.status(202).json({ confirmationRequired: true, message: SIGNUP_CONFIRMATION_MESSAGE });
    }
    if (user.role === 'admin') return fail(res, 403, 'ADMIN_LOGIN_REQUIRED', 'Administrator accounts must use the separate administrator sign-in.');
    if (user.role !== 'client' && user.role !== 'user') return fail(res, 403, 'CLIENT_PROFILE_REQUIRED', 'A client profile is required for client sign-in.');
    if (!issueAuthCookies(res, result)) return fail(res, 500, 'SESSION_CREATION_FAILED', 'Could not establish your sign-in session. Please try again.');
    await writeAudit(user.id, 'auth.registered');
    return res.status(201).json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (e) { next(e); }
});
app.post('/api/v1/auth/verify-email', rateLimit(8, 15 * 60_000), async (req, res, next) => {
  try {
    const parsed = verifySignupCodeSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a valid email address and the 6–8 digit code from your email.');
    let response: Response;
    try {
      response = await supabaseRequest('/auth/v1/verify', {
        method: 'POST',
        body: JSON.stringify({ type: 'signup', email: parsed.data.email, token: parsed.data.code }),
      });
    } catch { return fail(res, 503, 'AUTH_UNAVAILABLE', 'Email verification is temporarily unavailable. Please try again shortly.'); }
    if (!response.ok) {
      const failure = verificationFailure(response.status);
      return fail(res, failure.status, failure.code, failure.message);
    }
    const session = await response.json() as SupabaseSession;
    if (!session.access_token || !session.refresh_token) return fail(res, 400, 'EMAIL_CODE_INVALID', 'That code is invalid or expired. Request a new code and try again.');
    const identity = await verifySupabaseToken(session.access_token);
    if (!identity || identity.email.toLowerCase() !== parsed.data.email) return fail(res, 401, 'EMAIL_CODE_INVALID', 'That code is invalid or expired. Request a new code and try again.');
    const user = await prisma.user.findUnique({ where: { id: identity.id } });
    const decision = authorizeClientLogin(identity.id, identity.email, user ? { id: user.id, email: user.email, role: user.role } : null);
    if (decision === 'profile_missing') return fail(res, 403, 'PROFILE_NOT_FOUND', 'Your account profile is missing. Contact support.');
    if (decision === 'identity_mismatch') return fail(res, 403, 'AUTH_PROFILE_MISMATCH', 'Your account profile could not be verified. Contact support.');
    if (decision === 'admin_login_required') return fail(res, 403, 'ADMIN_LOGIN_REQUIRED', 'Administrator accounts must use the separate administrator sign-in.');
    if (decision === 'client_profile_required' || !user) return fail(res, 403, 'CLIENT_PROFILE_REQUIRED', 'A client profile is required to use this workspace.');
    if (!issueAuthCookies(res, session)) return fail(res, 500, 'SESSION_CREATION_FAILED', 'Email verified, but a sign-in session could not be established. Sign in with your password.');
    await writeAudit(user.id, 'auth.email_verified');
    return res.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});
app.post('/api/v1/auth/resend-verification', rateLimit(3, 15 * 60_000), async (req, res, next) => {
  try {
    const parsed = resendSignupCodeSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a valid email address.');
    let response: Response;
    try {
      const redirectTo = signupConfirmationUrl(req.get('origin'), origins);
      response = await supabaseRequest(`/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        body: JSON.stringify({ type: 'signup', email: parsed.data.email }),
      });
    } catch { return fail(res, 503, 'AUTH_UNAVAILABLE', 'Verification email could not be requested. Please try again shortly.'); }
    if (response.status === 429) return fail(res, 429, 'AUTH_RATE_LIMITED', 'Too many verification requests. Wait a few minutes and try again.');
    if (response.status >= 500) return fail(res, 503, 'AUTH_UNAVAILABLE', 'Verification email could not be requested. Please try again shortly.');
    return res.status(202).json({ message: SIGNUP_CODE_SENT_MESSAGE });
  } catch (error) { next(error); }
});
app.post('/api/v1/auth/google/session', rateLimit(10, 15 * 60_000), async (req, res, next) => {
  try {
    const parsed = z.object({ accessToken: z.string().min(20).max(8192), refreshToken: z.string().min(20).max(8192) }).strict().safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'Google sign-in session is invalid. Try signing in again.');
    const initialIdentity = await verifySupabaseToken(parsed.data.accessToken);
    if (!initialIdentity) return fail(res, 401, 'INVALID_OAUTH_SESSION', 'Google sign-in could not be verified. Try again.');
    let refreshResponse: Response;
    try {
      refreshResponse = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: parsed.data.refreshToken }),
      });
    } catch { return fail(res, 503, 'AUTH_UNAVAILABLE', 'Google sign-in is temporarily unavailable. Please try again.'); }
    if (!refreshResponse.ok) {
      if (refreshResponse.status === 429) return fail(res, 429, 'AUTH_RATE_LIMITED', 'Too many sign-in attempts. Please wait and try again.');
      if (refreshResponse.status >= 500) return fail(res, 503, 'AUTH_UNAVAILABLE', 'Google sign-in is temporarily unavailable. Please try again.');
      return fail(res, 401, 'INVALID_OAUTH_SESSION', 'Google sign-in could not be verified. Try again.');
    }
    const session = await refreshResponse.json() as SupabaseSession;
    if (!session.access_token || !session.refresh_token) return fail(res, 401, 'INVALID_OAUTH_SESSION', 'Google sign-in could not be verified. Try again.');
    const identity = await verifySupabaseToken(session.access_token);
    if (!identity || identity.id !== initialIdentity.id) return fail(res, 401, 'INVALID_OAUTH_SESSION', 'Google sign-in could not be verified. Try again.');
    let profile = await prisma.user.findUnique({ where: { id: identity.id } });
    let emailProfile = profile ? null : await prisma.user.findUnique({ where: { email: identity.email.toLowerCase() } });
    let decision = decideGoogleProfile(identity, profile, emailProfile);
    if (decision === 'create') {
      try {
        profile = await prisma.user.create({ data: googleClientProfileData(identity) });
      } catch (error) {
        const uniqueConflict = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
        if (!uniqueConflict) throw error;
        profile = await prisma.user.findUnique({ where: { id: identity.id } });
        emailProfile = profile ? null : await prisma.user.findUnique({ where: { email: identity.email.toLowerCase() } });
      }
      decision = decideGoogleProfile(identity, profile, emailProfile);
    }
    if (decision !== 'authorized' || !profile) {
      const status = decision === 'email_unverified' || decision === 'admin_login_required' || decision === 'client_profile_required' ? 403
        : decision === 'email_conflict' || decision === 'identity_mismatch' ? 409 : 401;
      const code = decision === 'email_unverified' ? 'EMAIL_NOT_VERIFIED'
        : decision === 'admin_login_required' ? 'ADMIN_LOGIN_REQUIRED'
          : decision === 'client_profile_required' ? 'CLIENT_PROFILE_REQUIRED'
            : decision === 'email_conflict' || decision === 'identity_mismatch' ? 'AUTH_PROFILE_MISMATCH' : 'GOOGLE_SIGN_IN_REQUIRED';
      const message = decision === 'email_unverified' ? 'Google did not provide a verified email address.'
        : decision === 'admin_login_required' ? 'Administrator accounts must use the separate administrator sign-in.'
          : decision === 'client_profile_required' ? 'A client profile is required to use this workspace.'
            : decision === 'email_conflict' || decision === 'identity_mismatch' ? 'This email is already linked to a different D-GUY profile. Sign in with that account or contact support.'
              : 'Use the Google sign-in option to continue.';
      return fail(res, status, code, message);
    }
    if (!issueAuthCookies(res, session)) {
      return fail(res, 500, 'SESSION_CREATION_FAILED', 'Could not establish your sign-in session. Please try again.');
    }
    await writeAudit(profile.id, 'auth.google_logged_in');
    return res.json({ user: { id: profile.id, email: profile.email, role: profile.role } });
  } catch (error) { next(error); }
});
async function passwordLogin(req: express.Request, res: express.Response, next: express.NextFunction, adminOnly: boolean) {
  try {
    const parsed = passwordLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => ({ field: issue.path.map(String).join('.') || 'body', rule: issue.code }));
      logger.warn({ fields, flow: adminOnly ? 'admin' : 'user' }, 'password login request validation failed');
      return fail(res, 400, 'VALIDATION_ERROR', passwordLoginValidationMessage(parsed.error.issues));
    }
    const body = parsed.data;
    let response: Response;
    try { response = await supabaseRequest('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify(body) }); }
    catch { return fail(res, 503, 'AUTH_UNAVAILABLE', 'Supabase sign-in is temporarily unavailable. Please try again shortly.'); }
    if (!response.ok) {
      let providerError: unknown;
      try { providerError = await response.clone().json(); } catch { providerError = undefined; }
      const failure = classifySupabasePasswordFailure(providerError);
      const category = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'provider_error' : failure.toLowerCase();
      logger.warn({ category, status: response.status, flow: adminOnly ? 'admin' : 'user' }, 'Supabase password authentication rejected');
      if (response.status === 429) return fail(res, 429, 'AUTH_RATE_LIMITED', 'Too many sign-in attempts. Please wait and try again.');
      if (response.status >= 500) return fail(res, 503, 'AUTH_UNAVAILABLE', 'Supabase sign-in is temporarily unavailable. Please try again shortly.');
      if (failure === 'EMAIL_NOT_CONFIRMED') return fail(res, 401, 'EMAIL_NOT_CONFIRMED', 'Email not verified. Request a verification code and enter it here.');
      // Do not expose the distinction between an absent account and a wrong password.
      return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    const result = await response.json() as SupabaseSession;
    if (!result.user?.id || !result.user.email) return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    const user = await prisma.user.findUnique({ where: { id: result.user.id } });
    if (adminOnly) {
      const authorization = establishAdministratorSession(result.user.id, user ? { id: user.id, role: user.role } : null, () => issueAuthCookies(res, result));
      if (authorization === 'session_failed') return fail(res, 500, 'SESSION_CREATION_FAILED', 'Could not establish your sign-in session. Please try again.');
      if (authorization !== 'authorized') {
        const code = authorization === 'profile_missing' ? 'PROFILE_NOT_FOUND' : authorization === 'identity_mismatch' ? 'AUTH_PROFILE_MISMATCH' : 'NOT_ADMIN';
        logger.warn({ category: authorization, flow: 'admin' }, 'Admin login denied after Supabase authentication');
        return fail(res, 403, code, authorization === 'profile_missing' ? 'Administrator access is not configured for this account.' : 'Administrator access is required');
      }
    }
    if (!adminOnly) {
      const decision = authorizeClientLogin(result.user.id, result.user.email, user ? { id: user.id, email: user.email, role: user.role } : null);
      if (decision === 'profile_missing') return fail(res, 403, 'PROFILE_NOT_FOUND', 'Your account profile is missing. Contact support.');
      if (decision === 'identity_mismatch') return fail(res, 403, 'AUTH_PROFILE_MISMATCH', 'Your account profile could not be verified. Contact support.');
      if (decision === 'admin_login_required') return fail(res, 403, 'ADMIN_LOGIN_REQUIRED', 'Administrator accounts must use the separate administrator sign-in.');
      if (decision === 'client_profile_required') return fail(res, 403, 'CLIENT_PROFILE_REQUIRED', 'A client profile is required for client sign-in.');
    }
    if (!user) return fail(res, 403, 'PROFILE_NOT_FOUND', 'Your account profile is missing. Contact support.');
    const profile = user;
    if (!adminOnly && !issueAuthCookies(res, result)) return fail(res, 500, 'SESSION_CREATION_FAILED', 'Could not establish your sign-in session. Please try again.');
    await writeAudit(profile.id, adminOnly ? 'admin.logged_in' : 'auth.logged_in');
    res.json({ user: { id: profile.id, email: profile.email, role: profile.role } });
  } catch (e) { next(e); }
}
app.post('/api/v1/auth/login', rateLimit(10, 15 * 60_000), (req, res, next) => passwordLogin(req, res, next, false));
app.post('/api/v1/auth/admin/login', rateLimit(5, 15 * 60_000), (req, res, next) => passwordLogin(req, res, next, true));
app.post('/api/v1/auth/logout', auth, async (req, res) => {
  const token = req.cookies[accessCookie] as string | undefined;
  if (token) await supabaseRequest('/auth/v1/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  await writeAudit((req as any).user.id, 'auth.logged_out'); clearAuthCookies(res); res.status(204).end();
});
app.get('/api/v1/auth/me', auth, (req, res) => { const u = (req as any).user; res.json({ user: { id: u.id, email: u.email, role: u.role } }); });
app.get('/api/v1/auth/csrf', auth, (req, res) => { const csrf = randomBytes(24).toString('base64url'); res.cookie(csrfCookie, csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: 30 * 86400000 }); res.json({ csrfToken: csrf }); });
app.post('/api/v1/auth/recover', rateLimit(4, 15 * 60_000), async (req, res, next) => {
  try {
    const body = z.object({ email: emailSchema }).strict().parse(req.body);
    const redirect = new URL('/', origins[0]); redirect.searchParams.set('auth', 'recovery');
    let response: Response;
    try { response = await supabaseRequest(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirect.toString())}`, { method: 'POST', body: JSON.stringify(body) }); }
    catch { return fail(res, 503, 'AUTH_UNAVAILABLE', 'Password recovery is temporarily unavailable. Please try again shortly.'); }
    if (response.status >= 500 || response.status === 429) return fail(res, 503, 'AUTH_UNAVAILABLE', 'Password recovery is temporarily unavailable. Please try again shortly.');
    res.status(202).json({ message: 'If that account exists, Supabase has sent password-reset instructions.' });
  } catch (error) { next(error); }
});
app.post('/api/v1/auth/password', rateLimit(5, 15 * 60_000), async (req, res, next) => {
  try {
    const body = z.object({ accessToken: z.string().min(20).max(8192), password: z.string().min(12).max(128) }).strict().parse(req.body);
    let response: Response;
    try { response = await supabaseRequest('/auth/v1/user', { method: 'PUT', headers: { authorization: `Bearer ${body.accessToken}` }, body: JSON.stringify({ password: body.password }) }); }
    catch { return fail(res, 503, 'AUTH_UNAVAILABLE', 'Password update is temporarily unavailable. Please try again shortly.'); }
    if (response.status >= 500 || response.status === 429) return fail(res, 503, 'AUTH_UNAVAILABLE', 'Password update is temporarily unavailable. Please try again shortly.');
    if (!response.ok) return fail(res, 400, 'PASSWORD_RESET_FAILED', 'The reset link is invalid or expired. Request another password-reset email.');
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get('/api/v1/projects', auth, async (req, res, next) => { try { const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page); const limit = z.coerce.number().int().min(1).max(20).default(20).parse(req.query.limit); const ownerId = (req as any).user.id; res.json({ projects: await prisma.project.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { versions: { orderBy: { number: 'desc' }, take: 100, select: { id: true, number: true, prompt: true, summary: true, templateId: true, options: true, warnings: true, createdAt: true } } } }) }); } catch (e) { next(e); } });
app.post('/api/v1/projects', auth, async (req, res, next) => { try { const body = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(req.body); const ownerId = (req as any).user.id; if (await prisma.project.count({ where: { ownerId } }) >= 20) return fail(res, 429, 'PROJECT_LIMIT', 'Project limit reached'); const p = await prisma.project.create({ data: { ownerId, name: body.name } }); res.status(201).json({ project: { ...p, versions: [] } }); } catch (e) { next(e); } });
app.get('/api/v1/projects/:id', auth, async (req, res) => {
  const id = z.string().min(1).max(64).parse(req.params.id); const ownerId = (req as any).user.id as string;
  const project = await prisma.project.findFirst({ where: { id, ownerId } });
  if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
  const versions = await prisma.version.findMany({ where: { projectId: id }, orderBy: { number: 'desc' }, take: 100, select: { id: true, projectId: true, number: true, prompt: true, summary: true, templateId: true, options: true, warnings: true, createdAt: true } });
  const activeFiles = project.activeVersionId ? (await prisma.version.findFirst({ where: { id: project.activeVersionId, projectId: id }, select: { files: true } }))?.files : undefined;
  res.json({ project: { ...project, versions: versions.map((version) => ({ ...version, files: version.id === project.activeVersionId ? activeFiles ?? [] : [] })) } });
});
app.patch('/api/v1/projects/:id', auth, async (req, res, next) => { try { const body = z.object({ name: z.string().trim().min(1).max(120), messages: z.array(z.object({ id: z.string().max(100), role: z.enum(['user', 'assistant']), text: z.string().max(10000) })).max(200).optional() }).strict().parse(req.body); const found = await ownerProject(z.string().min(1).max(64).parse(req.params.id), (req as any).user.id); if (!found) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const p = await prisma.project.update({ where: { id: found.id }, data: body }); res.json({ project: p }); } catch (e) { next(e); } });
app.delete('/api/v1/projects/:id', auth, async (req, res) => { const found = await prisma.project.findFirst({ where: { id: z.string().min(1).max(64).parse(req.params.id), ownerId: (req as any).user.id } }); if (!found) return fail(res, 404, 'NOT_FOUND', 'Project not found'); await prisma.project.delete({ where: { id: found.id } }); await writeAudit((req as any).user.id, 'project.deleted', found.id); res.status(204).end(); });
app.get('/api/v1/projects/:id/files', auth, async (req, res) => { const p = await ownerProject(z.string().min(1).max(64).parse(req.params.id), (req as any).user.id); if (!p) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const v = p.versions.find((item) => item.id === p.activeVersionId) ?? p.versions.at(-1); res.json({ files: v?.files ?? [] }); });
app.put('/api/v1/projects/:id/files', auth, async (req, res, next) => { try { const files = projectFilesSchema.parse(req.body.files); const p = await ownerProject(z.string().min(1).max(64).parse(req.params.id), (req as any).user.id); if (!p) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const number = p.versions[0]?.number ?? 0; if (number >= 100) return fail(res, 409, 'VERSION_LIMIT', 'Version limit reached; start a new project to continue'); const version = await prisma.version.create({ data: { projectId: p.id, number: number + 1, prompt: 'Manual file update', summary: 'Files updated', templateId: 'custom', options: {}, files } }); await prisma.project.update({ where: { id: p.id }, data: { activeVersionId: version.id } }); res.status(201).json({ version }); } catch (e) { next(e); } });
app.get('/api/v1/projects/:id/versions', auth, async (req, res, next) => { try { const id = z.string().min(1).max(64).parse(req.params.id); const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page); const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit); const project = await prisma.project.findFirst({ where: { id, ownerId: (req as any).user.id } }); if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const versions = await prisma.version.findMany({ where: { projectId: id }, orderBy: { number: 'desc' }, skip: (page - 1) * limit, take: limit, select: { id: true, projectId: true, number: true, prompt: true, summary: true, templateId: true, options: true, warnings: true, createdAt: true } }); res.json({ versions: versions.map((version) => ({ ...version, files: [] })) }); } catch (error) { next(error); } });
app.get('/api/v1/projects/:id/versions/:versionId', auth, async (req, res) => { const id = z.string().min(1).max(64).parse(req.params.id); const versionId = z.string().min(1).max(64).parse(req.params.versionId); const project = await prisma.project.findFirst({ where: { id, ownerId: (req as any).user.id }, select: { id: true } }); if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const version = await prisma.version.findFirst({ where: { id: versionId, projectId: project.id } }); if (!version) return fail(res, 404, 'NOT_FOUND', 'Version not found'); res.json({ version }); });
app.post('/api/v1/projects/:id/versions/:versionId/restore', auth, async (req, res) => { const id = z.string().min(1).max(64).parse(req.params.id); const versionId = z.string().min(1).max(64).parse(req.params.versionId); const project = await prisma.project.findFirst({ where: { id, ownerId: (req as any).user.id } }); if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const source = await prisma.version.findFirst({ where: { id: versionId, projectId: project.id } }); if (!source) return fail(res, 404, 'NOT_FOUND', 'Version not found'); const latest = await prisma.version.findFirst({ where: { projectId: id }, orderBy: { number: 'desc' }, select: { number: true } }); if ((latest?.number ?? 0) >= 100) return fail(res, 409, 'VERSION_LIMIT', 'Version limit reached; start a new project to continue'); const restored = await prisma.version.create({ data: { projectId: project.id, number: (latest?.number ?? 0) + 1, prompt: `Restore version ${source.number}`, summary: `Restored from version ${source.number}`, templateId: source.templateId, options: source.options as Prisma.InputJsonObject, files: source.files as Prisma.InputJsonValue, warnings: source.warnings as Prisma.InputJsonValue } }); await prisma.project.update({ where: { id: project.id }, data: { activeVersionId: restored.id } }); res.status(201).json({ version: restored }); });

app.get('/api/v1/usage/me', auth, async (req, res) => {
  const userId = (req as any).user.id as string; const since = new Date(Date.now() - 30 * 86400000);
  const [jobs, usage] = await Promise.all([
    prisma.generationJob.count({ where: { project: { ownerId: userId }, createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.usage.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true }, _count: true }),
  ]);
  res.json({ dailyGenerationLimit: 20, generationsLast24Hours: jobs, usageLast30Days: { requests: usage._count, inputTokens: usage._sum.inputTokens ?? 0, outputTokens: usage._sum.outputTokens ?? 0 } });
});
app.get('/api/v1/projects/:id/export.zip', auth, async (req, res, next) => {
  try {
    const project = await ownerProject(z.string().min(1).max(64).parse(req.params.id), (req as any).user.id);
    if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    const version = project.versions.find((item) => item.id === project.activeVersionId) ?? project.versions.at(-1);
    if (!version) return fail(res, 404, 'NO_FILES', 'Project has no files to export');
    const archive = createSafeZip(version.files, 5_000_000);
    await writeAudit((req as any).user.id, 'project.exported', project.id);
    const safeName = project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
    res.setHeader('content-type', 'application/zip'); res.setHeader('content-length', archive.length); res.setHeader('content-disposition', `attachment; filename="${safeName}-v${version.number}.zip"`); res.send(archive);
  } catch (error) { next(error); }
});
app.get('/api/v1/projects/:id/deployment-preparation.zip', auth, async (req, res, next) => {
  try {
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const userId = (req as any).user.id as string;
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true, name: true, activeVersionId: true } });
    if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    if (!project.activeVersionId) return fail(res, 409, 'NO_FILES', 'Generate and save a project version before preparing deployment files.');
    const version = await prisma.version.findFirst({ where: { id: project.activeVersionId, projectId }, select: { files: true } });
    if (!version) return fail(res, 404, 'NO_FILES', 'The active project version could not be found.');
    const files = projectFilesSchema.parse(version.files);
    const deployment = createDeploymentPackage(files, project.name);
    const conflicts = deployment.files.filter((generated) => files.some((file) => file.path.toLowerCase() === generated.path.toLowerCase()));
    if (conflicts.length) return fail(res, 409, 'DEPLOYMENT_CONFIG_CONFLICT', `The project already contains ${conflicts.map((file) => file.path).join(', ')}. Resolve those files before preparing manifests.`);
    const archive = createSafeZip([...files, ...deployment.files], 5_000_000);
    await writeAudit(userId, 'project.deployment_prepared', projectId);
    const safeName = project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
    res.setHeader('content-type', 'application/zip'); res.setHeader('content-length', archive.length); res.setHeader('content-disposition', `attachment; filename="${safeName}-deployment-preparation.zip"`); res.send(archive);
  } catch (error) { if (error instanceof DeploymentPreparationError) return fail(res, 422, 'DEPLOYMENT_MANIFEST_INVALID', error.message); next(error); }
});
app.post('/api/v1/projects/:id/github/pull-request', rateLimit(2, 60 * 60_000, false), auth, async (req, res, next) => {
  try {
    const body = z.object({
      owner: z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/),
      repository: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,100}$/),
      baseBranch: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._/-]+$/).refine((value) => !value.includes('..')).optional(),
      title: z.string().trim().min(1).max(120),
      body: z.string().max(5000).default(''),
    }).strict().parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const userId = (req as any).user.id as string;
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true, activeVersionId: true } });
    if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    if (!process.env.GITHUB_TOKEN) return fail(res, 503, 'GITHUB_NOT_CONFIGURED', 'GitHub publishing is not configured on this D-GUY server.');
    const allowedRepositories = new Set((process.env.GITHUB_ALLOWED_REPOSITORIES || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (!allowedRepositories.has(`${body.owner}/${body.repository}`.toLowerCase())) return fail(res, 403, 'GITHUB_REPOSITORY_DENIED', 'That repository is not enabled for publishing on this D-GUY server.');
    if (!project.activeVersionId) return fail(res, 409, 'NO_FILES', 'Generate and save a project version before creating a pull request.');
    const version = await prisma.version.findFirst({ where: { id: project.activeVersionId, projectId }, select: { id: true, files: true, summary: true } });
    const files = version ? projectFilesSchema.parse(version.files) : [];
    if (!files.length) return fail(res, 409, 'NO_FILES', 'The active project version has no files to publish.');
    const result = await publishProjectPullRequest(body, files, project.id, process.env.GITHUB_TOKEN);
    await writeAudit(userId, 'project.github_pr_created', projectId);
    res.status(201).json({ pullRequest: result });
  } catch (error) {
    if (error instanceof GitHubIntegrationError) {
      const code = error.code === 'not_configured' ? 'GITHUB_NOT_CONFIGURED' : error.code === 'repository_denied' ? 'GITHUB_REPOSITORY_DENIED' : 'GITHUB_REQUEST_FAILED';
      const message = error.code === 'repository_denied' ? 'The configured GitHub token cannot push to that repository.' : error.code === 'not_configured' ? 'GitHub publishing is not configured on this D-GUY server.' : 'GitHub could not create the branch and pull request. Check the repository and base branch.';
      return fail(res, error.code === 'not_configured' ? 503 : error.code === 'repository_denied' ? 403 : 502, code, message);
    }
    next(error);
  }
});
app.post('/api/v1/projects/:id/generations', rateLimit(10, 60_000, false), auth, async (req, res, next) => {
  try {
    const body = z.object({ prompt: z.string().trim().min(1).max(4000), templateId: z.enum(['restaurant', 'saas', 'portfolio']).default('saas'), options: z.record(z.string(), z.unknown()).default({}), mode: z.enum(['create', 'revise']).default('create') }).strict().parse(req.body);
    const userId = (req as any).user.id as string; const project = await ownerProject(z.string().min(1).max(64).parse(req.params.id), userId);
    if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    const headerKey = req.get('idempotency-key');
    if (headerKey && !/^[a-zA-Z0-9._:-]{8,100}$/.test(headerKey)) return fail(res, 400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8 to 100 safe characters');
    const requestKey = headerKey ? `${userId}:${headerKey}` : undefined;
    if (requestKey) {
      const existing = await prisma.generationJob.findUnique({ where: { requestKey } });
      if (existing) { if (existing.projectId !== project.id) return fail(res, 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another project'); return res.status(202).json({ job: { id: existing.id, status: existing.status, progress: existing.status === 'complete' ? 100 : null } }); }
    }
    const since = new Date(Date.now() - 86400000);
    if (activeControllers.size >= 20) return fail(res, 429, 'SERVER_CONCURRENCY_LIMIT', 'Generation capacity is full');
    const [daily, active, globalActive] = await Promise.all([
      prisma.generationJob.count({ where: { project: { ownerId: userId }, createdAt: { gte: since } } }),
      prisma.generationJob.count({ where: { project: { ownerId: userId }, status: { in: ['queued', 'running'] } } }),
      prisma.generationJob.count({ where: { status: { in: ['queued', 'running'] } } }),
    ]);
    if (daily >= 20) return fail(res, 429, 'QUOTA_EXCEEDED', 'Daily generation limit reached');
    if (active >= 2) return fail(res, 429, 'CONCURRENCY_LIMIT', 'Two generations are already running');
    if (globalActive >= 20) return fail(res, 429, 'SERVER_CONCURRENCY_LIMIT', 'Generation capacity is full');
    const activeVersion = project.versions.find((item) => item.id === project.activeVersionId) ?? project.versions.at(-1);
    const contextFiles = activeVersion?.files ?? [];
    if (Buffer.byteLength(JSON.stringify(contextFiles), 'utf8') > 50_000) return fail(res, 413, 'CONTEXT_TOO_LARGE', 'Current project context exceeds 50 KB');
    const job = await prisma.generationJob.create({ data: { projectId: project.id, prompt: body.prompt, status: 'queued', requestKey, contextFiles: contextFiles as any } });
    await writeAudit(userId, 'generation.started', job.id);
    res.status(202).json({ job: { id: job.id, status: job.status, progress: 0 } });
    void generate(job.id, project.id, userId, { ...body, contextFiles }).catch((error) => logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError', jobId: job.id, providerFailures: error instanceof GenerationFailure ? error.failures : undefined }, 'generation failed'));
  } catch (error) { next(error); }
});
async function generate(jobId: string, projectId: string, userId: string, input: { prompt: string; templateId: string; options: Record<string, unknown>; mode: 'create' | 'revise'; contextFiles: unknown }) {
  const controller = new AbortController(); activeControllers.set(jobId, controller);
  await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'running' } });
  try {
  publishGeneration(jobId, 'stage', { id: 'planning', label: 'Analyzing requirements and planning the file structure' });
  const generated = await generateVanillaWebsiteWithFallback(
    { prompt: input.prompt, currentFiles: input.contextFiles, mode: input.mode },
    {
      groq: {
        baseUrl: groqBaseUrl,
        apiKey: process.env.GROQ_API_KEY!,
        model: input.mode === 'create' ? aiModels.coding : aiModels.reasoning,
        timeoutMs: groqTimeoutMs,
      },
      gemini: {
        baseUrl: geminiBaseUrl,
        apiKey: process.env.GEMINI_API_KEY!,
        model: aiModels.fallback,
        timeoutMs: geminiTimeoutMs,
      },
      ...(openRouterConfig ? { openRouter: openRouterConfig } : {}),
      totalTimeoutMs: generationTotalTimeoutMs,
      ...(huggingFaceConfig ? { huggingFace: huggingFaceConfig } : {}),
    },
    controller.signal,
    fetch,
    (event: GenerationEvent) => {
      if (event.type === 'provider') publishGeneration(jobId, 'stage', { id: 'generating', label: 'Generating project files with AI' });
      if (event.type === 'delta') publishGeneration(jobId, 'delta', { provider: event.provider, characters: event.text.length });
      if (event.type === 'provider' || event.type === 'file' || event.type === 'file_started' || event.type === 'file_delta' || event.type === 'retry') publishGeneration(jobId, event.type, event);
    },
    (event: GeminiDiagnosticEvent) => logger.info({ jobId, model: aiModels.fallback, ...event }, 'Gemini request diagnostic'),
  );
  const files = mergeGeneratedFiles(input.contextFiles, generated.files, input.mode);
  publishGeneration(jobId, 'stage', { id: 'validating', label: 'Checking responsive website output' });
  if (!files.some((file) => file.path === 'package.json') && ['index.html', 'styles.css', 'app.js'].every((path) => files.some((file) => file.path === path))) {
    validateVanillaProject(files, generated.provider ?? 'gemini');
  }
  for (const file of files) publishGeneration(jobId, 'file', { path: file.path });
  publishGeneration(jobId, 'stage', { id: 'saving', label: 'Saving the project version to Supabase' });
  const version = await persistGeneratedVersion(prisma, { jobId, projectId, userId, prompt: input.prompt, templateId: input.templateId, options: input.options, generated: { ...generated, files } });
  publishGeneration(jobId, 'complete', { status: 'complete', versionId: version.id });
  return version;
  } catch (error) {
    const errorCode = controller.signal.aborted
      ? 'CANCELLED'
      : error instanceof GenerationFailure ? storedGenerationFailure(error.message) : 'GENERATION_FAILED';
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: controller.signal.aborted ? 'cancelled' : 'failed', errorCode, finishedAt: new Date() } });
    await writeAudit(userId, controller.signal.aborted ? 'generation.cancelled' : 'generation.failed', jobId);
    const errorMessage = error instanceof GenerationFailure ? error.message : 'AI generation did not complete. The previous version remains available.';
    publishGeneration(jobId, controller.signal.aborted ? 'cancelled' : 'failed', { status: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted ? 'Generation was cancelled.' : errorMessage });
    throw error;
  } finally { activeControllers.delete(jobId); }
}
app.get('/api/v1/generations/:jobId', auth, async (req, res) => {
  const id = z.string().min(1).max(64).parse(req.params.jobId);
  const job = await prisma.generationJob.findFirst({ where: { id, project: { ownerId: (req as any).user.id } } });
  if (!job) return fail(res, 404, 'NOT_FOUND', 'Generation not found');
  res.json({ job: { id: job.id, status: job.status, progress: job.status === 'complete' ? 100 : job.status === 'queued' ? 0 : null, errorCode: job.errorCode } });
});
app.get('/api/v1/generations/:jobId/events', auth, async (req, res) => {
  const id = z.string().min(1).max(64).parse(req.params.jobId);
  const job = await prisma.generationJob.findFirst({ where: { id, project: { ownerId: (req as any).user.id } } });
  if (!job) return fail(res, 404, 'NOT_FOUND', 'Generation not found');
  res.status(200);
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();
  const terminalError = job.status === 'failed' || job.status === 'cancelled'
    ? generationFailureForClient(job.errorCode)
    : undefined;
  res.write(`event: status\ndata: ${JSON.stringify({ status: job.status, ...(terminalError ? { error: terminalError } : {}) })}\n\n`);
  if (['complete', 'failed', 'cancelled'].includes(job.status)) { res.end(); return; }
  const cursorValue = req.get('Last-Event-ID');
  const cursor = cursorValue && /^\d{1,12}$/.test(cursorValue) ? Number(cursorValue) : 0;
  const replay = generationEventHistory.readAfter(id, cursor);
  for (const frame of replay) {
    if (res.writableLength > 1_000_000) { res.end(); return; }
    res.write(`id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
  }
  const replayTerminal = replay.at(-1)?.event;
  if (replayTerminal && ['complete', 'failed', 'cancelled'].includes(replayTerminal)) { res.end(); return; }
  const clients = generationClients.get(id) ?? new Set<express.Response>();
  clients.add(res); generationClients.set(id, clients);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(heartbeat); clients.delete(res);
    if (!clients.size) generationClients.delete(id);
  });
});
app.post('/api/v1/generations/:jobId/cancel', auth, async (req, res) => {
  const id = z.string().min(1).max(64).parse(req.params.jobId);
  const job = await prisma.generationJob.findFirst({ where: { id, project: { ownerId: (req as any).user.id } } });
  if (!job) return fail(res, 404, 'NOT_FOUND', 'Generation not found');
  if (job.status === 'queued') { await prisma.generationJob.update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date() } }); return res.json({ status: 'cancelled' }); }
  const controller = activeControllers.get(id);
  if (job.status === 'running' && controller) { controller.abort(); return res.json({ status: 'cancellation_requested' }); }
  res.json({ status: job.status });
});

  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError) {
      const fields = requestValidationFields(err);
      logger.warn({ requestId: res.locals.requestId, method: req.method, path: req.path, fields, issueCodes: err.issues.map((issue) => issue.code) }, 'request validation failed');
      return fail(res, 400, 'VALIDATION_ERROR', requestValidationMessage(fields));
    }
    if (err?.type === 'entity.too.large') return fail(res, 413, 'BODY_TOO_LARGE', 'Request body exceeds 1 MB');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    if (err?.code === 'P2002') return fail(res, 409, 'CONFLICT', 'Resource already exists');
    if (['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2010', 'P2021'].includes(err?.code)) {
      logger.error({ code: err.code }, 'database request unavailable');
      return fail(res, 503, 'DATABASE_UNAVAILABLE', 'Account and project storage is temporarily unavailable.');
    }
    logger.error({ errorName: err instanceof Error ? err.name : 'UnknownError', code: typeof err?.code === 'string' ? err.code : undefined }, 'request failed');
    fail(res, 500, 'INTERNAL_ERROR', 'Request could not be completed');
  });
const server = app.listen(port, () => logger.info({ port }, 'D-GUY API listening'));
const processStartedAt = new Date();
void failInterruptedGenerations(prisma, processStartedAt).then((count) => {
  if (count > 0) logger.warn({ count }, 'marked unfinished generation jobs interrupted by process restart');
}).catch((error) => logger.error({ category: databaseFailureCategory(error) }, 'generation startup recovery failed'));
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

let shutdownStarted = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info({ signal }, 'D-GUY API graceful shutdown started');
  for (const controller of activeControllers.values()) controller.abort(new Error('API is shutting down'));
  for (const clients of generationClients.values()) for (const client of clients) client.end();
  generationClients.clear();

  const forceTimer = setTimeout(() => {
    logger.error({ signal }, 'D-GUY API graceful shutdown timed out');
    server.closeAllConnections();
    process.exit(1);
  }, 15_000);
  server.close((closeError) => {
    void (async () => {
      if (closeError) {
        logger.error({ signal, errorName: closeError.name }, 'HTTP server close failed');
        process.exitCode = 1;
      }
      const drainDeadline = Date.now() + 10_000;
      while (activeControllers.size > 0 && Date.now() < drainDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (activeControllers.size > 0) logger.warn({ activeGenerations: activeControllers.size }, 'generation shutdown drain deadline elapsed');
      try {
        await prisma.$disconnect();
      } catch (error) {
        logger.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'database disconnect failed during shutdown');
        process.exitCode = 1;
      } finally {
        clearTimeout(forceTimer);
        logger.info({ signal }, 'D-GUY API graceful shutdown complete');
      }
    })();
  });
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
