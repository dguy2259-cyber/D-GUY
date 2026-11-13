import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
loadEnv({ path: fileURLToPath(new URL('./.env', import.meta.url)) });
import { defineConfig, env } from 'prisma/config';

const databaseUrl = new URL(env('DATABASE_URL'));
databaseUrl.searchParams.set('sslmode', 'verify-full');
const caPath = process.env.SUPABASE_DB_CA_CERT_PATH;
if (caPath) databaseUrl.searchParams.set('sslrootcert', isAbsolute(caPath) ? caPath : resolve(fileURLToPath(new URL('.', import.meta.url)), caPath));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl.toString() },
});
