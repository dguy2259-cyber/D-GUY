import { afterEach, describe, expect, it } from 'vitest';
import type { Pool as PgPool } from 'pg';
import { createDatabasePool, databaseConnectionDiagnostics, databaseFailureCategory } from './database.js';

describe('verified PostgreSQL pool configuration', () => {
  let pool: PgPool | undefined;
  afterEach(async () => { await pool?.end(); pool = undefined; });

  it('requires TLS certificate verification and strips ambiguous URL SSL overrides', () => {
    pool = createDatabasePool('postgresql://test:secret@localhost:5432/dguy?sslmode=require&uselibpqcompat=true', '');
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
    expect(pool.options.connectionString).not.toContain('sslmode=');
    expect(pool.options.connectionString).not.toContain('uselibpqcompat=');
  });

  it('rejects non-PostgreSQL URLs before attempting a connection', () => {
    expect(() => createDatabasePool('https://example.test/db', '')).toThrow('DATABASE_URL must use PostgreSQL');
  });
  it('reports non-secret connection diagnostics only', () => {
    const diagnostics = databaseConnectionDiagnostics('postgresql://test:private-value@localhost:5432/dguy?sslmode=require', '');
    expect(diagnostics).toMatchObject({ host: 'localhost', port: 5432, username: 'test', database: 'dguy', caConfigured: false, tlsVerification: 'enabled' });
    expect(JSON.stringify(diagnostics)).not.toContain('private-value');
  });

  it('classifies wrapped PostgreSQL password rejection without logging its message', () => {
    expect(databaseFailureCategory({ code: 'P2010', meta: { message: 'password authentication failed for user "postgres"' } })).toBe('database_authentication_rejected');
  });
  it('classifies TLS, DNS and network failures safely', () => {
    expect(databaseFailureCategory({ code: 'SELF_SIGNED_CERT_IN_CHAIN' })).toBe('database_tls_verification_failed');
    expect(databaseFailureCategory({ code: 'ENOTFOUND' })).toBe('database_dns_failed');
    expect(databaseFailureCategory({ code: 'ETIMEDOUT' })).toBe('database_network_unavailable');
  });
});
