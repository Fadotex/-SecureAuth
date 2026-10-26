import { Role, RoleProfile } from '@prisma/client';

export type LegacyStudentMappingCandidate = {
  role: Role;
  roleProfile: RoleProfile;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  hasStudentProfile: boolean;
};

export function isEligibleLegacyStudentMapping(candidate: LegacyStudentMappingCandidate) {
  return candidate.role === Role.STUDENT
    && candidate.roleProfile === RoleProfile.LEGACY
    && candidate.isActive
    && candidate.emailVerifiedAt !== null
    && candidate.hasStudentProfile;
}
