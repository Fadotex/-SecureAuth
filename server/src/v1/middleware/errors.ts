import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: 'Request validation failed.', details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  }
  if (error?.code === 'P2002') return res.status(409).json({ error: 'A record with those details already exists.' });
  if (error?.code === 'P2025') return res.status(404).json({ error: 'The requested record was not found.' });
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message || 'Request could not be completed.' });
  }
  console.error('Unhandled API error:', error);
  return res.status(500).json({ error: 'Unexpected server error.' });
};