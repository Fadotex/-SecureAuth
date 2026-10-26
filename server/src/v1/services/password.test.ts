import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('stores passwords as independently salted Argon2id hashes', async () => {
    const first = await hashPassword('a strong test password');
    const second = await hashPassword('a strong test password');

    expect(first.startsWith('$argon2id$')).toBe(true);
    expect(second.startsWith('$argon2id$')).toBe(true);
    expect(first).not.toBe(second);
    await expect(verifyPassword('a strong test password', first)).resolves.toEqual({ valid: true, needsRehash: false });
    await expect(verifyPassword('incorrect password', first)).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it('supports bcrypt verification for login-time Argon2id upgrade', async () => {
    const legacyHash = await bcrypt.hash('legacy test password', 4);

    await expect(verifyPassword('legacy test password', legacyHash)).resolves.toEqual({ valid: true, needsRehash: true });
  });
});
