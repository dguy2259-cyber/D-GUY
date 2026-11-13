export const GENERIC_GENERATION_FAILURE = 'AI generation did not complete. The previous version remains available.';
const PROVIDER_FAILURE_PREFIX = 'PROVIDER_FAILURE:';

/** Keep the useful, sanitized provider diagnosis available if the SSE client reconnects after completion. */
export function generationFailureForClient(errorCode: string | null | undefined): string {
  if (errorCode?.startsWith(PROVIDER_FAILURE_PREFIX)) return errorCode.slice(PROVIDER_FAILURE_PREFIX.length);
  if (errorCode === 'CANCELLED') return 'Generation was cancelled. Your previous version remains available.';
  if (errorCode === 'PROCESS_RESTARTED') return 'Generation stopped because the API restarted. Your previous saved version remains available; please try again.';
  return GENERIC_GENERATION_FAILURE;
}

export function storedGenerationFailure(message: string): string {
  return `${PROVIDER_FAILURE_PREFIX}${message.slice(0, 900)}`;
}
