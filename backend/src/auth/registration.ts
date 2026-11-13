import { z } from 'zod';

const securePassword = z.string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Password must be 128 characters or fewer.')
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/\d/, 'Include a number.')
  .regex(/[^A-Za-z0-9]/, 'Include a symbol.');

export const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: securePassword,
}).strict();

export function registrationValidationMessage(issues: ReadonlyArray<{ path: readonly PropertyKey[]; code?: string }>): string {
  const fields = new Set<string>();
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === 'fullName') fields.add('full name (2–100 characters)');
    else if (field === 'email') fields.add('a valid email address');
    else if (field === 'password') fields.add('a password with 12–128 characters, uppercase and lowercase letters, a number, and a symbol');
    else fields.add('only the listed account fields');
  }
  return fields.size ? `Check ${[...fields].join('; ')}.` : 'Check the account details and try again.';
}

export interface SupabaseSignupUser {
  id?: string;
  email?: string;
  identities?: unknown[] | null;
}

export const SIGNUP_CONFIRMATION_MESSAGE = 'We sent a verification code if this account is eligible. Enter the code from your email to finish signing up.';

export interface RegistrationProfileData {
  id: string;
  email: string;
  fullName: string;
  role: 'client';
  passwordHash: null;
}

export function registrationProfileData(identity: SupabaseSignupUser & { id: string; email: string }, fallbackName: string): RegistrationProfileData {
  return {
    id: identity.id,
    email: identity.email.trim().toLowerCase(),
    fullName: fallbackName.trim().replace(/\s+/g, ' '),
    role: 'client',
    passwordHash: null,
  };
}

export function signupConfirmationUrl(requestOrigin: string | undefined, allowedOrigins: readonly string[]): string {
  const origin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
  if (!origin) throw new Error('FRONTEND_ORIGIN is required for account verification redirects');
  return new URL('/auth/callback', origin).toString();
}

/** Supabase may return a synthetic empty-identity user for an existing email. */
export function isUsableSignupIdentity(user: SupabaseSignupUser | null | undefined): user is SupabaseSignupUser & { id: string; email: string } {
  return Boolean(user?.id && user.email && !(Array.isArray(user.identities) && user.identities.length === 0));
}

export function signupFailure(status: number): { status: number; code: string; message: string } {
  if (status === 429) return { status: 429, code: 'AUTH_RATE_LIMITED', message: 'Too many account attempts. Wait a few minutes and try again.' };
  if (status >= 500) return { status: 503, code: 'AUTH_UNAVAILABLE', message: 'Supabase account creation is temporarily unavailable. Please try again shortly.' };
  // Keep account existence private; the same guidance works for duplicates and bad details.
  return { status: 400, code: 'SIGNUP_FAILED', message: 'Account could not be created. Check the details. If you already have an account, sign in or reset your password.' };
}

export { securePassword };
