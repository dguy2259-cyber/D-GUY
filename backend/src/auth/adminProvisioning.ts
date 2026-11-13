import { decideAdminBootstrap } from './adminBootstrapPolicy.js';

export interface AdminAuthIdentity { id: string; email: string }
export interface AdministratorProfile { id: string; email: string; role: string }

export interface AdminAuthAdminApi {
  findUserByEmail(email: string): Promise<AdminAuthIdentity | null>;
  createUser(email: string, password: string): Promise<AdminAuthIdentity>;
  updatePassword(userId: string, password: string): Promise<void>;
}

export interface AdminProfileStore {
  findAdministrator(): Promise<{ id: string; email: string } | null>;
  ensureAdministrator(identity: AdminAuthIdentity): Promise<AdministratorProfile>;
  findById(id: string): Promise<AdministratorProfile | null>;
}

export interface ProvisionAdministratorOptions {
  email: string;
  password?: string;
  promotionConfirmed: boolean;
  resetExistingPassword: boolean;
}

function validatePassword(password: string | undefined): asserts password is string {
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD must contain 12–128 characters for account creation or an explicitly confirmed password reset.');
  }
}

export async function provisionAdministrator(
  options: ProvisionAdministratorOptions,
  auth: AdminAuthAdminApi,
  profiles: AdminProfileStore,
): Promise<{ identity: AdminAuthIdentity; profile: AdministratorProfile; created: boolean; resetPassword: boolean }> {
  const email = options.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_BOOTSTRAP_EMAIL does not meet the required format.');

  const [existingAdmin, existingIdentity] = await Promise.all([
    profiles.findAdministrator(),
    auth.findUserByEmail(email),
  ]);
  const decision = decideAdminBootstrap({
    existingAdmin: existingAdmin ?? undefined,
    authUser: existingIdentity ? { id: existingIdentity.id } : undefined,
    promotionConfirmed: options.promotionConfirmed,
    email,
  });

  if (decision === 'administrator_conflict') throw new Error('A different administrator is already provisioned; bootstrap refused.');
  if (decision === 'administrator_identity_missing') throw new Error('The administrator profile has no matching Supabase Auth user; manual reconciliation is required.');
  if (decision === 'administrator_identity_mismatch') throw new Error('The administrator email resolves to a different Supabase Auth identity; manual reconciliation is required.');
  if (decision === 'confirm_existing_user_promotion') throw new Error('This Auth user already exists. Set ADMIN_BOOTSTRAP_CONFIRM_PROMOTION=YES locally to authorize promotion, then rerun.');

  const created = decision === 'create_auth_user';
  if (created || options.resetExistingPassword) validatePassword(options.password);
  if (options.resetExistingPassword && !options.promotionConfirmed && decision !== 'already_provisioned') {
    throw new Error('Set ADMIN_BOOTSTRAP_CONFIRM_PROMOTION=YES locally before resetting a password while promoting an existing Auth user.');
  }

  let identity = existingIdentity;
  if (created) {
    try {
      identity = await auth.createUser(email, options.password!);
    } catch (creationError) {
      // Recover the common concurrent-bootstrap/response-timeout case without
      // treating a failed create as success unless the exact identity exists.
      identity = await auth.findUserByEmail(email);
      if (!identity) throw creationError;
    }
  }
  if (!identity?.id || identity.email.trim().toLowerCase() !== email) {
    throw new Error('Supabase Auth identity did not match ADMIN_BOOTSTRAP_EMAIL; profile changes were refused.');
  }

  const profile = created || decision === 'promote_existing_user'
    ? await profiles.ensureAdministrator(identity)
    : await profiles.findById(identity.id);
  if (!profile || profile.id !== identity.id || profile.email.trim().toLowerCase() !== email || profile.role !== 'admin') {
    throw new Error('Administrator profile verification failed: Supabase Auth ID, database profile ID, email, and role must match.');
  }

  // Only the identity found by exact normalized email can be reset. This path
  // is opt-in and never updates another Auth user's credentials.
  if (!created && options.resetExistingPassword) await auth.updatePassword(identity.id, options.password!);

  return { identity, profile, created, resetPassword: !created && options.resetExistingPassword };
}
