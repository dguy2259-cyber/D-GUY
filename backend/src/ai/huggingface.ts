import { InferenceClient } from '@huggingface/inference';
import type { ChatCompletionOutput } from '@huggingface/tasks';
import type { GenerationEvent, GenerationInput, GenerationOutput } from './provider.js';
import { GENERATION_SYSTEM_PROMPT, ProviderFailure, parseProviderOutput } from './provider.js';

export interface HuggingFaceProviderConfig {
  token: string;
  model: string;
  provider: 'featherless-ai';
  timeoutMs: number;
  maxOutputTokens: number;
  freeCreditsOnly: boolean;
  /** Injectable SDK boundary for tests; production config never supplies this. */
  client?: HuggingFaceChatClient;
}

export interface HuggingFaceChatClient {
  chatCompletion: (
    args: {
      model: string;
      provider: 'featherless-ai';
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      max_tokens: number;
      temperature: number;
      stream: false;
    },
    options?: { signal?: AbortSignal; retry_on_error?: boolean },
  ) => Promise<ChatCompletionOutput>;
}

function safeCreditFailure(error: unknown): ProviderFailure {
  const response = error && typeof error === 'object' ? (error as { httpResponse?: { status?: unknown; body?: unknown } }).httpResponse : undefined;
  const status = typeof response?.status === 'number' ? response.status : undefined;
  const body = response?.body;
  const bodyText = typeof body === 'string' ? body : body && typeof body === 'object' ? JSON.stringify(body) : '';
  const creditSignal = /credit|balance|payment_required|insufficient_quota|quota_exceeded/i.test(bodyText);
  const category = status === 402 || ((status === 403 || status === 429) && creditSignal) ? 'credits_exhausted'
    : status === 401 || status === 403 ? 'authentication_rejected'
      : status === 404 ? 'invalid_model'
        : status === 400 || status === 422 ? 'invalid_request'
          : status && status >= 500 ? 'provider_unavailable'
            : error instanceof Error && error.name === 'TimeoutError' ? 'timeout'
              : error instanceof TypeError ? 'network_error' : 'provider_unavailable';
  const code = status === 402 || creditSignal ? 'free_credits_exhausted'
    : status === 404 ? 'model_unavailable'
      : status === 401 || status === 403 ? 'token_or_provider_access_denied'
        : undefined;
  return new ProviderFailure({ provider: 'huggingface', category, ...(status ? { status } : {}), ...(code ? { providerCode: code } : {}), recoverable: false });
}

function clientFor(config: HuggingFaceProviderConfig): HuggingFaceChatClient {
  return config.client ?? new InferenceClient(config.token) as unknown as HuggingFaceChatClient;
}

async function request(
  input: GenerationInput,
  config: HuggingFaceProviderConfig,
  signal: AbortSignal,
  maxTokens: number,
  prompt: string,
): Promise<ChatCompletionOutput> {
  if (!config.freeCreditsOnly) throw new ProviderFailure({ provider: 'huggingface', category: 'safety_guard_blocked', providerCode: 'free_only_not_confirmed', recoverable: false });
  if (!config.token || !config.model || config.provider !== 'featherless-ai') throw new ProviderFailure({ provider: 'huggingface', category: 'configuration_error', recoverable: false });
  if (signal.aborted) throw new ProviderFailure({ provider: 'huggingface', category: 'cancelled', recoverable: false });
  const controller = AbortSignal.any([signal, AbortSignal.timeout(Math.min(120_000, Math.max(1_000, config.timeoutMs)))]);
  try {
    return await clientFor(config).chatCompletion({
      model: config.model,
      provider: config.provider,
      messages: [
        { role: 'system', content: GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: Math.max(1, Math.min(maxTokens, config.maxOutputTokens)),
      temperature: 0.25,
      stream: false,
    }, { signal: controller, retry_on_error: false });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new ProviderFailure({ provider: 'huggingface', category: 'cancelled', recoverable: false });
    if (controller.aborted && controller.reason instanceof Error && controller.reason.name === 'TimeoutError') throw new ProviderFailure({ provider: 'huggingface', category: 'timeout', recoverable: false });
    throw safeCreditFailure(error);
  }
}

export async function generateWithHuggingFace(
  input: GenerationInput,
  config: HuggingFaceProviderConfig,
  signal: AbortSignal,
  onEvent?: (event: GenerationEvent) => void,
): Promise<GenerationOutput> {
  const result = await request(input, config, signal, config.maxOutputTokens, JSON.stringify(input));
  const choice = result.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason === 'length') throw new ProviderFailure({ provider: 'huggingface', category: 'invalid_output', providerCode: 'output_truncated', recoverable: false });
  if (typeof content !== 'string' || !content.trim()) throw new ProviderFailure({ provider: 'huggingface', category: 'invalid_output', providerCode: 'empty_output', recoverable: false });
  onEvent?.({ type: 'delta', provider: 'huggingface', text: content });
  return parseProviderOutput(content, {
    input: result.usage?.prompt_tokens ?? 0,
    output: result.usage?.completion_tokens ?? 0,
  }, input.mode === 'create', 'huggingface', input.expectedFilePath);
}

/** Small explicit connection probe. It is an inference request and uses HF credits. */
export async function testHuggingFaceConnection(config: HuggingFaceProviderConfig, signal = new AbortController().signal): Promise<{ ok: true; provider: 'featherless-ai'; model: string }> {
  const result = await request({ prompt: 'Reply with the exact text D-GUY_CONNECTION_OK.', currentFiles: [], mode: 'revise' }, config, signal, 24, 'Reply with the exact text D-GUY_CONNECTION_OK.');
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.includes('D-GUY_CONNECTION_OK')) throw new ProviderFailure({ provider: 'huggingface', category: 'invalid_output', providerCode: 'connection_probe_invalid_output', recoverable: false });
  return { ok: true, provider: 'featherless-ai', model: config.model };
}
