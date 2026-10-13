import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.CSRF_SECRET = randomBytes(48).toString('base64url');
