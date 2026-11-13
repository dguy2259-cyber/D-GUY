import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createDatabasePool } from './database.js';
import { provisionAdministrator } from './auth/adminProvisioning.js';

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;
const missingConfiguration = [
  ['SUPABASE_URL', supabaseUrl],
  ['SUPABASE_SERVICE_ROLE_KEY', serviceKey],
  ['DATABASE_URL', databaseUrl],
  ['ADMIN_BOOTSTRAP_EMAIL', email],
].filter(([, value]) => !value).map(([name]) => name);
if (missingConfiguration.length) throw new Error(`Set the required local environment variable(s): ${missingConfiguration.join(', ')}.`);

async function adminRequest(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl!}/auth/v1/admin/${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey!}`, 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error('Supabase Admin API could not be reached; check the local network and Supabase URL.');
  }
  if (!response.ok) throw new Error(`Supabase Admin API rejected the bootstrap request (HTTP ${response.status}).`);
  return response.status === 204 ? null : response.json();
}

async function findAuthUser(targetEmail: string) {
  for (let page = 1; page <= 20; page += 1) {
    const result = await adminRequest(`users?page=${page}&per_page=100`) as { users?: Array<{ id: string; email?: string }> };
    const users = result.users ?? [];
    const found = users.find((user) => user.email?.trim().toLowerCase() === targetEmail);
    if (found?.id && found.email) return { id: found.id, email: found.email };
    if (users.length < 100) break;
  }
  return null;
}

const pool = createDatabasePool(databaseUrl!);
const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
try {
  await prisma.$queryRaw`SELECT 1`;
  const result = await provisionAdministrator({
    email: email!,
    password,
    promotionConfirmed: process.env.ADMIN_BOOTSTRAP_CONFIRM_PROMOTION === 'YES',
    resetExistingPassword: process.env.ADMIN_BOOTSTRAP_RESET_PASSWORD === 'YES',
  }, {
    findUserByEmail: findAuthUser,
    async createUser(targetEmail, initialPassword) {
      const user = await adminRequest('users', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail, password: initialPassword, email_confirm: true }),
      }) as { id?: string; email?: string };
      if (!user.id || !user.email) throw new Error('Supabase Admin API returned an incomplete Auth identity.');
      return { id: user.id, email: user.email };
    },
    async updatePassword(userId, nextPassword) {
      await adminRequest(`users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        body: JSON.stringify({ password: nextPassword }),
      });
    },
  }, {
    async findAdministrator() {
      return prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true, email: true } });
    },
    async ensureAdministrator(identity) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('d-guy-admin-bootstrap'))`;
        const anotherAdmin = await tx.user.findFirst({ where: { role: 'admin' } });
        if (anotherAdmin && anotherAdmin.id !== identity.id) {
          throw new Error('A different administrator is already provisioned; bootstrap refused.');
        }
        const profile = await tx.user.upsert({
          where: { id: identity.id },
          create: { id: identity.id, email: email!, role: 'admin', passwordHash: null },
          update: { email: email!, role: 'admin' },
        });
        await tx.auditEvent.create({ data: { userId: identity.id, action: 'admin.bootstrapped' } });
        return { id: profile.id, email: profile.email, role: profile.role };
      });
    },
    async findById(id) {
      return prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
    },
  });
  console.log(`Administrator provisioning verified; Auth and database IDs match. Created=${result.created}; PasswordReset=${result.resetPassword}.`);
} finally {
  await prisma.$disconnect();
}
