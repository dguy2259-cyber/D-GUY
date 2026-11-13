# D-GUY — Autonomous AI Software Engineer

D-GUY is one application with independently testable services: a React/Vite browser client, a Node.js/Express API, Supabase Auth, and hosted PostgreSQL. The browser uses one centralized API client. The API owns private credentials, profile authorization, project persistence, and provider calls.

## Architecture

```text
Development
  Browser ── http://localhost:5173 ── Vite/React
                    │ /api/*
                    └── Vite proxy ── Express/tsx :8787 ── Supabase Auth + PostgreSQL

Production Compose
  Browser ── one entry point :8080 ── Nginx (static frontend + /api reverse proxy)
                                             │ private network
                                             └── Express API :8787 ── Supabase Auth + PostgreSQL
```

The API port is not published by Compose. The Nginx web service serves the production Vite build and proxies `/api/*` to the API. Compose does not run Vite's development server. Put the Compose entry point behind a TLS terminator for public deployment.

Authentication uses email/password with emailed verification codes, plus Google sign-in through Supabase Auth. Supabase manages passwords and provider identity; the API verifies signup codes and Google sessions, writes UUID-linked client profiles, and sets HttpOnly session cookies. Administrator sign-in remains separate and cannot be granted by either client flow.

## Requirements and environment

- Node.js 22.12 or newer and npm.
- Docker Engine/Desktop with the Compose plugin for containerized use.
- A configured Supabase project (Auth and PostgreSQL), verified-TLS database URL, and the API's configured AI provider credentials.

### Local development configuration

Copy the templates:

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the root `.env` (these are public browser values). Configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GROQ_API_KEY`, and `GEMINI_API_KEY` in `backend/.env`. Provider keys, the database URL, and any service-role key must never be placed in root `.env` or any `VITE_*` variable. The API loads its private settings from `backend/.env`; Vite can temporarily fall back to the existing public `VITE_*` values there for compatibility.

### Supabase email-code and Google sign-in setup

1. In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to `http://localhost:5173` for local development and add `http://localhost:5173/auth/callback` to the allowed redirect URLs. Add your production HTTPS callback URL when deploying.
2. Open **Authentication → Email → Templates → Confirm signup**. Include the one-time code in the message body, for example:

   ```text
   Your D-GUY verification code is: {{ .Token }}
   ```

   Save the template. The user enters this emailed code on the D-GUY verification screen. Supabase must have email signups enabled and mail delivery configured; use a configured SMTP provider for reliable production delivery.
3. For Google, create a **Web application** OAuth client in Google Cloud Console. In its authorized redirect URIs, add the callback URL shown by your Supabase project (usually `https://<project-ref>.supabase.co/auth/v1/callback`). Configure the OAuth consent screen and test users as needed.
4. In Supabase, open **Authentication → Sign In / Providers → Google**, enable the provider, and paste the Google OAuth client ID and client secret there. Do not put the Google client secret in frontend variables, source files, or Docker build arguments.
5. Add the exact D-GUY origins to Supabase's allowed redirect URLs (for example `http://localhost:5173/auth/callback` and `https://your-domain.example/auth/callback`). In production, set the API's `FRONTEND_ORIGIN` to the exact HTTPS site origin.

The browser starts Google authorization, Supabase returns to `/auth/callback`, and the API verifies the Google access token and refreshes the matching session before issuing HttpOnly cookies. Google-created profiles receive only `role=client`; an existing administrator must continue using administrator sign-in. These provider settings require a Supabase/Google administrator and cannot be applied from this repository.

Before creating application data, check the selected database and migration state. Only apply migrations to an intended, backed-up database:

```powershell
npm run db:check
npm run db:status
# Review target and migration SQL before intentionally applying:
npm --prefix backend run db:migrate
```

### Start both development services

Install dependencies once:

```powershell
npm ci
npm --prefix backend ci
npm --prefix backend run db:generate
```

Then start both processes in one terminal:

```powershell
npm run dev
```

Concurrently labels API and web logs and terminates the sibling process when either service stops. Press Ctrl+C to stop both. The services can also be started independently:

```powershell
npm run dev:web
npm run dev:api
```

The frontend is at `http://localhost:5173`; its `/api/*` requests are proxied to `http://127.0.0.1:8787`. Set `DGUY_API_TARGET` in root `.env` to override the API address. `npm run dev:api` uses `tsx watch`; it regenerates Prisma Client at startup and watches backend source changes.

## Production Docker Compose

Prepare both environment files without putting server secrets in the root:

```powershell
Copy-Item .env.production.example .env
Copy-Item backend/.env.production.example backend/.env
```

Replace the example Supabase origin and enter the actual public Supabase URL/anon key in root `.env`. Enter private database, Supabase API, and AI provider configuration only in `backend/.env`. The examples contain placeholders, not working credentials. For local HTTP-only Compose testing, use `.env.example` instead; it selects development cookie settings.

Build and start:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f
```

Stop and remove the containers/networks (persistent Supabase data is not touched):

```powershell
docker compose down
```

The Nginx web service is the single host entry point. By default it binds to `127.0.0.1:8080`; set `DGUY_WEB_BIND=0.0.0.0` only when your host firewall/TLS ingress is configured. Set `DGUY_WEB_PORT` to change the host port. Use the exact HTTPS browser origin in both root `FRONTEND_ORIGIN` and backend `FRONTEND_ORIGIN` for production; Compose passes the root value to the API. `COOKIE_SECURE=true` is required with production `NODE_ENV`. Compose never runs database migrations automatically.

Compose builds a static Vite bundle served by unprivileged Nginx, runs the API independently as a non-root Node process, waits for API readiness before starting web, restarts failed containers, limits CPU/memory/PIDs, drops Linux capabilities, uses read-only root filesystems, and rotates Docker JSON logs. Only the web port is published. The API has a private network connection to web and an outbound network for Supabase and configured providers.

## API routes

All API routes are under `/api/v1`; the browser's centralized service is `src/services/backendApi.ts`.

- `GET /health` — API/provider configuration health.
- `GET /ready` — PostgreSQL readiness query.
- `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/google/session`, `/auth/admin/login`, `/auth/logout`, `/auth/recover`, `/auth/password`; `GET /auth/me`, `/auth/csrf`.
- Protected project routes: `/projects`, `/projects/:id`, `/projects/:id/files`, `/projects/:id/versions`, `/projects/:id/generations`.
- Generation status, SSE events and cancellation: `/generations/:jobId`, `/generations/:jobId/events`, `/generations/:jobId/cancel`.
- `/projects/:id/export.zip` and `/usage/me`.

Request failures use `{ "error": { "code": "...", "message": "..." } }`. CORS permits exact `FRONTEND_ORIGIN` values. Production browser requests are same-origin through Nginx. Health/readiness do not by themselves prove Auth or provider credentials work.

## Development checks

```powershell
npm run typecheck
npm run lint
npm run build
npm run api:build
npm run api:test
```

Provider tests use mocked HTTP and do not make paid calls. Database integration tests run only when `TEST_DATABASE_URL` points to a dedicated disposable database; never point them at production. Readiness checks database connectivity, while actual profile/project persistence and a real authenticated dashboard require an authorized test account and a safe cleanup path.

## Troubleshooting

- **API won't start:** check that `backend/.env` exists and has valid `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GROQ_API_KEY`, and `GEMINI_API_KEY`. Errors name missing variables but do not print their values.
- **Database TLS/readiness fails:** confirm the Supabase pooler URL, encoded password, CA path, and `npm run db:check`; do not disable certificate verification.
- **Frontend cannot reach API in development:** confirm API listens on port 8787, then inspect the Vite `/api` proxy and `DGUY_API_TARGET`. An unauthenticated `GET /auth/me` returns 401 by design.
- **Compose containers are unhealthy:** use `docker compose ps` and `docker compose logs api web`; verify Supabase reachability and `FRONTEND_ORIGIN`. Compose doesn't migrate the database.
- **Verification code doesn't arrive:** confirm the Confirm signup template includes `{{ .Token }}`, email signups are enabled, SMTP delivery is configured, and the message is not in spam. The resend action is rate limited.
- **Google sign-in fails:** enable Google in Supabase Auth, configure the provider's Google client ID/secret, add Supabase's callback URL in Google Cloud, and allow the exact D-GUY `/auth/callback` URL in Supabase.
- **Auth callbacks fail:** check the Supabase Site URL, exact allowed redirect URLs, and HTTPS origin settings.
- **Generation fails:** inspect sanitized provider failure categories in API logs; verify configured models and provider availability. No live paid provider call is part of the default test suite.

## Security notes

Only the Supabase anon/publishable key is sent to the browser. Supabase service-role, PostgreSQL, and AI provider credentials stay server-side. Do not commit `.env` or `backend/.env`; only the `.env.example` templates are tracked. Keep the Nginx entry point behind HTTPS before production use.
