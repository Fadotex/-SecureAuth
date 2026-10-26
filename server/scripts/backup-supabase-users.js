const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const envPath = path.resolve(__dirname, '../.env');
const backupDirectory = path.resolve(__dirname, '../backups/supabase');
const PAGE_SIZE = 500;
const MAGIC = Buffer.from('SAUB1');

function getBackupKey() {
  if (!fs.existsSync(envPath)) throw new Error('server/.env is missing. Configure the server first.');
  let envText = fs.readFileSync(envPath, 'utf8');
  const existing = envText.match(/^BACKUP_ENCRYPTION_KEY=(.*)$/m)?.[1]?.trim();

  if (existing) {
    if (!/^[\da-f]{64}$/i.test(existing)) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hexadecimal characters.');
    return Buffer.from(existing, 'hex');
  }

  const key = crypto.randomBytes(32);
  if (envText.length && !envText.endsWith('\n')) envText += '\n';
  envText += `BACKUP_ENCRYPTION_KEY=${key.toString('hex')}\n`;
  fs.writeFileSync(envPath, envText, { mode: 0o600 });
  process.env.BACKUP_ENCRYPTION_KEY = key.toString('hex');
  console.log('Created BACKUP_ENCRYPTION_KEY in server/.env. Save a protected copy separately; the key is not displayed.');
  return key;
}

function validateConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured in server/.env.');
  }
  const url = new URL(process.env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL.');
  }
}

async function downloadUsers() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL('/rest/v1/users?select=*', process.env.SUPABASE_URL);
    const response = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
        Accept: 'application/json',
        'Range-Unit': 'items',
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
      },
    });
    if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status} while reading the users table.`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Supabase returned an unexpected users-table response.');
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

function encryptBackup(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function pruneOldBackups(retentionDays) {
  const expiry = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(backupDirectory)) {
    if (!/^secureauth-users-\d{4}-\d\d-\d\dT[\w.-]+Z\.enc$/.test(name)) continue;
    const filePath = path.join(backupDirectory, name);
    if (fs.statSync(filePath).mtimeMs < expiry) fs.rmSync(filePath);
  }
}

async function main() {
  validateConfig();
  const key = getBackupKey();
  const retentionDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('BACKUP_RETENTION_DAYS must be a whole number between 1 and 3650.');
  }

  const users = await downloadUsers();
  const backup = {
    format: 'secureauth-supabase-users',
    version: 1,
    createdAt: new Date().toISOString(),
    table: 'public.users',
    records: users,
  };

  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = backup.createdAt.replace(/:/g, '-');
  const filename = `secureauth-users-${stamp}.enc`;
  const target = path.join(backupDirectory, filename);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, encryptBackup(backup, key), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, target);
  pruneOldBackups(retentionDays);
  console.log(`Encrypted Supabase users backup created: backups/supabase/${filename} (${users.length} accounts).`);
}

main().catch((error) => {
  console.error(`Supabase users backup failed: ${error.message}`);
  process.exitCode = 1;
});
