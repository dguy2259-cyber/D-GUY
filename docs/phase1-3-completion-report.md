# D-GUY Phase 1–3 Acceptance Report

Report date: 2026-11-13 (Asia/Kolkata; updated after the follow-up implementation pass)

This report distinguishes code and automated-test evidence from live product acceptance. Phase 4 deployment and GitHub PR automation are outside the Phase 1–3 acceptance scope. The paper task sheet specifies Groq-first routing; a later direct project instruction specified Gemini-first. The implementation retains Gemini → Groq → OpenRouter and optional Featherless routing; this is a documented project decision, not a claim that the original sheet said Gemini-first.

Authentication details later in this report are historical snapshots. The current email-code and Google OAuth implementation, test results, and remaining external setup are recorded in the latest “Email-code and Google sign-in update” section.

## Phase 1 — Infrastructure, isolation, and database

| Task | Status | Evidence and limits |
|---|---|---|
| 1.1 Development environment | COMPLETED AND VERIFIED | Node.js v24.19.0 is installed. `npm.cmd` scripts execute. Frontend/API packages and their build scripts are present. |
| 1.2 Docker and isolated containers | COMPLETED AND VERIFIED | Docker Desktop Engine is running (Docker CLI/server 29.2.1). `docker compose --env-file backend/.env up --build -d` rebuilt the current API and web images and started both services. Docker reports both containers healthy. The web container is published on `127.0.0.1:8080`; its `/api/v1/health` and `/api/v1/ready` proxy checks returned HTTP 200, confirming frontend-to-API networking and database readiness from the containerized API. The API remains private to the Compose network on port 8787 by design. |
| 1.3 API gateway and health checks | COMPLETED AND VERIFIED | `/api/v1/health` and `/api/v1/ready` on port 8787 in the local development service previously returned HTTP 200. The rebuilt Compose web app at `http://localhost:8080/` returns HTTP 200; through its internal Nginx proxy, `/api/v1/health` returns `{"status":"ok"...}` and `/api/v1/ready` returns `{"status":"ready"}` (both HTTP 200). Compose API port 8787 is internal-only by design. Earlier Vite CORS/preflight checks also passed. |
| 1.4 Supabase PostgreSQL, TLS, persistence | PARTIALLY COMPLETED | `npm.cmd --prefix backend run db:check` passed a real `SELECT 1` with TLS verification enabled. `db:status` now confirms all six migrations are applied, including runtime recovery. A read-only count found zero queued/running generation jobs before the API reloaded. Browser reload persistence and authenticated ownership were not verified. |

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
| Runtime-error self-correction | IMPLEMENTED; SCHEMA APPLIED; LIVE CYCLE UNVERIFIED | The opt-in recovery flow reports redacted HTML/WebContainer diagnostics, uses the configured generation pipeline for bounded source-only corrections, validates candidates in the isolated preview, and compare-and-swap restores the previous version on failure. The additive migration is applied and automated tests/builds pass; no live AI/database recovery cycle was run. |

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
- `npm.cmd --prefix backend run db:status` — passed: Supabase PostgreSQL reachable; all six migrations up to date.
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

## Autonomous runtime recovery implementation (2026-11-13)

- Added project-scoped recovery sessions/attempts, opt-in auto-recovery settings, owner-scoped RLS policies, and an additive Prisma migration. It was subsequently applied on 2026-11-13 after verifying that it only adds a default-false project setting, recovery tables/indexes/foreign keys, and owner RLS policies. `db:status` confirms the schema is up to date; no existing project or user records were changed.
- Integrated structured runtime/startup diagnostics from the sandboxed HTML iframe and WebContainer preview with the authenticated recovery API and workspace UI. Diagnostics are normalized/redacted, expected auth/network failures are not repaired, and dependency/config/security changes stop for review.
- Recovery uses the existing configured provider route and SSE generation pipeline. A candidate is stored as a version, the preview must become ready and remain error-free through the validation window, and a failed or paused candidate is rolled back with active-version compare-and-swap. Manual retries and auto-recovery share a five-attempt-per-incident cap and ten attempts per account per rolling 24 hours.
- Added regression coverage for credential redaction, expected-error classification, untrusted prompt diagnostics, source-only patch restrictions, and retry/review limits. No paid AI request, real account, production database write, or recovery migration was performed.
- Verification on 2026-11-13: backend build passed; full backend suite passed (28 files, 161 tests; 1 integration file / 4 DB tests skipped without `TEST_DATABASE_URL`); frontend typecheck and ESLint passed; production Vite build passed (634.69 kB main JS chunk, existing >500 kB warning).
- Mocked browser verification exercised the production React workspace UI: a scripted error inside the sandboxed HTML preview reached the mocked `POST /runtime-errors` with the correct version/environment/source location; the incident appeared in the recovery dashboard with auto-recovery still off. No generation request was made. This verifies client telemetry and dashboard wiring, not real database persistence or AI repair.
- The recovery schema is now present. A real recovery cycle still requires an authenticated user, an opted-in project with a reproducible runtime defect, and an explicitly approved live AI request; it has not been run.

## Authenticated workspace project-loading fix

- The saved-project workspace used Prisma's default project selection, which included the newly added `autoRecoveryEnabled` field while its migration was pending. Core project list/create/detail/update and version persistence now select only established columns.
- Normal generation checks recovery-schema availability before querying recovery tables. It can proceed during a rolling deployment without the migration; recovery-only endpoints return a sanitized `503 SCHEMA_NOT_READY` until the schema exists. The schema is now applied. Negative schema checks expire after 30 seconds so a running API can discover a newly applied migration.
- Verification: backend production build passed; backend suite passed (28 files, 161 tests; 4 database integration tests skipped because `TEST_DATABASE_URL` is not configured). The local API returned 200 for health and database readiness. An unauthenticated project-list request returned 401, confirming the route still requires authentication.
- The additive migration applied without changing existing user/project records. An authenticated dashboard session was not available in the shared browser, so live project loading for the reported admin account remains unverified.

## Static-site provider truncation recovery

- The supplied generation screenshot shows a provider failure, not an authentication failure: Groq returned HTTP 429, Gemini was in its cooldown window, and OpenRouter stopped at its output-token limit.
- Static HTML/CSS/JavaScript generation now retries a file once only when the configured providers report truncated output. The retry targets the last provider that truncated, uses a concise repair instruction and requests up to 6,144 output tokens (subject to the provider's own cap), and resets partial streamed file content first. HTTP 429 responses are not retried; existing provider cooldowns and the overall generation deadline remain in effect.
- A mocked regression reproduces provider rate limits followed by OpenRouter truncation and verifies the bounded retry returns a complete validated site file. Provider tests passed (43 tests); backend build passed; full backend suite passed (28 files, 162 tests, 4 isolated-database tests skipped). No live provider request or paid AI call was made.
- Live generation remains subject to external provider quota/cooldown and model output limits. If all configured providers remain unavailable or truncate even on the bounded retry, generation correctly fails and preserves the last saved version; no local code can guarantee provider availability.
- The requested Nexora Technologies acceptance prompt was not submitted: explicit approval for a potentially billable provider request and isolated project/version write was unavailable, and the shared browser remains signed out. No live generated website or browser rendering is claimed.

## Streaming timeout, fallback, and intent-routing update

- Root cause: provider requests were being stopped by a short shared request timeout while Gemini was still streaming response chunks. Static file subrequests also had short caps, so a response that had started successfully could be aborted before completion.
- Provider requests now use independent first-byte, stream-idle (reset for every received chunk), and 60-second per-provider total-deadline timers. Timeout diagnostics identify the timer that fired and bytes received. The default route is Groq → Gemini → OpenRouter and can be reordered with `PROVIDER_ORDER`; failures are logged as `provider_attempt` events without exposing credentials. Complete files from partial output are retained for salvage.
- A non-empty `index.html` remains usable if optional files are absent or persistence fails. The preview is returned and database persistence is retried in the background. Greetings and common questions use local FAQ replies without starting generation; “retry” uses the project’s most recent real build prompt.
- Vanilla create prompts now support `SINGLE_REQUEST_MODE=true` (default): one provider request asks for a complete, single-page `index.html` with inline CSS/JavaScript, then the backend extracts inline assets into `styles.css` and `app.js` in code. The multi-file workflow remains available with the setting disabled and continues to support revisions.
- Groq model IDs are checked against Groq's list-models endpoint at API startup; missing keys and unavailable models produce sanitized warnings. Groq request diagnostics log model, status (or null before a response), input/output tokens, and elapsed time. HTTP 429 responses retain the parsed `Retry-After` value and immediately proceed to the next configured provider without waiting.
- New backend environment settings: `PROVIDER_ORDER=groq,gemini,openrouter`, `SINGLE_REQUEST_MODE=true`, `FIRST_BYTE_TIMEOUT_MS=30000`, `STREAM_IDLE_TIMEOUT_MS=30000`, and `TOTAL_DEADLINE_MS=60000`. Provider model IDs are configurable with `GEMINI_MODEL`, `GROQ_MODEL`, and `OPENROUTER_MODEL`. Values are documented in `backend/.env.example`; keys are not logged.
- Verification on 2026-11-13: `npm run api:test` passed (31 test files passed, 1 skipped; 178 tests passed, 4 skipped). Local HTTP stubs exercised a 10-second first byte, a 90-second stream with chunks every 5 seconds, Groq success/429/truncated JSON, hanging-provider fallback, 500 responses, single-request asset splitting, and model-list verification. Regression tests also cover preview retention after save failure and prompt classification/retry selection.
- `npm --prefix backend run build`, `npm run typecheck`, `npm run lint`, and `npm run build` passed. Vite emitted its existing large-chunk advisory (642.51 kB main JS bundle). No real provider generation request, paid generation, Supabase write, or authenticated browser test was performed.

## Groq-first website defaults and prompt options

- Website creation defaults to the Groq → Gemini → OpenRouter fallback order and uses one request for a self-contained HTML page, then extracts inline CSS and JavaScript into the existing editor files. `PROVIDER_ORDER` and `SINGLE_REQUEST_MODE` remain configurable.
- The chat requirements panel is expanded by default and exposes website type, theme, top menu bar, and testimonial options. Auto-detect remains available; menu-free sites are accepted when explicitly selected, and older saved projects default to showing a menu.
- Per-provider generation is capped at 60 seconds and the full generation pipeline at 120 seconds. These limits bound a request but do not guarantee provider response time or quality.
- Local verification for this update: provider/prompt tests, frontend typecheck, and lint passed; the focused one-request test confirms inline assets are split and a menu-free responsive page passes validation. A real provider generation and the end-to-end 30–120 second target were not measured.
