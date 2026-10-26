import type { Role, RoleProfile } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: Role;
        roleProfile: RoleProfile;
        email: string;
        mustChangePassword: boolean;
        permissions: string[];
      };
    }
  }
}

export {};