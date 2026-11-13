import { describe, expect, it } from 'vitest';
import { classifySupabasePasswordFailure } from './passwordLoginErrors.js';

describe('Supabase password failure classification', () => {
  it('classifies unverified email separately without exposing provider details', () => {
    expect(classifySupabasePasswordFailure({ error_code: 'email_not_confirmed' })).toBe('EMAIL_NOT_CONFIRMED');
    expect(classifySupabasePasswordFailure({ msg: 'Email not confirmed' })).toBe('EMAIL_NOT_CONFIRMED');
    expect(classifySupabasePasswordFailure({ code: 'user_not_found' })).toBe('ACCOUNT_NOT_FOUND');
    expect(classifySupabasePasswordFailure({ message: 'Invalid login credentials' })).toBe('INVALID_CREDENTIALS');
    expect(classifySupabasePasswordFailure({ message: 'sensitive provider detail' })).toBe('INVALID_CREDENTIALS');
    expect(classifySupabasePasswordFailure(null)).toBe('INVALID_CREDENTIALS');
  });
});
