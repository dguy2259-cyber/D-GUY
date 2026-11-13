import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/supabaseAuth.js', () => ({ supabaseAuth: null }));

describe('browser authentication request contracts', () => {
  let backendApi: typeof import('../../../src/services/backendApi.js').backendApi;
  let requests: Array<{ url: URL; init?: RequestInit }>;
  let confirmationRequired: boolean;

  beforeEach(async () => {
    vi.resetModules();
    requests = [];
    confirmationRequired = false;
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
      requests.push({ url, init });
      const user = { id: 'mock-user-id', email: 'person@example.test' };
      const payload = url.pathname.endsWith('/auth/register') && confirmationRequired
        ? { confirmationRequired: true, message: 'Check your email to verify the account.' }
        : url.pathname.endsWith('/auth/csrf')
        ? { csrfToken: 'mock-csrf-token' }
        : url.pathname.endsWith('/auth/me')
          ? { user }
          : { user };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    ({ backendApi } = await import('../../../src/services/backendApi.js'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends email login as POST JSON with only email and password', async () => {
    await backendApi.login(' Person@Example.test ', 'not-a-real-password');
    const login = requests.find(({ url }) => url.pathname.endsWith('/auth/login'));
    expect(login?.init?.method).toBe('POST');
    expect(JSON.parse(String(login?.init?.body))).toEqual({
      email: 'person@example.test',
      password: 'not-a-real-password',
    });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/me',
      '/api/v1/auth/csrf',
    ]);
    expect(requests.every(({ init }) => init?.credentials === 'include')).toBe(true);
  });

  it('sends normalized registration details without privileged fields', async () => {
    await backendApi.register(' Ada Lovelace ', ' ADA@Example.test ', 'SecurePass123!');
    const registration = requests.find(({ url }) => url.pathname.endsWith('/auth/register'));
    expect(registration?.init?.method).toBe('POST');
    expect(JSON.parse(String(registration?.init?.body))).toEqual({
      fullName: 'Ada Lovelace',
      email: 'ada@example.test',
      password: 'SecurePass123!',
    });
  });

  it('does not restore an application session before email confirmation', async () => {
    confirmationRequired = true;
    await expect(backendApi.register('Test Client', 'client@example.test', 'SecurePass123!')).resolves.toEqual({
      confirmationRequired: true,
      message: 'Check your email to verify the account.',
    });
    expect(requests.map(({ url }) => url.pathname)).toEqual(['/api/v1/auth/register']);
  });

  it('submits the email code to the backend and restores the verified application session', async () => {
    await backendApi.verifyEmailCode(' ADA@Example.test ', '012345');
    const verification = requests.find(({ url }) => url.pathname.endsWith('/auth/verify-email'));
    expect(verification?.init?.method).toBe('POST');
    expect(JSON.parse(String(verification?.init?.body))).toEqual({ email: 'ada@example.test', code: '012345' });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/api/v1/auth/verify-email',
      '/api/v1/auth/me',
      '/api/v1/auth/csrf',
    ]);
  });

  it('sends the Google access and refresh tokens only to the backend session exchange', async () => {
    await backendApi.googleSession('mock-access-token-with-sufficient-length', 'mock-refresh-token-with-sufficient-length');
    const oauth = requests.find(({ url }) => url.pathname.endsWith('/auth/google/session'));
    expect(oauth?.init?.method).toBe('POST');
    expect(JSON.parse(String(oauth?.init?.body))).toEqual({
      accessToken: 'mock-access-token-with-sufficient-length',
      refreshToken: 'mock-refresh-token-with-sufficient-length',
    });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/api/v1/auth/google/session',
      '/api/v1/auth/me',
      '/api/v1/auth/csrf',
    ]);
  });

  it('requests a verification code through the backend without exposing whether the email exists', async () => {
    await backendApi.resendVerificationCode(' ADA@Example.test ');
    const resend = requests.find(({ url }) => url.pathname.endsWith('/auth/resend-verification'));
    expect(JSON.parse(String(resend?.init?.body))).toEqual({ email: 'ada@example.test' });
    expect(requests).toHaveLength(1);
  });
});
