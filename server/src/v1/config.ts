import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOSTEL_API_HOST: z.string().min(1).default('127.0.0.1'),
  HOSTEL_API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  PEPPER: z.string().min(32),
  JWT_SECRET: z.string().optional(),
  DATA_ENCRYPTION_KEY: z.string().regex(/^[\da-f]{64}$/i),
  FRONTEND_ORIGINS: z.string().default('http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5173,http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_IPS: z.string().optional(),
  PAYSTACK_CALLBACK_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  APP_BASE_URL: z.string().url().default('http://127.0.0.1:5174'),
  HOLD_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
});

const parsed = schema.parse(process.env);
const accessTokenSecret = parsed.ACCESS_TOKEN_SECRET || parsed.JWT_SECRET;
if (!accessTokenSecret || accessTokenSecret.length < 32) {
  throw new Error('Set ACCESS_TOKEN_SECRET to a random value at least 32 characters long.');
}
export const config = {
  ...parsed,
  ACCESS_TOKEN_SECRET: accessTokenSecret,
  FRONTEND_ORIGINS: parsed.FRONTEND_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  PAYSTACK_WEBHOOK_IPS: parsed.PAYSTACK_WEBHOOK_IPS?.split(',').map((ip) => ip.trim()).filter(Boolean) ?? [],
  COOKIE_SECURE: parsed.COOKIE_SECURE === 'true' || parsed.NODE_ENV === 'production',
};