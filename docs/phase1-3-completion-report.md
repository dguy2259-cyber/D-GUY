# D-GUY Phase 1–3 Acceptance Report

Report date: 2026-11-12 (Asia/Kolkata; updated after the follow-up implementation pass)

This report distinguishes code and automated-test evidence from live product acceptance. Phase 4 deployment and GitHub PR automation are outside the Phase 1–3 acceptance scope. The paper task sheet specifies Groq-first routing; a later direct project instruction specified Gemini-first. The implementation retains Gemini → Groq → OpenRouter and optional Featherless routing; this is a documented project decision, not a claim that the original sheet said Gemini-first.

Authentication details later in this report are historical snapshots. The current email-code and Google OAuth implementation, test results, and remaining external setup are recorded in the latest “Email-code and Google sign-in update” section.

## Phase 1 — Infrastructure, isolation, and database

| Task | Status | Evidence and limits |
|---|---|---|
| 1.1 Development environment | COMPLETED AND VERIFIED | Node.js v24.19.0 is installed. `npm.cmd` scripts execute. Frontend/API packages and their build scripts are present. |
| 1.2 Docker and isolated containers | COMPLETED AND VERIFIED | Docker Desktop Engine is running (Docker CLI/server 29.2.1). `docker compose --env-file backend/.env up --build -d` rebuilt the current API and web images and started both services. Docker reports both containers healthy. The web container is published on `127.0.0.1:8080`; its `/api/v1/health` and `/api/v1/ready` proxy checks returned HTTP 200, confirming frontend-to-API networking and database readiness from the containerized API. The API remains private to the Compose network on port 8787 by design. |
| 1.3 API gateway and health checks | COMPLETED AND VERIFIED | `/api/v1/health` and `/api/v1/ready` on port 8787 in the local development service previously returned HTTP 200. The rebuilt Compose web app at `http://localhost:8080/` returns HTTP 200; through its internal Nginx proxy, `/api/v1/health` returns `{"status":"ok"...}` and `/api/v1/ready` returns `{"status":"ready"}` (both HTTP 200). Compose API port 8787 is internal-only by design. Earlier Vite CORS/preflight checks also passed. |
| 1.4 Supabase PostgreSQL, TLS, persistence | PARTIALLY COMPLETED | `npm.cmd --prefix backend run db:check` passed a real `SELECT 1`. `db:status` connected to Supabase and reported five migrations up to date. A read-only Prisma generation-job count passed with zero queued/running jobs. The startup-recovery `updateMany` was reproduced in a transaction then rolled back; it matched zero rows. Browser reload persistence and authenticated ownership were not verified. |

## Phase 2 — AI orchestration and structured generation

| Requirement | Status | Evidence and limits |
|---|---|---|
| Provider adapters and configured routing | IMPLEMENTED BUT NOT LIVE-VERIFIED | Current configured route is Gemini → Groq → OpenRouter, with optional Featherless after those providers. No provider was called in this pass. No model, credential, or priority was changed. |
| Structured files and validation | IMPLEMENTED BUT NOT LIVE-VERIFIED | Code requests bounded static site files and validates the generated file set before saving. Backend tests exercise provider and file validation paths with mocked HTTP responses; there is no real provider output evidence from this pass. |
| Fallback, deadlines, and rate limits | IMPLEMENTED BUT NOT LIVE-VERIFIED | Bounded budgets/fallback and rate-limit handling are present in the implementation. Automated coverage is included in the backend suite; no real provider failure/recovery was induced. |
| Provider latency / total generation time | PARTIALLY COMPLETED | No real generation ran, so first-token and end-to-end timings cannot be reported against the task sheet's 30–120 second goal. |

## Phase 3 — Dashboard, streaming, and preview

| Requirement | Status | Evidence and limits |
|---|---|---|
| 3.1 Dual-panel dashboard | PARTIALLY COMPLETED | Playwright was installed outside the repository and launched the real local frontend in Edge. The sign-in page rendered; its layout was checked at desktop 1440px, tablet 768px, and mobile 390px with no horizontal overflow. The authenticated dual-panel dashboard has not yet been accessed. |
| 3.2 SSE source streaming | IMPLEMENTED AND AUTOMATED-TESTED; LIVE STREAM AWAITS AUTHENTICATED VERIFICATION | Server events carry monotonic per-job IDs; the browser resumes with `Last-Event-ID` and avoids replaying consumed deltas. Vanilla file streams reset on provider fallback, and structured React/Next output now emits per-file start/content events while JSON streams arrive. Focused tests cover chunked escaped content, fallback resets, cursor resume, and terminal failure handling. No authenticated live stream was observed. |
| 3.3 Static iframe and React/Vite WebContainer | IMPLEMENTED AND AUTOMATED-TESTED; LIVE PREVIEW AWAITS GENERATED PROJECT | The isolated static preview now embeds matching local image/font assets, rejects path traversal, and drops external CSS imports/resources so network-blocked assets fall back offline. A transient WebContainer boot failure no longer poisons the cached singleton; successful concurrent boots are shared. Focused tests cover these paths. No generated site was run in-browser; Next.js compatibility remains unverified. |
| 3.4 Under-two-minute website build | PARTIALLY COMPLETED | No real generation duration was measured. |
| Runtime-error self-correction | PARTIALLY COMPLETED | Error-reporting/repair code is present in the project, but no live preview error was captured and repaired end-to-end in this pass. |

## Complete workflow checks

| Workflow step | Status | Evidence and limits |
|---|---|---|
| Email/password registration/login/session | PARTIALLY COMPLETED | Registration and login source paths are covered by automated validation, profile-mapping, role-policy, duplicate-signup, and cookie-session request tests. New Supabase Auth users receive a UUID-linked `User` profile with normalized email, `fullName`, `role=client`, `passwordHash=null`, and database-default `createdAt`. Missing/mismatched profiles are rejected during login and session restoration. No real account, profile write, or authenticated dashboard was verified. Google sign-in has since been removed. |
| Create project and generate a real website | IMPLEMENTED BUT NOT LIVE-VERIFIED | No authenticated project was available; no provider request or project write was made. A real request may incur provider charges and requires separate approval. |
| Stream into Code/Files and render preview | IMPLEMENTED AND AUTOMATED-TESTED; LIVE APP AWAITS AUTH | Mocked SSE tests verify file deltas for framework and static output, including provider fallback. Browser rendering of generated files still awaits authenticated generation. |
| Reload persistence, revision, ZIP and extraction | IMPLEMENTED BUT NOT LIVE-VERIFIED | No authenticated project was available for reload/revision/download verification. |

## Checks run on 2026-11-12

- `npm run api:test` — passed: 26 files passed, 1 skipped; 151 tests passed, 3 skipped. Skips require dedicated `TEST_DATABASE_URL` integration setup.
- `npm run api:build` — passed, including Prisma client generation and TypeScript compilation.
- `npm run typecheck` — passed.
- `npm run lint` — passed after the final test changes.
- `npm run build` — passed. Vite emitted the existing >500 kB main-chunk warning; latest output was 604.70 kB (168.16 kB gzip).
- Follow-up targeted tests — passed: 4 files, 13 tests covering SSE reconnect/cursor replay, history IDs, transient WebContainer boot retry, and safe local preview assets.
- Follow-up `npm.cmd --prefix backend run build` and `npm.cmd run typecheck` — passed after the changes.
- Follow-up `npm.cmd run lint` — passed after the changes.
- Follow-up `npm.cmd run build` — passed outside the restricted sandbox. Vite emitted the existing large-chunk warning; main JS chunk is 604.48 kB (168.07 kB gzip).
- `docker compose --env-file backend/.env config --quiet` — passed. A plain `docker compose config --quiet` failed because Compose interpolation did not find `VITE_SUPABASE_URL`; supplying the existing backend env file resolved configuration without printing expanded values.
- Docker verification — `docker compose --env-file backend/.env up --build -d` rebuilt both images with the final auth fix and recreated both services. The web production bundle was 365.79 kB (109.92 kB gzip). `docker compose ... ps` reports API and web containers `running`, `healthy`.
- Container-facing HTTP checks — `http://localhost:8080/` returned HTTP 200; `http://localhost:8080/api/v1/health` returned HTTP 200 and provider route Gemini → Groq → OpenRouter; `http://localhost:8080/api/v1/ready` returned HTTP 200 (`ready`). This confirms web-to-API Compose networking and API readiness against the configured database.
- Docker-facing HTTP checks after the final rebuild: web, `/api/v1/health`, and `/api/v1/ready` all returned HTTP 200. Headless Edge rendered the login page from port 8080 and observed only the expected `GET /api/v1/auth/me` at startup.
- Host API runtime: a read-only count found no queued/running generation jobs before restart. The rebuilt server, including the refresh-token validation fix, was started on port 8787; health/readiness returned 200. No generation recovery rows were changed.
- Docker image build emitted an npm audit notice of seven moderate findings during the frontend dependency install; the build succeeded. No automatic dependency updates were applied.
- `http://localhost:5173/` — HTTP 200, response contains Vite dev client marker.
- `http://localhost:8787/api/v1/health` — HTTP 200 with status `ok` and provider order Gemini → Groq → OpenRouter.
- `http://localhost:8787/api/v1/ready` — HTTP 200 with status `ready` (the endpoint uses the real shared-pool readiness query).
- CORS — `OPTIONS /api/v1/auth/login` from Origin `http://localhost:5173` returned 204, allowed credentials origin, POST, and `content-type,x-csrf-token`; direct health with that Origin returned 200.
- `GET /api/v1/auth/me` and `/api/v1/projects` — HTTP 401 without a session.
- Current rebuilt API probes used only synthetic values: login returned 401 `INVALID_CREDENTIALS` after Supabase rejected them; Google session with a 15-character refresh token returned 401 `GOOGLE_SESSION_INVALID`, confirming the shorter token passed schema validation. The rebuilt Docker API image also accepted that short token in a schema-only check. Invalid registration fields returned 400 before Supabase.
- `npm.cmd --prefix backend run db:check` — passed: real PostgreSQL `SELECT 1` returned 1 with TLS verification enabled.
- `npm.cmd --prefix backend run db:status` — passed: Supabase PostgreSQL reachable; five migrations up to date.
- Read-only Prisma `GenerationJob.count` — passed; zero queued/running jobs. The recovery update executed in a transaction that was rolled back and matched zero rows.
- Process ownership caveat: Windows listener enumeration does not expose the host-forwarded API/frontend processes; Vite strict-port startup confirmed 5173 is occupied. A direct backend launch logged `D-GUY API listening` but also a startup-recovery error; the read-only Prisma checks and rolled-back recovery statement now succeed, so that warning was not reproduced or conclusively attributed.
- Browser acceptance — Computer Use reported native/browser hosts unavailable; headless Edge remote debugging did not stay available. Playwright Core was subsequently installed outside the repository and used through headed Edge.
- Browser network verification — isolated Edge captured `GET /api/v1/auth/me` → 401 `UNAUTHENTICATED` on an unauthenticated page; no Google-session call occurred at ordinary startup. A fake login submission sent `POST /api/v1/auth/login` with only `email` and `password`. A mocked PKCE Google flow sent `GET /auth/v1/authorize`, `POST /auth/v1/token?grant_type=pkce`, then exactly one `POST /api/v1/auth/google/session` with only `accessToken` and a short `refreshToken`; the live backend accepted its schema and rejected the synthetic token as 401, not 400. No real credentials were read or submitted. The provided screenshots show the Console, not the Network request details; Computer Use was unavailable in the unattended session.
- No live AI request, registration, database write, migration, credential access, external-account change, deployment, or push was performed.

## Follow-up code fixes

- `src/services/generationStream.ts`, `backend/src/generation/eventHistory.ts`, and `backend/src/server.ts`: generation SSE frames have stable event IDs; clients reconnect from their last received frame rather than restarting the stream from the beginning. Tests cover replay after a dropped connection and no retry after a terminal failure.
- `src/services/previewAssets.ts` and `src/components/PreviewCanvas.tsx`: local project assets are embedded into the isolated HTML preview; unsafe traversal and external asset fetches are rejected. CSS local URLs are resolved relative to their stylesheet, while external imports are removed for offline rendering.
- `src/services/webcontainerRuntime.ts` and `src/components/WebContainerPreview.tsx`: failed WebContainer boot promises are cleared for a safe retry; concurrent boot attempts still share the same promise.
- `backend/src/ai/provider.ts` and `backend/src/ai/provider.test.ts`: framework JSON responses emit path-scoped file deltas as streamed; partial previews clear when fallback providers take over. Static revisions now include existing CSS/JavaScript in the generation context. Regression tests cover both cases.
- `backend/src/security/requestValidation.ts` and `backend/src/server.ts`: generic schema failures identify sanitized field names and correlate logs with request ID/method/path without echoing submitted values.
- `src/components/BackendAuthScreen.tsx` and `src/services/authCallback.ts`: React StrictMode's callback effect now shares a single Google session exchange, preventing duplicate use of a rotating refresh token. A regression test verifies the callback operation runs once.
- `backend/src/auth/authRequestContract.test.ts`, `backend/src/auth/googleSession.ts`, and `backend/src/auth/{passwordLogin,googleSession}.test.ts`: regression tests assert browser login and Google payload keys against the backend schemas.
- `src/App.tsx`: ZIP download object URLs are revoked after the browser has time to begin consuming the download.
- `backend/src/integration/{generationStream,previewAssets,webcontainerRuntime}.test.ts` and `backend/src/generation/eventHistory.test.ts`: 13 focused tests passed. These verify implementation behavior, not successful provider calls or a browser-rendered generated website.

## Screenshots / evidence checklist

- [ ] Dashboard prompt and live generation stage
- [ ] Actual SSE updates in Code and Files (`index.html`, `styles.css`, `app.js`)
- [ ] Static iframe preview rendered
- [ ] React/Vite WebContainer preview running
- [ ] Supabase project and revision still present after reload
- [ ] ZIP downloaded, extracted, and required files inspected
- [ ] Total real generation duration ≤120 seconds

The login screen was captured in the live Playwright session but not saved as a report artifact. No authenticated dashboard screenshots are available yet.

## Remaining blockers and next actions

1. The user authorized a dedicated test client, but live Supabase Auth/profile verification remains unperformed: no isolated Supabase test project, reachable confirmation mailbox, or safe Auth-user cleanup method is available. Do not create a persistent account in the configured production project or access service-role credentials. With an isolated project, verify Auth UUID/profile fields, confirmation, login, dashboard, reload, and deletion of only the new test user/profile.
2. The isolated PostgreSQL integration tests require `TEST_DATABASE_URL`; four tests were skipped. Do not point them at production.
3. Live AI generation/revision and the 30–120 second target remain unverified. A real request may incur provider charges and requires separate approval. Google sign-in also requires Supabase/Google provider configuration and remains unverified against a real account.
4. The production build succeeds with a 602.83 kB main JS chunk warning. This is a performance follow-up, not a build blocker. Docker's frontend dependency install also reported seven moderate audit notices; no automatic update was made.

No credentials or provider priority were changed. No destructive database operations, deployments, or GitHub publishing were performed.

## Email-only authentication update (2026-11-12; historical)

- Removed the Google button and client callback helpers, Supabase Google sign-in call, backend `/auth/google/session` route, and Google-only tests. The rebuilt endpoint returns HTTP 404.
- New registration profiles use the Supabase Auth UUID as `User.id`, normalized Auth email, the submitted full name, `role=client`, `passwordHash=null`, and the Prisma/PostgreSQL `createdAt` default. The request schema rejects client-supplied roles and password fields. Existing profiles are not role-updated; legacy `user` profiles remain accepted for client login.
- Password login and cookie-based session restoration now require an existing profile whose ID/email match the verified Supabase identity. Missing or unsupported profiles no longer get silently created. Admin login remains separate. Email-unverified login receives a clear verification message.
- Focused auth tests: 5 files, 21 tests passed. Full backend suite: 25 files passed, 1 integration file skipped; 144 tests passed and 4 database tests skipped because no isolated `TEST_DATABASE_URL` is configured. Backend production build, frontend typecheck, lint, and production build passed. Vite retains its >500 kB chunk warning.
- Docker API and web images were rebuilt; both containers report healthy. The app, `/api/v1/health`, and `/api/v1/ready` return HTTP 200.
- Browser verification on the rebuilt app: sign-in and create-account modes rendered, all four registration fields were present, the Google button was absent, and a mismatched confirmation showed `Passwords do not match.` without sending a registration request. At 390 px, page width matched viewport width. The startup `/api/v1/auth/me` 401 was the expected unauthenticated check.
- No live Supabase account, profile, session, or dashboard was verified; no user data or credentials were accessed or changed.

## Email-code and Google sign-in update (2026-11-13)

- Added an email verification-code screen, verification and resend API routes, and automatic transition to code entry after registration or an unverified-password login. Codes are validated and redeemed server-side through Supabase Auth; the browser never receives a service-role key.
- Added Google OAuth via Supabase PKCE, a `/auth/callback` handler, and a backend session exchange. The API validates the Google provider and verified email, refreshes the supplied token pair and checks both tokens identify the same user, then establishes HttpOnly cookies. New Google profiles receive only `role=client`; conflicting profiles and administrators are rejected rather than merged or promoted.
- Added rate limits and generic resend responses to reduce email enumeration, request-validation helpers, profile-role conflict tests, and frontend request-contract/callback regression tests.
- Easy setup: in Supabase Auth email templates, set Confirm signup to include `{{ .Token }}`; configure SMTP, Site URL, and the allowed `/auth/callback`. Enable Google under Supabase Auth providers, configure the Google OAuth client ID/secret there, and add Supabase's callback URL to the Google Cloud OAuth client. Full steps are in the root README. Google secrets are not placed in application environment files.
- Automated verification for this update: frontend typecheck, lint, and production build passed; backend production build passed; full backend suite passed (155 tests, 4 isolated-database tests skipped). A focused auth rerun passed (4 files, 18 tests).
- Browser UI check used mocked register/resend API responses only: registration transitioned to the code field, and resend showed the generic success notice. No account or email was created. The login page displays the Google option.
- The running API loaded the new code, verify-email, resend, and Google session routes; invalid empty requests returned HTTP 400 before any Supabase call. A read-only database check passed `SELECT 1`. Compose configuration currently requires `FRONTEND_ORIGIN` in the root `.env`; no production Compose services were changed or started.
- No live confirmation email, Google OAuth transaction, user/profile write, or authenticated dashboard session was performed. These require the documented Supabase email-template/SMTP and Google provider configuration plus a real-account test.

## Provider compatibility fix (2026-11-12)

- The supplied live screenshot showed the actual generation failure chain: `Gemini: timeout; Groq: invalid_request (HTTP 400); OpenRouter: invalid_output, empty_output`. This is distinct from authentication errors and is not caused by the requirements panel.
- Removed unsupported per-file array cardinality/path-enum keywords from the structured-output schema sent to Groq/Gemini. The server still validates the complete response and enforces the requested individual file path before accepting it.
- Changed OpenRouter from a forced function/tool call (not supported by every configured model) to JSON-object response mode; the existing strict server-side project parser/schema validator remains authoritative.
- Focused mocked provider suite passed: 42 tests. No provider credentials or paid AI requests were used for this change.
- Production API/web containers rebuilt and healthy; web, health, and readiness checks returned HTTP 200 after the provider request changes. No real prompt was submitted, so live provider recovery and the resulting one-page render still need a user-authorized, potentially billable test.
