export type AdminLoginDecision = 'authorized' | 'profile_missing' | 'identity_mismatch' | 'not_admin' | 'session_failed';

export function authorizeAdministrator(
  authUserId: string,
  profile: { id: string; role: string } | null,
): AdminLoginDecision {
  if (!profile) return 'profile_missing';
  if (!authUserId || profile.id !== authUserId) return 'identity_mismatch';
  if (profile.role !== 'admin') return 'not_admin';
  return 'authorized';
}

/** The callback is invoked only after Supabase identity and trusted DB role checks pass. */
export function establishAdministratorSession(
  authUserId: string,
  profile: { id: string; role: string } | null,
  issueSession: () => boolean,
): AdminLoginDecision {
  const authorization = authorizeAdministrator(authUserId, profile);
  if (authorization !== 'authorized') return authorization;
  return issueSession() ? 'authorized' : 'session_failed';
}
