# D-GUY Phase 1 readiness audit

Audit date: 2026-11-09. This report distinguishes repository implementation, mocked tests, and real-service checks. The workspace has no committed Git baseline, so there is no trustworthy changed-file diff to report.

## Status

| Phase 1 area | Status | Evidence and remaining work |
|---|---|---|
| Existing frontend and Node/Express architecture | Implemented | Existing React, TypeScript, Vite dashboard and Express API retained. Python/FastAPI is not part of the current architecture and was not added. |
| TypeScript configuration and Git | Implemented | Frontend and backend TypeScript builds pass. A local Git repository is initialized; no commit or push was made. |
| Supabase PostgreSQL / TLS | Live-verified (connectivity and schema deploy) | Read-only `SELECT 1` via the shared `pg` pool passed against the configured Supabase pooler with CA verification enabled. `/api/v1/ready` returned 200 from the running API and Compose API container. Four reviewed migrations were applied after read-only status and schema diff showed the app tables were absent; they created the app schema and rate-limit table without dropping existing app data. |
| Prisma schema and migrations | Applied; persistence write tests pending | Prisma client generation/build passed. All four migrations now report applied. No project record was created or changed as a persistence smoke test; use a dedicated staging/test database for write/read/cleanup integration tests. |
| Email/password and Google authentication | Implemented, external setup and live E2E pending | Supabase Auth handles passwords and Google identity; signup email codes are verified by the API, and Google PKCE sessions are verified/refreshed server-side before issuing HttpOnly cookies. Both client paths create only UUID-linked `client` profiles and preserve admin separation. Live email delivery and OAuth require Supabase SMTP/template and Google provider configuration. |
| Admin bootstrap and authorization | Implemented; provisioning previously reported successful | Guarded one-time bootstrap and trusted database role checks exist. Admin provisioning was reported successful by the user; admin login was not re-tested in this run. Client registration cannot self-assign admin. |
| Ownership, validation, CSRF and rate limiting | Implemented, partially tested | Request schemas, ownership-scoped queries, CSRF/session protections, request limits and sanitized error logging are present. Shared PostgreSQL fixed-window rate limiting applies when `NODE_ENV=production`, using hashed client/scope keys, fail-closed behavior, and periodic expiry cleanup. The migration and direct-client access restriction are applied; a multi-instance throttling integration test still needs a dedicated test DB. |
| API gateway and health | Live-verified | `/api/v1/health` and `/api/v1/ready` returned HTTP 200. Readiness runs a real `SELECT 1` using the API's shared pool. Safe startup diagnostics omit password and API credentials. |
| Docker image builds | Passed | API and web images built successfully. API image includes OpenSSL, CA certificates, TypeScript config and the Supabase CA certificate; containers use non-root users, read-only root filesystems, dropped capabilities, resource/PID limits and health checks. |
| Docker Compose runtime | Live-verified locally | API and web images built. A restart test recovered both health checks. Nginx served the app and proxied health/readiness; `localhost:8080` returned HTTP 200. The original internal-only network prevented host publication; a dedicated host-facing bridge fixed it. The API remains unpublished and attached only to the private and outbound networks. |
| Generated-code sandbox | Partially implemented | Preview uses an opaque-origin sandboxed iframe with restrictive CSP, inlines project CSS and local JavaScript, blocks network requests from generated code and displays runtime errors. There is no isolated build/execution container for generated React/Node code; generated server-side code is not run. |
| Rate/load testing, recovery mail, durable jobs, self-correction, Octokit and deployment | Not complete | No load/E2E suite, distributed queue, error-repair loop, GitHub PR automation, Vercel/Render deployment or production monitoring was tested or deployed. |

## Verification results

- `npm run api:build`: passed.
- `npm run api:test`: 65 passed; 3 database integration tests skipped because a dedicated `TEST_DATABASE_URL` was not configured.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed. Vite emitted a bundle-size warning (>500 KB); Docker's static web build also passed.
- `npm --prefix backend run db:check`: passed; real `SELECT 1` returned 1 with TLS verification enabled.
- `prisma migrate status`: all four migrations applied. The schema diff was read-only before deployment and showed the application's modeled objects absent from the public schema.
- Live API: `/api/v1/health` HTTP 200 and `/api/v1/ready` HTTP 200.
- `docker compose --env-file backend/.env build`: passed for both images.
- Local Compose: both containers passed health checks, recovered after restart, and `/`, `/api/v1/health`, and `/api/v1/ready` returned HTTP 200 on `localhost:8080`.
- Automated provider tests use mocked HTTP responses; they do not establish live Groq/Gemini availability and do not make paid calls.
- `npm audit --omit=dev` and `npm --prefix backend audit --omit=dev` reported zero production dependency vulnerabilities. Full frontend audit reported seven moderate advisories in the development TypeScript ESLint/minimatch chain; `npm audit fix` did not resolve them. No high or critical findings were reported.
- One actual dashboard generation reached the API and failed after 58.9 seconds: Groq returned `invalid_output`, then Gemini timed out. The corresponding database job is `failed`; it created no versions and had no active version before generation. The earlier server build did not retain the subcategory for Groq's invalid output. Updated code now identifies malformed JSON, schema rejection, token truncation and missing preview entry points, retries transient errors, raises the output token ceiling from 6,000 to 12,000, and preserves detailed safe errors for late SSE subscribers. These changes have not yet been validated by another real provider request.
- No destructive migration or data rewrite, external deployment, or Git push was performed. No provider request beyond the single failed dashboard attempt was made.

## Manual configuration and acceptance gates

1. In Supabase Auth, configure email/password confirmation and the exact frontend verification/reset redirect URLs. Then test registration, confirmation, sign-in, and session restoration using an isolated test account.
2. Provision or confirm the administrator using the documented one-time bootstrap procedure, then verify admin login and that client login cannot enter admin-only paths. Keep the service-role key temporary and server-side.
3. Against a dedicated staging Supabase project, verify migrations/history, profile and project persistence, session behavior, and a cross-user ownership denial. Do not use production as the automated integration-test database.
4. Resolve or document the seven remaining moderate advisories in frontend build-time dependencies.
5. Configure HTTPS, `COOKIE_SECURE=true`, exact `FRONTEND_ORIGIN`, and the correct trusted proxy setting before public use.
6. Add the separate network-restricted generated-code runtime and resource/timeout limits before executing arbitrary React/Node project builds. Do not expose the Docker socket to generated code.
7. Run all DB write/persistence integration tests on a dedicated test Supabase project with `TEST_DATABASE_URL`; never point the test suite at production.
8. Phase 1 is not fully production-ready until email/password and admin live tests, staged persistence checks, dependency review, host network exposure, and isolated execution requirements are resolved.

## Commands

```powershell
npm run api:build
npm run api:test
npm run typecheck
npm run build -- --configLoader runner
npm --prefix backend run db:check
npm --prefix backend run db:status
docker compose --env-file backend/.env config --quiet
docker compose --env-file backend/.env up --build
```

Do not run `db:migrate` until the target project, migration history and backup have been reviewed and approved.
