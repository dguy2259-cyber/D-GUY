import { describe, expect, it } from 'vitest';
import { isUsableSignupIdentity, registrationProfileData, registrationSchema, registrationValidationMessage, signupConfirmationUrl, signupFailure } from './registration.js';

describe('registration validation and Supabase signup mapping (simulated)', () => {
  it('normalizes names and emails while preserving password input', () => {
    expect(registrationSchema.parse({ fullName: '  Ada Lovelace ', email: 'ADA@Example.test', password: 'SecurePass123!' }))
      .toEqual({ fullName: 'Ada Lovelace', email: 'ada@example.test', password: 'SecurePass123!' });
  });

  it('rejects invalid names, addresses, and weak passwords', () => {
    for (const input of [
      { fullName: 'A', email: 'ada@example.test', password: 'SecurePass123!' },
      { fullName: 'Ada', email: 'invalid', password: 'SecurePass123!' },
      { fullName: 'Ada', email: 'ada@example.test', password: 'short' },
      { fullName: 'Ada', email: 'ada@example.test', password: 'alllowercase123!' },
      { fullName: 'Ada', email: 'ada@example.test', password: 'NoDigitsOrSymbols' },
    ]) expect(registrationSchema.safeParse(input).success).toBe(false);
  });

  it('rejects client-supplied roles and password fields', () => {
    const request = { fullName: 'Ada Lovelace', email: 'ada@example.test', password: 'SecurePass123!' };
    expect(registrationSchema.safeParse({ ...request, role: 'admin' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...request, passwordHash: 'plaintext' }).success).toBe(false);
  });

  it('returns actionable registration field hints without echoing submitted values', () => {
    const invalid = registrationSchema.safeParse({ fullName: 'A', email: 'secret-invalid-address', password: 'weak-private-value' });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    const message = registrationValidationMessage(invalid.error.issues);
    expect(message).toContain('full name');
    expect(message).toContain('valid email address');
    expect(message).toContain('uppercase and lowercase');
    expect(message).not.toContain('secret-invalid-address');
    expect(message).not.toContain('weak-private-value');
  });

  it('does not provision a profile from Supabase anti-enumeration placeholder identities', () => {
    expect(isUsableSignupIdentity({ id: 'fake', email: 'ada@example.test', identities: [] })).toBe(false);
    expect(isUsableSignupIdentity({ id: 'real', email: 'ada@example.test', identities: [{ provider: 'email' }] })).toBe(true);
  });

  it('uses the same non-enumerating response for duplicate or invalid signup attempts', () => {
    const failure = signupFailure(400);
    expect(failure.status).toBe(400);
    expect(failure.message).toContain('If you already have an account');
    expect(failure.message).not.toContain('ada@example.test');
  });

  it('builds a client profile linked to the Supabase UUID without storing a password', () => {
    expect(registrationProfileData({
      id: 'supabase-user-id',
      email: 'ADA@Example.test',
    }, ' Ada   Lovelace ')).toEqual({
      id: 'supabase-user-id',
      email: 'ada@example.test',
      fullName: 'Ada Lovelace',
      role: 'client',
      passwordHash: null,
    });
  });

  it('sends legacy email confirmation to an allowlisted frontend callback, falling back to the configured site', () => {
    expect(signupConfirmationUrl('http://localhost:5173', ['http://localhost:5173'])).toBe('http://localhost:5173/auth/callback');
    expect(signupConfirmationUrl('https://untrusted.example', ['https://app.example.test'])).toBe('https://app.example.test/auth/callback');
    expect(() => signupConfirmationUrl(undefined, [])).toThrow('FRONTEND_ORIGIN');
  });

  it('maps provider errors to safe, non-secret messages', () => {
    expect(signupFailure(429).code).toBe('AUTH_RATE_LIMITED');
    expect(signupFailure(500).status).toBe(503);
    expect(signupFailure(400).message).toContain('If you already have an account');
  });
});
