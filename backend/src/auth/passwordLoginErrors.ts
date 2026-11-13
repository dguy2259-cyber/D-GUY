export type PasswordLoginFailure = 'ACCOUNT_NOT_FOUND' | 'EMAIL_NOT_CONFIRMED' | 'INVALID_CREDENTIALS';

/** Classify only Supabase error signals; provider text is never forwarded to a client. */
export function classifySupabasePasswordFailure(payload: unknown): PasswordLoginFailure {
  if (!payload || typeof payload !== 'object') return 'INVALID_CREDENTIALS';
  const error = payload as Record<string, unknown>;
  const markers = [error.code, error.error_code, error.msg, error.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (/email[_\s-]+not[_\s-]+confirmed|email.*not.*confirmed/.test(markers)) return 'EMAIL_NOT_CONFIRMED';
  if (/user[_\s-]+not[_\s-]+found|account[_\s-]+not[_\s-]+found/.test(markers)) return 'ACCOUNT_NOT_FOUND';
  return 'INVALID_CREDENTIALS';
}
