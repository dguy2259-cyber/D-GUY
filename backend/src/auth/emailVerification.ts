import { z } from 'zod';

const emailAddress = z.string().trim().email().max(254).transform((email) => email.toLowerCase());

export const verifySignupCodeSchema = z.object({
  email: emailAddress,
  code: z.string().trim().regex(/^\d{6,8}$/),
}).strict();

export const resendSignupCodeSchema = z.object({ email: emailAddress }).strict();

export const SIGNUP_CODE_SENT_MESSAGE = 'If the address can be verified, Supabase has sent a verification code. Check your inbox and spam folder.';

export function verificationFailure(status: number) {
  if (status === 429) return { status: 429, code: 'AUTH_RATE_LIMITED', message: 'Too many verification attempts. Wait a few minutes and try again.' };
  if (status >= 500) return { status: 503, code: 'AUTH_UNAVAILABLE', message: 'Email verification is temporarily unavailable. Please try again shortly.' };
  return { status: 400, code: 'EMAIL_CODE_INVALID', message: 'That verification code is invalid or expired. Request a new code and try again.' };
}
