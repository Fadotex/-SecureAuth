import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshFindUnique: vi.fn(),
  refreshUpdateMany: vi.fn(),
  userUpdateMany: vi.fn(),
  writeAudit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    refreshToken: {
      findUnique: mocks.refreshFindUnique,
      updateMany: mocks.refreshUpdateMany,
    },
    user: { updateMany: mocks.userUpdateMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../services/audit.js', () => ({ writeAudit: mocks.writeAudit }));

import { config } from '../config.js';
import { authRouter } from './auth.js';

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

describe('logout session invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshFindUnique.mockResolvedValue({ userId: 'user-123' });
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
    mocks.refreshUpdateMany.mockResolvedValue({ count: 1 });
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: { updateMany: mocks.userUpdateMany },
      refreshToken: { updateMany: mocks.refreshUpdateMany },
    }));
  });

  it('invalidates every session belonging to the refresh-token owner', async () => {
    const response = await request(app)
      .post('/auth/logout')
      .set('X-Hostel-Client', 'expo-native')
      .send({ refreshToken: 'r'.repeat(48) });

    expect(response.status).toBe(204);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(mocks.refreshUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-123', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'user-123',
      action: 'logout_succeeded',
    }), expect.any(Object));
  });

  it('uses a valid access token when no refresh cookie is available', async () => {
    mocks.refreshFindUnique.mockResolvedValue(null);
    const accessToken = jwt.sign(
      { type: 'access', sv: 0 },
      config.ACCESS_TOKEN_SECRET,
      { subject: 'user-456', expiresIn: '15m', issuer: 'hostel-api' },
    );

    const response = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(response.status).toBe(204);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-456' },
    }));
  });

  it('clears cookies without changing accounts when no valid session is supplied', async () => {
    mocks.refreshFindUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/auth/logout')
      .set('Authorization', 'Bearer invalid')
      .send({});

    expect(response.status).toBe(204);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
