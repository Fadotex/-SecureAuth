require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { generateSecret, generateURI, verifySync } = require('otplib');
const { hashPassword, verifyPassword } = require('./password');
const hostelStore = require('./hostelStore');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN_TTL = '8h';
const CHALLENGE_TTL = '5m';
const backupDirectory = path.join(__dirname, '..', 'backups', 'supabase');
const adminConfigIncomplete = Boolean(process.env.ADMIN_EMAIL) !== Boolean(process.env.ADMIN_PASSWORD);

if (
  !process.env.PEPPER ||
  !process.env.JWT_SECRET ||
  !/^[\da-f]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || '') ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SECRET_KEY ||
  adminConfigIncomplete
) {
  console.error('ERROR: Configure PEPPER, JWT_SECRET, a 64-character hex DATA_ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY, and both ADMIN_EMAIL and ADMIN_PASSWORD (or neither).');
  process.exit(1);
}

// This privileged key stays on the API server. Never put it in the web client.
const encryptionKey = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex');

app.use(cors());
app.use(express.json({ limit: '10kb' }));

function encryptSecret(secret) {
  if (!secret) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('hex')).join(':');
}

function decryptSecret(value) {
  if (!value) return null;
  const [ivHex, tagHex, encryptedHex] = value.split(':');
  if (!ivHex || !tagHex || !encryptedHex) throw new Error('Invalid encrypted authenticator secret in Supabase.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

function userFromRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    passwordHash: record.password_hash,
    salt: record.salt,
    role: record.role,
    twoFactorEnabled: record.two_factor_enabled,
    twoFactorSecret: decryptSecret(record.two_factor_secret_encrypted),
    pendingTwoFactorSecret: decryptSecret(record.pending_two_factor_secret_encrypted),
    createdAt: record.created_at,
  };
}

function recordFromUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    password_hash: user.passwordHash,
    salt: user.salt,
    role: user.role,
    two_factor_enabled: user.twoFactorEnabled,
    two_factor_secret_encrypted: encryptSecret(user.twoFactorSecret),
    pending_two_factor_secret_encrypted: encryptSecret(user.pendingTwoFactorSecret),
    created_at: user.createdAt,
  };
}

async function usersRequest(method, filters = {}, body = undefined, table = '/rest/v1/users') {
  const url = new URL(table, process.env.SUPABASE_URL);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(result?.message || 'Supabase request failed.');
    error.code = result?.code;
    error.status = response.status;
    throw error;
  }
  return result;
}

async function findUserByEmail(email) {
  const rows = await usersRequest('GET', { select: '*', email: `eq.${email}`, limit: '1' });
  return userFromRecord(rows[0]);
}

async function findUserById(id) {
  const rows = await usersRequest('GET', { select: '*', id: `eq.${id}`, limit: '1' });
  return userFromRecord(rows[0]);
}

async function listUsers() {
  const records = await usersRequest('GET', { select: '*', order: 'created_at.asc' });
  return records.map(userFromRecord);
}

async function listRecords() {
  const records = await usersRequest('GET', { select: '*', order: 'created_at.desc' }, undefined, '/rest/v1/records');
  return records.map((record) => publicRecord(record));
}

async function insertRecord(record) {
  const records = await usersRequest('POST', { select: '*' }, record, '/rest/v1/records');
  return records[0];
}

async function insertAuditLog(entry) {
  const records = await usersRequest('POST', { select: '*' }, entry, '/rest/v1/audit_logs');
  return records[0];
}

async function insertUser(user) {
  const records = await usersRequest('POST', { select: '*' }, recordFromUser(user));
  return userFromRecord(records[0]);
}

async function listBackupFiles() {
  fs.mkdirSync(backupDirectory, { recursive: true });
  return fs.readdirSync(backupDirectory)
    .filter((file) => file.endsWith('.enc'))
    .sort((a, b) => fs.statSync(path.join(backupDirectory, b)).mtimeMs - fs.statSync(path.join(backupDirectory, a)).mtimeMs);
}

async function createBackupSnapshot() {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const [users, records] = await Promise.all([
    usersRequest('GET', { select: '*', order: 'created_at.asc' }, undefined, '/rest/v1/users'),
    usersRequest('GET', { select: '*', order: 'created_at.desc' }, undefined, '/rest/v1/records'),
  ]);

  const data = {
    generatedAt: new Date().toISOString(),
    users,
    records,
  };

  const fileName = `secureauth-backup-${Date.now()}.enc`;
  const filePath = path.join(backupDirectory, fileName);
  fs.writeFileSync(filePath, encryptBackupData(data));

  return {
    fileName,
    filePath,
    generatedAt: data.generatedAt,
  };
}

async function restoreBackup(fileName) {
  const filePath = path.join(backupDirectory, fileName);
  if (!fs.existsSync(filePath)) throw new Error('Backup file not found.');

  const encrypted = fs.readFileSync(filePath, 'utf8');
  const snapshot = decryptBackupData(encrypted);
  if (!Array.isArray(snapshot.users) || !Array.isArray(snapshot.records)) {
    throw new Error('Backup file is not a valid SecureAuth snapshot.');
  }

  await usersRequest('DELETE', { select: 'id' }, undefined, '/rest/v1/users');
  await usersRequest('DELETE', { select: 'id' }, undefined, '/rest/v1/records');

  for (const user of snapshot.users) {
    await usersRequest('POST', { select: '*' }, user, '/rest/v1/users');
  }

  for (const record of snapshot.records) {
    await usersRequest('POST', { select: '*' }, record, '/rest/v1/records');
  }

  return snapshot;
}

async function updateUser(user) {
  const records = await usersRequest('PATCH', { id: `eq.${user.id}`, select: '*' }, recordFromUser(user));
  if (!records[0]) throw new Error('User no longer exists in Supabase.');
  return userFromRecord(records[0]);
}

async function removeUser(id) {
  await usersRequest('DELETE', { id: `eq.${id}`, select: 'id' });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

function publicRecord(record) {
  return {
    id: record.id,
    residentName: record.resident_name,
    studentId: record.student_id,
    block: record.block,
    roomDetails: record.room_details,
    status: record.status,
    createdBy: record.created_by,
    createdAt: record.created_at,
  };
}

function ensureBackupKey() {
  if (!process.env.BACKUP_ENCRYPTION_KEY) {
    process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  }
  return process.env.BACKUP_ENCRYPTION_KEY;
}

function encryptBackupData(data) {
  const key = Buffer.from(ensureBackupKey(), 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const serialized = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptBackupData(payload) {
  const [ivHex, tagHex, encryptedHex] = payload.split(':');
  if (!ivHex || !tagHex || !encryptedHex) throw new Error('Backup file is corrupted or incomplete.');
  const key = Buffer.from(ensureBackupKey(), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(decrypted);
}

function issueToken(user, purpose = 'session', expiresIn = TOKEN_TTL) {
  return jwt.sign({ sub: user.id, role: user.role, purpose }, process.env.JWT_SECRET, { expiresIn });
}

function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ success: false, message: 'Sign in to continue.' });

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
    if (claims.purpose !== 'session') throw new Error('Not a session token');
  } catch {
    return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
  }

  findUserById(claims.sub)
    .then((user) => {
      if (!user) return res.status(401).json({ success: false, message: 'Session is no longer valid.' });
      req.user = user;
      return next();
    })
    .catch((error) => {
      console.error('Supabase authentication lookup failed:', error.message);
      return res.status(503).json({ success: false, message: 'Account service is temporarily unavailable.' });
    });
}

app.get('/', (_req, res) => res.json({ message: 'SecureAuth server is running', status: 'success' }));

app.get('/api/security-status', (_req, res) => res.json({
  pepperConfigured: Boolean(process.env.PEPPER),
  jwtConfigured: Boolean(process.env.JWT_SECRET),
  supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
}));

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }
    if (name.trim().length > 100 || email.trim().length > 254) return res.status(400).json({ success: false, message: 'Name or email is too long.' });
    if (password.length < 8 || password.length > 256) return res.status(400).json({ success: false, message: 'Password must contain 8 to 256 characters.' });
    const normalizedEmail = email.trim().toLowerCase();
    if (await findUserByEmail(normalizedEmail)) return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    const { salt, hash } = hashPassword(password);
    const user = await insertUser({
      id: crypto.randomUUID(), name: name.trim(), email: normalizedEmail,
      passwordHash: hash, salt, role: 'inputer', twoFactorEnabled: false,
      twoFactorSecret: null, pendingTwoFactorSecret: null, createdAt: new Date().toISOString(),
    });
    return res.status(201).json({ success: true, message: 'Account created successfully.', user: publicUser(user) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    console.error('Registration error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });
    const user = await findUserByEmail(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    if (user.twoFactorEnabled) {
      return res.json({ success: true, twoFactorRequired: true, challengeToken: issueToken(user, 'two-factor', CHALLENGE_TTL) });
    }
    return res.json({ success: true, twoFactorRequired: false, token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

app.post('/api/2fa/setup', authenticate, async (req, res) => {
  try {
    if (req.user.twoFactorEnabled) return res.status(409).json({ success: false, message: 'Two-factor authentication is already enabled.' });
    // Each explicit setup request starts a fresh enrollment. This also
    // invalidates any pending setup key that may have been copied or exposed.
    const previousSecret = req.user.pendingTwoFactorSecret;
    req.user.pendingTwoFactorSecret = generateSecret();
    try {
      await updateUser(req.user);
    } catch (error) {
      req.user.pendingTwoFactorSecret = previousSecret;
      throw error;
    }
    const otpauth = generateURI({ issuer: 'SecureAuth', label: req.user.email, secret: req.user.pendingTwoFactorSecret });
    return res.json({ success: true, secret: req.user.pendingTwoFactorSecret, otpauth });
  } catch (error) {
    console.error('2FA setup error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error during 2FA setup.' });
  }
});

app.post('/api/2fa/verify', async (req, res) => {
  try {
    const { token, code } = req.body;
    if (typeof token !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: 'A valid six-digit code and sign-in challenge are required.' });
    let claims;
    try { claims = jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(401).json({ success: false, message: 'Your verification challenge has expired. Please sign in again.' }); }
    const user = await findUserById(claims.sub);
    if (!user) return res.status(401).json({ success: false, message: 'Account not found.' });

    let secret;
    if (claims.purpose === 'two-factor' && user.twoFactorEnabled) secret = user.twoFactorSecret;
    else if (claims.purpose === 'session' && !user.twoFactorEnabled) secret = user.pendingTwoFactorSecret;
    else return res.status(401).json({ success: false, message: 'This verification challenge is not valid.' });

    let verification = { valid: false };
    if (secret) verification = verifySync({ token: code, secret, epochTolerance: 30 });
    if (!verification.valid) return res.status(401).json({ success: false, message: 'Invalid or expired verification code.' });

    if (claims.purpose === 'session') {
      const previousState = {
        twoFactorSecret: user.twoFactorSecret,
        pendingTwoFactorSecret: user.pendingTwoFactorSecret,
        twoFactorEnabled: user.twoFactorEnabled,
      };
      user.twoFactorSecret = user.pendingTwoFactorSecret;
      user.pendingTwoFactorSecret = null;
      user.twoFactorEnabled = true;
      try {
        await updateUser(user);
      } catch (error) {
        Object.assign(user, previousState);
        throw error;
      }
    }
    return res.json({ success: true, message: 'Two-factor verification successful.', token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error('2FA verification error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error during 2FA verification.' });
  }
});

app.get('/api/me', authenticate, (req, res) => res.json({ success: true, user: publicUser(req.user) }));

app.get('/api/records', authenticate, async (req, res) => {
  if (!['inputer', 'manager', 'admin', 'administrator'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to records.' });
  }

  try {
    const records = await listRecords();
    return res.json({ success: true, records });
  } catch (error) {
    console.error('Record listing error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while loading records.' });
  }
});

app.post('/api/records', authenticate, async (req, res) => {
  if (!['inputer', 'manager', 'admin', 'administrator'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Only authorized roles can add records.' });
  }

  try {
    const { residentName, studentId, block, roomDetails } = req.body;
    if (typeof residentName !== 'string' || typeof studentId !== 'string' || typeof block !== 'string' || typeof roomDetails !== 'string') {
      return res.status(400).json({ success: false, message: 'Resident name, student ID, block and room details are required.' });
    }

    if (!residentName.trim() || !studentId.trim() || !block.trim() || !roomDetails.trim()) {
      return res.status(400).json({ success: false, message: 'Resident name, student ID, block and room details are required.' });
    }

    const record = await insertRecord({
      id: crypto.randomUUID(),
      resident_name: residentName.trim(),
      student_id: studentId.trim(),
      block: block.trim(),
      room_details: roomDetails.trim(),
      status: 'pending',
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    });

    await insertAuditLog({
      id: crypto.randomUUID(),
      user_id: req.user.id,
      action: 'record_created',
      details: `Created resident record for student ${record.student_id}`,
      created_at: new Date().toISOString(),
    });

    return res.status(201).json({ success: true, record: publicRecord(record) });
  } catch (error) {
    console.error('Record creation error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while creating record.' });
  }
});

app.get('/api/audit-logs', authenticate, async (req, res) => {
  if (!['admin', 'administrator', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to system logs.' });
  }

  try {
    const logs = await usersRequest('GET', { select: '*', order: 'created_at.desc', limit: '20' }, undefined, '/rest/v1/audit_logs');
    return res.json({ success: true, logs });
  } catch (error) {
    console.error('Audit log error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while loading logs.' });
  }
});

app.get('/api/hostel/summary', authenticate, async (req, res) => {
  if (!['manager', 'admin', 'administrator'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Manager access is required to view hostel summary.' });
  }

  try {
    return res.json({ success: true, summary: hostelStore.getDashboardSummary() });
  } catch (error) {
    console.error('Hostel summary error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while loading hostel summary.' });
  }
});

app.get('/api/hostel/rooms', authenticate, async (req, res) => {
  if (!['inputer', 'manager', 'admin', 'administrator'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to room data.' });
  }

  try {
    return res.json({ success: true, rooms: hostelStore.listRooms() });
  } catch (error) {
    console.error('Room listing error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while loading rooms.' });
  }
});

app.post('/api/hostel/rooms', authenticate, async (req, res) => {
  if (!['manager', 'admin', 'administrator'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Only management roles can create hostel rooms.' });
  }

  try {
    const { roomNumber, block, type, rent, capacity, occupied, status } = req.body;
    if (typeof roomNumber !== 'string' || !roomNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Room number is required.' });
    }

    const created = hostelStore.createRoom({
      roomNumber: roomNumber.trim(),
      block: (block || 'Block A').trim(),
      type: type || 'Single',
      rent: rent || 0,
      capacity: capacity || 1,
      occupied: occupied || 0,
      status: status || 'Available',
    });

    return res.status(201).json({ success: true, room: created });
  } catch (error) {
    console.error('Room creation error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while creating room.' });
  }
});

app.get('/api/hostel/residents', authenticate, async (req, res) => {
  if (!['inputer', 'manager', 'admin', 'administrator'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to resident data.' });
  }

  try {
    return res.json({ success: true, residents: hostelStore.listResidents() });
  } catch (error) {
    console.error('Resident listing error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while loading residents.' });
  }
});

app.post('/api/hostel/residents', authenticate, async (req, res) => {
  if (!['inputer', 'manager', 'admin', 'administrator'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to create resident records.' });
  }

  try {
    const { name, studentId, roomId, block, feeBalance, status } = req.body;
    if (typeof name !== 'string' || typeof studentId !== 'string' || !name.trim() || !studentId.trim()) {
      return res.status(400).json({ success: false, message: 'Name and student ID are required.' });
    }

    const resident = hostelStore.createResident({
      name: name.trim(),
      studentId: studentId.trim(),
      roomId: roomId || 'unassigned',
      block: block || 'Block A',
      feeBalance: feeBalance || 0,
      status: status || 'Active',
    });

    return res.status(201).json({ success: true, resident });
  } catch (error) {
    console.error('Resident creation error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while creating resident record.' });
  }
});

app.get('/api/admin/users', authenticate, async (req, res) => {
  if (!['admin', 'administrator'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Administrator access is required.' });
  try {
    const users = await listUsers();
    return res.json({ success: true, users: users.map(publicUser) });
  } catch (error) {
    console.error('User listing error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while loading users.' });
  }
});

app.get('/api/admin/backups', authenticate, async (req, res) => {
  if (!['admin', 'administrator'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access is required to view backups.' });
  try {
    const files = await listBackupFiles();
    return res.json({ success: true, backups: files });
  } catch (error) {
    console.error('Backup listing error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while loading backups.' });
  }
});

app.post('/api/admin/backup', authenticate, async (req, res) => {
  if (!['admin', 'administrator'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access is required to create a backup.' });
  try {
    const result = await createBackupSnapshot();
    return res.status(201).json({ success: true, message: 'Backup created successfully.', backup: result });
  } catch (error) {
    console.error('Backup creation error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while creating backup.' });
  }
});

app.post('/api/admin/restore', authenticate, async (req, res) => {
  if (!['admin', 'administrator'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access is required to restore a backup.' });
  try {
    const { fileName } = req.body;
    if (typeof fileName !== 'string' || !fileName.trim()) {
      return res.status(400).json({ success: false, message: 'A backup file name is required.' });
    }
    const snapshot = await restoreBackup(fileName);
    return res.json({ success: true, message: 'Backup restored successfully.', restoredAt: snapshot.generatedAt });
  } catch (error) {
    console.error('Restore error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Server error while restoring backup.' });
  }
});

app.post('/api/manager/inputers', authenticate, async (req, res) => {
  if (!['manager', 'administrator'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Manager access is required to add an inputer.' });
  try {
    const { name, email, password } = req.body;
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }
    if (name.trim().length > 100 || email.trim().length > 254) return res.status(400).json({ success: false, message: 'Name or email is too long.' });
    if (password.length < 8 || password.length > 256) return res.status(400).json({ success: false, message: 'Password must contain 8 to 256 characters.' });
    const normalizedEmail = email.trim().toLowerCase();
    if (await findUserByEmail(normalizedEmail)) return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    const { salt, hash } = hashPassword(password);
    const inputer = await insertUser({
      id: crypto.randomUUID(), name: name.trim(), email: normalizedEmail,
      passwordHash: hash, salt, role: 'inputer', twoFactorEnabled: false,
      twoFactorSecret: null, pendingTwoFactorSecret: null, createdAt: new Date().toISOString(),
    });
    return res.status(201).json({ success: true, user: publicUser(inputer) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    console.error('Inputer creation error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while creating inputer.' });
  }
});

app.delete('/api/admin/inputers/:id', authenticate, async (req, res) => {
  if (!['admin', 'administrator'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access is required to remove an inputer.' });
  try {
    const target = await findUserById(req.params.id);
    if (!target || target.role !== 'inputer') return res.status(404).json({ success: false, message: 'Inputer account not found.' });
    await removeUser(target.id);
    return res.json({ success: true, message: 'Inputer account removed.' });
  } catch (error) {
    console.error('Inputer deletion error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while removing inputer.' });
  }
});

app.patch('/api/admin/users/:id/role', authenticate, async (req, res) => {
  if (req.user.role !== 'administrator') return res.status(403).json({ success: false, message: 'Administrator access is required to change roles.' });
  const allowedRoles = ['inputer', 'manager', 'admin'];
  const nextRole = req.body.role;
  if (!allowedRoles.includes(nextRole)) return res.status(400).json({ success: false, message: 'Choose inputer, manager or admin.' });
  try {
    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User account not found.' });
    user.role = nextRole;
    const updated = await updateUser(user);
    return res.json({ success: true, user: publicUser(updated) });
  } catch (error) {
    console.error('Role update error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while updating role.' });
  }
});

async function startServer() {
  // This also confirms the schema is present and the server key can access it.
  await usersRequest('GET', { select: 'id', limit: '1' });
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
    if (!await findUserByEmail(adminEmail)) {
      if (!adminEmail || process.env.ADMIN_PASSWORD.length < 12) {
        throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must contain at least 12 characters when creating the initial administrator.');
      }
      const { salt, hash } = hashPassword(process.env.ADMIN_PASSWORD);
      await insertUser({
        id: crypto.randomUUID(), name: 'SecureAuth Administrator', email: adminEmail,
        passwordHash: hash, salt, role: 'administrator', twoFactorEnabled: false,
        twoFactorSecret: null, pendingTwoFactorSecret: null, createdAt: new Date().toISOString(),
      });
    }
  }
  app.listen(PORT, () => console.log(`SecureAuth server connected to Supabase and running on port ${PORT}`));
}

startServer().catch((error) => {
  console.error('Could not connect to Supabase or initialize the administrator:', error.message);
  process.exit(1);
});
