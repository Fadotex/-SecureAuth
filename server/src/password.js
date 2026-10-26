const crypto = require('crypto');

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const ITERATIONS = 120000;
const DIGEST = 'sha512';

/**
 * Creates a secure password hash using:
 * Password + unique Salt + server-side Pepper
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const pepper = process.env.PEPPER;

  if (!pepper) {
    throw new Error('PEPPER is not configured');
  }

  const passwordWithPepper = password + pepper;

  const hash = crypto
    .pbkdf2Sync(
      passwordWithPepper,
      salt,
      ITERATIONS,
      KEY_LENGTH,
      DIGEST
    )
    .toString('hex');

  return {
    salt,
    hash,
  };
}

/**
 * Checks whether a login password matches
 * the stored password hash.
 */
function verifyPassword(password, salt, storedHash) {
  const pepper = process.env.PEPPER;

  if (!pepper) {
    throw new Error('PEPPER is not configured');
  }

  const passwordWithPepper = password + pepper;

  const hash = crypto
    .pbkdf2Sync(
      passwordWithPepper,
      salt,
      ITERATIONS,
      KEY_LENGTH,
      DIGEST
    )
    .toString('hex');

  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}

module.exports = {
  hashPassword,
  verifyPassword,
};