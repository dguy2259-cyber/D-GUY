import { describe, expect, it } from 'vitest';
import { sessionCookieOptions } from './cookies.js';

describe('authentication cookie policy', () => {
  it('keeps access and refresh tokens HttpOnly with bounded lifetime and same-site policy', () => {
    expect(sessionCookieOptions(true, true, 60 * 60_000)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60_000 });
  });

  it('allows the CSRF double-submit token to be read by the client without weakening session cookies', () => {
    expect(sessionCookieOptions(false, false)).toEqual({ httpOnly: false, secure: false, sameSite: 'lax', path: '/' });
  });
});
