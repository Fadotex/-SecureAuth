# Hostel Management

An existing React web application, an Express/TypeScript v1 API, PostgreSQL/Prisma persistence, and an Expo client for hostel operations. The active API is `server/src/v1/server.ts`; legacy SQLite/Supabase code and files are not part of the v1 startup path. Existing accounts and backup files are not migrated automatically.

## Local development

Prerequisites: Node.js 22.13+ and a running PostgreSQL database configured privately in `server/.env`. Never replace an existing `.env` or display its contents.

Install dependencies from each application folder:

```powershell
Set-Location 'C:\path\to\SecureAuth-FinalRecovery\server'
npm.cmd install
npm.cmd run db:generate

Set-Location 'C:\path\to\SecureAuth-FinalRecovery\web'
npm.cmd install
```

Apply only the reviewed migrations to the intended empty development database after confirming its identity and backup/recovery plan:

```powershell
Set-Location 'C:\path\to\SecureAuth-FinalRecovery\server'
npm.cmd run db:deploy
```

Do not use `db:push`, reset commands, legacy import scripts, or automatic seeds to initialize production. For a new empty database, create the first Administrator interactively with `npm.cmd run provision:first-admin`; the script prompts for a password without echoing it and refuses to proceed if the user table is not empty.

Start the API and web app in separate terminals:

```powershell
Set-Location 'C:\path\to\SecureAuth-FinalRecovery\server'
npm.cmd run dev
```

```powershell
Set-Location 'C:\path\to\SecureAuth-FinalRecovery\web'
$env:VITE_API_URL = 'http://127.0.0.1:3001/api/v1'
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

The API defaults to loopback (`127.0.0.1:3001`). Do not expose it to the public internet. LAN use requires a trusted network, a deliberate `HOSTEL_API_HOST`, restricted firewall rules, an exact `FRONTEND_ORIGINS` list, and HTTPS.

## Checks

```powershell
Set-Location 'C:\path\to\SecureAuth-FinalRecovery\server'
npm.cmd test
npm.cmd run build

Set-Location 'C:\path\to\SecureAuth-FinalRecovery\web'
npm.cmd run lint
npm.cmd run build

Set-Location 'C:\path\to\SecureAuth-FinalRecovery\mobile'
npm.cmd run lint
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\expo.cmd export --platform android
```

See [deployment guidance](docs/deployment.md), [architecture](docs/hostel-architecture.md), [v1 API reference](docs/hostel-api.md), and the role guides in `docs/`.

## Integration and production limits

- Student registration requires email verification. Real delivery requires configured SMTP; the loopback-only local development verification helper is unavailable in production.
- Target roles require authenticator-app Two-Factor Authentication (2FA), including enrollment before a full session. Staff and student portal permissions are checked by the API.
- Paystack payment processing requires provider credentials, HTTPS webhooks, and external provider verification; it has not been established as a live production integration by this repository.
- Active PostgreSQL backup/restore is not implemented by the legacy `backup:supabase` scripts. Do not treat those scripts as a v1 database backup. A tested isolated restore drill is a production blocker.
- Audit events are stored in PostgreSQL. They are access-restricted at the application layer but are not cryptographically tamper-evident against database administrators.
- Sensitive TOTP seeds are encrypted with `DATA_ENCRYPTION_KEY`; other personal data relies on database/provider storage protection, which must be configured and verified separately.
- The project is a classroom MVP, not a compliance certification. Production requires TLS, provider review, external rate-limit storage before horizontal scaling, key rotation, tested backups/restores, and security/accessibility testing.
