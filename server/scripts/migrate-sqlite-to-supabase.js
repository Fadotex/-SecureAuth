require('dotenv').config();

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in server/.env before migrating.');
  process.exit(1);
}

const databasePath = path.join(__dirname, '..', 'data', 'secureauth.sqlite');
const database = new DatabaseSync(databasePath, { readOnly: true });
const rows = database.prepare(`SELECT
  id, name, email, password_hash, salt, role, two_factor_enabled,
  two_factor_secret_encrypted, pending_two_factor_secret_encrypted, created_at
  FROM users ORDER BY created_at`).all().map((row) => ({
  ...row,
  two_factor_enabled: Boolean(row.two_factor_enabled),
}));
database.close();

async function main() {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const tableUrl = new URL('/rest/v1/users', process.env.SUPABASE_URL);
  tableUrl.searchParams.set('select', 'id');
  tableUrl.searchParams.set('limit', '1');

  const existingResponse = await fetch(tableUrl, { headers });
  const existing = await existingResponse.json();
  if (!existingResponse.ok) throw new Error(existing.message || 'Could not read the Supabase users table. Run supabase/schema.sql first.');
  if (existing.length > 0) throw new Error('Supabase users table is not empty. Migration stopped to avoid overwriting or duplicating accounts.');
  if (rows.length === 0) {
    console.log('The local SQLite database has no accounts to import.');
    return;
  }

  const insertUrl = new URL('/rest/v1/users', process.env.SUPABASE_URL);
  const importResponse = await fetch(insertUrl, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!importResponse.ok) {
    const error = await importResponse.json();
    throw new Error(error.message || 'Supabase rejected the account import.');
  }
  console.log(`Imported ${rows.length} account(s). Local SQLite data was left untouched.`);
}

main().catch((error) => {
  console.error('SQLite to Supabase migration failed:', error.message);
  process.exitCode = 1;
});
