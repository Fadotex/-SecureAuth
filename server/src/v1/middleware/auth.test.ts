import { describe, expect, it } from 'vitest';
import { Role, RoleProfile } from '@prisma/client';
import { canAccessRole, hasPermission } from './auth.js';

describe('role profile authorization', () => {
  it('does not treat a legacy ADMIN account as the target ADMIN role', () => {
    expect(canAccessRole(Role.ADMIN, RoleProfile.LEGACY, [Role.ADMIN])).toBe(false);
  });

  it('allows a target role only after an explicit target-profile assignment', () => {
    expect(canAccessRole(Role.ADMIN, RoleProfile.TARGET, [Role.ADMIN])).toBe(true);
    expect(canAccessRole(Role.MANAGER, RoleProfile.TARGET, [Role.ADMIN])).toBe(false);
    expect(canAccessRole(Role.STUDENT, RoleProfile.LEGACY, [Role.STUDENT])).toBe(false);
    expect(canAccessRole(Role.STUDENT, RoleProfile.TARGET, [Role.STUDENT])).toBe(true);
  });

  it('preserves legacy access for legacy-only roles', () => {
    expect(canAccessRole(Role.STAFF, RoleProfile.LEGACY, [Role.STAFF])).toBe(true);
  });

  it('enforces the target role permission matrix instead of caller-supplied grants', () => {
    expect(hasPermission(Role.INPUTER, [], 'hostel:records:write')).toBe(true);
    expect(hasPermission(Role.INPUTER, ['inputers:create', '*'], 'inputers:create')).toBe(false);
    expect(hasPermission(Role.MANAGER, [], 'inputers:create')).toBe(true);
    expect(hasPermission(Role.MANAGER, [], 'inputers:deactivate')).toBe(false);
    expect(hasPermission(Role.ADMIN, [], 'inputers:deactivate')).toBe(true);
    expect(hasPermission(Role.ADMIN, [], 'system:roles:manage')).toBe(false);
    expect(hasPermission(Role.ADMINISTRATOR, [], 'system:roles:manage')).toBe(true);
    expect(hasPermission(Role.STUDENT, [], 'notices:read')).toBe(true);
    expect(hasPermission(Role.STUDENT, [], 'hostel:manage')).toBe(false);
  });
});
