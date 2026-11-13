export const EMAIL_VERIFICATION_SUCCESS_MESSAGE = 'Email verified. Sign in with your email and password to continue.';

export function createSingleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) pending = operation();
    return pending;
  };
}

export function createPendingSingleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const current = operation();
      const shared = current.finally(() => {
        if (pending === shared) pending = undefined;
      });
      pending = shared;
    }
    return pending;
  };
}

export function isEmailSignupVerification(query: URLSearchParams, fragment: URLSearchParams): boolean {
  const isSignup = query.get('type') === 'signup' || fragment.get('type') === 'signup';
  const carriesAuthResult = query.has('code') || fragment.has('access_token');
  return isSignup && carriesAuthResult;
}

export const EMAIL_CONFIRMATION_MESSAGE = 'We sent a verification code if this account is eligible. Enter the code from your email to finish signing up.';

export function isGoogleOAuthCallback(pathname: string, query: URLSearchParams, fragment: URLSearchParams): boolean {
  return pathname === '/auth/callback' && !query.has('error') && !fragment.has('error') && query.has('code') && query.get('type') !== 'signup';
}

export function validateRegistrationDetails(fullName: string, email: string, password: string, confirmation: string): string | undefined {
  if (fullName.trim().length < 2 || fullName.trim().length > 100) return 'Enter your full name (2 to 100 characters).';
  if (email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Use 12–128 characters with an uppercase letter, lowercase letter, number, and symbol.';
  }
  if (password !== confirmation) return 'Passwords do not match.';
  return undefined;
}
