# Deployment preparation

## What can be deployed to Vercel

The React/Vite application is a static SPA and is suitable for Vercel. Set the Vercel project **Root Directory** to `web`, use `npm run build` as the build command, and `dist` as the output directory. The `web/vercel.json` rewrite sends direct SPA routes (including refreshed dashboard URLs) to `index.html`.

Set the non-secret `VITE_API_URL` in Vercel project settings to the HTTPS v1 API base URL, including `/api/v1`, then rebuild. Do not put server secrets in any `VITE_*` variable. Configure the API's `FRONTEND_ORIGINS` to the exact deployed frontend origin (scheme and hostname, without a trailing path). The API must allow credentialed requests.

The current Express API is a long-running process: it starts PostgreSQL-backed email/expiry/notification workers and uses the default in-memory `express-rate-limit` store. Do not deploy it as Vercel serverless functions or scale it horizontally as-is. Use a managed host that supports one persistent Node.js service, background workers, health checks, and TLS, or first redesign workers and rate limiting around durable external services. No backend host or public deployment has been configured here.

Cookie auth currently uses HttpOnly, `SameSite=Strict` cookies and requires HTTPS in production (`COOKIE_SECURE` is forced true when `NODE_ENV=production`). Prefer the frontend and API on subdomains of the same site, for example `app.example.com` and `api.example.com`. A frontend and API on unrelated sites will not work reliably with the current Strict cookie policy. Do not change to cross-site cookies without an explicit CSRF design and review. The server trusts one proxy hop in production; configure the chosen host accordingly and verify its proxy topology.

## PostgreSQL and migrations

Use a separate, managed production PostgreSQL database with provider-required TLS and connection pooling appropriate to the chosen host. The Prisma connection must select schema `secureauth_app`. Keep development and production databases separate.

The repository contains two v1 migrations: initial schema creation and active-booking partial unique indexes. `prisma validate` has passed locally; migration status could not be checked because the local PostgreSQL service was unreachable. Before production:

1. Provision a new, empty production database and confirm its identity out of band.
2. Take a provider snapshot/backup and verify the recovery key/access path.
3. Review both checked-in SQL migrations against the current Prisma schema and the provider's PostgreSQL version.
4. Use a migration-only database role with schema/table creation privileges. Use a separate least-privilege runtime role for the API.
5. Apply only with `npm run db:deploy`, then verify the migration history and schema against the production database.

Do not use `db:push`, `migrate dev`, `reset`, legacy imports, or seeds against production. Migration 1 creates the schema and tables; it is not a baseline for an existing database. Migration 2 can fail if pre-existing bookings violate its uniqueness constraints.

The available `backup:supabase` and `backup:restore` scripts operate on the legacy Supabase users table, not the active Prisma PostgreSQL database. There is no verified active-v1 PostgreSQL backup/restore procedure in this project, and no isolated restore test has been completed. Production data must not be created until an encrypted, off-site-capable PostgreSQL backup and isolated restore drill have been reviewed and completed.

## API environment variables

Configure these in the backend host's secret/environment settings, never in Vercel's browser build:

**Required secrets by `server/src/v1/config.ts`:**

- `DATABASE_URL` — production PostgreSQL URL selecting `secureauth_app`; use TLS options required by the provider.
- `ACCESS_TOKEN_SECRET` — random secret, at least 32 characters. `JWT_SECRET` is only a compatibility fallback.
- `REFRESH_TOKEN_SECRET` — random secret, at least 32 characters; currently validated by configuration, while refresh tokens themselves are opaque random values stored by hash.
- `PEPPER` — independent random secret, at least 32 characters, for password hashing.
- `DATA_ENCRYPTION_KEY` — independent 32-byte key encoded as 64 hexadecimal characters. Preserve it securely; rotating it without re-encrypting stored TOTP seeds prevents their decryption.

**Set explicitly for a production deployment (the code has local-development defaults):**

- `NODE_ENV=production`.
- `FRONTEND_ORIGINS` — exact production origin(s), comma-separated.
- `APP_BASE_URL` — HTTPS frontend origin used to build verification/reset links.
- `HOSTEL_API_HOST` and `HOSTEL_API_PORT` — bind settings appropriate to the selected host.

**Optional or defaulted by the current config:**

- `COOKIE_SECURE` — production forces secure cookies on.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` — needed for real verification and reset email delivery.
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_IPS`, `PAYSTACK_CALLBACK_URL` — needed only for the configured Paystack payment flow.
- `HOLD_MINUTES`, `LOGIN_MAX_ATTEMPTS`.
- `JWT_SECRET` — legacy fallback only; do not configure alongside `ACCESS_TOKEN_SECRET` without a deliberate migration plan.
- `EXPO_PUBLIC_API_URL` is mobile build configuration, not an API secret. Use the same HTTPS API base URL in mobile builds.

Use independent production values for the token secret, pepper, and encryption key. Never copy local demo credentials or development secrets to production. The first Administrator command is interactive and does not use a built-in password, but it currently relies on the operator to select the correct database; independently verify the database target before running it.

## Verification boundaries

The local web production build, backend build/tests, Prisma schema validation, and Expo Android bundle are local checks only. They do not verify Vercel routing, external API connectivity, production cookies, email/payment providers, production database migrations, or backup restoration. Do not describe this project as deployed or production-verified until those checks have actually been completed.
