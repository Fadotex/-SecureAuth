# Administrator / Manager Guide

1. Sign in with the initial administrator credentials configured in `server/.env`; do not distribute a shared credential. Enable TOTP from **Security**.
2. In **Overview**, choose a semester and review occupancy, payment state, expected/collected/outstanding amounts, fee/net totals, top balances, and reconciliation. Export the payment ledger to CSV.
3. In **Rooms & prices**, create room types and semester prices, then create hostel/block/floor/room inventory. Room capacity creates the corresponding beds. Price changes affect future bookings only; each booking stores its price snapshot.
4. In **Students**, search residents and inspect balances. In **Payments**, review the ledger. Manual payments are visible with their source and reference.
5. In **Operations**, publish notices, review maintenance, room changes, and visitors. Use **Staff & audit** to create/deactivate staff and inspect audit events.
6. Closing a semester makes its booking and payment operations read-only. The API enforces role checks; hiding a control in the browser is not the security boundary.