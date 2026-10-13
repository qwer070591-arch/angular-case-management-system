export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_MS = 5 * 60 * 1000;
export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-case_session' : 'case_session';
export const CSRF_COOKIE = 'XSRF-TOKEN';

export function authConfig() {
  const secret = process.env.CSRF_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('CSRF_SECRET must contain at least 32 bytes.');
  }
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.APP_ORIGIN ?? (production ? '' : 'http://localhost:4200');
  if (!origin || !/^https?:\/\/[^/]+$/.test(origin) || (production && !origin.startsWith('https://'))) {
    throw new Error('APP_ORIGIN must be a single HTTPS origin in production.');
  }
  return { secret, origin, production };
}
