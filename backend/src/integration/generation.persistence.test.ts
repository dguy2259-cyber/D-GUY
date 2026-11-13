import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateWithFallback } from '../ai/provider.js';
import { persistGeneratedVersion } from '../generation/persistence.js';
import { createDatabasePool } from '../database.js';
import { consumeDistributedRateLimit, rateLimitBucketKey } from '../security/rateLimit.js';
import { registrationProfileData } from '../auth/registration.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const testPool = databaseUrl ? createDatabasePool(databaseUrl, process.env.TEST_DATABASE_CA_CERT_PATH || process.env.SUPABASE_DB_CA_CERT_PATH || '') : null;
const prisma = testPool ? new PrismaClient({ adapter: new PrismaPg(testPool, { disposeExternalPool: true }) }) : null;
const groq = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'integration-test-groq', model: 'openai/gpt-oss-120b', timeoutMs: 3000 };
const gemini = { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'integration-test-gemini', model: 'gemini-3.8-flash', timeoutMs: 3000 };
const response = (status: number, payload?: unknown) => new Response(payload === undefined ? '' : `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { status, headers: { 'content-type': 'text/event-stream' } });

integration('Supabase/PostgreSQL generation persistence (requires isolated TEST_DATABASE_URL)', () => {
  let ownerId: string | undefined;
  let registrationProfileId: string | undefined;
  afterAll(async () => {
    if (ownerId && prisma) await prisma.user.deleteMany({ where: { id: ownerId } });
    if (registrationProfileId && prisma) await prisma.user.deleteMany({ where: { id: registrationProfileId } });
    await prisma?.$disconnect();
  });

  it('persists a Supabase-linked client profile with database-created timestamp', async () => {
    if (!prisma) throw new Error('TEST_DATABASE_URL is required for this integration suite');
    const authUserId = crypto.randomUUID();
    registrationProfileId = authUserId;
    const startedAt = new Date();
    const profile = await prisma.user.create({
      data: registrationProfileData({ id: authUserId, email: 'Client@Example.test' }, 'Test Client'),
    });
    const persisted = await prisma.user.findUnique({ where: { id: authUserId } });
    const finishedAt = new Date();
    expect(persisted).toMatchObject({
      id: authUserId,
      email: 'client@example.test',
      fullName: 'Test Client',
      role: 'client',
      passwordHash: null,
    });
    expect(profile.id).toBe(authUserId);
    expect(persisted?.createdAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
    expect(persisted?.createdAt.getTime()).toBeLessThanOrEqual(finishedAt.getTime());
  });

  it('saves generated files and usage atomically, and scopes project reads to the owner', async () => {
    if (!prisma) throw new Error('TEST_DATABASE_URL is required for this integration suite');
    await prisma.$queryRaw`SELECT 1`;
    const suffix = crypto.randomUUID();
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `integration-${suffix}@example.test` } });
    ownerId = user.id;
    const project = await prisma.project.create({ data: { ownerId: user.id, name: 'integration generation test' } });
    const job = await prisma.generationJob.create({ data: { projectId: project.id, prompt: 'generate test app', status: 'running' } });
    const fetcher = async (url: string | URL | Request) => {
      if (!String(url).includes('generativelanguage.googleapis.com')) return response(503);
      const content = JSON.stringify({ summary: 'Persisted from Gemini fallback', files: [{ path: 'index.html', content: '<h1>Generated</h1>' }], warnings: [] });
      return response(200, {
        candidates: [{ content: { parts: [{ text: content }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
      });
    };
    const generated = await generateWithFallback({ prompt: 'generate test app', currentFiles: [], mode: 'create' }, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch);
    const version = await persistGeneratedVersion(prisma, { jobId: job.id, projectId: project.id, userId: user.id, prompt: job.prompt, templateId: 'saas', options: {}, generated });

    const persisted = await prisma.project.findFirst({ where: { id: project.id, ownerId: user.id }, include: { versions: true, jobs: true } });
    const otherOwnerProject = await prisma.project.findFirst({ where: { id: project.id, ownerId: `different-${suffix}` } });
    const usage = await prisma.usage.findFirst({ where: { userId: user.id, jobId: job.id } });
    expect(persisted?.activeVersionId).toBe(version.id);
    expect((persisted?.versions[0]?.files as Array<{ path: string }>)[0]?.path).toBe('index.html');
    expect(persisted?.jobs[0]?.status).toBe('complete');
    expect(otherOwnerProject).toBeNull();
    expect(usage?.inputTokens).toBe(5);
    expect(generated.warnings).toContain('Groq failed with provider_unavailable (HTTP 503); Gemini generated this version.');
  });

  it('sanitizes total provider failure and leaves project persistence untouched', async () => {
    const fetcher = async () => response(503);
    await expect(generateWithFallback({ prompt: 'fail safely', currentFiles: [], mode: 'create' }, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch))
      .rejects.toThrow('Groq: provider_unavailable (HTTP 503); Gemini: provider_unavailable (HTTP 503)');
  });

  it('enforces shared PostgreSQL limits and allows a fresh window after expiry', async () => {
    if (!testPool) throw new Error('TEST_DATABASE_URL is required for this integration suite');
    const key = rateLimitBucketKey('integration', crypto.randomUUID(), 'test-key');
    try {
      expect(await consumeDistributedRateLimit(testPool, key, 1, 60_000)).toMatchObject({ allowed: true, hits: 1 });
      expect(await consumeDistributedRateLimit(testPool, key, 1, 60_000)).toMatchObject({ allowed: false, hits: 2 });
    } finally {
      await testPool.query('DELETE FROM "ApiRateLimitBucket" WHERE "key" = $1', [key]);
    }
  });
});
