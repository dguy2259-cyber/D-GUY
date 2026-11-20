/*
 Express request augmentation is kept local to this service; refine to typed request state as route modules split out. */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { config as loadEnv } from 'dotenv';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import express from 'express';
import type { RequestHandler } from 'express';
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
import { generateVanillaWebsiteWithFallback, GenerationFailure, ProviderFailure, validateGeneratedStaticWebsite, verifyGeminiModel, verifyGroqModels } from './ai/provider.js';
import type { GeminiDiagnosticEvent, GenerationEvent } from './ai/provider.js';
import { persistGeneratedVersion, ProjectVersionConflictError } from './generation/persistence.js';
import { persistOrKeepPreview } from './generation/previewSave.js';
import { buildGenerationPrompt } from './generation/buildPrompt.js';
import { GenerationEventHistory } from './generation/eventHistory.js';
import { generationFailureForClient, safeGenerationFailureMessage, storedGenerationFailure } from './generation/failure.js';
import { failInterruptedGenerations } from './generation/recovery.js';
import { classifyRuntimeError, containsCredentialLikeValue, createRecoveryPrompt, MAX_RECOVERY_ATTEMPTS, normalizeRuntimeError, redactRuntimeText, recoveryRetryPolicy, runtimeErrorReportSchema, validateRecoveryPatch } from './recovery/runtimeError.js';
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

// Vercel's TypeScript checker resolves Helmet's CommonJS declaration as a module namespace.
// Load the package's actual CommonJS export; validate it before adapting its type for Express.
const nodeRequire = createRequire(import.meta.url);
const helmetExport: unknown = nodeRequire('helmet');
if (typeof helmetExport !== 'function') throw new TypeError('Helmet did not export a middleware factory.');
const helmetFactory = helmetExport as () => unknown;
const helmetMiddleware = helmetFactory();
if (typeof helmetMiddleware !== 'function') throw new TypeError('Helmet did not return an Express middleware.');

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
// Provider fallback is configured by PROVIDER_ORDER; the legacy
// AI_FALLBACK_PROVIDER setting is intentionally ignored for compatibility.
const groqBaseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const geminiBaseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const openRouterBaseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
for (const [label, value] of [['GROQ_BASE_URL', groqBaseUrl], ['GEMINI_BASE_URL', geminiBaseUrl], ['OPENROUTER_BASE_URL', openRouterBaseUrl]] as const) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment`);
}
if (![process.env.GROQ_API_KEY, process.env.GEMINI_API_KEY, process.env.OPENROUTER_API_KEY].some(Boolean)) {
  throw new Error('Configure at least one of GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY for real generation');
}
const firstByteTimeoutMs = z.coerce.number().int().min(1_000).max(120_000).default(30_000).parse(process.env.FIRST_BYTE_TIMEOUT_MS);
const streamIdleTimeoutMs = z.coerce.number().int().min(1_000).max(120_000).default(30_000).parse(process.env.STREAM_IDLE_TIMEOUT_MS);
const configuredTotalDeadlineMs = z.coerce.number().int().min(1_000).max(120_000).default(60_000).parse(process.env.TOTAL_DEADLINE_MS);
const totalDeadlineMs = Math.min(configuredTotalDeadlineMs, 60_000);
if (configuredTotalDeadlineMs > totalDeadlineMs) {
  logger.warn({ configuredTotalDeadlineMs, totalDeadlineMs }, 'per-provider total deadline is capped at 60000ms');
}
const huggingFaceTimeoutMs = z.coerce.number().int().min(1_000).max(120_000).default(10_000).parse(process.env.HF_TIMEOUT_MS);
const configuredGenerationTimeoutMs = z.coerce.number().int().min(30_000).max(360_000).default(120_000).parse(process.env.AI_GENERATION_TOTAL_TIMEOUT_MS);
const generationTotalTimeoutMs = Math.min(configuredGenerationTimeoutMs, 120_000);
if (configuredGenerationTimeoutMs > generationTotalTimeoutMs) {
  logger.warn({ configuredGenerationTimeoutMs, generationTotalTimeoutMs }, 'website generation deadline is capped at 120000ms');
}
const supabaseAuthTimeoutMs = z.coerce.number().int().min(1_000).max(30_000).default(12_000).parse(process.env.SUPABASE_AUTH_TIMEOUT_MS);
const providerOrder = z.array(z.enum(['groq', 'gemini', 'openrouter'])).min(1)
  .refine((providers) => new Set(providers).size === providers.length, 'PROVIDER_ORDER must not contain duplicates')
  .parse((process.env.PROVIDER_ORDER ?? 'groq,gemini,openrouter').split(',').map((provider) => provider.trim()).filter(Boolean));
const singleRequestMode = z.enum(['true', 'false']).default('true')
  .parse((process.env.SINGLE_REQUEST_MODE ?? 'true').toLowerCase()) === 'true';
const aiModels = {
  reasoning: process.env.AI_MODEL || 'openai/gpt-oss-120b',
  coding: process.env.AI_CODER_MODEL || 'openai/gpt-oss-120b',
  fallback: process.env.GEMINI_MODEL || process.env.AI_FALLBACK_MODEL || 'gemini-2.5-flash',
};
if (!process.env.GROQ_API_KEY) logger.warn({ provider: 'groq', reason: 'missing_api_key' }, 'AI provider skipped at startup');
if (!process.env.GEMINI_API_KEY) logger.warn({ provider: 'gemini', reason: 'missing_api_key' }, 'AI provider skipped at startup');
if (!process.env.OPENROUTER_API_KEY) logger.warn({ provider: 'openrouter', reason: 'missing_api_key' }, 'AI provider skipped at startup');
if (process.env.GEMINI_API_KEY) {
  const configuredModel = aiModels.fallback;
  const verification = await verifyGeminiModel(geminiBaseUrl, process.env.GEMINI_API_KEY, configuredModel);
  aiModels.fallback = verification.model;
  if (verification.fallbackUsed) {
    logger.warn({ configuredModel, selectedModel: verification.model, reason: verification.reason }, 'configured Gemini model is unavailable; using the known-good fallback');
  } else if (!verification.verified) {
    logger.warn({ model: configuredModel, reason: verification.reason }, 'Gemini model list could not be verified; retaining the configured model');
  } else {
    logger.info({ model: verification.model }, 'Gemini model verified');
  }
}
const groqModelsToVerify = process.env.GROQ_MODEL
  ? [process.env.GROQ_MODEL]
  : [...new Set([aiModels.coding, aiModels.reasoning])];
if (process.env.GROQ_API_KEY) {
  const verification = await verifyGroqModels(groqBaseUrl, process.env.GROQ_API_KEY, groqModelsToVerify);
  if (!verification.verified) {
    logger.warn({
      models: groqModelsToVerify,
      missingModels: verification.missingModels,
      reason: verification.reason,
    }, 'Groq model verification failed; provider fallback will remain available');
  } else {
    logger.info({ models: groqModelsToVerify }, 'Groq models verified');
  }
}
const openRouterConfig = process.env.OPENROUTER_API_KEY ? {
  baseUrl: openRouterBaseUrl,
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL || '',
  firstByteTimeoutMs,
  streamIdleTimeoutMs,
  totalDeadlineMs,
} : undefined;
if (openRouterConfig && !openRouterConfig.model) throw new Error('OPENROUTER_MODEL is required when OPENROUTER_API_KEY is configured');
logger.info({ providerOrder, singleRequestMode, gemini: aiModels.fallback, groqConfigured: !!process.env.GROQ_API_KEY, openRouterConfigured: !!openRouterConfig, firstByteTimeoutMs, streamIdleTimeoutMs, totalDeadlineMs }, 'website generation provider routing configured');
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
app.use(helmetMiddleware as RequestHandler);
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
let groqRateLimitSnapshot: { model: string; observedAt: number; rateLimit: NonNullable<GeminiDiagnosticEvent['rateLimit']>; cooldownUntil?: number } | null = null;
let groqProviderState: 'ready' | 'cooldown' | 'unavailable' = 'ready';
type GenerationSaveStatus = { state: 'retrying' | 'saved' | 'failed'; versionId?: string; updatedAt: number };
type PendingVersionSave = { input: Parameters<typeof persistGeneratedVersion>[1]; attempts: number; timer?: ReturnType<typeof setTimeout> };
const generationSaveStates = new Map<string, GenerationSaveStatus>();
const pendingVersionSaves = new Map<string, PendingVersionSave>();
let shutdownStarted = false;
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
function setGenerationSaveState(jobId: string, state: Omit<GenerationSaveStatus, 'updatedAt'>) {
  generationSaveStates.set(jobId, { ...state, updatedAt: Date.now() });
  if (generationSaveStates.size > 500) {
    const oldest = [...generationSaveStates.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0]?.[0];
    if (oldest) generationSaveStates.delete(oldest);
  }
}
function scheduleVersionPersistenceRetry(jobId: string, input: Parameters<typeof persistGeneratedVersion>[1]) {
  if (shutdownStarted) {
    setGenerationSaveState(jobId, { state: 'failed' });
    return;
  }
  if (!pendingVersionSaves.has(jobId) && pendingVersionSaves.size >= 100) {
    setGenerationSaveState(jobId, { state: 'failed' });
    logger.error({ jobId }, 'generated preview is ready, but background save capacity is full');
    return;
  }
  const pending = pendingVersionSaves.get(jobId) ?? { input, attempts: 0 };
  pendingVersionSaves.set(jobId, pending);
  setGenerationSaveState(jobId, { state: 'retrying' });
  const retry = async () => {
    pending.attempts += 1;
    try {
      const version = await persistGeneratedVersion(prisma, pending.input);
      pendingVersionSaves.delete(jobId);
      setGenerationSaveState(jobId, { state: 'saved', versionId: version.id });
      publishGeneration(jobId, 'saved', { versionId: version.id });
      logger.info({ jobId, attempt: pending.attempts }, 'background project-version save succeeded');
    } catch (error) {
      if (shutdownStarted || pending.attempts >= 8) {
        pendingVersionSaves.delete(jobId);
        setGenerationSaveState(jobId, { state: 'failed' });
        logger.error({ jobId, attempts: pending.attempts, category: databaseFailureCategory(error), errorName: error instanceof Error ? error.name : 'UnknownError' }, 'background project-version save retries exhausted; preview remains available in the active browser session');
        return;
      }
      const delayMs = Math.min(60_000, 1_000 * 2 ** (pending.attempts - 1));
      logger.warn({ jobId, attempt: pending.attempts, retryInMs: delayMs, category: databaseFailureCategory(error), errorName: error instanceof Error ? error.name : 'UnknownError' }, 'background project-version save failed; retry scheduled');
      pending.timer = setTimeout(() => { void retry(); }, delayMs);
      pending.timer.unref();
    }
  };
  pending.timer = setTimeout(() => { void retry(); }, 1_000);
  pending.timer.unref();
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
const projectSelect = {
  id: true,
  ownerId: true,
  name: true,
  messages: true,
  activeVersionId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;
const ownerProject = async (id: string, ownerId: string) => prisma.project.findFirst({
  where: { id, ownerId },
  select: {
    ...projectSelect,
    versions: { orderBy: { number: 'desc' }, take: 1 },
  },
});
const recoverySchemaCacheMs = 30_000;
let recoverySchemaState: { available: boolean; checkedAt: number } | undefined;
async function hasRuntimeRecoverySchema() {
  const now = Date.now();
  if (recoverySchemaState && now - recoverySchemaState.checkedAt < recoverySchemaCacheMs) return recoverySchemaState.available;
  const result = await databasePool.query<{
    projectColumn: boolean;
    sessionTable: boolean;
    attemptTable: boolean;
  }>(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'Project'
          AND column_name = 'autoRecoveryEnabled'
      ) AS "projectColumn",
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'RuntimeRecoverySession'
      ) AS "sessionTable",
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'RuntimeRecoveryAttempt'
      ) AS "attemptTable"
  `);
  const schema = result.rows[0];
  if (!schema) throw new Error('Recovery schema readiness query returned no result.');
  recoverySchemaState = { available: schema.projectColumn && schema.sessionTable && schema.attemptTable, checkedAt: now };
  return recoverySchemaState.available;
}
async function requireRuntimeRecoverySchema(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    if (!await hasRuntimeRecoverySchema()) return fail(res, 503, 'SCHEMA_NOT_READY', 'A required database migration has not been applied.');
    next();
  } catch (error) { next(error); }
}
const ownerRecoverySession = (projectId: string, sessionId: string, ownerId: string) => prisma.runtimeRecoverySession.findFirst({
  where: { id: sessionId, projectId, project: { ownerId } },
  include: {
    project: { select: { autoRecoveryEnabled: true } },
    attempts: { orderBy: { attemptNumber: 'desc' }, take: MAX_RECOVERY_ATTEMPTS },
  },
});
class RecoveryNeedsApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryNeedsApprovalError';
  }
}
const emailSchema = z.string().email().max(254).transform((v) => v.toLowerCase());
const writeAudit = (userId: string, action: string, resourceId?: string) => prisma.auditEvent.create({ data: { userId, action, resourceId } }).catch((error) => logger.error({ code: (error as any)?.code, action }, 'audit event could not be stored'));

app.get('/api/v1/health', (_req, res) => {
  const labels: Record<string, string> = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter' };
  const providers = providerOrder.filter((provider) => provider !== 'openrouter' || openRouterConfig).map((provider) => labels[provider]);
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
app.get('/api/v1/projects', auth, async (req, res, next) => { try { const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page); const limit = z.coerce.number().int().min(1).max(20).default(20).parse(req.query.limit); const ownerId = (req as any).user.id; res.json({ projects: await prisma.project.findMany({ where: { ownerId }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: { ...projectSelect, versions: { orderBy: { number: 'desc' }, take: 100, select: { id: true, number: true, prompt: true, summary: true, templateId: true, options: true, warnings: true, createdAt: true } } } }) }); } catch (e) { next(e); } });
app.post('/api/v1/projects', auth, async (req, res, next) => { try { const body = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(req.body); const ownerId = (req as any).user.id; if (await prisma.project.count({ where: { ownerId } }) >= 20) return fail(res, 429, 'PROJECT_LIMIT', 'Project limit reached'); const p = await prisma.project.create({ data: { ownerId, name: body.name, autoRecoveryEnabled: true }, select: projectSelect }); res.status(201).json({ project: { ...p, versions: [] } }); } catch (e) { next(e); } });
app.get('/api/v1/projects/:id', auth, async (req, res) => {
  const id = z.string().min(1).max(64).parse(req.params.id); const ownerId = (req as any).user.id as string;
  const project = await prisma.project.findFirst({ where: { id, ownerId }, select: projectSelect });
  if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
  const versions = await prisma.version.findMany({ where: { projectId: id }, orderBy: { number: 'desc' }, take: 100, select: { id: true, projectId: true, number: true, prompt: true, summary: true, templateId: true, options: true, warnings: true, createdAt: true } });
  const activeFiles = project.activeVersionId ? (await prisma.version.findFirst({ where: { id: project.activeVersionId, projectId: id }, select: { files: true } }))?.files : undefined;
  res.json({ project: { ...project, versions: versions.map((version) => ({ ...version, files: version.id === project.activeVersionId ? activeFiles ?? [] : [] })) } });
});
app.patch('/api/v1/projects/:id', auth, async (req, res, next) => { try { const body = z.object({ name: z.string().trim().min(1).max(120), messages: z.array(z.object({ id: z.string().max(100), role: z.enum(['user', 'assistant']), text: z.string().max(10000) })).max(200).optional() }).strict().parse(req.body); const found = await ownerProject(z.string().min(1).max(64).parse(req.params.id), (req as any).user.id); if (!found) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const p = await prisma.project.update({ where: { id: found.id }, data: body, select: projectSelect }); res.json({ project: p }); } catch (e) { next(e); } });
app.delete('/api/v1/projects/:id', auth, async (req, res) => { const found = await prisma.project.findFirst({ where: { id: z.string().min(1).max(64).parse(req.params.id), ownerId: (req as any).user.id, }, select: { id: true } }); if (!found) return fail(res, 404, 'NOT_FOUND', 'Project not found'); await prisma.project.delete({ where: { id: found.id }, select: { id: true } }); await writeAudit((req as any).user.id, 'project.deleted', found.id); res.status(204).end(); });
app.get('/api/v1/projects/:id/files', auth, async (req, res) => { const p = await ownerProject(z.string().min(1).max(64).parse(req.params.id), (req as any).user.id); if (!p) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const v = p.versions.find((item) => item.id === p.activeVersionId) ?? p.versions.at(-1); res.json({ files: v?.files ?? [] }); });
app.put('/api/v1/projects/:id/files', auth, async (req, res, next) => { try { const files = projectFilesSchema.parse(req.body.files); const p = await ownerProject(z.string().min(1).max(64).parse(req.params.id), (req as any).user.id); if (!p) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const number = p.versions[0]?.number ?? 0; if (number >= 100) return fail(res, 409, 'VERSION_LIMIT', 'Version limit reached; start a new project to continue'); const version = await prisma.version.create({ data: { projectId: p.id, number: number + 1, prompt: 'Manual file update', summary: 'Files updated', templateId: 'custom', options: {}, files } }); await prisma.project.update({ where: { id: p.id }, data: { activeVersionId: version.id }, select: { id: true } }); res.status(201).json({ version }); } catch (e) { next(e); } });
app.get('/api/v1/projects/:id/versions', auth, async (req, res, next) => { try { const id = z.string().min(1).max(64).parse(req.params.id); const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page); const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit); const project = await prisma.project.findFirst({ where: { id, ownerId: (req as any).user.id }, select: { id: true } }); if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const versions = await prisma.version.findMany({ where: { projectId: id }, orderBy: { number: 'desc' }, skip: (page - 1) * limit, take: limit, select: { id: true, projectId: true, number: true, prompt: true, summary: true, templateId: true, options: true, warnings: true, createdAt: true } }); res.json({ versions: versions.map((version) => ({ ...version, files: [] })) }); } catch (error) { next(error); } });
app.get('/api/v1/projects/:id/versions/:versionId', auth, async (req, res) => { const id = z.string().min(1).max(64).parse(req.params.id); const versionId = z.string().min(1).max(64).parse(req.params.versionId); const project = await prisma.project.findFirst({ where: { id, ownerId: (req as any).user.id }, select: { id: true } }); if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const version = await prisma.version.findFirst({ where: { id: versionId, projectId: project.id } }); if (!version) return fail(res, 404, 'NOT_FOUND', 'Version not found'); res.json({ version }); });
app.post('/api/v1/projects/:id/versions/:versionId/restore', auth, async (req, res) => { const id = z.string().min(1).max(64).parse(req.params.id); const versionId = z.string().min(1).max(64).parse(req.params.versionId); const project = await prisma.project.findFirst({ where: { id, ownerId: (req as any).user.id }, select: { id: true } }); if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found'); const source = await prisma.version.findFirst({ where: { id: versionId, projectId: project.id } }); if (!source) return fail(res, 404, 'NOT_FOUND', 'Version not found'); const latest = await prisma.version.findFirst({ where: { projectId: id }, orderBy: { number: 'desc' }, select: { number: true } }); if ((latest?.number ?? 0) >= 100) return fail(res, 409, 'VERSION_LIMIT', 'Version limit reached; start a new project to continue'); const restored = await prisma.version.create({ data: { projectId: project.id, number: (latest?.number ?? 0) + 1, prompt: `Restore version ${source.number}`, summary: `Restored from version ${source.number}`, templateId: source.templateId, options: source.options as Prisma.InputJsonObject, files: source.files as Prisma.InputJsonValue, warnings: source.warnings as Prisma.InputJsonValue } }); await prisma.project.update({ where: { id: project.id }, data: { activeVersionId: restored.id }, select: { id: true } }); res.status(201).json({ version: restored }); });

app.get('/api/v1/projects/:id/recovery', auth, requireRuntimeRecoverySchema, async (req, res) => {
  const projectId = z.string().min(1).max(64).parse(req.params.id);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: (req as any).user.id },
    select: { autoRecoveryEnabled: true, activeVersionId: true },
  });
  if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
  const sessions = await prisma.runtimeRecoverySession.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: MAX_RECOVERY_ATTEMPTS } },
  });
  res.json({ autoRecoveryEnabled: project.autoRecoveryEnabled, activeVersionId: project.activeVersionId, sessions });
});
app.patch('/api/v1/projects/:id/recovery-settings', auth, requireRuntimeRecoverySchema, async (req, res, next) => {
  try {
    const body = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const updated = await prisma.project.updateMany({
      where: { id: projectId, ownerId: (req as any).user.id },
      data: { autoRecoveryEnabled: body.enabled },
    });
    if (!updated.count) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    res.json({ autoRecoveryEnabled: body.enabled });
  } catch (error) { next(error); }
});
app.post('/api/v1/projects/:id/runtime-errors', rateLimit(20, 60_000), auth, requireRuntimeRecoverySchema, async (req, res, next) => {
  try {
    const body = runtimeErrorReportSchema.parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: (req as any).user.id },
      select: { id: true, activeVersionId: true, autoRecoveryEnabled: true },
    });
    if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    if (project.activeVersionId !== body.versionId) return fail(res, 409, 'STALE_RUNTIME_REPORT', 'The runtime error belongs to an inactive project version.');
    const decision = classifyRuntimeError(body);
    if (decision === 'expected') return res.json({ ignored: true, reason: 'expected_request_failure' });

    const normalized = normalizeRuntimeError(body);
    const recent = await prisma.runtimeRecoverySession.findFirst({
      where: { projectId, errorSignature: normalized.signature, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: MAX_RECOVERY_ATTEMPTS } },
    });
    if (recent) return res.json({ session: recent, autoRecoveryEnabled: project.autoRecoveryEnabled, deduplicated: true });

    const session = await prisma.runtimeRecoverySession.create({
      data: {
        projectId,
        sourceVersionId: project.activeVersionId,
        errorSignature: normalized.signature,
        environment: normalized.environment,
        category: normalized.category,
        message: normalized.message,
        stackTrace: normalized.stackTrace,
        sourceFile: normalized.sourceFile,
        line: normalized.line,
        column: normalized.column,
        status: decision === 'external_dependency' ? 'awaiting_approval' : 'detected',
        failureReason: decision === 'external_dependency' ? 'Dependency and network failures require manual review.' : undefined,
      },
      include: { attempts: true },
    });
    await writeAudit((req as any).user.id, 'runtime_error.detected', session.id);
    res.status(201).json({
      session,
      autoRecoveryEnabled: project.autoRecoveryEnabled,
      autoEligible: decision === 'defect',
    });
  } catch (error) { next(error); }
});
app.post('/api/v1/projects/:id/recovery/:sessionId/attempts', rateLimit(10, 60_000), auth, requireRuntimeRecoverySchema, async (req, res, next) => {
  try {
    const body = z.object({ manual: z.boolean().default(false) }).strict().parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const sessionId = z.string().min(1).max(64).parse(req.params.sessionId);
    const ownerId = (req as any).user.id as string;
    const session = await ownerRecoverySession(projectId, sessionId, ownerId);
    if (!session) return fail(res, 404, 'NOT_FOUND', 'Recovery session not found');
    if (session.status === 'paused') return fail(res, 409, 'RECOVERY_PAUSED', 'Resume this recovery session before retrying.');
    if (['recovered', 'rolled_back', 'awaiting_approval'].includes(session.status)) return fail(res, 409, 'RECOVERY_NOT_RETRYABLE', 'This recovery session requires manual review or is already complete.');
    if (session.attemptCount >= Math.min(session.maxAttempts, MAX_RECOVERY_ATTEMPTS)) return fail(res, 409, 'RECOVERY_LIMIT_REACHED', 'The automatic recovery attempt limit has been reached.');
    if (session.attempts.some((attempt) => ['generating', 'validating'].includes(attempt.status))) return fail(res, 409, 'RECOVERY_IN_PROGRESS', 'A recovery attempt is already in progress.');

    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId },
      select: { id: true, activeVersionId: true },
    });
    if (!project?.activeVersionId) return fail(res, 409, 'RECOVERY_VERSION_MISSING', 'A saved project version is required for recovery.');
    const currentVersion = await prisma.version.findFirst({
      where: { id: project.activeVersionId, projectId },
      select: { id: true, files: true },
    });
    if (!currentVersion) return fail(res, 409, 'RECOVERY_VERSION_MISSING', 'The active project version could not be loaded.');
    if (containsCredentialLikeValue(currentVersion.files)) return fail(res, 409, 'RECOVERY_SECRET_REVIEW', 'Automatic recovery is disabled because project source contains credential-like values.');

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), hashtext('runtime-recovery-daily'))`;
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "ownerId" = ${ownerId} FOR UPDATE`;
      const lockedProject = await tx.project.findFirst({
        where: { id: projectId, ownerId },
        select: { activeVersionId: true, autoRecoveryEnabled: true },
      });
      if (!lockedProject || lockedProject.activeVersionId !== currentVersion.id) return { kind: 'version_changed' as const };
      if (!body.manual && !lockedProject.autoRecoveryEnabled) return { kind: 'auto_disabled' as const };
      const otherActiveSession = await tx.runtimeRecoverySession.findFirst({
        where: { projectId, id: { not: sessionId }, status: { in: ['generating', 'validating'] } },
        select: { id: true },
      });
      if (otherActiveSession) return { kind: 'project_busy' as const };
      const dailyAttemptCount = await tx.runtimeRecoveryAttempt.count({
        where: { startedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) }, session: { project: { ownerId } } },
      });
      if (dailyAttemptCount >= 10) return { kind: 'daily_limit' as const };
      const current = await tx.runtimeRecoverySession.findFirst({
        where: { id: sessionId, projectId, project: { ownerId } },
        select: { attemptCount: true, maxAttempts: true, status: true },
      });
      if (!current || current.attemptCount >= Math.min(current.maxAttempts, MAX_RECOVERY_ATTEMPTS)) return { kind: 'state_changed' as const };
      if (['generating', 'validating'].includes(current.status)) return { kind: 'in_progress' as const };
      if (['paused', 'recovered', 'rolled_back', 'awaiting_approval'].includes(current.status)) return { kind: 'state_changed' as const };
      const changed = await tx.runtimeRecoverySession.updateMany({
        where: { id: sessionId, attemptCount: current.attemptCount, status: current.status },
        data: { attemptCount: { increment: 1 }, status: 'generating', failureReason: null },
      });
      if (changed.count !== 1) return { kind: 'state_changed' as const };
      const attempt = await tx.runtimeRecoveryAttempt.create({
        data: {
          sessionId,
          attemptNumber: current.attemptCount + 1,
          sourceVersionId: currentVersion.id,
          status: 'generating',
        },
      });
      return { kind: 'started' as const, attempt };
    });
    if (result.kind === 'daily_limit') return fail(res, 429, 'RECOVERY_DAILY_LIMIT', 'The daily automatic recovery limit has been reached.');
    if (result.kind === 'auto_disabled') return fail(res, 403, 'AUTO_RECOVERY_DISABLED', 'Automatic recovery is disabled for this project.');
    if (result.kind === 'project_busy' || result.kind === 'in_progress') return fail(res, 409, 'RECOVERY_IN_PROGRESS', 'Another recovery attempt is already active for this project.');
    if (result.kind === 'version_changed') return fail(res, 409, 'RECOVERY_VERSION_CHANGED', 'Project files changed before recovery began. Refresh and try again.');
    if (result.kind === 'state_changed') return fail(res, 409, 'RECOVERY_STATE_CHANGED', 'Recovery state changed. Refresh and try again.');
    const attempt = result.attempt;
    await writeAudit(ownerId, 'runtime_recovery.attempt_started', attempt.id);
    const promptSession = await prisma.runtimeRecoverySession.findUnique({ where: { id: sessionId } });
    if (!promptSession) return fail(res, 404, 'NOT_FOUND', 'Recovery session not found');
    const promptError = normalizeRuntimeError(runtimeErrorReportSchema.parse({
      versionId: promptSession.sourceVersionId,
      environment: promptSession.environment,
      category: promptSession.category,
      message: promptSession.message,
      stackTrace: promptSession.stackTrace ?? undefined,
      sourceFile: promptSession.sourceFile ?? undefined,
      line: promptSession.line ?? undefined,
      column: promptSession.column ?? undefined,
    }));
    res.status(201).json({ attempt, prompt: createRecoveryPrompt(promptError) });
  } catch (error) { next(error); }
});
app.post('/api/v1/projects/:id/recovery/:sessionId/attempts/:attemptId/validation', auth, requireRuntimeRecoverySchema, async (req, res, next) => {
  try {
    const body = z.object({
      candidateVersionId: z.string().min(1).max(64),
      passed: z.boolean(),
      message: z.string().max(1_000).optional(),
      error: runtimeErrorReportSchema.optional(),
    }).strict().parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const sessionId = z.string().min(1).max(64).parse(req.params.sessionId);
    const attemptId = z.string().min(1).max(64).parse(req.params.attemptId);
    const ownerId = (req as any).user.id as string;
    const session = await ownerRecoverySession(projectId, sessionId, ownerId);
    if (!session) return fail(res, 404, 'NOT_FOUND', 'Recovery session not found');
    const attempt = session.attempts.find((entry) => entry.id === attemptId);
    if (!attempt || attempt.status !== 'validating' || attempt.candidateVersionId !== body.candidateVersionId) return fail(res, 409, 'RECOVERY_CANDIDATE_MISMATCH', 'The candidate version is no longer awaiting validation.');
    if (session.status !== 'validating') return fail(res, 409, 'RECOVERY_SESSION_NOT_VALIDATING', 'This recovery session is no longer awaiting preview validation.');
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId }, select: { activeVersionId: true } });
    if (!project || project.activeVersionId !== body.candidateVersionId) return fail(res, 409, 'RECOVERY_CANDIDATE_STALE', 'Project files changed before recovery validation completed.');
    if (body.error && body.error.versionId !== body.candidateVersionId) return fail(res, 400, 'RECOVERY_DIAGNOSTIC_MISMATCH', 'The validation diagnostic must belong to the candidate version.');
    if (body.passed && body.error) return fail(res, 400, 'RECOVERY_VALIDATION_CONFLICT', 'A successful preview validation cannot include a runtime error.');
    const normalizedError = body.error ? normalizeRuntimeError(body.error) : undefined;
    const errorDecision = normalizedError ? classifyRuntimeError(normalizedError) : 'defect';
    const message = normalizedError?.message ?? (body.message ? redactRuntimeText(body.message).slice(0, 1_000) : undefined);

    if (body.passed) {
      await prisma.$transaction(async (tx) => {
        const attemptUpdated = await tx.runtimeRecoveryAttempt.updateMany({
          where: { id: attemptId, sessionId, status: 'validating', candidateVersionId: body.candidateVersionId },
          data: { status: 'recovered', completedAt: new Date(), validation: { passed: true, message: message ?? null } },
        });
        if (attemptUpdated.count !== 1) throw new Error('Recovery validation changed before the result could be recorded.');
        const sessionUpdated = await tx.runtimeRecoverySession.updateMany({
          where: { id: sessionId, projectId, status: 'validating' },
          data: { status: 'recovered', failureReason: null, resolvedAt: new Date() },
        });
        if (sessionUpdated.count !== 1) throw new Error('Recovery session changed before validation completed.');
      });
      await writeAudit(ownerId, 'runtime_recovery.recovered', sessionId);
      return res.json({ status: 'recovered', retryAllowed: false });
    }

    const { requiresReview, retryAllowed } = recoveryRetryPolicy(attempt.attemptNumber, session.maxAttempts, errorDecision);
    const failureReason = requiresReview
      ? 'The candidate reported an environment or request failure that is not safe to repair automatically.'
      : message ?? 'The candidate did not pass runtime validation.';
    await prisma.$transaction(async (tx) => {
      const rolledBack = await tx.project.updateMany({
        where: { id: projectId, ownerId, activeVersionId: body.candidateVersionId },
        data: { activeVersionId: attempt.sourceVersionId },
      });
      if (rolledBack.count !== 1) throw new Error('Recovery rollback lost its active-version compare-and-swap.');
      const attemptUpdated = await tx.runtimeRecoveryAttempt.updateMany({
        where: { id: attemptId, sessionId, status: 'validating', candidateVersionId: body.candidateVersionId },
        data: { status: 'failed', failureReason, completedAt: new Date(), validation: { passed: false, message: message ?? null, error: normalizedError ?? null } },
      });
      if (attemptUpdated.count !== 1) throw new Error('Recovery attempt changed before validation completed.');
      const sessionUpdated = await tx.runtimeRecoverySession.updateMany({
        where: { id: sessionId, projectId, status: 'validating' },
        data: {
          status: requiresReview ? 'awaiting_approval' : retryAllowed ? 'retryable' : 'failed',
          failureReason,
          ...(normalizedError ? {
            errorSignature: normalizedError.signature,
            environment: normalizedError.environment,
            category: normalizedError.category,
            message: normalizedError.message,
            stackTrace: normalizedError.stackTrace ?? null,
            sourceFile: normalizedError.sourceFile ?? null,
            line: normalizedError.line ?? null,
            column: normalizedError.column ?? null,
          } : {}),
        },
      });
      if (sessionUpdated.count !== 1) throw new Error('Recovery session changed before validation completed.');
    });
    await writeAudit(ownerId, 'runtime_recovery.validation_failed', sessionId);
    res.json({ status: requiresReview ? 'awaiting_approval' : retryAllowed ? 'retryable' : 'failed', retryAllowed, activeVersionId: attempt.sourceVersionId });
  } catch (error) { next(error); }
});
app.post('/api/v1/projects/:id/recovery/:sessionId/pause', auth, requireRuntimeRecoverySchema, async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const sessionId = z.string().min(1).max(64).parse(req.params.sessionId);
    const ownerId = (req as any).user.id as string;
    const session = await ownerRecoverySession(projectId, sessionId, ownerId);
    if (!session) return fail(res, 404, 'NOT_FOUND', 'Recovery session not found');
    if (['recovered', 'rolled_back'].includes(session.status)) return fail(res, 409, 'RECOVERY_COMPLETE', 'This recovery session is already complete.');
    const activeAttempt = await prisma.$transaction(async (tx) => {
      const currentAttempt = await tx.runtimeRecoveryAttempt.findFirst({
        where: { sessionId, status: { in: ['generating', 'validating'] } },
        orderBy: { attemptNumber: 'desc' },
      });
      if (currentAttempt?.status === 'validating' && currentAttempt.candidateVersionId) {
        const rolledBack = await tx.project.updateMany({
          where: { id: projectId, ownerId, activeVersionId: currentAttempt.candidateVersionId },
          data: { activeVersionId: currentAttempt.sourceVersionId },
        });
        if (rolledBack.count !== 1) throw new Error('Recovery pause could not safely restore the candidate version.');
        const rolledBackAttempt = await tx.runtimeRecoveryAttempt.updateMany({
          where: { id: currentAttempt.id, sessionId, status: 'validating' },
          data: { status: 'rolled_back', failureReason: 'Recovery was paused before preview validation completed.', completedAt: new Date() },
        });
        if (rolledBackAttempt.count !== 1) throw new Error('Recovery attempt changed before it could be paused.');
      } else if (currentAttempt?.status === 'generating') {
        const cancelledAttempt = await tx.runtimeRecoveryAttempt.updateMany({
          where: { id: currentAttempt.id, sessionId, status: 'generating' },
          data: { status: 'cancelled', failureReason: 'Recovery was paused by the user.', completedAt: new Date() },
        });
        if (cancelledAttempt.count !== 1) throw new Error('Recovery attempt changed before it could be paused.');
      }
      const paused = await tx.runtimeRecoverySession.updateMany({
        where: { id: sessionId, projectId, status: { notIn: ['recovered', 'rolled_back', 'failed', 'awaiting_approval'] } },
        data: { status: 'paused' },
      });
      if (paused.count !== 1) throw new Error('Recovery session changed before it could be paused.');
      return currentAttempt;
    });
    if (activeAttempt?.generationJobId) activeControllers.get(activeAttempt.generationJobId)?.abort(new Error('Recovery paused by user'));
    res.json({ status: 'paused' });
  } catch (error) { next(error); }
});
app.post('/api/v1/projects/:id/recovery/:sessionId/resume', auth, requireRuntimeRecoverySchema, async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const sessionId = z.string().min(1).max(64).parse(req.params.sessionId);
    const ownerId = (req as any).user.id as string;
    const session = await ownerRecoverySession(projectId, sessionId, ownerId);
    if (!session) return fail(res, 404, 'NOT_FOUND', 'Recovery session not found');
    const updated = await prisma.runtimeRecoverySession.updateMany({
      where: { id: sessionId, projectId, status: 'paused', attemptCount: { lt: Math.min(session.maxAttempts, MAX_RECOVERY_ATTEMPTS) } },
      data: { status: 'retryable', failureReason: null },
    });
    if (!updated.count) return fail(res, 409, 'RECOVERY_NOT_RESUMABLE', 'This recovery session cannot be resumed.');
    res.json({ status: 'retryable' });
  } catch (error) { next(error); }
});
app.post('/api/v1/projects/:id/recovery/:sessionId/rollback', auth, requireRuntimeRecoverySchema, async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body);
    const projectId = z.string().min(1).max(64).parse(req.params.id);
    const sessionId = z.string().min(1).max(64).parse(req.params.sessionId);
    const ownerId = (req as any).user.id as string;
    const session = await ownerRecoverySession(projectId, sessionId, ownerId);
    if (!session) return fail(res, 404, 'NOT_FOUND', 'Recovery session not found');
    if (session.status === 'generating') return fail(res, 409, 'RECOVERY_IN_PROGRESS', 'Wait for recovery generation to stop before restoring a version.');
    const latestCandidate = session.attempts.find((attempt) => attempt.candidateVersionId);
    if (!latestCandidate?.candidateVersionId) return fail(res, 409, 'RECOVERY_NO_CANDIDATE', 'This session has no saved correction to roll back.');
    await prisma.$transaction(async (tx) => {
      const currentProject = await tx.project.findFirst({ where: { id: projectId, ownerId }, select: { activeVersionId: true } });
      if (currentProject?.activeVersionId !== latestCandidate.candidateVersionId) throw new Error('Recovery rollback lost its active-version compare-and-swap.');
      const rolledBack = await tx.project.updateMany({
        where: { id: projectId, ownerId, activeVersionId: latestCandidate.candidateVersionId },
        data: { activeVersionId: latestCandidate.sourceVersionId },
      });
      if (rolledBack.count !== 1) throw new Error('Recovery rollback lost its active-version compare-and-swap.');
      const attemptUpdated = await tx.runtimeRecoveryAttempt.updateMany({
        where: { id: latestCandidate.id, sessionId, candidateVersionId: latestCandidate.candidateVersionId, status: { in: ['validating', 'recovered'] } },
        data: { status: 'rolled_back', completedAt: new Date() },
      });
      if (attemptUpdated.count !== 1) throw new Error('Recovery attempt changed before rollback completed.');
      const sessionUpdated = await tx.runtimeRecoverySession.updateMany({
        where: { id: sessionId, projectId, status: { in: ['validating', 'recovered'] } },
        data: { status: 'rolled_back', failureReason: null },
      });
      if (sessionUpdated.count !== 1) throw new Error('Recovery session changed before rollback completed.');
    });
    await writeAudit(ownerId, 'runtime_recovery.rolled_back', sessionId);
    res.json({ status: 'rolled_back', activeVersionId: latestCandidate.sourceVersionId });
  } catch (error) { next(error); }
});

app.get('/api/v1/usage/me', auth, async (req, res) => {
  const userId = (req as any).user.id as string; const since = new Date(Date.now() - 30 * 86400000);
  const [jobs, oldestJob, usage] = await Promise.all([
    prisma.generationJob.count({ where: { project: { ownerId: userId }, createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.generationJob.findFirst({ where: { project: { ownerId: userId }, createdAt: { gte: new Date(Date.now() - 86400000) } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.usage.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true }, _count: true }),
  ]);
  res.json({ dailyGenerationLimit: 20, generationsLast24Hours: jobs, nextGenerationAvailableAt: jobs >= 20 && oldestJob ? oldestJob.createdAt.getTime() + 86400000 : null, usageLast30Days: { requests: usage._count, inputTokens: usage._sum.inputTokens ?? 0, outputTokens: usage._sum.outputTokens ?? 0 }, groqConfigured: !!process.env.GROQ_API_KEY, groqProviderState: groqProviderState, groq: groqRateLimitSnapshot });
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
    const body = z.object({
      prompt: z.string().trim().min(1).max(4000),
      templateId: z.enum(['restaurant', 'saas', 'portfolio']).default('saas'),
      options: z.record(z.string(), z.unknown()).default({}),
      mode: z.enum(['create', 'revise']).default('create'),
      recoveryAttemptId: z.string().min(1).max(64).optional(),
    }).strict().parse(req.body);
    const userId = (req as any).user.id as string; const project = await ownerProject(z.string().min(1).max(64).parse(req.params.id), userId);
    if (!project) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    if (body.recoveryAttemptId && body.mode !== 'revise') return fail(res, 400, 'RECOVERY_REQUIRES_REVISION', 'Recovery attempts must revise a saved project version.');
    const recoveryReady = await hasRuntimeRecoverySchema();
    if (body.recoveryAttemptId && !recoveryReady) return fail(res, 503, 'SCHEMA_NOT_READY', 'A required database migration has not been applied.');
    const activeRecovery = recoveryReady
      ? await prisma.runtimeRecoverySession.findFirst({
        where: { projectId: project.id, status: { in: ['generating', 'validating'] } },
        select: { id: true },
      })
      : null;
    if (activeRecovery && !body.recoveryAttemptId) return fail(res, 409, 'RECOVERY_IN_PROGRESS', 'Pause or finish autonomous recovery before starting another generation.');
    const recoveryAttempt = body.recoveryAttemptId
      ? await prisma.runtimeRecoveryAttempt.findFirst({
        where: {
          id: body.recoveryAttemptId,
          status: 'generating',
          sourceVersionId: project.activeVersionId ?? '',
          session: { is: { projectId: project.id, status: 'generating', project: { is: { ownerId: userId } } } },
        },
      })
      : null;
    if (body.recoveryAttemptId && !recoveryAttempt) return fail(res, 409, 'RECOVERY_ATTEMPT_STALE', 'The recovery attempt is no longer active for this project version.');
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
    const activeVersion = project.activeVersionId
      ? await prisma.version.findFirst({ where: { id: project.activeVersionId, projectId: project.id }, select: { files: true } })
      : project.versions[0];
    const contextFiles = activeVersion?.files ?? [];
    if (Buffer.byteLength(JSON.stringify(contextFiles), 'utf8') > 50_000) return fail(res, 413, 'CONTEXT_TOO_LARGE', 'Current project context exceeds 50 KB');
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.generationJob.create({ data: { projectId: project.id, prompt: body.prompt, status: 'queued', requestKey, contextFiles: contextFiles as any } });
      if (recoveryAttempt) {
        const linked = await tx.runtimeRecoveryAttempt.updateMany({
          where: { id: recoveryAttempt.id, status: 'generating', generationJobId: null },
          data: { generationJobId: created.id },
        });
        if (linked.count !== 1) throw new Error('Recovery attempt was already linked to a generation.');
      }
      return created;
    });
    await writeAudit(userId, 'generation.started', job.id);
    logger.info({ requestId: res.locals.requestId, correlationId: job.id }, 'generation request accepted');
    res.status(202).json({ job: { id: job.id, correlationId: job.id, status: job.status, progress: 0 } });
    void generate(job.id, project.id, userId, { ...body, contextFiles }).catch((error) => logger.error({ correlationId: job.id, errorName: error instanceof Error ? error.name : 'UnknownError', providerFailures: error instanceof GenerationFailure ? error.failures : error instanceof ProviderFailure ? [error.info] : undefined }, 'generation task rejected'));
  } catch (error) { next(error); }
});
async function generate(jobId: string, projectId: string, userId: string, input: { prompt: string; templateId: string; options: Record<string, unknown>; mode: 'create' | 'revise'; contextFiles: unknown; recoveryAttemptId?: string }) {
  const generationStartedAt = Date.now();
  let stage = 'job_start';
  let selectedProvider: string | undefined;
  let selectedModel: string | undefined;
  const controller = new AbortController(); activeControllers.set(jobId, controller);
  await prisma.generationJob.update({ where: { id: jobId }, data: { status: 'running' } });
  try {
  stage = 'planning';
  const recoveryAttempt = input.recoveryAttemptId
    ? await prisma.runtimeRecoveryAttempt.findFirst({
      where: { id: input.recoveryAttemptId, generationJobId: jobId, status: 'generating', session: { is: { status: 'generating', projectId } } },
      include: { session: true },
    })
    : null;
  if (input.recoveryAttemptId && !recoveryAttempt) throw new RecoveryNeedsApprovalError('The recovery session changed before analysis started.');
  if (recoveryAttempt && containsCredentialLikeValue(input.contextFiles)) {
    throw new RecoveryNeedsApprovalError('Credential-like values were found in project source; automatic analysis was stopped.');
  }
  const navigationEnabled = input.options.navigation !== false;
  const generationPrompt = buildGenerationPrompt(input.prompt, input.templateId, input.options);
  publishGeneration(jobId, 'stage', { id: 'planning', label: 'Analyzing requirements and planning the file structure' });
  const generated = await generateVanillaWebsiteWithFallback(
    { prompt: generationPrompt, currentFiles: input.contextFiles, mode: input.mode, navigation: navigationEnabled },
    {
      providerOrder,
      singleRequestMode,
      ...(process.env.GROQ_API_KEY ? { groq: {
        baseUrl: groqBaseUrl,
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || (input.mode === 'create' ? aiModels.coding : aiModels.reasoning),
        firstByteTimeoutMs,
        streamIdleTimeoutMs,
        totalDeadlineMs,
      } } : {}),
      ...(process.env.GEMINI_API_KEY ? { gemini: {
        baseUrl: geminiBaseUrl,
        apiKey: process.env.GEMINI_API_KEY,
        model: aiModels.fallback,
        firstByteTimeoutMs,
        streamIdleTimeoutMs,
        totalDeadlineMs,
      } } : {}),
      ...(openRouterConfig ? { openRouter: openRouterConfig } : {}),
      totalTimeoutMs: generationTotalTimeoutMs,
      ...(huggingFaceConfig ? { huggingFace: huggingFaceConfig } : {}),
    },
    controller.signal,
    fetch,
    (event: GenerationEvent) => {
      if (event.type === 'provider') publishGeneration(jobId, 'stage', { id: 'generating', label: 'Generating project files with AI' });
      if (event.type === 'delta') publishGeneration(jobId, 'delta', { provider: event.provider, characters: event.text.length });
      if (event.type === 'provider_attempt') {
        selectedProvider = event.provider;
        selectedModel = event.model;
        stage = 'provider_request';
        logger.info({ correlationId: jobId, ...event }, 'provider_attempt');
      }
      if (event.type === 'provider' || event.type === 'provider_attempt' || event.type === 'file' || event.type === 'file_started' || event.type === 'file_delta' || event.type === 'retry' || event.type === 'correction') publishGeneration(jobId, event.type, event);
    },
    (event: GeminiDiagnosticEvent) => {
      if (event.provider) selectedProvider = event.provider;
      if (event.model) selectedModel = event.model;
      if (event.stage === 'response_headers' || event.stage === 'first_byte' || event.stage === 'response_complete' || event.stage === 'provider_error' || event.stage === 'request_failed' || event.stage === 'timeout') stage = event.stage;
      if (event.provider === 'groq' && event.stage === 'response_headers') groqProviderState = event.status === 429 ? 'cooldown' : event.status && event.status >= 400 ? 'unavailable' : 'ready';
      if (event.provider === 'groq' && event.stage === 'provider_error') groqProviderState = event.category === 'rate_limited' ? 'cooldown' : 'unavailable';
      if (event.provider === 'groq' && event.rateLimit) groqRateLimitSnapshot = { model: event.model ?? aiModels.coding, observedAt: Date.now(), rateLimit: event.rateLimit, ...(event.retryAfterMs ? { cooldownUntil: Date.now() + event.retryAfterMs } : {}) };
      if (event.provider === 'groq' && event.category === 'rate_limited') groqRateLimitSnapshot = { model: event.model ?? aiModels.coding, observedAt: Date.now(), rateLimit: groqRateLimitSnapshot?.rateLimit ?? {}, cooldownUntil: Date.now() + (event.retryAfterMs ?? 60_000) };
      logger.info(
      { correlationId: jobId, ...event, ...(event.provider === 'groq' ? { status: event.status ?? null, inputTokens: event.inputTokens ?? 0, outputTokens: event.outputTokens ?? 0 } : {}) },
      event.provider === 'groq' ? 'Groq provider request metrics' : event.stage === 'timeout' ? 'provider timeout fired' : 'provider request diagnostic',
      );
    },
  );
  stage = 'response_validation';
  if (recoveryAttempt) {
    try { validateRecoveryPatch(input.contextFiles, generated.files); }
    catch (error) {
      throw new RecoveryNeedsApprovalError(error instanceof Error ? error.message : 'The proposed patch failed safety validation.');
    }
  }
  const files = mergeGeneratedFiles(input.contextFiles, generated.files, input.mode);
  stage = 'file_validation';
  publishGeneration(jobId, 'stage', { id: 'validating', label: 'Checking responsive website output' });
  if (!files.some((file) => file.path === 'package.json')) validateGeneratedStaticWebsite(files, generated.provider ?? 'gemini', { singleRequestMode, navigation: navigationEnabled });
  stage = 'preview_assembly';
  for (const file of files) publishGeneration(jobId, 'file', { path: file.path });
  publishGeneration(jobId, 'stage', { id: 'saving', label: 'Saving the project version to Supabase' });
  stage = 'file_persistence';
  const persistenceInput: Parameters<typeof persistGeneratedVersion>[1] = {
    jobId,
    projectId,
    userId,
    prompt: input.prompt,
    templateId: input.templateId,
    options: input.options,
    generated: { ...generated, files },
    ...(recoveryAttempt ? { expectedActiveVersionId: recoveryAttempt.sourceVersionId, recoveryAttemptId: recoveryAttempt.id } : {}),
  };
  const saveResult = await persistOrKeepPreview(
    () => persistGeneratedVersion(prisma, persistenceInput),
    { summary: generated.summary, files, warnings: generated.warnings },
  );
  if (saveResult.state === 'saved') {
    const version = saveResult.value;
    setGenerationSaveState(jobId, { state: 'saved', versionId: version.id });
    if (!recoveryAttempt) publishGeneration(jobId, 'preview_ready', { summary: generated.summary, files, warnings: generated.warnings, provider: generated.provider });
    stage = 'complete';
    await writeAudit(userId, 'generation.completed', jobId);
    publishGeneration(jobId, 'complete', { status: 'complete', versionId: version.id, saved: true });
    return version;
  } else {
    const error = saveResult.error;
    if (error instanceof ProjectVersionConflictError || recoveryAttempt) throw error;
    logger.warn({
      correlationId: jobId,
      stage: 'file_persistence',
      elapsedMs: Date.now() - generationStartedAt,
      category: databaseFailureCategory(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }, 'generated website could not be saved; the last saved version remains active');
    scheduleVersionPersistenceRetry(jobId, persistenceInput);
    const saveState = generationSaveStates.get(jobId)?.state ?? 'failed';
    publishGeneration(jobId, 'complete', {
      status: 'complete',
      saved: false,
      saveState,
      correlationId: jobId,
      warning: saveState === 'retrying' ? 'Files generated, but saving failed. The previous saved version remains active while D-GUY retries.' : 'Files generated, but saving failed. Your previous saved version remains active.',
    });
    return undefined;
  }
  } catch (error) {
    const providerFailures = error instanceof GenerationFailure ? error.failures : error instanceof ProviderFailure ? [error.info] : [];
    const clientMessage = providerFailures.length
      ? safeGenerationFailureMessage(providerFailures)
      : error instanceof RecoveryNeedsApprovalError || error instanceof ProjectVersionConflictError
        ? error.message
        : 'AI generation did not complete. Your previous saved version remains active.';
    const correlatedMessage = `${clientMessage} Reference: ${jobId}`;
    const errorCode = controller.signal.aborted ? 'CANCELLED' : storedGenerationFailure(correlatedMessage);
    logger.error({ correlationId: jobId, stage, elapsedMs: Date.now() - generationStartedAt, provider: selectedProvider, model: selectedModel, errorName: error instanceof Error ? error.name : 'UnknownError', providerFailures }, 'generation failed');
    await prisma.generationJob.update({ where: { id: jobId }, data: { status: controller.signal.aborted ? 'cancelled' : 'failed', errorCode, finishedAt: new Date() } });
    await writeAudit(userId, controller.signal.aborted ? 'generation.cancelled' : 'generation.failed', jobId);
    const recoveryError = error instanceof RecoveryNeedsApprovalError;
    const recoveryMessage = recoveryError ? error.message : error instanceof ProjectVersionConflictError ? 'Project files changed while the correction was generated. No patch was applied.' : undefined;
    if (input.recoveryAttemptId) {
      const currentAttempt = await prisma.runtimeRecoveryAttempt.findUnique({
        where: { id: input.recoveryAttemptId },
        include: { session: { select: { id: true, status: true, attemptCount: true, maxAttempts: true } } },
      });
      if (currentAttempt && currentAttempt.status === 'generating') {
        const paused = currentAttempt.session.status === 'paused';
        const status = paused ? 'cancelled' : recoveryError ? 'awaiting_approval' : 'failed';
        await prisma.$transaction(async (tx) => {
          await tx.runtimeRecoveryAttempt.updateMany({
            where: { id: currentAttempt.id, status: 'generating' },
            data: {
              status,
              failureReason: paused ? 'Recovery was paused by the user.' : recoveryMessage ?? 'The recovery generation did not complete.',
              completedAt: new Date(),
              validation: { passed: false, state: paused ? 'paused' : recoveryError ? 'approval_required' : 'generation_failed' },
            },
          });
          if (!paused) {
            await tx.runtimeRecoverySession.updateMany({
              where: { id: currentAttempt.session.id, status: { not: 'paused' } },
              data: {
                status: recoveryError ? 'awaiting_approval' : 'failed',
                failureReason: recoveryMessage ?? 'The recovery generation did not complete.',
              },
            });
          }
        });
      }
    }
    const errorMessage = controller.signal.aborted ? 'Generation was cancelled.' : correlatedMessage;
    publishGeneration(jobId, controller.signal.aborted ? 'cancelled' : 'failed', { status: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted ? 'Generation was cancelled.' : errorMessage });
    throw error;
  } finally { activeControllers.delete(jobId); }
}
app.get('/api/v1/generations/:jobId', auth, async (req, res) => {
  const id = z.string().min(1).max(64).parse(req.params.jobId);
  const job = await prisma.generationJob.findFirst({ where: { id, project: { ownerId: (req as any).user.id } } });
  if (!job) return fail(res, 404, 'NOT_FOUND', 'Generation not found');
  const saveState = generationSaveStates.get(id);
  const status = saveState?.state === 'saved' || (job.status === 'complete' && !saveState) ? 'complete' : saveState?.state === 'failed' ? 'failed' : job.status;
  res.json({
    job: {
      id: job.id,
      status,
      progress: status === 'complete' ? 100 : status === 'queued' ? 0 : null,
      errorCode: job.errorCode,
      ...(saveState ? { saveState: saveState.state, ...(saveState.versionId ? { versionId: saveState.versionId } : {}) } : {}),
    },
  });
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
    if (['P2021', 'P2022'].includes(err?.code)) {
      logger.error({ code: err.code }, 'database schema migration required');
      return fail(res, 503, 'SCHEMA_NOT_READY', 'A required database migration has not been applied.');
    }
    if (['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2010'].includes(err?.code)) {
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

async function shutdown(signal: NodeJS.Signals) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info({ signal }, 'D-GUY API graceful shutdown started');
  if (pendingVersionSaves.size > 0) {
    logger.warn({ pendingSaves: pendingVersionSaves.size }, 'background save retries will pause during shutdown');
    for (const pending of pendingVersionSaves.values()) if (pending.timer) clearTimeout(pending.timer);
  }
  pendingVersionSaves.clear();
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
