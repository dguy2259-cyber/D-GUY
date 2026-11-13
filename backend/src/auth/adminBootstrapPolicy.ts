export type BootstrapDecision = 'already_provisioned' | 'create_auth_user' | 'confirm_existing_user_promotion' | 'promote_existing_user' | 'administrator_conflict' | 'administrator_identity_missing' | 'administrator_identity_mismatch';

export function decideAdminBootstrap(input: { existingAdmin?: { id: string; email: string }; authUser?: { id: string }; promotionConfirmed: boolean; email: string }): BootstrapDecision {
  if (input.existingAdmin) {
    if (input.existingAdmin.email.toLowerCase() !== input.email.toLowerCase()) return 'administrator_conflict';
    if (!input.authUser) return 'administrator_identity_missing';
    return input.existingAdmin.id === input.authUser.id ? 'already_provisioned' : 'administrator_identity_mismatch';
  }
  if (!input.authUser) return 'create_auth_user';
  return input.promotionConfirmed ? 'promote_existing_user' : 'confirm_existing_user_promotion';
}
