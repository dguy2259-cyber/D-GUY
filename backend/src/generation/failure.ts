export const GENERIC_GENERATION_FAILURE = 'AI generation did not complete. The previous version remains available.';
const PROVIDER_FAILURE_PREFIX = 'PROVIDER_FAILURE:';

export function safeGenerationFailureMessage(failures: ReadonlyArray<{ category: string; providerCode?: string }>): string {
  if (failures.some((failure) => failure.category === 'rate_limited')) return 'Provider rate limit reached. Wait for the provider cooldown to end, then try again.';
  if (failures.some((failure) => failure.category === 'timeout')) return 'Generation timed out. Your previous saved version remains active.';
  if (failures.some((failure) => failure.category === 'invalid_output')) {
    const code = failures.find((failure) => failure.category === 'invalid_output')?.providerCode;
    const detail = code === 'responsive_navigation_missing' || code === 'responsive_navigation_ids_invalid' || code === 'responsive_navigation_behavior_missing'
      ? 'The generated navigation did not meet accessibility and responsive checks.'
      : code === 'javascript_syntax_error'
        ? 'The generated JavaScript did not pass syntax checks.'
        : code === 'stylesheet_incomplete'
          ? 'The generated stylesheet was incomplete.'
          : code === 'incomplete_html_document' || code === 'missing_preview_entrypoint'
            ? 'The generated HTML was incomplete.'
            : 'The generated response did not pass website validation.';
    return `${detail} Your previous saved version remains active.`;
  }
  if (failures.some((failure) => failure.category === 'authentication_rejected' || failure.category === 'configuration_error')) return 'The AI provider is not configured correctly. Your previous saved version remains active.';
  if (failures.some((failure) => failure.category === 'invalid_model')) return 'The configured AI model is unavailable. Your previous saved version remains active.';
  return 'AI providers could not complete generation. Your previous saved version remains active.';
}

/** Keep the useful, sanitized provider diagnosis available if the SSE client reconnects after completion. */
export function generationFailureForClient(errorCode: string | null | undefined): string {
  if (errorCode?.startsWith(PROVIDER_FAILURE_PREFIX)) return errorCode.slice(PROVIDER_FAILURE_PREFIX.length);
  if (errorCode === 'CANCELLED') return 'Generation was cancelled. Your previous version remains available.';
  if (errorCode === 'PROCESS_RESTARTED') return 'Generation stopped because the API restarted. Your previous saved version remains available; please try again.';
  if (errorCode === 'GENERATION_TIMEOUT') return 'Generation timed out after 120 seconds. Your previous saved version remains available; please try again.';
  return GENERIC_GENERATION_FAILURE;
}

export function storedGenerationFailure(message: string): string {
  return `${PROVIDER_FAILURE_PREFIX}${message.slice(0, 900)}`;
}
