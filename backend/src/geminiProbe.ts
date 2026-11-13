import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { probeGemini, ProviderFailure } from './ai/provider.js';
import type { GeminiDiagnosticEvent } from './ai/provider.js';

loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const model = process.env.AI_FALLBACK_MODEL;
const apiKey = process.env.GEMINI_API_KEY;
if (!model || !apiKey) {
  console.error(JSON.stringify({ stage: 'configuration', model: model ?? null, keyPresent: Boolean(apiKey) }));
  process.exitCode = 2;
} else {
  const diagnostics = (event: GeminiDiagnosticEvent) => console.info(JSON.stringify({ model, ...event }));
  try {
    const result = await probeGemini({
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
      apiKey,
      model,
      timeoutMs: 15_000,
    }, new AbortController().signal, fetch, diagnostics);
    console.info(JSON.stringify({ stage: 'probe_complete', ...result }));
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error.info : undefined;
    console.error(JSON.stringify({
      stage: 'probe_failed',
      provider: 'gemini',
      model,
      status: failure?.status ?? null,
      category: failure?.category ?? 'unknown',
      providerCode: failure?.providerCode ?? null,
      message: error instanceof Error ? error.message.slice(0, 300) : 'Gemini probe failed',
    }));
    process.exitCode = 1;
  }
}
