import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { BookingStatus, PaymentNetwork, PaymentSource, PaymentStatus, Role, RoleProfile, SemesterStatus } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { enqueueEmail } from '../services/email.js';
import { createReceiptPdf, type ReceiptDetails } from '../services/receipts.js';
import { isPaymentWithinBalance, remainingBalancePesewas, requiredDepositPesewas } from '../services/money.js';
import { isValidPaystackSignature } from '../services/paystack-signature.js';

export const paymentRouter = Router();
const staffRoles = [Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF];
const payableBookingStatuses = new Set<BookingStatus>([BookingStatus.HELD, BookingStatus.CONFIRMED]);
const receiptRoles = new Set<Role>([Role.ADMIN, Role.STAFF]);
const extendedReceiptRoles = new Set<Role>([Role.MANAGER, Role.ADMINISTRATOR]);

type PaystackResponse<T> = { status: boolean; message?: string; data?: T };
type VerifiedTransaction = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  fees?: number;
  customer?: { email?: string };
  metadata?: { paymentId?: string; bookingId?: string };
};

async function paystackRequest<T>(path: string, options: RequestInit = {}) {
  if (!config.PAYSTACK_SECRET_KEY) throw Object.assign(new Error('Online payments are not configured.'), { status: 503 });
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const result = await response.json() as PaystackResponse<T>;
  if (!response.ok || !result.status) throw new Error(result.message || 'Paystack request failed.');
  return result.data as T;
}

async function receiptData(paymentId: string): Promise<ReceiptDetails> {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      student: { include: { user: true } },
      booking: { include: { room: true } },
      semester: true,
    },
  });
  const successful = await prisma.payment.aggregate({ where: { bookingId: payment.bookingId, status: PaymentStatus.SUCCESS }, _sum: { amountPesewas: true } });
  const totalPaidPesewas = successful._sum.amountPesewas || 0;
  return {
    receiptNumber: payment.receiptNumber || `PENDING-${payment.id.slice(0, 8)}`,
    studentName: payment.student.user.fullName,
    studentId: payment.student.studentId,
    roomNumber: payment.booking.room.roomNumber,
    amountPesewas: payment.amountPesewas,
    totalPaidPesewas,
    balancePesewas: remainingBalancePesewas(payment.booking.pricePesewas, totalPaidPesewas),
    network: payment.network || 'MANUAL_CASH',
    reference: payment.paystackReference || payment.momoReference || payment.id,
    paidAt: payment.verifiedAt || payment.createdAt,
  };
}

async function settleVerifiedPayment(reference: string, eventName: string, eventId: string, transaction: VerifiedTransaction) {
  const payment = await prisma.payment.findUnique({ where: { paystackReference: reference } });
  if (!payment) return { matched: false, duplicate: false };

  return prisma.$transaction(async (tx) => {
    const prior = await tx.paystackWebhookEvent.findUnique({ where: { eventId } });
    if (prior) return { matched: true, duplicate: true };
    await tx.paystackWebhookEvent.create({ data: { eventId, reference, event: eventName } });
    if (payment.status === PaymentStatus.SUCCESS) return { matched: true, duplicate: false };

    const isValid = transaction.status === 'success'
      && transaction.currency === 'GHS'
      && transaction.amount === payment.amountPesewas
      && transaction.reference === payment.paystackReference
      && (!transaction.metadata?.paymentId || transaction.metadata.paymentId === payment.id);
    if (!isValid) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      await writeAudit({ action: 'online_payment_verification_failed', entityType: 'Payment', entityId: payment.id, metadata: { reference }, ipAddress: null }, tx);
      return { matched: true, duplicate: false };
    }

    const receiptNumber = `HST-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCESS,
        feePesewas: transaction.fees || 0,
        netPesewas: payment.amountPesewas - (transaction.fees || 0),
        receiptNumber,
        verifiedAt: new Date(),
      },
      include: { student: { include: { user: true } }, booking: { include: { room: true } }, semester: true },
    });
    const totals = await tx.payment.aggregate({ where: { bookingId: payment.bookingId, status: PaymentStatus.SUCCESS }, _sum: { amountPesewas: true } });
    const totalPaid = totals._sum.amountPesewas || 0;
    const minimumDeposit = requiredDepositPesewas(updated.booking.pricePesewas, updated.semester.depositBps);
    if (totalPaid >= minimumDeposit) {
      await tx.booking.updateMany({
        where: { id: updated.bookingId, status: BookingStatus.HELD, holdExpiresAt: { gt: new Date() } },
        data: { status: BookingStatus.CONFIRMED, confirmedAt: new Date(), holdExpiresAt: null },
      });
    }
    await enqueueEmail({
      userId: updated.student.userId,
      toEmail: updated.student.user.email,
      template: 'payment-received',
      payload: {
        subject: `Payment received: ${receiptNumber}`,
        name: updated.student.user.fullName,
        message: 'Your payment was verified by Paystack. Your receipt is attached.',
        amount: `GHS ${(updated.amountPesewas / 100).toFixed(2)}`,
        network: updated.network,
        reference: updated.paystackReference,
        room: updated.booking.room.roomNumber,
        totalPaid: `GHS ${(totalPaid / 100).toFixed(2)}`,
        balance: `GHS ${Math.max(0, updated.booking.pricePesewas - totalPaid) / 100}`,
        receipt: {
          receiptNumber,
          studentName: updated.student.user.fullName,
          studentId: updated.student.studentId,
          roomNumber: updated.booking.room.roomNumber,
          amountPesewas: updated.amountPesewas,
          totalPaidPesewas: totalPaid,
          balancePesewas: Math.max(0, updated.booking.pricePesewas - totalPaid),
          network: updated.network || 'MTN_MOMO',
          reference: updated.paystackReference || reference,
          paidAt: updated.verifiedAt || new Date(),
        },
      },
    }, tx);
    const administrators = await tx.user.findMany({ where: { role: { in: [Role.ADMIN, Role.ADMINISTRATOR] }, isActive: true }, select: { email: true } });
    const paymentState = totalPaid >= updated.booking.pricePesewas ? 'Complete' : 'Incomplete';
    const managerPayload = {
      subject: `Payment received from ${updated.student.user.fullName}`,
      name: 'Hostel administrator',
      message: `${updated.student.user.fullName} (${updated.student.studentId}) paid via ${updated.network}. Status: ${paymentState}; balance GHS ${(Math.max(0, updated.booking.pricePesewas - totalPaid) / 100).toFixed(2)}.`,
      amount: `GHS ${(updated.amountPesewas / 100).toFixed(2)}`,
      network: updated.network,
      reference: updated.paystackReference,
      room: updated.booking.room.roomNumber,
      totalPaid: `GHS ${(totalPaid / 100).toFixed(2)}`,
      balance: `GHS ${(Math.max(0, updated.booking.pricePesewas - totalPaid) / 100).toFixed(2)}`,
      status: paymentState,
    };
    for (const administrator of administrators) {
      await enqueueEmail({ toEmail: administrator.email, template: 'payment-alert', payload: managerPayload }, tx);
    }
    await writeAudit({ actorId: updated.student.userId, action: 'online_payment_verified', entityType: 'Payment', entityId: updated.id, metadata: { reference, amountPesewas: updated.amountPesewas }, ipAddress: null }, tx);
    return { matched: true, duplicate: false };
  }, { isolationLevel: 'Serializable', timeout: 15_000 });
}

export async function handlePaystackWebhook(req: Request, res: Response) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!isValidPaystackSignature(rawBody, req.header('x-paystack-signature'), config.PAYSTACK_SECRET_KEY)) return res.status(401).json({ error: 'Invalid webhook signature.' });
  const event = JSON.parse(rawBody.toString('utf8')) as { event?: string; data?: { reference?: string; id?: number } };
  const reference = event.data?.reference;
  if (!reference || !event.event || event.event !== 'charge.success') return res.status(200).json({ received: true });

  const transaction = await paystackRequest<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
  const eventId = `${transaction.id}:${event.event}`;
  await settleVerifiedPayment(reference, event.event, eventId, transaction);
  return res.status(200).json({ received: true });
}

paymentRouter.post('/payments/initialize', requireAuth, requireRole(Role.STUDENT), async (req, res) => {
  const input = z.object({
    bookingId: z.string().uuid(),
    amountPesewas: z.number().int().positive(),
    network: z.nativeEnum(PaymentNetwork),
    phone: z.string().trim().min(7).max(32),
    idempotencyKey: z.string().min(12).max(120),
  }).parse(req.body);
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId }, include: { user: true } });
  const prior = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    if (prior.studentId !== student.id) return res.status(409).json({ error: 'Idempotency key already belongs to another payment.' });
    return res.json({ payment: prior, repeated: true });
  }

  const booking = await prisma.booking.findFirst({
    where: { id: input.bookingId, studentId: student.id, status: { in: [BookingStatus.HELD, BookingStatus.CONFIRMED] } },
    include: { semester: true },
  });
  if (!booking) return res.status(404).json({ error: 'An active booking was not found.' });
  if (booking.semester.status === SemesterStatus.CLOSED) return res.status(409).json({ error: 'Closed-semester payments are not accepted.' });
  if (booking.status === BookingStatus.HELD && booking.holdExpiresAt && booking.holdExpiresAt <= new Date()) return res.status(409).json({ error: 'The bed hold expired. Select a bed again.' });

  const paid = await prisma.payment.aggregate({ where: { bookingId: booking.id, status: PaymentStatus.SUCCESS }, _sum: { amountPesewas: true } });
  const alreadyPaid = paid._sum.amountPesewas || 0;
  const balance = remainingBalancePesewas(booking.pricePesewas, alreadyPaid);
  if (!isPaymentWithinBalance(input.amountPesewas, balance)) return res.status(400).json({ error: 'Payment exceeds the remaining balance.' });
  if (alreadyPaid === 0 && input.amountPesewas < requiredDepositPesewas(booking.pricePesewas, booking.semester.depositBps)) {
    return res.status(400).json({ error: `Initial payment must be at least ${booking.semester.depositBps / 100}% of the semester price.` });
  }

  const reference = `hst_${randomUUID().replaceAll('-', '')}`;
  const payment = await prisma.payment.create({
    data: {
      studentId: student.id,
      semesterId: booking.semesterId,
      bookingId: booking.id,
      amountPesewas: input.amountPesewas,
      network: input.network,
      source: PaymentSource.ONLINE,
      status: PaymentStatus.INITIALIZING,
      paystackReference: reference,
      idempotencyKey: input.idempotencyKey,
      momoReference: input.phone,
    },
  });
  try {
    const provider = input.network === PaymentNetwork.MTN_MOMO ? 'mtn' : 'vod';
    const result = await paystackRequest<{ reference: string; status: string }>('/charge', {
      method: 'POST',
      body: JSON.stringify({
        email: student.user.email,
        amount: input.amountPesewas,
        currency: 'GHS',
        reference,
        mobile_money: { phone: input.phone, provider },
        metadata: { paymentId: payment.id, bookingId: booking.id, network: input.network },
      }),
    });
    const updated = await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PENDING } });
    return res.status(202).json({ payment: updated, providerStatus: result.status, message: 'Approve the mobile-money prompt on your phone.' });
  } catch (error) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
    throw error;
  }
});

paymentRouter.get('/payments/me', requireAuth, requireRole(Role.STUDENT), async (req, res) => {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId } });
  const payments = await prisma.payment.findMany({ where: { studentId: student.id }, include: { booking: { include: { room: true } }, semester: true }, orderBy: { createdAt: 'desc' } });
  return res.json({ payments });
});

paymentRouter.post('/payments/manual', requireAuth, requireRole(...staffRoles), requirePermission('payments:manual'), async (req, res) => {
  const input = z.object({
    bookingId: z.string().uuid(),
    amountPesewas: z.number().int().positive(),
    source: z.enum([PaymentSource.MANUAL_CASH, PaymentSource.MANUAL_MOMO]),
    network: z.nativeEnum(PaymentNetwork).optional(),
    momoReference: z.string().trim().max(120).optional(),
  }).parse(req.body);
  if (input.source === PaymentSource.MANUAL_MOMO && !input.network) return res.status(400).json({ error: 'Select the mobile-money network for a manual MoMo payment.' });

  const created = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId }, include: { semester: true } });
    if (booking.semester.status === SemesterStatus.CLOSED) throw Object.assign(new Error('Closed-semester records are read-only.'), { status: 409 });
    if (!payableBookingStatuses.has(booking.status)) throw Object.assign(new Error('This booking cannot receive payment.'), { status: 409 });
    if (booking.status === BookingStatus.HELD && booking.holdExpiresAt && booking.holdExpiresAt <= new Date()) throw Object.assign(new Error('The bed hold expired. Select a bed again.'), { status: 409 });
    const totals = await tx.payment.aggregate({ where: { bookingId: booking.id, status: PaymentStatus.SUCCESS }, _sum: { amountPesewas: true } });
    const paid = totals._sum.amountPesewas || 0;
    if (input.amountPesewas > booking.pricePesewas - paid) throw Object.assign(new Error('Payment exceeds the remaining balance.'), { status: 400 });
    const payment = await tx.payment.create({
      data: {
        studentId: booking.studentId,
        semesterId: booking.semesterId,
        bookingId: booking.id,
        amountPesewas: input.amountPesewas,
        network: input.network,
        source: input.source,
        status: PaymentStatus.SUCCESS,
        momoReference: input.momoReference,
        idempotencyKey: `manual_${randomUUID()}`,
        receiptNumber: `HST-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        recordedById: req.auth!.userId,
        verifiedAt: new Date(),
        netPesewas: input.amountPesewas,
      },
    });
    const minDeposit = requiredDepositPesewas(booking.pricePesewas, booking.semester.depositBps);
    if (paid + input.amountPesewas >= minDeposit) {
      await tx.booking.updateMany({ where: { id: booking.id, status: BookingStatus.HELD }, data: { status: BookingStatus.CONFIRMED, confirmedAt: new Date(), holdExpiresAt: null } });
    }
    await writeAudit({ actorId: req.auth!.userId, action: 'manual_payment_recorded', entityType: 'Payment', entityId: payment.id, metadata: { bookingId: booking.id, amountPesewas: input.amountPesewas, source: input.source, network: input.network, reference: input.momoReference }, ipAddress: req.ip }, tx);
    return payment;
  });
  return res.status(201).json({ payment: created });
});

paymentRouter.get('/payments/:id/receipt', requireAuth, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id }, include: { student: true } });
  const isOwner = payment.student.userId === req.auth!.userId;
  const isAuthorizedOperator = req.auth!.roleProfile === RoleProfile.TARGET
    ? receiptRoles.has(req.auth!.role) || extendedReceiptRoles.has(req.auth!.role)
    : req.auth!.role === Role.STAFF;
  if (!isOwner && !isAuthorizedOperator) return res.status(403).json({ error: 'You cannot access this receipt.' });
  if (payment.status !== PaymentStatus.SUCCESS) return res.status(409).json({ error: 'Receipt is available only after payment confirmation.' });
  const receipt = await receiptData(payment.id);
  const pdf = await createReceiptPdf(receipt);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.receiptNumber}.pdf"`);
  return res.send(pdf);
});

paymentRouter.get('/admin/payments', requireAuth, requireRole(Role.ADMIN, Role.ADMINISTRATOR), async (req, res) => {
  const query = z.object({ semesterId: z.string().uuid().optional(), status: z.nativeEnum(PaymentStatus).optional() }).parse(req.query);
  const payments = await prisma.payment.findMany({
    where: { ...(query.semesterId ? { semesterId: query.semesterId } : {}), ...(query.status ? { status: query.status } : {}) },
    include: { student: { include: { user: true } }, booking: { include: { room: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return res.json({ payments });
});