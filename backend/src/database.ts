import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { Pool } from 'pg';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));

export function databaseConnectionDiagnostics(databaseUrl = process.env.DATABASE_URL, caPath = process.env.SUPABASE_DB_CA_CERT_PATH) {
  if (!databaseUrl) return { configured: false, tlsVerification: 'enabled' as const };
  const connection = new URL(databaseUrl);
  const certPath = caPath ? (isAbsolute(caPath) ? caPath : resolve(backendRoot, caPath)) : undefined;
  let caFingerprint256: string | undefined;
  if (certPath) caFingerprint256 = new X509Certificate(readFileSync(certPath)).fingerprint256;
  return {
    configured: true,
    host: connection.hostname,
    port: Number(connection.port || 5432),
    username: decodeURIComponent(connection.username),
    database: decodeURIComponent(connection.pathname.replace(/^\//, '')),
    caConfigured: Boolean(certPath),
    caFingerprint256,
    tlsVerification: 'enabled' as const,
  };
}

export function databaseFailureCategory(error: unknown): string {
  const value = error as { code?: unknown; meta?: { code?: unknown; message?: unknown }; cause?: { code?: unknown; message?: unknown }; message?: unknown };
  const code = typeof value?.code === 'string' ? value.code : '';
  const detailCode = typeof value?.meta?.code === 'string' ? value.meta.code : typeof value?.cause?.code === 'string' ? value.cause.code : '';
  const safeDiagnosticText = [value?.meta?.message, value?.cause?.message, value?.message].filter((part): part is string => typeof part === 'string').join(' ');
  if (detailCode === '28P01' || /password authentication failed/i.test(safeDiagnosticText)) return 'database_authentication_rejected';
  if (detailCode === '28000') return 'database_authorization_rejected';
  if (/self.signed certificate|certificate verify failed|hostname.*mismatch/i.test(safeDiagnosticText)) return 'database_tls_verification_failed';
  if (/getaddrinfo.*(ENOTFOUND|EAI_AGAIN)|could not translate host name/i.test(safeDiagnosticText)) return 'database_dns_failed';
  if (/connect.*timeout|connection timed out|ECONNREFUSED|ECONNRESET/i.test(safeDiagnosticText)) return 'database_network_unavailable';
  if (detailCode) return databaseFailureCategory({ code: detailCode });
  if (code === '28P01') return 'database_authentication_rejected';
  if (code === '28000') return 'database_authorization_rejected';
  if (code.includes('CERT') || code.startsWith('TLS') || code.startsWith('ERR_TLS')) return 'database_tls_verification_failed';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'database_dns_failed';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'CONNECT_TIMEOUT') return 'database_network_unavailable';
  return 'database_connection_failed';
}

/** Build a PostgreSQL pool with TLS verification enabled and an optional Supabase CA bundle. */
export function createDatabasePool(databaseUrl = process.env.DATABASE_URL, caPath = process.env.SUPABASE_DB_CA_CERT_PATH) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const connection = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  // pg's connection string parser may otherwise override an explicit SSL configuration.
  connection.searchParams.delete('sslmode');
  connection.searchParams.delete('sslrootcert');
  connection.searchParams.delete('uselibpqcompat');

  const ssl = caPath
    ? { ca: readFileSync(isAbsolute(caPath) ? caPath : resolve(backendRoot, caPath), 'utf8'), rejectUnauthorized: true as const }
    : { rejectUnauthorized: true as const };

  return new Pool({ connectionString: connection.toString(), ssl, max: 10, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 30_000 });
}
