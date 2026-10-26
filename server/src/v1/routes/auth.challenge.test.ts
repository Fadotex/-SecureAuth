import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authRouter, isLoopbackAddress } from './auth.js';

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

describe('MFA enrollment challenge validation', () => {
  const challenge = 'x'.repeat(300);

  it('accepts a signed-challenge-sized setup request before JWT validation', async () => {
    const response = await request(app).post('/auth/2fa/enroll/setup').send({ challenge });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Enrollment challenge expired. Sign in again.');
  });

  it('accepts a signed-challenge-sized verification request before JWT validation', async () => {
    const response = await request(app)
      .post('/auth/2fa/enroll/verify')
      .send({ challenge, code: '123456' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Enrollment challenge expired. Sign in again.');
  });
});

describe('local development verification access', () => {
  it('accepts only loopback client addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
