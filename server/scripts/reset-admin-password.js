require('dotenv').config();

const { hashPassword } = require('../src/password');

async function main() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Configure the Supabase URL, server secret key, administrator email, and new administrator password in server/.env.');
  }
  if (ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 256) {
    throw new Error('ADMIN_PASSWORD must contain 12 to 256 characters.');
  }

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const usersUrl = new URL('/rest/v1/users', SUPABASE_URL);
  usersUrl.searchParams.set('select', 'id,role');
  usersUrl.searchParams.set('email', `eq.${email}`);
  usersUrl.searchParams.set('limit', '2');

  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  const lookup = await fetch(usersUrl, { headers });
  const users = await lookup.json();
  if (!lookup.ok) throw new Error(users.message || 'Could not look up the configured administrator.');
  if (users.length !== 1 || !['admin', 'administrator'].includes(users[0].role)) {
    throw new Error('The configured administrator account was not found or does not have an administrator role. No password was changed.');
  }

  const { salt, hash } = hashPassword(ADMIN_PASSWORD);
  const updateUrl = new URL('/rest/v1/users', SUPABASE_URL);
  updateUrl.searchParams.set('id', `eq.${users[0].id}`);
  const update = await fetch(updateUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ salt, password_hash: hash }),
  });
  const updatedUsers = await update.json();
  if (!update.ok) throw new Error(updatedUsers.message || 'Could not update the administrator password.');
  if (updatedUsers.length !== 1) throw new Error('No administrator password was updated.');

  console.log('Administrator password updated. Two-factor settings were left unchanged.');
}

main().catch((error) => {
  console.error(`Administrator password reset failed: ${error.message}`);
  process.exitCode = 1;
});
