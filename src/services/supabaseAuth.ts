import { createClient } from '@supabase/supabase-js';
import { createSingleFlight, isEmailSignupVerification } from './authCallback';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const verificationQuery = new URLSearchParams(window.location.search);
const verificationFragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
export const isSupabaseEmailVerificationCallback = isEmailSignupVerification(verificationQuery, verificationFragment);

// Supabase's browser session is short-lived and scoped to this tab. The durable
// application session is held by the backend in HttpOnly cookies.
export const supabaseAuth = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, storage: window.sessionStorage },
    })
  : null;

export async function beginGoogleSignIn(): Promise<void> {
  if (!supabaseAuth) throw new Error('Google sign-in is not configured. Add the public Supabase URL and anon key to the frontend environment.');
  const { error } = await supabaseAuth.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw new Error('Google sign-in could not start. Check the Supabase Google provider setup and allowed redirect URLs.');
}

export async function googleCallbackTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  if (!supabaseAuth) throw new Error('Google sign-in is not configured.');
  const { data, error } = await supabaseAuth.auth.getSession();
  if (error || !data.session) throw new Error('Google sign-in could not be completed. Try again.');
  const metadata = data.session.user.app_metadata;
  const providers = [
    metadata.provider,
    ...(Array.isArray(metadata.providers) ? metadata.providers : []),
    ...(Array.isArray(data.session.user.identities) ? data.session.user.identities.map((identity) => identity.provider) : []),
  ];
  if (!providers.includes('google')) throw new Error('The returned sign-in session is not a Google account.');
  return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
}

export async function clearSupabaseBrowserSession(): Promise<void> {
  if (!supabaseAuth) return;
  const { error } = await supabaseAuth.auth.signOut({ scope: 'local' });
  if (error) throw new Error('Sign-in completed, but temporary browser credentials could not be cleared. Reload and try again.');
}

const finishEmailVerificationOnce = createSingleFlight(async () => {
  if (!supabaseAuth) throw new Error('Email verification is not configured.');
  const { data, error } = await supabaseAuth.auth.getSession();
  if (error || !data.session) throw new Error('This email verification link is invalid or expired. Request another verification email.');
  const { error: signOutError } = await supabaseAuth.auth.signOut({ scope: 'local' });
  if (signOutError) throw new Error('Email verification completed, but the temporary browser session could not be cleared.');
});

export function completeEmailVerification() {
  return finishEmailVerificationOnce();
}
