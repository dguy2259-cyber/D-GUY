import { describe, expect, it, vi } from 'vitest';
import { createPendingSingleFlight, createSingleFlight, EMAIL_CONFIRMATION_MESSAGE, isEmailSignupVerification, isGoogleOAuthCallback, validateRegistrationDetails } from '../../../src/services/authCallback.js';

describe('browser authentication flow helpers (simulated)', () => {
  it('processes email verification only once when React reruns the effect', async () => {
    const operation = vi.fn(async () => ({ id: 'mock-user' }));
    const callback = createSingleFlight(operation);
    const [first, second] = await Promise.all([callback(), callback()]);
    expect(first).toEqual({ id: 'mock-user' });
    expect(second).toBe(first);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight Google callback exchange and allows a later retry', async () => {
    const operation = vi.fn(async () => ({ id: 'mock-user' }));
    const callback = createPendingSingleFlight(operation);
    const [first, second] = await Promise.all([callback(), callback()]);
    expect(first).toEqual({ id: 'mock-user' });
    expect(second).toBe(first);
    await callback();
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('recognizes signup verification callbacks but not password recovery callbacks', () => {
    expect(isEmailSignupVerification(new URLSearchParams('?type=signup&code=email-code'), new URLSearchParams())).toBe(true);
    expect(isEmailSignupVerification(new URLSearchParams('?type=recovery&code=recovery-code'), new URLSearchParams())).toBe(false);
    expect(isEmailSignupVerification(new URLSearchParams(), new URLSearchParams('type=signup&access_token=email-token'))).toBe(true);
  });

  it('recognizes Google PKCE callbacks without mistaking signup codes or provider errors for OAuth success', () => {
    expect(isGoogleOAuthCallback('/auth/callback', new URLSearchParams('?code=oauth-code'), new URLSearchParams())).toBe(true);
    expect(isGoogleOAuthCallback('/auth/callback', new URLSearchParams('?code=email-code&type=signup'), new URLSearchParams())).toBe(false);
    expect(isGoogleOAuthCallback('/auth/callback', new URLSearchParams('?error=access_denied'), new URLSearchParams())).toBe(false);
    expect(isGoogleOAuthCallback('/', new URLSearchParams('?code=oauth-code'), new URLSearchParams())).toBe(false);
  });

  it('validates registration fields before submission', () => {
    expect(validateRegistrationDetails('Ada Lovelace', 'ada@example.test', 'SecurePass123!', 'SecurePass123!')).toBeUndefined();
    expect(validateRegistrationDetails('A', 'ada@example.test', 'SecurePass123!', 'SecurePass123!')).toContain('full name');
    expect(validateRegistrationDetails('Ada Lovelace', 'invalid', 'SecurePass123!', 'SecurePass123!')).toContain('email');
    expect(validateRegistrationDetails('Ada Lovelace', 'ada@example.test', 'SecurePass123!', 'DifferentPass123!')).toBe('Passwords do not match.');
    expect(validateRegistrationDetails('Ada Lovelace', 'ada@example.test', 'weakpassword', 'weakpassword')).toContain('12');
  });

  it('provides a non-enumerating email-confirmation message', () => {
    expect(EMAIL_CONFIRMATION_MESSAGE).toContain('verification code');
    expect(EMAIL_CONFIRMATION_MESSAGE.toLowerCase()).toContain('enter the code');
  });
});
