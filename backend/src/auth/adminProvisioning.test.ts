import { describe, expect, it, vi } from 'vitest';
import { provisionAdministrator } from './adminProvisioning.js';

const target = { id: 'supabase-admin-id', email: 'admin@gmail.com' };

function harness(initial?: { auth?: typeof target | null; profile?: { id: string; email: string; role: string } | null }) {
  let authUser = initial?.auth ?? null;
  let profile = initial?.profile ?? null;
  const auth = {
    findUserByEmail: vi.fn(async () => authUser),
    createUser: vi.fn(async (email: string) => {
      authUser = { ...target, email };
      return authUser;
    }),
    updatePassword: vi.fn(async () => undefined),
  };
  const profiles = {
    findAdministrator: vi.fn(async () => profile?.role === 'admin' ? { id: profile.id, email: profile.email } : null),
    ensureAdministrator: vi.fn(async (identity: typeof target) => {
      profile = { ...identity, role: 'admin' };
      return profile;
    }),
    findById: vi.fn(async (id: string) => profile?.id === id ? profile : null),
  };
  return { auth, profiles, getAuth: () => authUser, getProfile: () => profile };
}

const baseOptions = {
  email: 'admin@gmail.com',
  password: 'Local-only-Strong-Password-57!',
  promotionConfirmed: true,
  resetExistingPassword: false,
};

describe('administrator provisioning (simulated Auth API/database; no external calls)', () => {
  it('creates the Auth identity and matching admin profile, then remains idempotent', async () => {
    const h = harness();
    const first = await provisionAdministrator(baseOptions, h.auth, h.profiles);
    const second = await provisionAdministrator(baseOptions, h.auth, h.profiles);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(h.auth.createUser).toHaveBeenCalledTimes(1);
    expect(h.profiles.ensureAdministrator).toHaveBeenCalledTimes(1);
    expect(h.getAuth()?.id).toBe(h.getProfile()?.id);
    expect(h.getProfile()?.role).toBe('admin');
    expect(h.auth.updatePassword).not.toHaveBeenCalled();
  });

  it('resets only the exact existing administrator when explicitly requested', async () => {
    const h = harness({ auth: target, profile: { ...target, role: 'admin' } });
    const result = await provisionAdministrator({ ...baseOptions, resetExistingPassword: true }, h.auth, h.profiles);
    expect(result.resetPassword).toBe(true);
    expect(h.auth.updatePassword).toHaveBeenCalledTimes(1);
    expect(h.auth.updatePassword).toHaveBeenCalledWith(target.id, baseOptions.password);
  });

  it('recovers an ambiguous create result only when the exact Auth identity can be found', async () => {
    const h = harness();
    h.auth.findUserByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(target);
    h.auth.createUser.mockRejectedValueOnce(new Error('simulated create response lost'));
    const result = await provisionAdministrator(baseOptions, h.auth, h.profiles);
    expect(result.identity).toEqual(target);
    expect(h.profiles.ensureAdministrator).toHaveBeenCalledWith(target);
  });

  it('does not reset or promote an existing account without explicit promotion authorization', async () => {
    const h = harness({ auth: target, profile: { ...target, role: 'user' } });
    await expect(provisionAdministrator({ ...baseOptions, promotionConfirmed: false, resetExistingPassword: true }, h.auth, h.profiles)).rejects.toThrow('ADMIN_BOOTSTRAP_CONFIRM_PROMOTION=YES');
    expect(h.auth.updatePassword).not.toHaveBeenCalled();
    expect(h.profiles.ensureAdministrator).not.toHaveBeenCalled();
  });

  it('refuses to change credentials if another administrator exists', async () => {
    const h = harness({ auth: target, profile: { id: 'different-admin-id', email: 'other@example.test', role: 'admin' } });
    await expect(provisionAdministrator({ ...baseOptions, resetExistingPassword: true }, h.auth, h.profiles)).rejects.toThrow('A different administrator is already provisioned');
    expect(h.auth.updatePassword).not.toHaveBeenCalled();
  });

  it('requires a strong local password for creation and reset operations', async () => {
    const fresh = harness();
    await expect(provisionAdministrator({ ...baseOptions, password: undefined }, fresh.auth, fresh.profiles)).rejects.toThrow('ADMIN_BOOTSTRAP_PASSWORD');
    const existing = harness({ auth: target, profile: { ...target, role: 'admin' } });
    await expect(provisionAdministrator({ ...baseOptions, password: undefined, resetExistingPassword: true }, existing.auth, existing.profiles)).rejects.toThrow('ADMIN_BOOTSTRAP_PASSWORD');
  });

  it('rejects profile identity mismatch after the database write', async () => {
    const h = harness({ auth: target, profile: null });
    h.profiles.ensureAdministrator.mockResolvedValue({ id: 'wrong-id', email: target.email, role: 'admin' });
    await expect(provisionAdministrator(baseOptions, h.auth, h.profiles)).rejects.toThrow('database profile ID, email, and role must match');
    expect(h.auth.updatePassword).not.toHaveBeenCalled();
  });
});
