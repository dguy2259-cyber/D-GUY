import { describe, expect, it } from 'vitest';
import { GENERIC_GENERATION_FAILURE, generationFailureForClient, storedGenerationFailure } from './failure.js';

describe('generation failure reconnect details', () => {
  it('retains sanitized provider diagnostics for a late event-stream subscriber', () => {
    const message = 'Groq: provider_unavailable (HTTP 503); Gemini: invalid_model (HTTP 404), model_not_found. The previous version remains available.';
    expect(generationFailureForClient(storedGenerationFailure(message))).toBe(message);
  });

  it('uses safe messages for non-provider failures and cancellation', () => {
    expect(generationFailureForClient('GENERATION_FAILED')).toBe(GENERIC_GENERATION_FAILURE);
    expect(generationFailureForClient('CANCELLED')).toContain('Generation was cancelled');
    expect(generationFailureForClient('PROCESS_RESTARTED')).toContain('API restarted');
    expect(generationFailureForClient(null)).toBe(GENERIC_GENERATION_FAILURE);
  });

  it('bounds persisted diagnostic length', () => {
    expect(storedGenerationFailure('x'.repeat(2_000))).toHaveLength('PROVIDER_FAILURE:'.length + 900);
  });
});
