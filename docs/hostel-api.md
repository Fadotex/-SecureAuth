# Hostel API v1

All endpoints are under `/api/v1`. Protected routes accept the `hostel_access` HttpOnly cookie; refresh uses the rotating `hostel_refresh` cookie. IDs are UUIDs. Money fields are integer pesewas. JSON validation failures return `400 { error, details }`; forbidden and missing resources return `403` and `404`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Student self-registration; system assigns STUDENT |
| POST | `/auth/verify-email` | Public | Consume one-time verification token |
| POST | `/auth/login` | Public, rate-limited | Password sign-in; may require TOTP |
| POST | `/auth/login/2fa` | Public, rate-limited | Complete Two-Factor Authentication (2FA) using an enabled account's authenticator code or one-time recovery code |
| POST | `/auth/2fa/enroll/setup` | Five-minute 2FA enrollment challenge | Start mandatory authenticator-app enrollment for a target-role user |
| POST | `/auth/2fa/enroll/verify` | Five-minute 2FA enrollment challenge | Confirm target-role authenticator enrollment and return one-time recovery codes |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh token and issue access cookie |
| POST | `/auth/logout` | Public | Revoke refresh token and clear cookies |
| POST | `/auth/forgot-password` | Public, rate-limited | Request one-time reset email |
| POST | `/auth/reset-password` | Public, rate-limited | Consume reset token |
| POST | `/auth/change-password` | Signed in | Change password; clears forced-change flag |
| GET | `/auth/me` | Signed in | Current role and student profile |
| POST | `/auth/2fa/setup` | Eligible legacy STAFF account | Optional legacy enrollment; target roles must use mandatory first-login enrollment |
| POST | `/auth/2fa/enable` | Eligible legacy STAFF account | Confirm optional legacy enrollment; revokes sessions |
| GET | `/semesters` | Signed in | List semesters |
| POST | `/semesters` | MANAGER/ADMIN/ADMINISTRATOR | Create semester |
| POST | `/semesters/:id/activate` | MANAGER/ADMIN/ADMINISTRATOR | Set active semester |
| POST | `/semesters/:id/close` | MANAGER/ADMIN/ADMINISTRATOR | Close semester for write operations |
| GET | `/room-types` | Signed in | Room types and semester prices |
| POST | `/room-types` | MANAGER/ADMIN/ADMINISTRATOR | Create room type and initial price |
| PUT | `/room-types/:id/prices/:semesterId` | MANAGER/ADMIN/ADMINISTRATOR | Update price for future bookings |
| GET | `/rooms/availability` | Signed in | Available/occupied beds, prices, and room status |
| POST | `/hostels`, `/blocks`, `/floors` | MANAGER/ADMIN/ADMINISTRATOR | Configure hostel structure |
| POST | `/rooms` | INPUTER/MANAGER/ADMIN/ADMINISTRATOR | Create room inventory; room capacity creates beds |
| PATCH | `/rooms/:id/status` | INPUTER/MANAGER/ADMIN/ADMINISTRATOR | Mark a room available/reserved/maintenance |
| POST | `/bookings/hold` | STUDENT | Atomically hold a selected or automatically assigned bed |
| GET | `/bookings/me` | STUDENT | Own semester bookings, payment totals, receipts data |
| POST | `/bookings/:id/cancel` | Owner/ADMIN | Cancel eligible booking |
| POST | `/bookings/:id/check-in` | ADMIN/STAFF/SECURITY | Check resident in |
| POST | `/bookings/:id/check-out` | ADMIN/STAFF/SECURITY | Check resident out |
| GET | `/student/dashboard` | STUDENT | Booking, roommate count, notices, maintenance and payment state |
| POST | `/payments/initialize` | STUDENT | Start MTN MoMo or Telecel Cash Paystack charge |
| POST | `/payments/paystack/webhook` | Paystack signature | Verify provider transaction and settle idempotently |
| GET | `/payments/me` | STUDENT | Own payment history |
| GET | `/payments/:id/receipt` | Owner/ADMIN/STAFF | Download PDF receipt after verification |
| POST | `/payments/manual` | ADMIN/STAFF | Record cash or office MoMo payment |
| GET | `/admin/payments` | ADMIN | Payment ledger |
| GET | `/admin/reports/summary` | ADMIN | Semester, occupancy, money and reconciliation totals |
| GET | `/admin/reports/payments.csv` | ADMIN | Export financial ledger |
| GET | `/staff/payments.csv` | ADMIN/STAFF | Export permitted payment ledger |
| GET | `/students` | ADMIN/STAFF | Search student ID, name, or room |
| POST | `/maintenance` | STUDENT | Create room maintenance request |
| GET/PATCH | `/maintenance` | Owner/ADMIN/STAFF | View/update maintenance work |
| POST/GET | `/visitors` | ADMIN/STAFF/SECURITY | Log and view visitor arrivals |
| POST | `/visitors/:id/check-out` | ADMIN/STAFF/SECURITY | Record visitor departure |
| POST/GET | `/notices` | Signed in / ADMIN create | Publish and list role/block-targeted notices |
| POST | `/notices/:id/read` | STUDENT | Record notice acknowledgement |
| POST | `/room-change-requests` | STUDENT | Request a transfer |
| GET | `/room-change-requests` | ADMIN/STAFF | Review transfer requests |
| POST | `/room-change-requests/:id/decision` | ADMIN | Approve/reject transfer |
| POST | `/admin/staff` | ADMIN | Create forced-password-change staff account |
| POST | `/admin/security` | ADMIN | Create a forced-password-change visitor/check-in-only account |
| GET | `/admin/staff` | ADMIN | List active staff and security accounts |
| DELETE | `/admin/staff/:id` | ADMIN | Deactivate staff/security and revoke sessions |
| PATCH | `/admin/staff/:id/permissions` | ADMIN | Update staff permission set |
| GET | `/admin/audit-logs` | ADMINISTRATOR | Read audit history (database administrators can still alter database-held records) |
| GET/PUT | `/admin/settings` | ADMINISTRATOR | Manage application settings |
| GET | `/admin/email-jobs` | ADMINISTRATOR | Inspect mail delivery state |
| POST | `/admin/inputers` | MANAGER/ADMINISTRATOR | Create an Inputer account with forced password change |
| GET | `/admin/inputers` | MANAGER/ADMIN/ADMINISTRATOR | List active Inputer accounts |
| DELETE | `/admin/inputers/:id` | ADMIN/ADMINISTRATOR | Deactivate an Inputer and revoke sessions |
| POST | `/system/users` | ADMINISTRATOR | Create a target-role account |
| GET | `/system/users` | ADMINISTRATOR | List target and unmapped legacy accounts |
| PATCH | `/system/users/:id/role` | ADMINISTRATOR | Explicitly assign a target role, revoke sessions, and audit the mapping |
| GET | `/system/inputer-archive` | ADMINISTRATOR | List deactivated Inputer accounts |
| POST | `/system/inputer-archive/:id/restore` | ADMINISTRATOR | Restore an archived Inputer account |
| GET | `/health` | Public | Check API and database availability |

Example booking hold:

```json
{
  "roomTypeId": "d7fd98da-2419-4f50-b9ef-1819274b9a81",
  "semesterId": "74509b4c-3511-458b-851b-5c9504381e5c"
}
```

Example payment initialization:

```json
{
  "bookingId": "4e34a9f3-90f1-41de-aaca-19a4a522b10c",
  "amountPesewas": 100000,
  "network": "MTN_MOMO",
  "phone": "0240000000",
  "idempotencyKey": "payment-attempt-unique-01"
}
```