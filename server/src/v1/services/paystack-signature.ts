import { createHmac, timingSafeEqual } from 'node:crypto';

export function isValidPaystackSignature(rawBody: Buffer, signature: string | undefined, secret: string | undefined) {
  if (!secret || !signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}