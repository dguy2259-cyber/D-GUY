import { describe, expect, it } from 'vitest';
import { decideGoogleProfile, googleClientProfileData } from './googleOAuth.js';

const identity = {
  id: 'auth-user-id',
  email: 'ADA@Example.test',
  provider: 'google',
  emailVerified: true,
  fullName: '  Ada   Lovelace ',
};

describe('Google OAuth profile authorization', () => {
  it('creates only a verified Google identity as a client with no password hash', () => {
    expect(decideGoogleProfile(identity, null, null)).toBe('create');
    expect(googleClientProfileData(identity)).toEqual({
      id: 'auth-user-id',
      email: 'ada@example.test',
      fullName: 'Ada Lovelace',
      role: 'client',
      passwordHash: null,
    });
  });

  it('requires a verified email and the Google provider', () => {
    expect(decideGoogleProfile({ ...identity, provider: 'email' }, null, null)).toBe('provider_mismatch');
    expect(decideGoogleProfile({ ...identity, emailVerified: false }, null, null)).toBe('email_unverified');
  });

  it('preserves existing role and rejects identity conflicts', () => {
    expect(decideGoogleProfile(identity, { id: identity.id, email: 'ada@example.test', role: 'client' }, null)).toBe('authorized');
    expect(decideGoogleProfile(identity, { id: identity.id, email: 'ada@example.test', role: 'admin' }, null)).toBe('admin_login_required');
    expect(decideGoogleProfile(identity, { id: identity.id, email: 'other@example.test', role: 'client' }, null)).toBe('identity_mismatch');
    expect(decideGoogleProfile(identity, null, { id: 'other-id', email: 'ada@example.test', role: 'client' })).toBe('email_conflict');
  });
});
