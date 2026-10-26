import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Role, RoleProfile } from '@prisma/client';
import { config } from '../src/v1/config.js';
import { prisma } from '../src/v1/db.js';
import { writeAudit } from '../src/v1/services/audit.js';
import { hashPassword } from '../src/v1/services/password.js';

const demoAccounts = [
  { email: 'inputer.demo@secureauth.local', role: Role.INPUTER },
  { email: 'manager.demo@secureauth.local', role: Role.MANAGER },
  { email: 'admin.demo@secureauth.local', role: Role.ADMIN },
  { email: 'administrator.demo@secureauth.local', role: Role.ADMINISTRATOR },
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

function validateTarget() {
  if (process.env.NODE_ENV !== 'development' || config.NODE_ENV !== 'development') {
    throw new Error('Demo password rotation is allowed only when NODE_ENV is explicitly set to development.');
  }
  const url = new URL(config.DATABASE_URL);
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (!isLoopback || url.port !== '5432' || url.pathname !== '/secureauth' ||
      decodeURIComponent(url.username) !== 'secureauth_app' || url.searchParams.get('schema') !== 'secureauth_app') {
    throw new Error('Refusing demo password rotation: DATABASE_URL is not the approved local secureauth_app target.');
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
    throw new Error('Refusing demo password rotation: live database identity does not match the approved local target.');
  }

  const accounts = await prisma.user.findMany({
    where: { email: { in: demoAccounts.map((account) => account.email) } },
    select: { id: true, email: true, role: true, roleProfile: true, isActive: true },
  });
  const accountsByEmail = new Map(accounts.map((account) => [account.email, account]));
  for (const expected of demoAccounts) {
    const account = accountsByEmail.get(expected.email);
    if (!account || account.role !== expected.role || account.roleProfile !== RoleProfile.TARGET || !account.isActive) {
      throw new Error(`Refusing password rotation: ${expected.email} is missing or is not an active TARGET ${expected.role} account.`);
    }
  }
  if (accounts.length !== demoAccounts.length) {
    throw new Error('Refusing password rotation: unexpected demo account records were returned.');
  }

  const credentials = demoAccounts.map((account) => ({
    ...account,
    password: randomBytes(24).toString('base64url'),
  }));
  const handoffPath = saveCredentialBundle(credentials);
  try {
    await prisma.$transaction(async (tx) => {
      for (const credential of credentials) {
        const account = accountsByEmail.get(credential.email)!;
        await tx.user.update({
          where: { id: account.id },
          data: {
            passwordHash: await hashPassword(credential.password),
            mustChangePassword: true,
            sessionVersion: { increment: 1 },
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        await tx.refreshToken.updateMany({
          where: { userId: account.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await writeAudit({
          actorId: account.id,
          action: 'development_demo_password_rotated',
          entityType: 'User',
          entityId: account.id,
          metadata: { email: account.email, role: account.role, environment: 'development' },
        }, tx);
      }
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    rmSync(handoffPath, { force: true });
    throw error;
  }

  console.info('Temporary passwords were saved to a Windows DPAPI-protected handoff for this Windows user.');
  console.info('Run npm.cmd run demo:show-passwords to display them once; the protected handoff is deleted after display.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Demo password rotation failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
