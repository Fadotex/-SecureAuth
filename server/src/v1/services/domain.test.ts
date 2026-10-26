import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPaymentWithinBalance, hostelPaymentState, remainingBalancePesewas, requiredDepositPesewas } from './money.js';
import { isValidPaystackSignature } from './paystack-signature.js';

describe('GHS payment rules use integer pesewas', () => {
  it('rounds a configured deposit up to the next pesewa', () => {
    expect(requiredDepositPesewas(10_001, 5_000)).toBe(5_001);
  });

  it('calculates unpaid, partial and complete states without negative balances', () => {
    expect(hostelPaymentState(100_000, 0)).toBe('UNPAID');
    expect(hostelPaymentState(100_000, 40_000)).toBe('INCOMPLETE');
    expect(hostelPaymentState(100_000, 100_000)).toBe('COMPLETE');
    expect(remainingBalancePesewas(100_000, 140_000)).toBe(0);
  });

  it('rejects zero, fractional, unsafe, and over-balance payments', () => {
    expect(isPaymentWithinBalance(50_000, 100_000)).toBe(true);
    expect(isPaymentWithinBalance(0, 100_000)).toBe(false);
    expect(isPaymentWithinBalance(50_000.5, 100_000)).toBe(false);
    expect(isPaymentWithinBalance(100_001, 100_000)).toBe(false);
  });
});

describe('Paystack webhook signature verification', () => {
  it('accepts a correct SHA-512 HMAC and rejects tampering', () => {
    const secret = randomBytes(32).toString('hex');
    const body = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac('sha512', secret).update(body).digest('hex');
    expect(isValidPaystackSignature(body, signature, secret)).toBe(true);
    expect(isValidPaystackSignature(Buffer.from('{"event":"charge.failed"}'), signature, secret)).toBe(false);
    expect(isValidPaystackSignature(body, 'not-a-signature', secret)).toBe(false);
  });
});