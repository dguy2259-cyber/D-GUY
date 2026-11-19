import { describe, expect, it, vi } from 'vitest';
import { consumeDistributedRateLimit, isRateLimitExemptRole, rateLimitBucketKey } from './rateLimit.js';

describe('distributed PostgreSQL rate limits', () => {
  it('exempts only verified administrator roles from application rate limits', () => {
    expect(isRateLimitExemptRole('admin')).toBe(true);
    expect(isRateLimitExemptRole('client')).toBe(false);
    expect(isRateLimitExemptRole(undefined)).toBe(false);
  });

  it('hashes scope and client address so IPs are not stored in plaintext', () => {
    const key = rateLimitBucketKey('/api/v1/auth/login', '203.0.113.10', 'test-only-secret');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain('203.0.113.10');
    expect(rateLimitBucketKey('/api/v1/auth/login', '203.0.113.11', 'test-only-secret')).not.toBe(key);
    expect(rateLimitBucketKey('/api/v1/auth/login', '203.0.113.10', 'rotated-secret')).not.toBe(key);
  });

  it('atomically increments and reports a blocked request after the limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ hits: 6, retryAfterSeconds: 37 }] });
    const result = await consumeDistributedRateLimit({ query }, 'hashed-key', 5, 60_000);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 37, hits: 6 });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT');
    expect(query.mock.calls[0]?.[1]).toEqual(['hashed-key', 60_000]);
  });

  it('fails closed if the shared store returns an invalid result', async () => {
    await expect(consumeDistributedRateLimit({ query: async () => ({ rows: [] }) }, 'key', 5, 1000)).rejects.toThrow('rate_limit_query_returned_no_row');
  });
});
