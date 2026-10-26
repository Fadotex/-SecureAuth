# Hostel Management web app

React and Vite portals for residents, staff/secretaries, optional security, and administrators. The browser talks to the versioned PostgreSQL-backed API at `/api/v1`; it never receives database or Paystack secrets.

## Run locally on Windows

Use two terminals. Start the API first, then start the website. In PowerShell, use `npm.cmd` (the `npm` PowerShell script can be blocked by the execution policy).

1. Configure the PostgreSQL API using the [repository setup guide](../README.md), then start the new `server/src/v1/server.ts` API from `server/` with `npm.cmd run dev`.
2. In this `web` folder, run `npm.cmd run dev`.
3. Open the local URL Vite prints, usually `http://127.0.0.1:5173/`. Do not open `index.html` directly from File Explorer; the website needs Vite and the API server.

The API defaults to `http://127.0.0.1:3001/api/v1` so it can coexist with the legacy server on port 3000. If it runs elsewhere, set `VITE_API_URL` in `web/.env.local` to the full API base, including `/api/v1`, then restart Vite. The local `secureauth` schema is initialized, but no accounts exist. From `server\`, run `npm.cmd run provision:first-admin` in a private interactive terminal to establish the first administrator; no password is predefined. First sign-in requires authenticator-app MFA enrollment. Student registration remains unavailable until that administrator exists, and the administrator can provision target-role accounts.

The API uses HttpOnly cookies for short-lived access and rotating refresh sessions. The service worker caches the static shell only, never private API responses. Payment, email, and database credentials stay on the server.
