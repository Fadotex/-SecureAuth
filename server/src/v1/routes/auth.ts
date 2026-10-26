import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { z } from 'zod';
import { Role, RoleProfile } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { decryptSecret, encryptSecret, hashToken, newOpaqueToken } from '../services/crypto.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { enqueueEmail } from '../services/email.js';

export const authRouter = Router();
const ACCESS_COOKIE = 'hostel_access';
const REFRESH_COOKIE = 'hostel_refresh';
const MFA_ENROLLMENT_ROLES = new Set<Role>([Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF]);
const REQUIRED_MFA_ROLES = new Set<Role>([Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR]);
const refreshDays = 30;
const accessMs = 15 * 60 * 1000;

export function isLoopbackAddress(address: string | undefined) {
  return address === '127.0.0.1' || address === '::1' || address?.startsWith('::ffff:127.') === true;
}

const cookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'strict' as const,
  path: '/',
};

const publicUser = (user: { id: string; email: string; fullName: string; role: Role; roleProfile: string; mustChangePassword: boolean; twoFactorEnabled: boolean }) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
  roleProfile: user.roleProfile,
  mustChangePassword: user.mustChangePassword,
  twoFactorEnabled: user.twoFactorEnabled,
});

function setSessionCookies(res: Response, access: string, refresh: string) {
  res.cookie(ACCESS_COOKIE, access, { ...cookieOptions, maxAge: accessMs });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieOptions, maxAge: refreshDays * 24 * 60 * 60 * 1000 });
}

function isNativeClient(req: Request) {
  return req.get('x-hostel-client') === 'expo-native' && !req.get('origin');
}

export function getLogoutSubject(accessToken: string | undefined) {
  if (!accessToken) return null;
  try {
    const claims = jwt.verify(accessToken, config.ACCESS_TOKEN_SECRET, { issuer: 'hostel-api' });
    if (typeof claims === 'string' || claims.type !== 'access' || typeof claims.sub !== 'string') return null;
    return claims.sub;
  } catch {
    return null;
  }
}

function nativeSessionTokens(req: Request, session: { access: string; refresh: string }) {
  return isNativeClient(req)
    ? { accessToken: session.access, refreshToken: session.refresh }
    : {};
}

function createMfaChallenge(userId: string, type: 'mfa' | 'mfa_enrollment') {
  return jwt.sign({ type, sub: userId }, config.ACCESS_TOKEN_SECRET, {
    expiresIn: '5m',
    issuer: 'hostel-api',
    audience: 'hostel-mfa',
  });
}

async function verifyTotpAndConsumeStep(userId: string, secret: string, code: string) {
  const verification = verifySync({ token: code, secret, epochTolerance: 30 });
  if (!verification.valid || !('timeStep' in verification)) return false;
  const consumed = await prisma.user.updateMany({
    where: {
      id: userId,
      isActive: true,
      twoFactorEnabled: true,
      OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: verification.timeStep } }],
    },
    data: { lastTotpStep: verification.timeStep },
  });
  return consumed.count === 1;
}

async function recordFailedMfa(userId: string, ipAddress: string | undefined) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (user.failedLoginCount >= config.LOGIN_MAX_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
    });
  }
  await writeAudit({ actorId: userId, action: 'mfa_verification_failed', entityType: 'User', entityId: userId, ipAddress });
}

async function createSession(user: { id: string; email: string; role: Role; sessionVersion: number }, familyId = randomUUID()) {
  const access = jwt.sign(
    { email: user.email, role: user.role, type: 'access', sv: user.sessionVersion },
    config.ACCESS_TOKEN_SECRET,
    { subject: user.id, expiresIn: '15m', issuer: 'hostel-api' },
  );
  const refresh = newOpaqueToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId,
      tokenHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000),
    },
  });
  return { access, refresh };
}

authRouter.post('/register', async (req, res) => {
  const administrator = await prisma.user.findFirst({
    where: { role: Role.ADMINISTRATOR, roleProfile: RoleProfile.TARGET, isActive: true },
    select: { id: true },
  });
  if (!administrator) return res.status(503).json({ error: 'Registration is unavailable until the first Administrator has been provisioned.' });

  const input = z.object({
    studentId: z.string().trim().min(1).max(40),
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(7).max(32),
    guardianName: z.string().trim().min(2).max(120),
    guardianPhone: z.string().trim().min(7).max(32),
    gender: z.enum(['MALE', 'FEMALE']),
    password: z.string().min(12).max(128),
    consent: z.literal(true),
  }).parse(req.body);
  const email = input.email.toLowerCase();
  const verifyToken = newOpaqueToken();
  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        fullName: input.fullName,
        phone: input.phone,
        passwordHash,
        role: Role.STUDENT,
        studentProfile: {
          create: {
            studentId: input.studentId,
            gender: input.gender,
            guardianName: input.guardianName,
            guardianPhone: input.guardianPhone,
            consentAt: new Date(),
          },
        },
      },
    });
    await tx.emailVerificationToken.create({
      data: {
        userId: created.id,
        tokenHash: hashToken(verifyToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    await enqueueEmail({
      userId: created.id,
      toEmail: email,
      template: 'verify-email',
      payload: { name: input.fullName, url: `${config.APP_BASE_URL}/verify-email?token=${encodeURIComponent(verifyToken)}` },
    }, tx);
    await writeAudit({ actorId: created.id, action: 'student_registered', entityType: 'User', entityId: created.id, ipAddress: req.ip }, tx);
    return created;
  });

  res.status(201).json({ message: 'Account created. Check your email to verify it before signing in.', user: publicUser(user) });
});

authRouter.post('/verify-email', async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
  const tokenHash = hashToken(token);
  const verification = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!verification || verification.usedAt || verification.expiresAt <= new Date()) {
    return res.status(400).json({ error: 'Verification link is invalid or expired.' });
  }
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.emailVerificationToken.updateMany({ where: { id: verification.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) throw Object.assign(new Error('Verification link is invalid or expired.'), { status: 400 });
    await tx.user.update({ where: { id: verification.userId }, data: { emailVerifiedAt: new Date() } });
  });
  return res.json({ message: 'Email verified. You can sign in now.' });
});

authRouter.get('/dev/email-verification-link', async (req, res) => {
  if (config.NODE_ENV !== 'development' || !isLoopbackAddress(req.socket.remoteAddress)) {
    return res.status(404).json({ error: 'Route not found.' });
  }
  const { email } = z.object({ email: z.string().trim().email().max(254) }).parse(req.query);
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) return res.status(404).json({ error: 'No pending verification is available.' });

  const jobs = await prisma.emailJob.findMany({
    where: { userId: user.id, template: 'verify-email' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { payload: true },
  });
  const expectedOrigin = new URL(config.APP_BASE_URL).origin;
  for (const job of jobs) {
    if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) continue;
    const candidate = (job.payload as Record<string, unknown>).url;
    if (typeof candidate !== 'string') continue;
    let verificationUrl: URL;
    try {
      verificationUrl = new URL(candidate);
    } catch {
      continue;
    }
    if (verificationUrl.origin !== expectedOrigin || verificationUrl.pathname !== '/verify-email') continue;
    const token = verificationUrl.searchParams.get('token');
    if (!token) continue;
    const pendingToken = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id, tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!pendingToken) continue;

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.json({ url: verificationUrl.toString() });
  }
  return res.status(404).json({ error: 'No pending verification is available.' });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).parse(req.body);
  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (!user.isActive) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
  const passwordCheck = await verifyPassword(password, user.passwordHash);
  if (!passwordCheck.valid) {
    const failedAttempt = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedAttempt.failedLoginCount >= config.LOGIN_MAX_ATTEMPTS) {
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } });
    }
    await writeAudit({ actorId: user.id, action: 'login_failed', entityType: 'User', entityId: user.id, ipAddress: req.ip });
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (passwordCheck.needsRehash) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }
  if (!user.emailVerifiedAt && user.role === Role.STUDENT) return res.status(403).json({ error: 'Verify your email before signing in.' });
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

  if (user.twoFactorEnabled && user.twoFactorSecretEncrypted) {
    const challenge = createMfaChallenge(user.id, 'mfa');
    return res.json({ twoFactorRequired: true, challenge });
  }
  if (user.roleProfile === RoleProfile.TARGET && REQUIRED_MFA_ROLES.has(user.role)) {
    const challenge = createMfaChallenge(user.id, 'mfa_enrollment');
    return res.json({ mfaEnrollmentRequired: true, challenge, user: { email: user.email, role: user.role } });
  }

  const session = await createSession(user);
  setSessionCookies(res, session.access, session.refresh);
  await writeAudit({ actorId: user.id, action: 'login_succeeded', entityType: 'User', entityId: user.id, ipAddress: req.ip });
  return res.json({ user: publicUser(user), mustChangePassword: user.mustChangePassword, ...nativeSessionTokens(req, session) });
});

authRouter.post('/login/2fa', async (req, res) => {
  const { challenge, code } = z.object({ challenge: z.string().min(20), code: z.string().regex(/^(?:\d{6}|[A-Za-z0-9_-]{16})$/) }).parse(req.body);
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(challenge, config.ACCESS_TOKEN_SECRET, { issuer: 'hostel-api', audience: 'hostel-mfa' }) as jwt.JwtPayload;
  } catch {
    return res.status(401).json({ error: 'Two-Factor Authentication (2FA) challenge expired. Sign in again.' });
  }
  if (claims.type !== 'mfa' || typeof claims.sub !== 'string') return res.status(401).json({ error: 'Invalid two-factor challenge.' });
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user?.isActive || (user.lockedUntil && user.lockedUntil > new Date())) return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
  if (!user.twoFactorEnabled || !user.twoFactorSecretEncrypted) return res.status(401).json({ error: 'Two-Factor Authentication (2FA) is not configured.' });
  let verified = false;
  if (/^\d{6}$/.test(code)) {
    verified = await verifyTotpAndConsumeStep(user.id, decryptSecret(user.twoFactorSecretEncrypted), code);
  } else {
    const recovery = await prisma.recoveryCode.findUnique({ where: { codeHash: hashToken(code) } });
    if (recovery && recovery.userId === user.id && !recovery.usedAt) {
      const consumed = await prisma.recoveryCode.updateMany({ where: { id: recovery.id, usedAt: null }, data: { usedAt: new Date() } });
      verified = consumed.count === 1;
    }
  }
  if (!verified) {
    await recordFailedMfa(user.id, req.ip);
    return res.status(401).json({ error: 'Authenticator or recovery code is invalid, expired, or already used.' });
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const session = await createSession(user);
  setSessionCookies(res, session.access, session.refresh);
  await writeAudit({ actorId: user.id, action: 'mfa_login_succeeded', entityType: 'User', entityId: user.id, ipAddress: req.ip });
  return res.json({ user: publicUser(user), mustChangePassword: user.mustChangePassword, ...nativeSessionTokens(req, session) });
});

authRouter.post('/2fa/enroll/setup', async (req, res) => {
  const { challenge } = z.object({ challenge: z.string().min(20).max(2048) }).parse(req.body);
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(challenge, config.ACCESS_TOKEN_SECRET, { issuer: 'hostel-api', audience: 'hostel-mfa' }) as jwt.JwtPayload;
  } catch {
    return res.status(401).json({ error: 'Enrollment challenge expired. Sign in again.' });
  }
  if (claims.type !== 'mfa_enrollment' || typeof claims.sub !== 'string') return res.status(401).json({ error: 'Invalid Two-Factor Authentication (2FA) enrollment challenge.' });
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user?.isActive || user.roleProfile !== RoleProfile.TARGET || !REQUIRED_MFA_ROLES.has(user.role) || user.twoFactorEnabled) return res.status(403).json({ error: 'Two-Factor Authentication (2FA) enrollment is not available for this account.' });
  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecretEncrypted: encryptSecret(secret) } });
  await writeAudit({ actorId: user.id, action: 'mfa_enrollment_started', entityType: 'User', entityId: user.id, ipAddress: req.ip });
  return res.json({ secret, otpauth: generateURI({ issuer: 'SecureAuth Hostel', label: user.email, secret }) });
});

authRouter.post('/2fa/enroll/verify', async (req, res) => {
  const { challenge, code } = z.object({ challenge: z.string().min(20).max(2048), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(challenge, config.ACCESS_TOKEN_SECRET, { issuer: 'hostel-api', audience: 'hostel-mfa' }) as jwt.JwtPayload;
  } catch {
    return res.status(401).json({ error: 'Enrollment challenge expired. Sign in again.' });
  }
  if (claims.type !== 'mfa_enrollment' || typeof claims.sub !== 'string') return res.status(401).json({ error: 'Invalid Two-Factor Authentication (2FA) enrollment challenge.' });
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user?.isActive || user.roleProfile !== RoleProfile.TARGET || !REQUIRED_MFA_ROLES.has(user.role) || user.twoFactorEnabled || !user.twoFactorSecretEncrypted) {
    return res.status(403).json({ error: 'Two-Factor Authentication (2FA) enrollment is not available for this account.' });
  }
  const secret = decryptSecret(user.twoFactorSecretEncrypted);
  const verification = verifySync({ token: code, secret, epochTolerance: 30 });
  if (!verification.valid || !('timeStep' in verification)) {
    await recordFailedMfa(user.id, req.ip);
    return res.status(401).json({ error: 'Authenticator code is invalid or expired.' });
  }
  const recoveryCodes = Array.from({ length: 10 }, () => newOpaqueToken().slice(0, 16));
  await prisma.$transaction(async (tx) => {
    const activated = await tx.user.updateMany({
      where: { id: user.id, isActive: true, twoFactorEnabled: false, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: verification.timeStep } }] },
      data: { twoFactorEnabled: true, lastTotpStep: verification.timeStep, failedLoginCount: 0, lockedUntil: null },
    });
    if (activated.count !== 1) throw Object.assign(new Error('This authenticator code has already been used.'), { status: 409 });
    await tx.recoveryCode.createMany({ data: recoveryCodes.map((recoveryCode) => ({ userId: user.id, codeHash: hashToken(recoveryCode) })) });
    await writeAudit({ actorId: user.id, action: 'mfa_enrollment_completed', entityType: 'User', entityId: user.id, ipAddress: req.ip }, tx);
  });
  const session = await createSession(user);
  setSessionCookies(res, session.access, session.refresh);
  return res.json({ user: { ...publicUser(user), twoFactorEnabled: true }, recoveryCodes, ...nativeSessionTokens(req, session) });
});

authRouter.post('/refresh', async (req, res) => {
  const nativeClient = isNativeClient(req);
  const nativeRefresh = nativeClient
    ? z.object({ refreshToken: z.string().min(20).max(200) }).safeParse(req.body)
    : null;
  if (nativeRefresh && !nativeRefresh.success) return res.status(401).json({ error: 'Refresh session is missing or invalid.' });
  const rawToken = nativeRefresh?.success
    ? nativeRefresh.data.refreshToken
    : req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!rawToken) return res.status(401).json({ error: 'Refresh session is missing.' });
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) return res.status(401).json({ error: 'Refresh session is invalid.' });
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    return res.status(401).json({ error: 'Refresh token reuse detected. Sign in again.' });
  }
  if (existing.expiresAt <= new Date()) return res.status(401).json({ error: 'Refresh session expired.' });

  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user?.isActive) {
    await prisma.refreshToken.updateMany({ where: { userId: existing.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return res.status(401).json({ error: 'Account is no longer active.' });
  }
  const nextRefresh = newOpaqueToken();
  const nextRefreshId = randomUUID();
  const access = jwt.sign({ email: user.email, role: user.role, type: 'access', sv: user.sessionVersion }, config.ACCESS_TOKEN_SECRET, { subject: user.id, expiresIn: '15m', issuer: 'hostel-api' });
  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.create({ data: { id: nextRefreshId, userId: user.id, familyId: existing.familyId, tokenHash: hashToken(nextRefresh), expiresAt: new Date(Date.now() + refreshDays * 86400000) } });
    const revoked = await tx.refreshToken.updateMany({ where: { id: existing.id, revokedAt: null }, data: { revokedAt: new Date(), replacedBy: nextRefreshId } });
    if (revoked.count !== 1) throw Object.assign(new Error('Refresh session already used. Sign in again.'), { status: 401 });
  });
  setSessionCookies(res, access, nextRefresh);
  return res.json({
    user: publicUser(user),
    mustChangePassword: user.mustChangePassword,
    ...(nativeClient ? { accessToken: access, refreshToken: nextRefresh } : {}),
  });
});

authRouter.post('/logout', async (req, res) => {
  const nativeClient = isNativeClient(req);
  const nativeRefresh = nativeClient
    ? z.object({ refreshToken: z.string().min(20).max(200) }).safeParse(req.body)
    : null;
  const rawToken = nativeRefresh?.success
    ? nativeRefresh.data.refreshToken
    : req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const refreshSession = rawToken
    ? await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, select: { userId: true } })
    : null;
  const accessToken = req.cookies?.[ACCESS_COOKIE] as string | undefined
    ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
  const userId = refreshSession?.userId ?? getLogoutSubject(accessToken);

  if (userId) {
    await prisma.$transaction(async (tx) => {
      const invalidated = await tx.user.updateMany({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (invalidated.count === 1) {
        await writeAudit({ actorId: userId, action: 'logout_succeeded', entityType: 'User', entityId: userId, ipAddress: req.ip }, tx);
      }
    });
  } else if (rawToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  return res.status(204).end();
});

authRouter.post('/forgot-password', async (req, res) => {
  const { email } = z.object({ email: z.string().email().max(254) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user) {
    const token = newOpaqueToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    await enqueueEmail({ userId: user.id, toEmail: user.email, template: 'password-reset', payload: { name: user.fullName, url: `${config.APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}` } });
  }
  return res.json({ message: 'If that account exists, a reset link has been sent.' });
});

authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(20).max(200), password: z.string().min(12).max(128) }).parse(req.body);
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) return res.status(400).json({ error: 'Reset link is invalid or expired.' });
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) throw Object.assign(new Error('Reset link is invalid or expired.'), { status: 400 });
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null, sessionVersion: { increment: 1 } } });
    await tx.refreshToken.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({ actorId: reset.userId, action: 'password_reset_completed', entityType: 'User', entityId: reset.userId, ipAddress: req.ip }, tx);
  });
  return res.json({ message: 'Password updated. Sign in with your new password.' });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, password } = z.object({ currentPassword: z.string().min(1), password: z.string().min(12).max(128) }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const currentPasswordCheck = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentPasswordCheck.valid) return res.status(400).json({ error: 'Current password is incorrect.' });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: false, sessionVersion: { increment: 1 } } });
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({ actorId: user.id, action: 'password_changed', entityType: 'User', entityId: user.id, ipAddress: req.ip }, tx);
  });
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  return res.json({ message: 'Password changed.' });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth!.userId },
    include: { studentProfile: { select: { id: true, studentId: true, gender: true } } },
  });
  return res.json({ user: { ...publicUser(user), student: user.studentProfile } });
});

authRouter.post('/2fa/setup', requireAuth, async (req, res) => {
  if (!MFA_ENROLLMENT_ROLES.has(req.auth!.role)) return res.status(403).json({ error: 'Two-Factor Authentication (2FA) setup is only available to staff.' });
  if (req.auth!.roleProfile === RoleProfile.TARGET || req.auth!.role === Role.ADMINISTRATOR) {
    return res.status(403).json({ error: 'Target-role Two-Factor Authentication (2FA) reset is not available through this endpoint.' });
  }
  const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (currentUser.twoFactorEnabled) return res.status(409).json({ error: 'Authenticator is already enabled. Contact an administrator for recovery.' });
  const secret = generateSecret();
  await prisma.user.update({ where: { id: req.auth!.userId }, data: { twoFactorSecretEncrypted: encryptSecret(secret), twoFactorEnabled: false } });
  await writeAudit({ actorId: req.auth!.userId, action: 'mfa_enrollment_started', entityType: 'User', entityId: req.auth!.userId, ipAddress: req.ip });
  return res.json({ secret, otpauth: generateURI({ issuer: 'Hostel Management', label: req.auth!.email, secret }) });
});

authRouter.post('/2fa/enable', requireAuth, async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (user.roleProfile === RoleProfile.TARGET || user.role === Role.ADMINISTRATOR) return res.status(403).json({ error: 'Target-role Two-Factor Authentication (2FA) is managed through the mandatory enrollment and recovery flow.' });
  if (!MFA_ENROLLMENT_ROLES.has(user.role) || user.twoFactorEnabled || !user.twoFactorSecretEncrypted) return res.status(400).json({ error: 'Set up an authenticator first.' });
  const verification = verifySync({ token: code, secret: decryptSecret(user.twoFactorSecretEncrypted), epochTolerance: 30 });
  if (!verification.valid || !('timeStep' in verification)) return res.status(400).json({ error: 'Authenticator code is invalid or expired.' });
  await prisma.$transaction(async (tx) => {
    const enabled = await tx.user.updateMany({
      where: { id: user.id, isActive: true, twoFactorEnabled: false, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: verification.timeStep } }] },
      data: { twoFactorEnabled: true, lastTotpStep: verification.timeStep, sessionVersion: { increment: 1 } },
    });
    if (enabled.count !== 1) throw Object.assign(new Error('Authenticator code has already been used or the account has changed.'), { status: 409 });
    await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({ actorId: user.id, action: 'mfa_enrollment_completed', entityType: 'User', entityId: user.id, ipAddress: req.ip }, tx);
  });
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  return res.json({ message: 'Two-Factor Authentication (2FA) enabled.' });
});