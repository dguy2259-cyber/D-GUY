import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import { createDatabasePool, databaseConnectionDiagnostics, databaseFailureCategory } from './database.js';

console.log('Database connection configuration:', JSON.stringify(databaseConnectionDiagnostics()));
const pool = createDatabasePool();
try {
  const result = await pool.query('SELECT 1 AS ok');
  if (result.rows[0]?.ok !== 1) throw new Error('unexpected_query_result');
  console.log('Database check passed: SELECT 1 returned 1.');
} catch (error) {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'UNKNOWN';
  console.error(`Database check failed: ${databaseFailureCategory(error)} (${code}). No connection details were logged.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
