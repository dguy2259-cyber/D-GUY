import { describe, expect, it } from 'vitest';
import { GENERIC_GENERATION_FAILURE, generationFailureForClient, safeGenerationFailureMessage, storedGenerationFailure } from './failure.js';

describe('generation failure reconnect details', () => {
  it('maps provider failure categories to actionable safe dashboard messages', () => {
    expect(safeGenerationFailureMessage([{ category: 'rate_limited' }])).toContain('Provider rate limit reached');
    expect(safeGenerationFailureMessage([{ category: 'timeout' }])).toContain('Generation timed out');
    expect(safeGenerationFailureMessage([{ category: 'invalid_output' }])).toContain('did not pass website validation');
    expect(safeGenerationFailureMessage([{ category: 'invalid_output', providerCode: 'responsive_navigation_missing' }])).toContain('navigation did not meet accessibility');
    expect(safeGenerationFailureMessage([{ category: 'invalid_output', providerCode: 'javascript_syntax_error' }])).toContain('JavaScript did not pass syntax checks');
  });

  it('retains sanitized provider diagnostics for a late event-stream subscriber', () => {
    const message = 'Groq: provider_unavailable (HTTP 503); Gemini: invalid_model (HTTP 404), model_not_found. The previous version remains available.';
    expect(generationFailureForClient(storedGenerationFailure(message))).toBe(message);
  });

  it('preserves the safe error and correlation reference for late subscribers', () => {
    const message = 'Generated response was incomplete. Reference: job-123';
    expect(generationFailureForClient(storedGenerationFailure(message))).toBe(message);
  });

  it('uses safe messages for non-provider failures and cancellation', () => {
    expect(generationFailureForClient('GENERATION_FAILED')).toBe(GENERIC_GENERATION_FAILURE);
    expect(generationFailureForClient('CANCELLED')).toContain('Generation was cancelled');
    expect(generationFailureForClient('PROCESS_RESTARTED')).toContain('API restarted');
    expect(generationFailureForClient('GENERATION_TIMEOUT')).toContain('timed out after 120 seconds');
    expect(generationFailureForClient(null)).toBe(GENERIC_GENERATION_FAILURE);
  });

  it('bounds persisted diagnostic length', () => {
    expect(storedGenerationFailure('x'.repeat(2_000))).toHaveLength('PROVIDER_FAILURE:'.length + 900);
  });
});
