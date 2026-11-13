# Security threat model and deployment checklist

## Trust boundaries and protected data

The browser is untrusted. The Node API is the boundary for Supabase Auth, Postgres, Groq, and Gemini credentials. Prompts and generated files are untrusted data. Generated code is stored and displayed in a sandboxed iframe; it must never execute with the dashboard origin's privileges. Postgres and provider access are server-side only.

## Controls in this build

- Supabase Auth verifies email/password sessions. The API verifies the returned bearer token and requires a matching server-side profile before issuing or restoring HttpOnly, SameSite=Lax cookies. Registration assigns new profiles the `client` role and never accepts role, profile ID, or owner identity from request bodies. Administrator authentication remains a separate role-checked endpoint.
- State-changing requests require a CSRF header matching the same-site CSRF cookie. CORS allows only configured exact frontend origins. Development uses bounded process-local request buckets; production uses atomic fixed-window counters in PostgreSQL, hashes client/scope keys, fails closed if the shared limiter is unavailable, and expires old buckets. Request payloads use strict Zod validation and body size limits.
- Project, version, generation, export, and usage queries are scoped to the authenticated profile/owner. SQL access uses Prisma parameterized queries. Secrets are not returned to clients or included in normal request logs.
- Generated file paths/content are schema-validated and bounded before persistence/export. ZIP creation validates paths. Preview content is sandboxed and does not inherit application access.
- PostgreSQL row-level security is enabled by the deployed migrations. The rate-limit bucket has RLS enabled and direct `PUBLIC`, `anon`, and `authenticated` privileges revoked. Prisma uses a server database connection, so API ownership checks remain mandatory; RLS does not replace them. Legacy custom `Session` records/table are retained for compatibility and are no longer used for authentication.
- Docker images run as non-root, with read-only root filesystems, dropped Linux capabilities, private frontend-to-API networking, outbound access only where the API needs providers, and CPU/memory/process limits.

## Risks and release checks

- Confirm Supabase RLS policies and migration ownership against a staging project before production migration. Database administrator credentials bypass ordinary RLS policies.
- Ensure Supabase Auth email confirmation and password-reset settings match the intended account policy. Restrict verification/reset redirect URLs to explicit origins and use HTTPS.
- Put the Compose service behind a TLS reverse proxy before public access. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, exact HTTPS `FRONTEND_ORIGIN`, and trusted proxy hops. Production's shared rate limiter depends on the migrated PostgreSQL table; validate throttling and expiry on a separate test database before release.
- Generated HTML/JS remains potentially malicious. Keep iframe sandbox flags restrictive, prohibit same-origin privileges, and add a separate network-isolated execution container before running arbitrary build tools or server-side code.
- Add backup/restore drills, alerting, key rotation, dependency scanning, and external penetration review before production use.
- Never log prompts, passwords, bearer tokens, cookies, service-role keys, or provider keys. Rotate any credential accidentally committed or exposed.
