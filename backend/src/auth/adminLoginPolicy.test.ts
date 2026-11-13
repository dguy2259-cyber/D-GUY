import { describe, expect, it, vi } from 'vitest';
import { authorizeAdministrator, establishAdministratorSession } from './adminLoginPolicy.js';

describe('administrator login authorization (post-Supabase password verification)', () => {
  it('allows a verified Auth identity only when its matching trusted profile is admin', () => {
    expect(authorizeAdministrator('auth-id', { id: 'auth-id', role: 'admin' })).toBe('authorized');
  });
  it('denies when Supabase did not provide a verified identity', () => {
    expect(authorizeAdministrator('', { id: 'auth-id', role: 'admin' })).toBe('identity_mismatch');
  });
  it('denies missing profiles and non-admin roles', () => {
    expect(authorizeAdministrator('auth-id', null)).toBe('profile_missing');
    expect(authorizeAdministrator('auth-id', { id: 'auth-id', role: 'user' })).toBe('not_admin');
  });
  it('denies a mismatched Auth identity even when another profile is admin', () => {
    expect(authorizeAdministrator('different-auth-id', { id: 'admin-id', role: 'admin' })).toBe('identity_mismatch');
  });
  it('issues the existing session only after successful Supabase and profile authorization', () => {
    const issueSession = vi.fn(() => true);
    expect(establishAdministratorSession('auth-id', { id: 'auth-id', role: 'admin' }, issueSession)).toBe('authorized');
    expect(issueSession).toHaveBeenCalledOnce();
  });
  it('does not issue a session for rejected credentials or non-admin profiles', () => {
    const issueSession = vi.fn(() => true);
    expect(establishAdministratorSession('', { id: 'auth-id', role: 'admin' }, issueSession)).toBe('identity_mismatch');
    expect(establishAdministratorSession('auth-id', { id: 'auth-id', role: 'user' }, issueSession)).toBe('not_admin');
    expect(issueSession).not.toHaveBeenCalled();
  });
  it('reports cookie/session creation failure rather than authenticating', () => {
    expect(establishAdministratorSession('auth-id', { id: 'auth-id', role: 'admin' }, () => false)).toBe('session_failed');
  });
});
