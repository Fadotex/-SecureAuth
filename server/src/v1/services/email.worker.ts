import nodemailer from 'nodemailer';
import { EmailJobStatus } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { createReceiptPdf, type ReceiptDetails } from './receipts.js';

const transporter = config.SMTP_HOST && config.EMAIL_FROM
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    })
  : null;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] as string));

function emailMarkup(template: string, payload: Record<string, unknown>) {
  const title = escapeHtml(payload.title || template.replaceAll('-', ' '));
  const name = escapeHtml(payload.name || 'Resident');
  const message = escapeHtml(payload.message || 'Please review the details below.');
  const url = typeof payload.url === 'string' ? payload.url : '';
  const action = url ? `<p><a href="${escapeHtml(url)}">Continue securely</a></p>` : '';
  const details = ['amount', 'network', 'reference', 'room', 'totalPaid', 'balance', 'status']
    .filter((key) => payload[key] !== undefined)
    .map((key) => `<tr><th align="left">${escapeHtml(key)}</th><td>${escapeHtml(payload[key])}</td></tr>`)
    .join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#173550"><h1>${title}</h1><p>Hello ${name},</p><p>${message}</p>${action}<table>${details}</table><p>Hostel Management</p></body></html>`;
}

async function sendJob(job: { id: string; toEmail: string; template: string; payload: unknown }) {
  const payload = job.payload as Record<string, unknown>;
  const attachments = [];
  if (job.template === 'payment-received' && payload.receipt && typeof payload.receipt === 'object') {
    const pdf = await createReceiptPdf(payload.receipt as ReceiptDetails);
    attachments.push({ filename: `receipt-${escapeHtml((payload.receipt as ReceiptDetails).receiptNumber)}.pdf`, content: pdf, contentType: 'application/pdf' });
  }
  const mail = {
    from: config.EMAIL_FROM || 'hostel@example.invalid',
    to: job.toEmail,
    subject: String(payload.subject || 'Hostel Management update'),
    html: emailMarkup(job.template, payload),
    attachments,
  };
  if (!transporter) {
    if (config.NODE_ENV === 'production') throw new Error('SMTP is not configured.');
    console.info('Development email delivery skipped; verification links remain available through the loopback-only local workflow.');
    return;
  }
  await transporter.sendMail(mail);
}

async function claimJobs() {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "EmailJob"
      WHERE "status" = 'QUEUED' AND "runAt" <= (NOW() AT TIME ZONE 'UTC')
      ORDER BY "runAt" ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `;
    const ids = rows.map((row) => row.id);
    if (!ids.length) return [];
    await tx.emailJob.updateMany({ where: { id: { in: ids }, status: EmailJobStatus.QUEUED }, data: { status: EmailJobStatus.PROCESSING } });
    return tx.emailJob.findMany({ where: { id: { in: ids }, status: EmailJobStatus.PROCESSING } });
  });
}

async function drainQueue() {
  const jobs = await claimJobs();
  for (const job of jobs) {
    try {
      await sendJob(job);
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: EmailJobStatus.SENT, sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    } catch (error) {
      const attempts = job.attempts + 1;
      const failed = attempts >= 5;
      await prisma.emailJob.update({
        where: { id: job.id },
        data: {
          status: failed ? EmailJobStatus.FAILED : EmailJobStatus.QUEUED,
          attempts,
          runAt: new Date(Date.now() + Math.min(360, 2 ** attempts) * 60_000),
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed.',
        },
      });
    }
  }
}

export function startEmailWorker() {
  const timer = setInterval(() => {
    void drainQueue().catch((error) => console.error('Email queue poll failed:', error));
  }, 3_000);
  timer.unref();
  return timer;
}