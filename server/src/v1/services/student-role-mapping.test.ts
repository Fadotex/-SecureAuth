import { describe, expect, it } from 'vitest';
import { Role, RoleProfile } from '@prisma/client';
import { isEligibleLegacyStudentMapping } from './student-role-mapping.js';

describe('explicit student portal mapping eligibility', () => {
  const eligible = {
    role: Role.STUDENT,
    roleProfile: RoleProfile.LEGACY,
    isActive: true,
    emailVerifiedAt: new Date(),
    hasStudentProfile: true,
  };

  it('accepts an active, verified legacy student with a student profile', () => {
    expect(isEligibleLegacyStudentMapping(eligible)).toBe(true);
  });

  it.each([
    { role: Role.INPUTER },
    { roleProfile: RoleProfile.TARGET },
    { isActive: false },
    { emailVerifiedAt: null },
    { hasStudentProfile: false },
  ])('rejects an ineligible mapping candidate', (override) => {
    expect(isEligibleLegacyStudentMapping({ ...eligible, ...override })).toBe(false);
  });
});
