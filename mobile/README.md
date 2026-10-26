# SecureAuth mobile

The Expo client uses the same v1 API as the web application. It supports target-role email-and-password sign-in, mandatory Two-Factor Authentication (2FA) enrollment and authenticator-code verification, forced temporary-password changes, role-specific screens, and logout. Single-use recovery codes are shown once after enrollment. Access tokens stay in memory; refresh tokens use Expo SecureStore. Passwords and authenticator setup secrets are not persisted.

## Run locally

1. Start the API using [the server instructions](../server/README.md).
2. Set `EXPO_PUBLIC_API_URL` to the full v1 API base URL, including `/api/v1`.
   - Android emulator: `http://10.0.2.2:3001/api/v1` (the `.env.example` value).
   - iOS Simulator or local web: generally `http://127.0.0.1:3001/api/v1`.
3. Install dependencies and start Expo:

```powershell
npm.cmd install
npm.cmd run start
```

For a physical phone, `localhost` refers to the phone. Use the development computer's private LAN address, set `HOSTEL_API_HOST` to that LAN interface, and allow only the trusted private subnet through Windows Firewall. Do not expose port 3001 to the public internet. HTTP sends credentials in cleartext on the LAN; use HTTPS/TLS before using real accounts over Wi-Fi.
