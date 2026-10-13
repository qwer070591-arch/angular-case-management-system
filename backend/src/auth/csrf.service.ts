import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { authConfig, CSRF_COOKIE, SESSION_COOKIE, SESSION_ABSOLUTE_MS } from './auth-config';
import { authError, cookieValue } from './auth-http';
import { hashSessionToken } from './session.service';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;

@Injectable()
export class CsrfService {
  private readonly config = authConfig();

  issue(request: Request, response: Response, sessionToken?: string): string {
    const token = this.sign(randomBytes(32).toString('base64url'), sessionToken);
    response.cookie(CSRF_COOKIE, token, {
      httpOnly: false, secure: this.config.production, sameSite: 'lax', path: '/',
      maxAge: SESSION_ABSOLUTE_MS,
    });
    response.setHeader('Cache-Control', 'no-store');
    return token;
  }

  verify(request: Request): boolean {
    const cookie = cookieValue(request, CSRF_COOKIE);
    const header = request.headers['x-xsrf-token'];
    if (!cookie || !TOKEN_PATTERN.test(cookie) || typeof header !== 'string' || !safeEqual(cookie, header)) return false;
    const [nonce] = cookie.split('.');
    return safeEqual(cookie, this.sign(nonce, cookieValue(request, SESSION_COOKIE)));
  }

  validOrigin(request: Request): boolean {
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site') return false;
    const origin = request.headers.origin;
    if (origin) {
      if (origin === this.config.origin) return true;
      try {
        const parsed = new URL(origin);
        return parsed.host === request.headers.host
          && (!this.config.production || parsed.protocol === 'https:');
      } catch { return false; }
    }
    return fetchSite !== 'same-site';
  }

  private sign(nonce: string, sessionToken?: string): string {
    const context = sessionToken ? `session:${hashSessionToken(sessionToken)}` : 'anonymous';
    const mac = createHmac('sha256', this.config.secret).update(`${context}:${nonce}`).digest('base64url');
    return `${nonce}.${mac}`;
  }
}

function safeEqual(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
    if (!this.csrf.validOrigin(request) || !this.csrf.verify(request)) {
      throw authError(HttpStatus.FORBIDDEN, 'CSRF_INVALID', '請重新載入頁面後再試。');
    }
    return true;
  }
}
