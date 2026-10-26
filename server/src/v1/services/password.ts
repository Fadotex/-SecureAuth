import { createHmac } from 'node:crypto';
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

const argonOptions = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  version: 0x13,
};
const argonType = 2 as const;

function pepperPassword(password: string) {
  return createHmac('sha256', config.PEPPER).update(password, 'utf8').digest('base64url');
}

export async function hashPassword(password: string) {
  return argon2.hash(pepperPassword(password), { ...argonOptions, type: argonType, hashLength: 32 });
}

export async function verifyPassword(password: string, encodedHash: string) {
  if (encodedHash.startsWith('$argon2id$')) {
    return {
      valid: await argon2.verify(encodedHash, pepperPassword(password)),
      needsRehash: argon2.needsRehash(encodedHash, argonOptions),
    };
  }

  const valid = await bcrypt.compare(password, encodedHash);
  return { valid, needsRehash: valid };
}
