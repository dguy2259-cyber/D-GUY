# DGUY API

Express/TypeScript API. PostgreSQL on the configured Supabase project is intended to persist profiles, projects, versions, jobs, usage, and audit events. Generated project files are text data; this API does not execute generated files.

## Local setup

Copy `backend/.env.example` to `backend/.env` and the root `.env.example` to `.env`. Configure the Supabase PostgreSQL connection string from Dashboard → Connect, URL-encoding reserved password characters. Download the database CA certificate from Database Settings → SSL Configuration and place it at the configured `SUPABASE_DB_CA_CERT_PATH`. Both API and bootstrap use a TLS-verifying `pg` pool; the CA path resolves relative to `backend/`. The Prisma CLI connection string also needs `sslmode=verify-full&sslrootcert=./certs/prod-ca-2021.crt`. Do not disable certificate verification. Vite loads public browser values from root `.env` (with a compatibility fallback to public `VITE_*` values in `backend/.env`). Backend runtime and Prisma config resolve `backend/.env` relative to their own files, independent of shell working directory.

The frontend receives only the Supabase URL, anon/publishable key, and API base URL through `VITE_*`; keep service-role, database, and AI provider keys server-only. `SESSION_SECRET` is intentionally not required: Supabase Auth validates sessions and the API stores Supabase tokens in HttpOnly cookies. Set `COOKIE_SECURE=true` for HTTPS. Install root and backend dependencies, run `npm --prefix backend run db:generate`, then use root `npm run dev` to start both Vite and the API or `npm run dev:api` to run only the API.

Client registration, email/password login, email-code verification, Google OAuth, and password recovery use Supabase Auth. The API creates a corresponding client profile using the Supabase Auth UUID and verifies profiles and project ownership on protected requests. No application password hashes are stored. The API uses HttpOnly access/refresh cookies and same-site CSRF cookie/header checks. For signup codes, configure the Supabase Confirm signup email template to include `{{ .Token }}` and configure SMTP for production delivery. For Google, enable the Google provider in Supabase Auth and configure its client ID/secret there; the server verifies the Supabase access token, refreshes the same user session, and only then issues HttpOnly cookies. Google client credentials never belong in the frontend or this API's environment file. Set the exact frontend callback URL in Supabase Auth's allowed redirect URLs.

The first administrator is provisioned with `npm run admin:bootstrap` using `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_BOOTSTRAP_EMAIL`, and `ADMIN_BOOTSTRAP_PASSWORD` supplied only in the local shell. The password must be 12–128 characters. The command calls the Supabase Auth Admin API and the TLS-verifying PostgreSQL pool, refuses a different configured administrator, and verifies that the Auth user and `User` profile IDs match and the profile has `role=admin`. Repeated runs are idempotent. An existing Auth identity requires `ADMIN_BOOTSTRAP_CONFIRM_PROMOTION=YES` before its database profile can be promoted. To explicitly reset the password of only that exact Auth identity, set `ADMIN_BOOTSTRAP_RESET_PASSWORD=YES`; the command will never reset another account. Set `ADMIN_BOOTSTRAP_EMAIL` to the designated administrator's address. Supply secrets with secure PowerShell prompts and remove all temporary variables afterward:

```powershell
$secureServiceKey = Read-Host 'Supabase service-role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [Net.NetworkCredential]::new('', $secureServiceKey).Password
$env:ADMIN_BOOTSTRAP_EMAIL = Read-Host 'Administrator email'
# Only when explicitly promoting an existing Auth user:
# $env:ADMIN_BOOTSTRAP_CONFIRM_PROMOTION = 'YES'
# Only when explicitly resetting an existing target Auth password:
# $env:ADMIN_BOOTSTRAP_RESET_PASSWORD = 'YES'
$securePassword = Read-Host 'New or explicitly authorized reset password' -AsSecureString
$env:ADMIN_BOOTSTRAP_PASSWORD = [Net.NetworkCredential]::new('', $securePassword).Password
npm --prefix backend run admin:bootstrap
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_CONFIRM_PROMOTION, Env:ADMIN_BOOTSTRAP_RESET_PASSWORD, Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
$securePassword = $null
$secureServiceKey = $null
```

Do not set the promotion confirmation unless that Auth account should become an administrator. Do not set roles through client requests. Current admin login checks the trusted profile role; administrator user/config management APIs are not implemented.

## Database changes

The checked-in migrations create the application tables, ownership RLS policies, and the rate-limit bucket; they do not reset the database. For any target, run `npm run db:check`, `npm run db:status`, review the migration SQL, and confirm a recoverable backup before intentionally running `npm run db:migrate`. Production request limits use PostgreSQL when `NODE_ENV=production` and fail closed if the rate-limit table is missing. `npm run db:dev` is only for disposable development databases. Docker does not apply migrations automatically.

## Routes

All routes are under `/api/v1`. Errors use `{error:{code,message}}`. Protected project/version/generation/export/usage queries are scoped to the verified Supabase Auth user. Mutations require CSRF. Health and readiness are `GET /health` and `GET /ready`.

Auth: `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/google/session`, `/auth/admin/login`, `/auth/logout`, `/auth/recover`, `/auth/password`; `GET /auth/me`, `/auth/csrf`. The API verifies Supabase Auth sessions, requires a matching profile for client access, and issues HttpOnly cookies. Client registration and Google provisioning never accept or assign a privileged role.

Projects: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `GET/PUT /projects/:id/files`, version list/detail/restore routes, `POST /projects/:id/generations`, generation status/events/cancel routes, ZIP export, and `/usage/me`.

Generation enforces prompt/file bounds, per-process rate and concurrency limits, idempotency keys, bounded provider retries, provider timeouts, Gemini/Groq/OpenRouter fallback, strict JSON/file validation, and transactional version/job/usage persistence. Live jobs and SSE subscribers are in process memory; startup marks leftover queued/running jobs as interrupted without deleting project or version data. Users must retry interrupted jobs, and multi-instance deployments need a durable queue and shared event transport.

## Tests and operational limits

`npm test` covers mocked provider HTTP, output/file validation, and provider fallback without paid calls. Database integration tests require a dedicated `TEST_DATABASE_URL`; they create then delete test rows and are skipped if unset. Never point it at production. Live provider tests are separate and intentionally not part of the normal test command.

Generated `index.html` is rendered in an opaque-origin sandboxed iframe with a restrictive CSP; local CSS and JavaScript assets are embedded into that isolated preview, which reports browser runtime errors. Arbitrary React/Node project builds do not run in a WebContainer or isolated container. Automatic AI self-correction, GitHub/Octokit automation, durable distributed job processing, deployment to Vercel/Render, and production monitoring remain unimplemented. Production request limits are shared through PostgreSQL; development limits remain process-local. See the root [production readiness audit](../docs/production-readiness-audit.md) and [threat model](../docs/threat-model.md).
