import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { healthRouter } from './health.js';

const app = express();
app.use('/api/v1/health', healthRouter);

describe('health endpoint', () => {
  it('reports API liveness without querying the database', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
