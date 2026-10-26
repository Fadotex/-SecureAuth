const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const MAGIC = Buffer.from('SAUB1');

function decryptBackup(filePath) {
  const keyHex = process.env.BACKUP_ENCRYPTION_KEY;
  if (!/^[\da-f]{64}$/i.test(keyHex || '')) throw new Error('BACKUP_ENCRYPTION_KEY is missing or invalid in server/.env.');
  const blob = fs.readFileSync(filePath);
  if (blob.length < MAGIC.length + 28 || !blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not a SecureAuth encrypted backup.');
  const iv = blob.subarray(5, 17);
  const tag = blob.subarray(17, 33);
  const ciphertext = blob.subarray(33);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const backup = JSON.parse(plaintext);
  if (backup.format !== 'secureauth-supabase-users' || backup.version !== 1 || backup.table !== 'public.users' || !Array.isArray(backup.records)) {
    throw new Error('Backup contents are not a supported SecureAuth users backup.');
  }
  return backup;
}

async function requestUsers(method, body) {
  const url = new URL('/rest/v1/users?on_conflict=id', process.env.SUPABASE_URL);
  return fetch(url, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured in server/.env.');
  const url = new URL(process.env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL.');
  const suppliedPath = process.argv[2];
  if (!suppliedPath) throw new Error('Pass the encrypted backup filename as the first argument.');
  const filePath = path.resolve(process.cwd(), suppliedPath);
  const backup = decryptBackup(filePath);
  if (!backup.records.length) throw new Error('The backup contains no accounts; refusing to restore an empty snapshot.');

  const existing = await requestUsers('GET');
  if (!existing.ok) throw new Error(`Supabase returned HTTP ${existing.status} while checking the target table.`);
  const currentRows = await existing.json();
  if (currentRows.length) throw new Error('The target users table is not empty. Restore is allowed only into an empty public.users table.');

  for (let offset = 0; offset < backup.records.length; offset += 100) {
    const response = await requestUsers('POST', backup.records.slice(offset, offset + 100));
    if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status} while restoring account batch ${Math.floor(offset / 100) + 1}.`);
  }
  console.log(`Restored ${backup.records.length} accounts from backup created ${backup.createdAt}.`);
}

main().catch((error) => {
  console.error(`Supabase users restore failed: ${error.message}`);
  process.exitCode = 1;
});
