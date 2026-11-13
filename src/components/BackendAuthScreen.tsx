import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, Hexagon, LoaderCircle } from 'lucide-react';
import { backendApi, BackendApiError, type ApiUser } from '@/services/backendApi';
import {
  beginGoogleSignIn,
  clearSupabaseBrowserSession,
  completeEmailVerification,
  googleCallbackTokens,
  isSupabaseEmailVerificationCallback,
} from '@/services/supabaseAuth';
import { createPendingSingleFlight, isGoogleOAuthCallback, EMAIL_CONFIRMATION_MESSAGE, EMAIL_VERIFICATION_SUCCESS_MESSAGE, validateRegistrationDetails } from '@/services/authCallback';

interface BackendAuthScreenProps { onAuthenticated: (user: ApiUser) => void }
type AuthMode = 'login' | 'register' | 'admin' | 'recover' | 'reset' | 'verify';

const fieldClass = 'mt-2 w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm outline-none focus:border-terracotta';

const completeGoogleOAuthCallback = createPendingSingleFlight(async () => {
  const tokens = await googleCallbackTokens();
  const result = await backendApi.googleSession(tokens.accessToken, tokens.refreshToken);
  await clearSupabaseBrowserSession();
  return result.user;
});

export function BackendAuthScreen({ onAuthenticated }: BackendAuthScreenProps) {
  const [recoveryToken] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hash.get('type') === 'recovery' ? hash.get('access_token') : null;
    if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return token;
  });
  const [mode, setMode] = useState<AuthMode>(() => recoveryToken ? 'reset' : 'login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get('auth_error') || '');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const submissionLock = useRef(false);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const callbackPath = window.location.pathname === '/auth/callback';
    const hasCallbackError = query.has('error') || fragment.has('error');

    if (callbackPath && hasCallbackError) {
      window.history.replaceState(null, '', '/');
      setError('Sign-in could not be completed. Check your Supabase provider settings and try again.');
      return () => { active = false; };
    }

    if (isSupabaseEmailVerificationCallback) {
      setBusy(true);
      void (async () => {
        try {
          await completeEmailVerification();
          window.history.replaceState(null, '', '/');
          if (active) setNotice(EMAIL_VERIFICATION_SUCCESS_MESSAGE);
        } catch (cause) {
          window.history.replaceState(null, '', '/');
          if (active) setError(cause instanceof Error ? cause.message : 'Email verification could not be completed.');
        } finally {
          if (active) setBusy(false);
        }
      })();
    } else if (isGoogleOAuthCallback(window.location.pathname, query, fragment)) {
      setBusy(true);
      void (async () => {
        try {
          const user = await completeGoogleOAuthCallback();
          if (active) onAuthenticated(user);
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'Google sign-in could not be completed.');
        } finally {
          window.history.replaceState(null, '', '/');
          if (active) setBusy(false);
        }
      })();
    } else if (query.get('auth') === 'recovery') {
      window.history.replaceState(null, '', '/');
      setError('The password reset link is invalid or expired. Request another reset email.');
    }
    return () => { active = false; };
  }, [onAuthenticated]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionLock.current) return;
    const submitted = new FormData(event.currentTarget);
    const submittedEmail = String(submitted.get('email') ?? email).trim().toLowerCase();
    const submittedPassword = String(submitted.get('password') ?? password);
    const submittedName = String(submitted.get('fullName') ?? fullName).trim();
    const submittedConfirmation = String(submitted.get('confirmPassword') ?? confirmPassword);
    const submittedCode = String(submitted.get('verificationCode') ?? verificationCode).trim();
    setError('');
    setNotice('');

    if (mode === 'register') {
      const validationError = validateRegistrationDetails(submittedName, submittedEmail, submittedPassword, submittedConfirmation);
      if (validationError) { setError(validationError); return; }
    }
    if (mode === 'verify' && !/^\d{6,8}$/.test(submittedCode)) {
      setError('Enter the 6–8 digit verification code from your email.');
      return;
    }

    submissionLock.current = true;
    setBusy(true);
    try {
      if (mode === 'verify') {
        const result = await backendApi.verifyEmailCode(submittedEmail, submittedCode);
        onAuthenticated(result.user);
        return;
      }
      if (mode === 'recover') {
        const result = await backendApi.requestPasswordReset(submittedEmail);
        setNotice(result.message);
        setMode('login');
        return;
      }
      if (mode === 'reset') {
        if (!recoveryToken) throw new Error('The reset link is missing or expired. Request another email.');
        await backendApi.resetPassword(recoveryToken, submittedPassword);
        setNotice('Password updated. Sign in with your new password.');
        setMode('login');
        setPassword('');
        return;
      }

      const result = mode === 'register'
        ? await backendApi.register(submittedName, submittedEmail, submittedPassword)
        : mode === 'admin'
          ? await backendApi.adminLogin(submittedEmail, submittedPassword)
          : await backendApi.login(submittedEmail, submittedPassword);
      if ('confirmationRequired' in result && result.confirmationRequired) {
        setEmail(submittedEmail);
        setVerificationCode('');
        setMode('verify');
        setNotice(result.message || EMAIL_CONFIRMATION_MESSAGE);
        setPassword('');
        setConfirmPassword('');
        return;
      }
      if (result.user) onAuthenticated(result.user);
    } catch (cause) {
      if (cause instanceof BackendApiError && cause.code === 'EMAIL_NOT_CONFIRMED' && mode === 'login') {
        setEmail(submittedEmail);
        setVerificationCode('');
        setMode('verify');
        setNotice('Your email needs verification. Request a fresh code below, then enter it here.');
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not connect to the D-GUY API.');
      }
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await backendApi.resendVerificationCode(email);
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request a verification code.');
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  };

  const startGoogleSignIn = async () => {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await beginGoogleSignIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google sign-in could not be started.');
      setBusy(false);
      submissionLock.current = false;
    }
  };

  const changeMode = (nextMode: AuthMode) => {
    setError('');
    setNotice('');
    setMode(nextMode);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ivory p-5 text-charcoal">
      <form onSubmit={submit} className="clay-raised w-full max-w-md rounded-clay-lg bg-porcelain p-7 sm:p-9">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-peach/60 shadow-clay-inset">
          <Hexagon className="text-terracotta-deep" />
        </div>
        <h1 className="mt-5 text-center text-2xl font-bold">D-GUY workspace</h1>
        <p className="mt-2 text-center text-sm text-stone">
          {mode === 'verify' ? 'Verify your email to finish signing in.' : 'Sign in to use your persistent, private projects.'}
        </p>

        {mode === 'register' && (
          <>
            <label className="mt-6 block text-sm font-semibold" htmlFor="account-full-name">Full name</label>
            <input id="account-full-name" name="fullName" required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className={fieldClass} />
          </>
        )}

        {mode !== 'reset' && (
          <>
            <label className="mt-6 block text-sm font-semibold" htmlFor="account-email">Email</label>
            <input id="account-email" name="email" required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={fieldClass} />
          </>
        )}

        {mode === 'verify' && (
          <>
            <label className="mt-4 block text-sm font-semibold" htmlFor="verification-code">Email verification code</label>
            <input
              id="verification-code"
              name="verificationCode"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,8}"
              minLength={6}
              maxLength={8}
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
              className={fieldClass}
              aria-describedby="verification-code-help"
            />
            <p id="verification-code-help" className="mt-2 text-xs text-stone">Enter the code from the Supabase verification email.</p>
          </>
        )}

        {!['recover', 'verify'].includes(mode) && (
          <>
            <label className="mt-4 block text-sm font-semibold" htmlFor="account-password">{mode === 'reset' ? 'New password' : 'Password'}</label>
            <div className="relative mt-2">
              <input id="account-password" name="password" required minLength={mode === 'register' || mode === 'reset' ? 12 : 1} maxLength={128} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-cream bg-white px-3 py-2.5 pr-11 text-sm outline-none focus:border-terracotta" />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-2 flex items-center px-2 text-stone">
                <span aria-hidden="true">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</span>
              </button>
            </div>
          </>
        )}

        {mode === 'register' && (
          <>
            <label className="mt-4 block text-sm font-semibold" htmlFor="account-confirm-password">Confirm password</label>
            <div className="relative mt-2">
              <input id="account-confirm-password" name="confirmPassword" required minLength={12} maxLength={128} type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-cream bg-white px-3 py-2.5 pr-11 text-sm outline-none focus:border-terracotta" />
              <button type="button" aria-label={showConfirmation ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmation} onClick={() => setShowConfirmation((value) => !value)} className="absolute inset-y-0 right-2 flex items-center px-2 text-stone">
                <span aria-hidden="true">{showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}</span>
              </button>
            </div>
          </>
        )}

        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}

        <button disabled={busy} className="clay-button mt-5 flex w-full items-center justify-center gap-2 py-3 text-sm">
          {busy && <LoaderCircle size={16} className="animate-spin" />}
          {mode === 'register' ? 'Create account' : mode === 'admin' ? 'Admin sign in' : mode === 'recover' ? 'Send reset email' : mode === 'reset' ? 'Update password' : mode === 'verify' ? 'Verify email and sign in' : 'Sign in'}
        </button>

        {mode === 'verify' && (
          <button type="button" disabled={busy} onClick={() => void resendCode()} className="mt-3 w-full py-2 text-sm font-semibold text-stone">
            {busy ? 'Sending…' : 'Resend verification code'}
          </button>
        )}
        {mode === 'login' && (
          <>
            <button type="button" onClick={() => changeMode('recover')} className="mt-3 w-full py-2 text-sm font-semibold text-stone">Forgot password?</button>
            <div className="my-3 flex items-center gap-3 text-xs text-stone"><span className="h-px flex-1 bg-cream" /><span>or</span><span className="h-px flex-1 bg-cream" /></div>
            <button type="button" disabled={busy} onClick={() => void startGoogleSignIn()} className="flex w-full items-center justify-center gap-3 rounded-xl border border-cream bg-white py-3 text-sm font-semibold text-charcoal shadow-sm transition hover:bg-ivory disabled:opacity-60">
              <span aria-hidden="true" className="font-bold text-lg text-[#4285f4]">G</span>
              Continue with Google
            </button>
          </>
        )}
        {['login', 'register'].includes(mode) && (
          <button type="button" disabled={busy} onClick={() => changeMode(mode === 'login' ? 'register' : 'login')} className="mt-3 w-full py-2 text-sm font-semibold text-terracotta-deep">
            {mode === 'login' ? 'Create an account' : 'Back to sign in'}
          </button>
        )}
        {['recover', 'reset', 'verify'].includes(mode) && (
          <button type="button" disabled={busy} onClick={() => changeMode('login')} className="mt-3 w-full py-2 text-sm font-semibold text-terracotta-deep">Back to sign in</button>
        )}
        <button type="button" disabled={busy} onClick={() => changeMode(mode === 'admin' ? 'login' : 'admin')} className="mt-2 w-full py-2 text-sm font-semibold text-stone">
          {mode === 'admin' ? 'Back to user sign in' : 'Administrator login'}
        </button>
        {mode === 'register' && <p className="mt-2 text-center text-xs text-stone">Use 12–128 characters with uppercase and lowercase letters, a number, and a symbol.</p>}
      </form>
    </main>
  );
}
