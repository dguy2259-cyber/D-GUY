import { describe, expect, it } from 'vitest';
import { decideAdminBootstrap } from './adminBootstrapPolicy.js';

describe('one-time administrator bootstrap policy', () => {
  it('is idempotent for the already bootstrapped administrator', () => {
    expect(decideAdminBootstrap({ existingAdmin: { id: 'same-id', email: 'Admin@example.test' }, authUser: { id: 'same-id' }, promotionConfirmed: false, email: 'admin@example.test' })).toBe('already_provisioned');
  });
  it('refuses a second administrator', () => {
    expect(decideAdminBootstrap({ existingAdmin: { id: 'other-id', email: 'other@example.test' }, authUser: { id: 'other-id' }, promotionConfirmed: true, email: 'admin@example.test' })).toBe('administrator_conflict');
  });
  it('does not report a database admin as ready when its Supabase identity is missing', () => {
    expect(decideAdminBootstrap({ existingAdmin: { id: 'admin-id', email: 'admin@example.test' }, promotionConfirmed: false, email: 'admin@example.test' })).toBe('administrator_identity_missing');
  });
  it('refuses idempotent success if the matching email belongs to a different identity', () => {
    expect(decideAdminBootstrap({ existingAdmin: { id: 'old-id', email: 'admin@example.test' }, authUser: { id: 'new-id' }, promotionConfirmed: false, email: 'admin@example.test' })).toBe('administrator_identity_mismatch');
  });
  it('requires explicit confirmation before promoting an existing Auth user', () => {
    expect(decideAdminBootstrap({ authUser: { id: 'auth-id' }, promotionConfirmed: false, email: 'admin@example.test' })).toBe('confirm_existing_user_promotion');
    expect(decideAdminBootstrap({ authUser: { id: 'auth-id' }, promotionConfirmed: true, email: 'admin@example.test' })).toBe('promote_existing_user');
  });
  it('only requests an initial password when creating a new Auth user', () => {
    expect(decideAdminBootstrap({ promotionConfirmed: false, email: 'admin@example.test' })).toBe('create_auth_user');
  });
});
