import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type EmailInput = {
  userId?: string;
  toEmail: string;
  template: string;
  payload: Prisma.InputJsonValue;
  runAt?: Date;
  dedupeKey?: string;
};

export async function enqueueEmail(input: EmailInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const data = {
    userId: input.userId,
    toEmail: input.toEmail,
    template: input.template,
    payload: input.payload,
    runAt: input.runAt,
    dedupeKey: input.dedupeKey,
  };
  if (input.dedupeKey) return client.emailJob.upsert({ where: { dedupeKey: input.dedupeKey }, create: data, update: {} });
  return client.emailJob.create({ data });
}