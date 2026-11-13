import { describe, expect, it } from 'vitest';
import { authorizeAuthenticatedProfile, authorizeClientLogin, passwordLoginSchema, passwordLoginValidationMessage } from './passwordLogin.js';

describe('password login request contract', () => {
  it('accepts the exact frontend payload and normalizes email whitespace/case', () => {
    expect(passwordLoginSchema.parse({ email: '  Ada@Example.test ', password: 'correct horse battery staple' }))
      .toEqual({ email: 'ada@example.test', password: 'correct horse battery staple' });
  });

  it('rejects malformed email, missing password, oversized password, and unexpected properties', () => {
    expect(passwordLoginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(passwordLoginSchema.safeParse({ email: 'ada@example.test' }).success).toBe(false);
    expect(passwordLoginSchema.safeParse({ email: 'ada@example.test', password: 'x'.repeat(129) }).success).toBe(false);
    expect(passwordLoginSchema.safeParse({ email: 'ada@example.test', password: 'x', fullName: 'Ada' }).success).toBe(false);
  });

  it('returns field-specific guidance without echoing submitted values', () => {
    const badEmail = passwordLoginSchema.safeParse({ email: 'private-invalid-value', password: 'secret' });
    expect(badEmail.success).toBe(false);
    if (badEmail.success) return;
    const message = passwordLoginValidationMessage(badEmail.error.issues);
    expect(message).toBe('Enter a valid email address.');
    expect(message).not.toContain('private-invalid-value');
    expect(message).not.toContain('secret');
  });

  it('requires a matching client profile and preserves legacy client-role accounts', () => {
    expect(authorizeAuthenticatedProfile('auth-id', 'ada@example.test', null)).toBe('profile_missing');
    expect(authorizeAuthenticatedProfile('auth-id', 'ada@example.test', { id: 'auth-id', email: 'ada@example.test', role: 'client' })).toBe('authorized');
    expect(authorizeAuthenticatedProfile('auth-id', 'ada@example.test', { id: 'auth-id', email: 'ada@example.test', role: 'unknown' })).toBe('client_profile_required');
    expect(authorizeClientLogin('auth-id', 'ada@example.test', null)).toBe('profile_missing');
    expect(authorizeClientLogin('auth-id', 'ada@example.test', { id: 'another-id', email: 'ada@example.test', role: 'client' })).toBe('identity_mismatch');
    expect(authorizeClientLogin('auth-id', 'ada@example.test', { id: 'auth-id', email: 'different@example.test', role: 'client' })).toBe('identity_mismatch');
    expect(authorizeClientLogin('auth-id', 'ADA@example.test', { id: 'auth-id', email: 'ada@example.test', role: 'client' })).toBe('authorized');
    expect(authorizeClientLogin('auth-id', 'ada@example.test', { id: 'auth-id', email: 'ada@example.test', role: 'user' })).toBe('authorized');
  });

  it('keeps administrator and unknown roles out of client login', () => {
    expect(authorizeClientLogin('auth-id', 'ada@example.test', { id: 'auth-id', email: 'ada@example.test', role: 'admin' })).toBe('admin_login_required');
    expect(authorizeClientLogin('auth-id', 'ada@example.test', { id: 'auth-id', email: 'ada@example.test', role: 'unknown' })).toBe('client_profile_required');
  });
});
