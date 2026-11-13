export interface VerifiedGoogleIdentity {
  id: string;
  email: string;
  provider: string;
  emailVerified: boolean;
  fullName?: string;
}

export interface GoogleProfileRecord {
  id: string;
  email: string;
  role: string;
}

export type GoogleProfileDecision =
  | 'create'
  | 'authorized'
  | 'provider_mismatch'
  | 'email_unverified'
  | 'identity_mismatch'
  | 'email_conflict'
  | 'admin_login_required'
  | 'client_profile_required';

export function decideGoogleProfile(
  identity: VerifiedGoogleIdentity,
  profileById: GoogleProfileRecord | null,
  profileByEmail: GoogleProfileRecord | null,
): GoogleProfileDecision {
  if (identity.provider !== 'google') return 'provider_mismatch';
  if (!identity.emailVerified) return 'email_unverified';
  if (profileById) {
    if (profileById.id !== identity.id || profileById.email.trim().toLowerCase() !== identity.email.trim().toLowerCase()) return 'identity_mismatch';
    if (profileById.role === 'admin') return 'admin_login_required';
    return profileById.role === 'client' || profileById.role === 'user' ? 'authorized' : 'client_profile_required';
  }
  if (profileByEmail && profileByEmail.id !== identity.id) return 'email_conflict';
  return 'create';
}

export function googleClientProfileData(identity: VerifiedGoogleIdentity) {
  const cleanName = (identity.fullName ?? '')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  return {
    id: identity.id,
    email: identity.email.trim().toLowerCase(),
    fullName: cleanName.length >= 2 ? cleanName : 'Google User',
    role: 'client',
    passwordHash: null,
  } as const;
}
