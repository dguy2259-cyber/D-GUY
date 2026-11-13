import { z } from 'zod';

export type ClientLoginDecision = 'authorized' | 'profile_missing' | 'identity_mismatch' | 'admin_login_required' | 'client_profile_required';
export type AuthenticatedProfileDecision = 'authorized' | 'profile_missing' | 'identity_mismatch' | 'client_profile_required';

export function authorizeAuthenticatedProfile(
  authUserId: string,
  authEmail: string,
  profile: { id: string; email: string; role: string } | null,
): AuthenticatedProfileDecision {
  if (!profile) return 'profile_missing';
  if (!authUserId || profile.id !== authUserId || profile.email.trim().toLowerCase() !== authEmail.trim().toLowerCase()) return 'identity_mismatch';
  if (!['admin', 'client', 'user'].includes(profile.role)) return 'client_profile_required';
  return 'authorized';
}

export function authorizeClientLogin(
  authUserId: string,
  authEmail: string,
  profile: { id: string; email: string; role: string } | null,
): ClientLoginDecision {
  const profileDecision = authorizeAuthenticatedProfile(authUserId, authEmail, profile);
  if (profileDecision !== 'authorized') return profileDecision;
  if (!profile) return 'profile_missing';
  if (profile.role === 'admin') return 'admin_login_required';
  if (profile.role !== 'client' && profile.role !== 'user') return 'client_profile_required';
  return 'authorized';
}

/** Exact user/admin password-login contract, aligned with the browser's JSON payload. */
export const passwordLoginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();

export function passwordLoginValidationMessage(issues: ReadonlyArray<{ code: string; path: readonly PropertyKey[] }>): string {
  if (issues.some((issue) => issue.code === 'unrecognized_keys')) return 'Sign-in accepts only an email address and password.';
  if (issues.some((issue) => issue.path[0] === 'email')) return 'Enter a valid email address.';
  if (issues.some((issue) => issue.path[0] === 'password')) return 'Enter a password of 1 to 128 characters.';
  return 'Enter both your email address and password.';
}
