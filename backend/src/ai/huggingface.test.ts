import { describe, expect, it, vi } from 'vitest';
import { generateWithFallback } from './provider.js';
import { generateWithHuggingFace, testHuggingFaceConnection, type HuggingFaceChatClient, type HuggingFaceProviderConfig } from './huggingface.js';
import type { ChatCompletionOutput } from '@huggingface/tasks';

const model = 'Qwen/Qwen2.5-Coder-32B-Instruct';
const input = { prompt: 'build a cyber portfolio', currentFiles: [], mode: 'create' as const };
const website = {
  summary: 'A cyber portfolio',
  files: [
    { path: 'index.html', content: '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main>Cyber portfolio</main><script src="app.js"></script></body></html>' },
    { path: 'styles.css', content: 'body { background: #080b16; color: #cffafe; }' },
    { path: 'app.js', content: 'document.documentElement.dataset.ready = "true";' },
  ],
  warnings: [],
};

const config = (client: HuggingFaceChatClient, freeCreditsOnly = true): HuggingFaceProviderConfig => ({
  token: 'hf-test-token', model, provider: 'featherless-ai', timeoutMs: 2000, maxOutputTokens: 2048, freeCreditsOnly, client,
});
const output = (content = JSON.stringify(website)) => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 19, completion_tokens: 87 } }) as unknown as ChatCompletionOutput;
function makeClient(response = output()): HuggingFaceChatClient {
  return { chatCompletion: vi.fn().mockResolvedValue(response) as unknown as HuggingFaceChatClient['chatCompletion'] };
}
const httpError = (status: number, body: unknown) => Object.assign(new Error('provider error details are not exposed'), { httpResponse: { status, body } });

describe('Hugging Face Featherless adapter (mock SDK; no credits consumed)', () => {
  it('uses the official SDK with the exact model, explicit Featherless provider, and bounded non-retried output', async () => {
    const client = makeClient();
    const result = await generateWithHuggingFace(input, config(client), new AbortController().signal);
    expect(result.files.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'app.js']);
    expect(result.inputTokens).toBe(19);
    expect(client.chatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model,
      provider: 'featherless-ai',
      max_tokens: 2048,
      stream: false,
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    }), expect.objectContaining({ retry_on_error: false, signal: expect.any(AbortSignal) }));
  });

  it('blocks inference before contacting Featherless unless free-only safety is explicitly enabled', async () => {
    const client = makeClient();
    await expect(generateWithHuggingFace(input, config(client, false), new AbortController().signal)).rejects.toMatchObject({ info: { category: 'safety_guard_blocked' } });
    expect(client.chatCompletion).not.toHaveBeenCalled();
  });

  it('returns a small, safe connection-test result after an explicitly enabled low-token probe', async () => {
    const client = makeClient(output('D-GUY_CONNECTION_OK'));
    await expect(testHuggingFaceConnection(config(client))).resolves.toEqual({ ok: true, provider: 'featherless-ai', model });
    expect(client.chatCompletion).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 24, provider: 'featherless-ai' }), expect.objectContaining({ retry_on_error: false }));
  });

  it('reports out-of-credits and unavailable model without retries or raw provider details', async () => {
    const depleted: HuggingFaceChatClient = { chatCompletion: vi.fn().mockRejectedValue(httpError(402, { error: 'insufficient credits' })) as unknown as HuggingFaceChatClient['chatCompletion'] };
    await expect(generateWithHuggingFace(input, config(depleted), new AbortController().signal)).rejects.toMatchObject({ info: { category: 'credits_exhausted', providerCode: 'free_credits_exhausted', status: 402 } });
    expect(depleted.chatCompletion).toHaveBeenCalledTimes(1);

    const missingModel: HuggingFaceChatClient = { chatCompletion: vi.fn().mockRejectedValue(httpError(404, { error: 'model not available' })) as unknown as HuggingFaceChatClient['chatCompletion'] };
    await expect(generateWithHuggingFace(input, config(missingModel), new AbortController().signal)).rejects.toMatchObject({ info: { category: 'invalid_model', providerCode: 'model_unavailable', status: 404 } });
  });

  it('tries Featherless only after both existing providers fail and persists-compatible website files', async () => {
    const client = makeClient();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 401 }));
    const result = await generateWithFallback(input, {
      groq: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'groq-test', model: 'qwen/qwen3.8-27b', timeoutMs: 2000 },
      gemini: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-test', model: 'gemini-3.8-flash', timeoutMs: 2000 },
      huggingFace: config(client),
    }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.files.some((file) => file.path === 'index.html')).toBe(true);
    expect(result.files.some((file) => file.path.endsWith('.css'))).toBe(true);
    expect(result.files.some((file) => file.path.endsWith('.js'))).toBe(true);
    expect(result.warnings.at(-1)).toContain('Hugging Face Featherless generated');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
