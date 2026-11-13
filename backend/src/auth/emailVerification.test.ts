import { describe, expect, it } from 'vitest';
import { resendSignupCodeSchema, SIGNUP_CODE_SENT_MESSAGE, verificationFailure, verifySignupCodeSchema } from './emailVerification.js';

describe('signup email code validation', () => {
  it('normalizes the verification email and accepts a 6-digit code', () => {
    expect(verifySignupCodeSchema.parse({ email: ' ADA@Example.test ', code: '123456' })).toEqual({
      email: 'ada@example.test',
      code: '123456',
    });
  });

  it('rejects malformed or privileged verification input', () => {
    expect(verifySignupCodeSchema.safeParse({ email: 'invalid', code: '123456' }).success).toBe(false);
    expect(verifySignupCodeSchema.safeParse({ email: 'ada@example.test', code: '12345' }).success).toBe(false);
    expect(verifySignupCodeSchema.safeParse({ email: 'ada@example.test', code: '123456', role: 'admin' }).success).toBe(false);
    expect(resendSignupCodeSchema.safeParse({ email: 'ada@example.test', role: 'admin' }).success).toBe(false);
  });

  it('keeps resend responses generic and provider failures sanitized', () => {
    expect(SIGNUP_CODE_SENT_MESSAGE).not.toContain('ada@example.test');
    expect(verificationFailure(400).code).toBe('EMAIL_CODE_INVALID');
    expect(verificationFailure(429).status).toBe(429);
    expect(verificationFailure(503).status).toBe(503);
  });
});
