import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role, RoleProfile } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';

const targetRoles = new Set<Role>([Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STUDENT]);

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.hostel_access as string | undefined;
  const bearerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ error: 'Sign in is required.' });

  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(token, config.ACCESS_TOKEN_SECRET, { issuer: 'hostel-api' }) as jwt.JwtPayload;
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
  if (claims.type !== 'access' || typeof claims.sub !== 'string' || typeof claims.email !== 'string' || !Number.isInteger(claims.sv)) {
    return res.status(401).json({ error: 'Invalid access token.' });
  }
  const currentUser = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, role: true, roleProfile: true, isActive: true, mustChangePassword: true, permissions: true, sessionVersion: true } });
  if (!currentUser?.isActive || !Object.values(Role).includes(currentUser.role)) return res.status(401).json({ error: 'Account is no longer active.' });
  if (claims.sv !== currentUser.sessionVersion) return res.status(401).json({ error: 'Your session has been revoked. Sign in again.' });
  const permissions = Array.isArray(currentUser.permissions) ? currentUser.permissions.filter((permission): permission is string => typeof permission === 'string') : [];
  req.auth = { userId: currentUser.id, email: currentUser.email, role: currentUser.role, roleProfile: currentUser.roleProfile, mustChangePassword: currentUser.mustChangePassword, permissions };
  if (currentUser.mustChangePassword && !['/me', '/change-password'].includes(req.path)) {
    return res.status(403).json({ error: 'Change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  return next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Sign in is required.' });
    if (!canAccessRole(req.auth.role, req.auth.roleProfile, roles)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    return next();
  };
}

export function canAccessRole(role: Role, roleProfile: RoleProfile, allowedRoles: readonly Role[]) {
  return allowedRoles.includes(role) && (!targetRoles.has(role) || roleProfile === RoleProfile.TARGET);
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Sign in is required.' });
    if (!hasPermission(req.auth.role, req.auth.permissions, permission)) {
      return res.status(403).json({ error: `Missing permission: ${permission}.` });
    }
    return next();
  };
}

const rolePermissions: Partial<Record<Role, readonly string[]>> = {
  [Role.INPUTER]: ['students:read', 'hostel:records:write', 'notices:read'],
  [Role.MANAGER]: ['students:read', 'payments:manual', 'residents:check-in', 'maintenance:manage', 'visitors:manage', 'notices:read', 'room-changes:manage', 'hostel:manage', 'hostel:records:write', 'inputers:create'],
  [Role.ADMIN]: ['students:read', 'payments:manual', 'residents:check-in', 'maintenance:manage', 'visitors:manage', 'notices:read', 'room-changes:manage', 'hostel:manage', 'hostel:records:write', 'inputers:deactivate'],
  [Role.ADMINISTRATOR]: ['*'],
  [Role.STUDENT]: ['maintenance:manage', 'notices:read'],
};

export function hasPermission(role: Role, assignedPermissions: readonly string[], permission: string) {
  const permissions = rolePermissions[role];
  if (permissions) return permissions.includes('*') || permissions.includes(permission);
  return assignedPermissions.includes(permission);
}