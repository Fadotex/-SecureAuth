import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { prisma } from '../src/v1/db.js';
import { hashPassword } from '../src/v1/services/password.js';
import { createFirstAdministrator } from '../src/v1/services/first-administrator.js';

function readHidden(prompt: string) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this command in an interactive local terminal so the password can be entered without echo.');
  }

  return new Promise<string>((resolve, reject) => {
    let value = '';
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Administrator provisioning cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else {
          value += character;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  const readline = createInterface({ input: stdin, output: stdout });
  let fullName: string;
  let email: string;
  try {
    fullName = (await readline.question('Administrator full name: ')).trim();
    email = (await readline.question('Administrator email: ')).trim().toLowerCase();
  } finally {
    readline.close();
  }

  if (fullName.length < 2 || fullName.length > 120) throw new Error('Name must be 2 to 120 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');

  const password = await readHidden('Choose a password (16–128 characters; input hidden): ');
  const confirmation = await readHidden('Confirm password (input hidden): ');
  if (password.length < 16 || password.length > 128) throw new Error('Password must be 16 to 128 characters.');
  if (password !== confirmation) throw new Error('Passwords do not match.');

  await prisma.$transaction(async (tx) => {
    await createFirstAdministrator(tx, { fullName, email, passwordHash: await hashPassword(password) });
  }, { isolationLevel: 'Serializable' });

  stdout.write('First Administrator created. Sign in to the web app and complete mandatory authenticator-app MFA enrollment.\n');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Administrator provisioning failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
