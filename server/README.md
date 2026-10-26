# Hostel Management API

## Active v1 PostgreSQL API

The active app is the versioned TypeScript API at `src/v1/server.ts`, using PostgreSQL and Prisma. It listens on port `3001` under `/api/v1` and defaults to `127.0.0.1`; it no longer creates bootstrap accounts at startup. See the repository [README](../README.md), [architecture](../docs/hostel-architecture.md), and [v1 API reference](../docs/hostel-api.md).

Install dependencies, generate the Prisma client, and run the API:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run dev
```

The recovered database was confirmed empty before preparation of the reviewed initial migration. Do not run `db:push`, seed, reset, or ad hoc SQL; use the checked-in Prisma migrations only. Prisma client generation does not initialize or change the database.

Keep `DATABASE_URL`, token secrets, `PEPPER`, and `DATA_ENCRYPTION_KEY` in the private `server/.env`; never display or commit that file. The API binds to loopback by default. LAN exposure requires a deliberate `HOSTEL_API_HOST` setting, restricted Windows Firewall rules, explicit trusted origins, and HTTPS before transmitting credentials or sensitive data. Do not expose it to the public internet.

### Student email verification

When SMTP is configured, the email worker sends the verification message using the SMTP settings in `server/.env`. In local development without SMTP, the worker does not send email; use the registration page's **Get local verification link** action. That action reads only an unexpired, unused verification token already present in the local email queue, and is available only from a loopback client while `NODE_ENV=development`. The link still goes through the normal token-hash verification endpoint. This development helper is not available in production and never auto-verifies an account. Do not copy verification URLs into logs or share them.

### First Administrator

After the reviewed initial migration has been applied, run `npm.cmd run provision:first-admin` from `server\` in a private interactive terminal. The command accepts a name and email, prompts for a 16–128-character password without echoing it, and only provisions an account when the `User` table is empty. It does not use a built-in credential. The first sign-in must complete mandatory Two-Factor Authentication (2FA) authenticator-app enrollment before a full session is issued. Do not paste the password into chat or logs.

For local role demonstrations only, `NODE_ENV` must be explicitly set to `development` before `npm.cmd run provision:demo`. The script verifies the local database target and applied migrations, creates only missing `*.demo@secureauth.local` accounts, never resets existing accounts, and reuses the first-Administrator empty-table safeguard when the database has no users. Temporary passwords are generated randomly and stored in a Windows DPAPI-protected current-user file under `%LOCALAPPDATA%\SecureAuth`; they are not printed by provisioning. In that same Windows user session, run `npm.cmd run demo:show-passwords` to display and delete the one-time credential handoff. Every demo account must change its temporary password and enroll Two-Factor Authentication (2FA) before using a portal. This script is not a production provisioning mechanism.

### Two-Factor Authentication (2FA)

The active v1 API requires authenticator-app Two-Factor Authentication (2FA) for the INPUTER, MANAGER, ADMIN, and ADMINISTRATOR target roles. Enrollment must be verified before a full session is issued; sign-in then requires a current six-digit authenticator code. Single-use recovery codes are shown only once and provide the account-recovery path. Do not disable 2FA or expose setup secrets or recovery codes.

## Legacy SecureAuth/Supabase REST server

Historical Express API for the older SecureAuth website. This is not the active v1 API. User records were stored in Supabase Postgres. The website never connected to Supabase directly; only that server had the Supabase secret key.

## Connect a Supabase project

1. Create a project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor**, run the contents of [`supabase/schema.sql`](supabase/schema.sql), and confirm the `public.users` table exists.
3. In **Project Settings → API Keys**, copy the Project URL and a server-side **Secret key** (`sb_secret_...`). Keep that key in the API server only; never put it in `web/.env` or frontend code.
4. Copy `.env.example` to `.env`. Add the Project URL as `SUPABASE_URL` and the secret key as `SUPABASE_SECRET_KEY`. When upgrading from SQLite, keep the existing `PEPPER`, `JWT_SECRET`, and `DATA_ENCRYPTION_KEY` values; they protect existing password hashes and authenticator setup. For a fresh project, generate separate random values for the pepper and JWT secret and a separate 32-byte hex value for the encryption key. Keep all of `.env` private and out of version control.
5. Import existing SQLite accounts before starting the API. From this directory run `npm.cmd run migrate:supabase`. The script stops if the Supabase table already has rows, and it leaves the local SQLite database untouched. If this is a fresh project with no existing SQLite accounts, skip this step.
6. If you imported an existing administrator, keep that account's email and password. Otherwise set `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the initial administrator account. The server creates it on first connection if the email is not already in the table. Use a unique password with at least 12 characters.
7. Install dependencies and start the API from this directory:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

On non-Windows systems, use `npm install` and `npm run dev`. Start the API before the web client. It listens at `http://localhost:3000` by default.

## Roles and security

Public registration creates an `inputer`. A `manager` can add inputers. An `admin` can delete inputers. The `administrator` can assign `inputer`, `manager`, or `admin` roles. The API checks permissions on every protected request.

Passwords used PBKDF2-SHA512 with an individual random salt and a server-side pepper. Authenticator secrets were encrypted with AES-256-GCM before storage in Supabase. The legacy API required a valid signed-in session for 2FA setup and a five-minute challenge for sign-in verification. Session tokens expired after eight hours.

The table has Row Level Security enabled and grants no table access to `anon` or `authenticated`; the API connects with the server-only secret key. Keep the Supabase secret key, password pepper, JWT secret, and encryption key out of the website. Back up `DATA_ENCRYPTION_KEY` separately: encrypted authenticator secrets cannot be recovered without it.

## SecureAuth user-data backups

The project can create a daily encrypted snapshot of the `public.users` table, which contains the SecureAuth accounts, password hashes, roles, and encrypted authenticator secrets. This is an application-table backup, not a full Supabase project backup. The schema remains in `supabase/schema.sql`; Supabase-managed Auth, Storage objects, and other tables are not included.

From this directory, run one backup manually:

```powershell
npm.cmd run backup:supabase
```

On the first run, the script creates a separate 32-byte `BACKUP_ENCRYPTION_KEY` in `.env` without printing it. Save a protected copy of that key somewhere separate from this computer; without it, these backup files cannot be decrypted. The archive is written under `backups/supabase/`, which is excluded from Git. The default retention is 30 days; set `BACKUP_RETENTION_DAYS` in `.env` to change it.

To schedule the backup once per day on Windows, run this from the `server` folder:

```powershell
npm.cmd run backup:install-task
```

Windows Task Scheduler runs it daily at 2:00 a.m. local time when your Windows account is signed in and the computer is available. To run a manual backup at any time, use `npm.cmd run backup:supabase` again.

To restore to an empty `public.users` table, first run `supabase/schema.sql` in the target project's SQL Editor, then run:

```powershell
npm.cmd run backup:restore -- "backups/supabase/FILE.enc"
```

Use the actual backup filename. Restore refuses to run if the target table already contains accounts, so it will not overwrite an existing database. Review the target project URL in `.env` before restoring.

These local snapshots are encrypted, but they are not off-site protection unless the backup folder is copied to a separate secure location. They do not replace Supabase platform backups or point-in-time recovery. Check the Supabase Dashboard's Database > Backups section for platform-managed options available to your plan.

The remaining sections document the separate legacy Supabase service only; they are not instructions for the active Prisma v1 API. Do not use legacy migration, backup, or restore commands for the `secureauth` PostgreSQL database. For current Vercel/frontend and backend-hosting requirements, see [deployment guidance](../docs/deployment.md).

This is a classroom prototype. Production use still requires provider TLS, a persistent API host, external rate-limit storage before horizontal scaling, a PostgreSQL backup/restore workflow with an isolated restore drill, and a security review.
