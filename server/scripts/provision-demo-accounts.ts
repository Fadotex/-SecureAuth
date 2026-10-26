import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Role, RoleProfile } from '@prisma/client';
import { config } from '../src/v1/config.js';
import { prisma } from '../src/v1/db.js';
import { writeAudit } from '../src/v1/services/audit.js';
import { createFirstAdministrator } from '../src/v1/services/first-administrator.js';
import { hashPassword } from '../src/v1/services/password.js';

const demoAccounts = [
  { email: 'inputer.demo@secureauth.local', fullName: 'SecureAuth Local Demo - Inputer', role: Role.INPUTER },
  { email: 'manager.demo@secureauth.local', fullName: 'SecureAuth Local Demo - Manager', role: Role.MANAGER },
  { email: 'admin.demo@secureauth.local', fullName: 'SecureAuth Local Demo - Admin', role: Role.ADMIN },
  { email: 'administrator.demo@secureauth.local', fullName: 'SecureAuth Local Demo - Administrator', role: Role.ADMINISTRATOR },
] as const;

const protectCredentialBundle = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$clearBytes = [Text.Encoding]::UTF8.GetBytes(($inputData.credentials | ConvertTo-Json -Depth 5 -Compress))
$protectedBytes = [Security.Cryptography.ProtectedData]::Protect($clearBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$directory = [IO.Path]::GetDirectoryName($inputData.path)
[IO.Directory]::CreateDirectory($directory) | Out-Null
[IO.File]::WriteAllBytes($inputData.path, $protectedBytes)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
$acl.AddAccessRule($rule)
[IO.File]::SetAccessControl($inputData.path, $acl)
[Console]::Out.WriteLine('Credential handoff protected for the current Windows user.')
`;

function randomTemporaryPassword() {
  return randomBytes(24).toString('base64url');
}

function validateTarget() {
  if (process.env.NODE_ENV !== 'development' || config.NODE_ENV !== 'development') {
    throw new Error('Demo provisioning is allowed only when NODE_ENV is explicitly set to development.');
  }
  const url = new URL(config.DATABASE_URL);
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (!isLoopback || url.port !== '5432' || url.pathname !== '/secureauth' ||
      decodeURIComponent(url.username) !== 'secureauth_app' || url.searchParams.get('schema') !== 'secureauth_app') {
    throw new Error('Refusing demo provisioning: DATABASE_URL is not the approved local secureauth_app target.');
  }
}

function saveCredentialBundle(credentials: Array<{ email: string; role: Role; password: string }>) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('LOCALAPPDATA is unavailable; cannot create a protected local credential handoff.');
  const directory = join(localAppData, 'SecureAuth');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `demo-credentials-${new Date().toISOString().replace(/[:.]/g, '-')}.dpapi`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', protectCredentialBundle], {
    input: JSON.stringify({ path, credentials }),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not protect the local demo credential handoff${result.stderr ? `: ${result.stderr.trim()}` : '.'}`);
  }
  return path;
}

async function main() {
  validateTarget();

  const [identity] = await prisma.$queryRaw<Array<{ db: string; db_user: string; active_schema: string }>>`
    SELECT current_database() AS db, current_user AS db_user, current_schema() AS active_schema
  `;
  if (identity.db !== 'secureauth' || identity.db_user !== 'secureauth_app' || identity.active_schema !== 'secureauth_app') {
    throw new Error('Refusing demo provisioning: live database identity does not match the approved local target.');
  }

  const [migrationState] = await prisma.$queryRaw<Array<{ applied: bigint }>>`
    SELECT count(*) AS applied FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  if (Number(migrationState.applied) !== 2) throw new Error('Expected both reviewed local migrations to be applied; no accounts were created.');

  const existing = await prisma.user.findMany({
    where: { email: { in: demoAccounts.map((account) => account.email) } },
    select: { id: true, email: true, role: true, roleProfile: true, isActive: true },
  });
  const existingByEmail = new Map(existing.map((user) => [user.email, user]));
  for (const account of demoAccounts) {
    const user = existingByEmail.get(account.email);
    if (user && (user.role !== account.role || user.roleProfile !== RoleProfile.TARGET || !user.isActive)) {
      throw new Error(`Refusing to change existing account ${account.email}; its role/profile/state needs administrator review.`);
    }
  }

  const missing = demoAccounts.filter((account) => !existingByEmail.has(account.email));
  if (missing.length === 0) {
    console.info('All four demo accounts already exist and are active with the expected target roles. No changes made; existing passwords were not reset.');
    return;
  }

  const totalUsers = await prisma.user.count();
  const hasActiveAdministrator = await prisma.user.count({
    where: { role: Role.ADMINISTRATOR, roleProfile: RoleProfile.TARGET, isActive: true },
  });
  if (totalUsers > 0 && hasActiveAdministrator === 0) {
    throw new Error('No active target Administrator exists. Run the approved provision:first-admin process before creating demo accounts.');
  }

  const generated = missing.map((account) => ({ ...account, password: randomTemporaryPassword() }));
  const handoffPath = saveCredentialBundle(generated.map(({ email, role, password }) => ({ email, role, password })));
  try {
    const creationOrder = totalUsers === 0
      ? [...generated].sort((left, right) => Number(right.role === Role.ADMINISTRATOR) - Number(left.role === Role.ADMINISTRATOR))
      : generated;
    await prisma.$transaction(async (tx) => {
      for (const account of creationOrder) {
        const passwordHash = await hashPassword(account.password);
        if (account.role === Role.ADMINISTRATOR && totalUsers === 0) {
          await createFirstAdministrator(tx, {
            fullName: account.fullName,
            email: account.email,
            passwordHash,
            mustChangePassword: true,
          });
          continue;
        }

        const user = await tx.user.create({
          data: {
            fullName: account.fullName,
            email: account.email,
            passwordHash,
            role: account.role,
            roleProfile: RoleProfile.TARGET,
            emailVerifiedAt: new Date(),
            mustChangePassword: true,
          },
          select: { id: true, email: true },
        });
        await writeAudit({
          actorId: user.id,
          action: 'development_demo_account_created',
          entityType: 'User',
          entityId: user.id,
          metadata: { email: user.email, role: account.role, environment: 'development' },
        }, tx);
      }
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    rmSync(handoffPath, { force: true });
    throw error;
  }

  console.info(`Created ${generated.length} missing local demo account(s). Each is TARGET-profile, must change its temporary password, and must complete MFA enrollment.`);
  console.info(`Credentials were encrypted with Windows DPAPI for this Windows user: ${handoffPath}`);
  console.info('After provisioning, run npm.cmd run demo:show-passwords in this same Windows user account to display them locally.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Demo account provisioning failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
