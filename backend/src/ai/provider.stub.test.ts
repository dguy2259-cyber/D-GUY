import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearProviderHealthForTests,
  generateWebsiteWithFallback,
  generateVanillaWebsiteWithFallback,
  generateWithGemini,
  verifyGeminiModel,
  verifyGroqModels,
  type GenerationEvent,
  type ProviderConfig,
} from './provider.js';

type ProviderName = 'gemini' | 'groq' | 'openrouter';
type StubMode = 'slow-first-byte' | 'slow-stream' | 'hang' | '429' | '500' | 'truncated' | 'success' | 'single-success' | 'empty';

const generatedSite = {
  summary: 'Stubbed website preview',
  files: [
    { path: 'index.html', content: '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main>Nexora</main><script defer src="app.js"></script></body></html>' },
    { path: 'styles.css', content: 'body { color: white; background: #101020; }' },
    { path: 'app.js', content: 'document.querySelector("main");' },
  ],
  warnings: [],
};
const jsonOutput = JSON.stringify(generatedSite);
const singlePageOutput = JSON.stringify({
  summary: 'Single-request stubbed page',
  files: [{
    path: 'index.html',
    content: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}img{max-width:100%;height:auto}body{color:white}@media(max-width:1024px){body{color:#fff}}@media(max-width:768px){body{color:#eee}}</style></head><body><main>Nexora</main><script>document.querySelector("main");</script></body></html>',
  }],
  warnings: [],
});

function frame(provider: ProviderName, text: string, finished = false): string {
  if (provider === 'gemini') {
    const data = finished
      ? { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } }
      : { candidates: [{ content: { parts: [{ text }] } }] };
    return `data: ${JSON.stringify(data)}\n\n`;
  }
  if (provider === 'groq') return '';
  const data = finished
    ? { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }
    : { choices: [{ delta: { content: text }, finish_reason: null }] };
  return `data: ${JSON.stringify(data)}\n\n`;
}

function groqBody(content: string) {
  return JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
}

async function consumeRequest(request: AsyncIterable<Buffer | string>): Promise<void> {
  for await (const chunk of request) void chunk;
}

async function startStubProviderServer(modes: Partial<Record<ProviderName, StubMode>>) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  let requestCount = 0;
  const server: Server = createServer((request, response) => {
    void consumeRequest(request).then(() => {
      requestCount += 1;
      const path = request.url ?? '';
      const provider: ProviderName = path.includes('/gemini/')
        ? 'gemini'
        : path.includes('/openrouter/')
          ? 'openrouter'
          : 'groq';
      const mode = modes[provider] ?? 'success';
      response.on('close', () => {
        for (const timer of timers) clearTimeout(timer);
        for (const interval of intervals) clearInterval(interval);
      });

      if (path.endsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: 'groq-test' }, { id: 'groq-revision-test' }] }));
        return;
      }
      if (mode === 'hang') return;
      if (mode === '429' || mode === '500') {
        response.writeHead(mode === '429' ? 429 : 500, { 'content-type': 'application/json', 'retry-after': mode === '429' ? '60' : '0' });
        response.end(JSON.stringify({ error: { code: mode === '429' ? 'rate_limit_exceeded' : 'internal_error' } }));
        return;
      }
      if (mode === 'empty') {
        response.writeHead(200, { 'content-type': provider === 'groq' ? 'application/json' : 'text/event-stream' });
        response.end();
        return;
      }
      if (provider === 'groq') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(groqBody(mode === 'truncated' ? '{"summary":"partial"' : mode === 'single-success' ? singlePageOutput : jsonOutput));
        return;
      }

      const sendSuccess = (content: string) => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(frame(provider, content));
        response.write(frame(provider, '', true));
        response.end();
      };
      if (mode === 'slow-first-byte') {
        const timer = setTimeout(() => sendSuccess(jsonOutput), 10_000);
        timers.add(timer);
        return;
      }
      if (mode === 'slow-stream') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunks = Array.from({ length: 18 }, (_, index) => {
          const start = Math.floor(jsonOutput.length * index / 18);
          const end = Math.floor(jsonOutput.length * (index + 1) / 18);
          return jsonOutput.slice(start, end);
        });
        let index = 0;
        const interval = setInterval(() => {
          response.write(frame(provider, chunks[index] ?? ''));
          index += 1;
          if (index >= chunks.length) {
            response.write(frame(provider, '', true));
            response.end();
            clearInterval(interval);
            intervals.delete(interval);
          }
        }, 5_000);
        intervals.add(interval);
        return;
      }
      sendSuccess(mode === 'truncated' ? '{"summary":"partial"' : jsonOutput);
    }).catch(() => {
      if (!response.destroyed) response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local provider stub did not bind to a TCP port.');
  const origin = `http://127.0.0.1:${address.port}`;
  const config = (provider: ProviderName, overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
    baseUrl: `${origin}/${provider}/v1`,
    apiKey: `${provider}-local-test-key`,
    model: provider === 'gemini' ? 'gemini-test' : provider === 'groq' ? 'groq-test' : 'openrouter-test',
    firstByteTimeoutMs: 1_000,
    streamIdleTimeoutMs: 1_000,
    totalDeadlineMs: 2_000,
    ...overrides,
  });
  return {
    config,
    get requestCount() { return requestCount; },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const interval of intervals) clearInterval(interval);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

const generationInput = { prompt: 'Create a Nexora website.', currentFiles: [], mode: 'create' as const };
afterEach(() => clearProviderHealthForTests());

describe('local HTTP provider stub integration', () => {
  it('allows a ten-second first byte within the configured first-byte deadline', async () => {
    const stub = await startStubProviderServer({ gemini: 'slow-first-byte' });
    try {
      const result = await generateWithGemini(
        generationInput,
        stub.config('gemini', { firstByteTimeoutMs: 12_000, streamIdleTimeoutMs: 2_000, totalDeadlineMs: 15_000 }),
        new AbortController().signal,
      );
      expect(result.summary).toBe(generatedSite.summary);
      expect(result.files).toContainEqual(generatedSite.files[0]);
    } finally {
      await stub.close();
    }
  }, 20_000);

  it('does not time out a valid stream that sends chunks every five seconds for ninety seconds', async () => {
    const stub = await startStubProviderServer({ gemini: 'slow-stream' });
    const startedAt = Date.now();
    try {
      const result = await generateWithGemini(
        generationInput,
        stub.config('gemini', { firstByteTimeoutMs: 30_000, streamIdleTimeoutMs: 6_000, totalDeadlineMs: 110_000 }),
        new AbortController().signal,
      );
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(89_000);
      expect(result.files).toEqual(generatedSite.files);
    } finally {
      await stub.close();
    }
  }, 115_000);

  it('falls back from a hung Gemini to Groq and then OpenRouter in the same job', async () => {
    const stub = await startStubProviderServer({ gemini: 'hang', groq: '500', openrouter: 'success' });
    const providers: string[] = [];
    const attempts: Array<{ provider: string; model: string; attempt: number; reason?: string }> = [];
    try {
      const result = await generateWebsiteWithFallback(
        generationInput,
        {
          gemini: stub.config('gemini', { firstByteTimeoutMs: 100, streamIdleTimeoutMs: 100, totalDeadlineMs: 150 }),
          groq: stub.config('groq', { firstByteTimeoutMs: 1_000, streamIdleTimeoutMs: 1_000, totalDeadlineMs: 5_000 }),
          openRouter: stub.config('openrouter', { firstByteTimeoutMs: 1_000, streamIdleTimeoutMs: 1_000, totalDeadlineMs: 5_000 }),
          providerOrder: ['gemini', 'groq', 'openrouter'],
          totalTimeoutMs: 10_000,
        },
        new AbortController().signal,
        fetch,
        (event: GenerationEvent) => {
          if (event.type === 'provider') providers.push(event.provider);
          if (event.type === 'provider_attempt') attempts.push(event);
        },
      );
      expect(result.provider).toBe('openrouter');
      expect(providers).toEqual(['gemini', 'groq', 'openrouter']);
      expect(attempts).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: 'gemini', model: 'gemini-test', attempt: 1, reason: expect.stringContaining('first_byte_timeout') }),
        expect.objectContaining({ provider: 'groq', model: 'groq-test', attempt: 2, reason: expect.stringContaining('provider_unavailable') }),
        expect.objectContaining({ provider: 'openrouter', model: 'openrouter-test', attempt: 3 }),
      ]));
    } finally {
      await stub.close();
    }
  }, 15_000);

  it('falls back after Gemini returns truncated JSON and accepts a 429 as a provider failure', async () => {
    const truncatedStub = await startStubProviderServer({ gemini: 'truncated', groq: 'success' });
    try {
      const output = await generateWebsiteWithFallback(
        generationInput,
        { gemini: truncatedStub.config('gemini'), groq: truncatedStub.config('groq'), totalTimeoutMs: 10_000 },
        new AbortController().signal,
      );
      expect(output.provider).toBe('groq');
      expect(output.files).toEqual(generatedSite.files);
    } finally {
      await truncatedStub.close();
    }

    const rateLimitStub = await startStubProviderServer({ gemini: '429', groq: 'success' });
    try {
      const output = await generateWebsiteWithFallback(
        generationInput,
        { gemini: rateLimitStub.config('gemini'), groq: rateLimitStub.config('groq'), totalTimeoutMs: 10_000 },
        new AbortController().signal,
      );
      expect(output.provider).toBe('groq');
    } finally {
      await rateLimitStub.close();
    }
  }, 25_000);

  it('uses the Groq stub for a successful website request and records request metrics', async () => {
    const stub = await startStubProviderServer({ groq: 'success' });
    const diagnostics: Array<Record<string, unknown>> = [];
    try {
      const output = await generateWebsiteWithFallback(
        generationInput,
        { groq: stub.config('groq'), providerOrder: ['groq'] },
        new AbortController().signal,
        fetch,
        undefined,
        (event) => diagnostics.push(event),
      );
      expect(output.provider).toBe('groq');
      expect(output.files).toEqual(generatedSite.files);
      expect(diagnostics).toContainEqual(expect.objectContaining({
        stage: 'response_complete',
        provider: 'groq',
        model: 'groq-test',
        status: 200,
        inputTokens: 2,
        outputTokens: 3,
      }));
      expect(diagnostics.find((event) => event.stage === 'response_complete')?.elapsedMs).toEqual(expect.any(Number));
      expect(stub.requestCount).toBe(1);
    } finally {
      await stub.close();
    }
  });

  it('reads Groq retry-after and falls back immediately on 429', async () => {
    const stub = await startStubProviderServer({ groq: '429', gemini: 'success' });
    const attempts: Array<{ provider: string; reason?: string }> = [];
    const startedAt = Date.now();
    try {
      const output = await generateWebsiteWithFallback(
        generationInput,
        {
          groq: stub.config('groq'),
          gemini: stub.config('gemini'),
          providerOrder: ['groq', 'gemini'],
        },
        new AbortController().signal,
        fetch,
        (event: GenerationEvent) => { if (event.type === 'provider_attempt') attempts.push(event); },
      );
      expect(output.provider).toBe('gemini');
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      const failedAttempt = attempts.find((attempt) => attempt.reason?.includes('HTTP 429'));
      expect(failedAttempt?.reason).toContain('retry_after 60000ms');
      expect(stub.requestCount).toBe(2);
    } finally {
      await stub.close();
    }
  });

  it('falls back when the Groq stub returns truncated JSON', async () => {
    const stub = await startStubProviderServer({ groq: 'truncated', gemini: 'success' });
    try {
      const output = await generateWebsiteWithFallback(
        generationInput,
        { groq: stub.config('groq'), gemini: stub.config('gemini'), providerOrder: ['groq', 'gemini'] },
        new AbortController().signal,
      );
      expect(output.provider).toBe('gemini');
      expect(output.files).toEqual(generatedSite.files);
      expect(stub.requestCount).toBe(2);
    } finally {
      await stub.close();
    }
  });

  it('generates one inline HTML response and splits styles/scripts after the provider call', async () => {
    const stub = await startStubProviderServer({ groq: 'single-success' });
    try {
      const output = await generateVanillaWebsiteWithFallback(
        { ...generationInput, prompt: 'Create a single-page technology company website.', requireNavigation: false },
        { groq: stub.config('groq'), providerOrder: ['groq'], singleRequestMode: true },
        new AbortController().signal,
      );
      expect(stub.requestCount).toBe(1);
      expect(output.files.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'app.js']);
      expect(output.files[0]?.content).toContain('href="./styles.css"');
      expect(output.files[0]?.content).toContain('src="./app.js"');
      expect(output.files[1]?.content).toBe('*{box-sizing:border-box}img{max-width:100%;height:auto}body{color:white}@media(max-width:1024px){body{color:#fff}}@media(max-width:768px){body{color:#eee}}');
      expect(output.files[2]?.content).toBe('document.querySelector("main");');
      expect(output.warnings.some((warning) => warning.includes('follow-up validation'))).toBe(false);
    } finally {
      await stub.close();
    }
  });

  it('verifies configured Groq models using the local models endpoint', async () => {
    const stub = await startStubProviderServer({});
    try {
      await expect(verifyGroqModels(stub.config('groq').baseUrl, 'local-test-key', ['groq-test'], fetch))
        .resolves.toEqual({ verified: true, missingModels: [] });
      await expect(verifyGroqModels(stub.config('groq').baseUrl, 'local-test-key', ['missing-model'], fetch))
        .resolves.toEqual({ verified: false, missingModels: ['missing-model'], reason: 'configured_model_missing' });
    } finally {
      await stub.close();
    }
  });

  it('uses the known-good Gemini model when the configured model is absent from list-models', async () => {
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('local-test-key');
      return new Response(JSON.stringify({
        models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['streamGenerateContent'] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await expect(verifyGeminiModel('https://generativelanguage.googleapis.com', 'local-test-key', 'removed-model', fetcher))
      .resolves.toEqual({ model: 'gemini-2.5-flash', verified: false, fallbackUsed: true, reason: 'configured_model_missing' });
  });
});
