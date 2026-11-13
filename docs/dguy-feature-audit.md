# D-GUY foundation feature audit

Audit updated: 2026-11-07. `IMPLEMENTED` means the code path exists, `TESTED` means a local/mock test passed, `LIVE-VERIFIED` means an external service operation succeeded, and `NOT IMPLEMENTED` means no working implementation exists in this repository.

## Authentication and project workflow

| Feature | Status | Evidence / limit |
|---|---|---|
| Email/password registration/login, email-code verification/resend, reset, logout, cookie restoration | Implemented; external Auth unverified | Supabase Auth handles identity; server-side registration writes the Auth UUID and normalized email to `User`, assigns new profiles `client`, and stores no password hash. Signup codes are verified server-side and sessions are persisted in HttpOnly cookies. Live delivery and account verification are pending external Supabase SMTP/template configuration. |
| Google sign-in | Implemented; provider setup required | Supabase OAuth PKCE callback is exchanged through the API. Google provider identity and verified email are checked server-side; profile conflicts and admin roles are rejected, and new profiles receive only `client`. Live OAuth remains unverified until Supabase and Google provider credentials/redirect URLs are configured. |
| Admin separation and one-time bootstrap | Implemented; live admin missing | Admin login checks trusted `User.role`; regular client registration cannot set privileged roles. The database currently has no provisioned admin, and no credentials were invented. |
| Projects, ownership, files, history, revisions, restore, ZIP | Implemented; persistence integration pending | Routes scope project/version/generation/export reads and writes by authenticated owner. The real schema is now deployed, but a disposable DB test is required for create/read/update/delete verification. |
| AI provider adapters | Implemented; mocked tests pass | Groq primary and Gemini fallback are configured with schema validation, timeout and sanitized errors. No live inference was performed during this work. |
| Generation persistence | Implemented; live write not tested | Persistence uses transactional Prisma writes for versions, job status and usage. No user project or generation was written to the configured database during verification. |
| SSE generation updates | Implemented; process-local worker | Streams stage, validated paths and completion. Jobs/subscribers are not durable across API restarts and events are not replayed. |

## Runtime and security

| Feature | Status | Evidence / limit |
|---|---|---|
| Health/readiness and database TLS | Live-verified | Supabase `SELECT 1` passed using the shared verified-TLS pool. Health and readiness both return HTTP 200. |
| Prisma schema/migrations | Live-verified | Four migrations were applied after status and schema diff showed app tables absent; `prisma migrate status` reports up to date. Migrations create tables and policies without dropping existing app data. |
| Distributed production rate limits | Implemented; isolated integration pending | Production mode uses atomic PostgreSQL counters, HMAC-hashed client/scope keys, expiry cleanup and fail-closed errors. Development uses bounded process-local buckets. The integration test requires an isolated `TEST_DATABASE_URL`. |
| File validation and ZIP export | Implemented and unit-tested | Rejects traversal, sensitive paths, unsafe filenames, duplicate paths and oversized content. |
| HTML preview | Implemented | Uses an opaque-origin sandboxed iframe and restrictive CSP. It does not execute generated code in the API. |
| Isolated React/Node build runner | Not implemented | No separate sandbox runtime is included. Building an executor safely requires a restricted runtime and lifecycle controls; the Docker socket will not be exposed to generated code. |
| Docker Compose | Built and locally started | API container became healthy; internal Nginx frontend and API proxy checks passed. Host access to port 8080 was unavailable in this execution environment. Public deployment was not performed. |
| Self-correction, Octokit, deployment, monitoring | Not implemented | No bounded error-repair loop, GitHub PR workflow, Vercel/Render release, durable queue or production monitoring. |

## Current checks

- Backend production build: passed.
- Backend tests: 41 passed; 3 database integration tests skipped without a dedicated `TEST_DATABASE_URL`.
- Frontend TypeScript check and production build: passed. Vite reports a large-bundle warning.
- Docker API/web image builds: passed; Compose API is healthy.
- Real Supabase database connectivity and migration status: passed.
- Frontend dependency audit: seven moderate build-time advisories remain; npm registry audit could not be refreshed from this environment. API runtime dependency install reported none.
- No paid AI call, Auth write, project write, external deployment, Git push, or destructive migration was performed.

## Manual verification still required

1. Configure Supabase email/password confirmation and exact allowed verification/reset redirect URLs; exercise registration, login, verification, reset, and restored sessions using an isolated test account.
2. Provision the intended administrator with the guarded bootstrap using temporary credentials, then test admin login and client-role denial.
3. Configure a dedicated disposable `TEST_DATABASE_URL`, apply the migrations there, and run the persistence and shared-rate-limit integration tests. Never use the production database for these tests.
4. Review remaining frontend dependency advisories and verify Compose host-port access on the target machine.
5. Before running arbitrary React/Node builds, add an isolated execution runtime with network, filesystem, process, resource and time limits.
6. Configure HTTPS, `NODE_ENV=production`, `COOKIE_SECURE=true`, exact HTTPS frontend origins and trusted proxy hops before any public deployment.
