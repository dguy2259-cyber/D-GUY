import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Pool as PgPool } from 'pg';
import { createDatabasePool, databaseConnectionDiagnostics, databaseFailureCategory } from './database.js';

describe('verified PostgreSQL pool configuration', () => {
  let pool: PgPool | undefined;
  afterEach(async () => { await pool?.end(); pool = undefined; });

  it('requires TLS certificate verification and strips ambiguous URL SSL overrides', () => {
    const expectedCa = readFileSync(new URL('../certs/prod-ca-2021.crt', import.meta.url), 'utf8');
    pool = createDatabasePool('postgresql://test:secret@localhost:5432/dguy?sslmode=require&uselibpqcompat=true', '');
    expect(pool.options.ssl).toEqual({ ca: expectedCa, rejectUnauthorized: true });
    expect(pool.options.connectionString).not.toContain('sslmode=');
    expect(pool.options.connectionString).not.toContain('uselibpqcompat=');
  });

  it('loads the packaged Supabase CA relative to the backend module by default', () => {
    const expectedCa = readFileSync(new URL('../certs/prod-ca-2021.crt', import.meta.url), 'utf8');
    pool = createDatabasePool('postgresql://test:secret@localhost:5432/dguy');
    expect(pool.options.ssl).toEqual({ ca: expectedCa, rejectUnauthorized: true });
    expect(databaseConnectionDiagnostics('postgresql://test:secret@localhost:5432/dguy')).toMatchObject({
      caConfigured: true,
      tlsVerification: 'enabled',
    });
  });

  it('fails with deployment guidance when the configured CA certificate is missing', () => {
    expect(() => createDatabasePool('postgresql://test:secret@localhost:5432/dguy', 'certs/not-present.crt'))
      .toThrow(/Supabase PostgreSQL CA certificate is missing.*SUPABASE_DB_CA_CERT_PATH/);
  });

  it('keeps the CA certificate in Vercel function bundles for either project root', () => {
    const backendConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      functions: Record<string, { includeFiles: string }>;
    };
    const repositoryConfig = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
      functions: Record<string, { includeFiles: string }>;
    };
    expect(backendConfig.functions['dist/server.js']?.includeFiles).toBe('certs/prod-ca-2021.crt');
    expect(repositoryConfig.functions['backend/dist/server.js']?.includeFiles).toBe('backend/certs/prod-ca-2021.crt');
    expect(readFileSync(new URL('../certs/prod-ca-2021.crt', import.meta.url), 'utf8')).toContain('BEGIN CERTIFICATE');
  });

  it('rejects non-PostgreSQL URLs before attempting a connection', () => {
    expect(() => createDatabasePool('https://example.test/db', '')).toThrow('DATABASE_URL must use PostgreSQL');
  });
  it('reports non-secret connection diagnostics only', () => {
    const diagnostics = databaseConnectionDiagnostics('postgresql://test:private-value@localhost:5432/dguy?sslmode=require', '');
    expect(diagnostics).toMatchObject({ host: 'localhost', port: 5432, username: 'test', database: 'dguy', caConfigured: true, tlsVerification: 'enabled' });
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
