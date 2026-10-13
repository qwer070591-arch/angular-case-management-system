import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { authError, UserPublic } from './auth-http';
import { LoginLimiterService } from './login-limiter.service';
import { SessionService } from './session.service';

const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
let dummyHash: Promise<string> | undefined;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseLogin(value: unknown): { email: string; password: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw authError(HttpStatus.BAD_REQUEST, 'MALFORMED_REQUEST', '請求格式不正確。');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['email', 'password'].includes(key))
    || typeof input.email !== 'string' || typeof input.password !== 'string'
    || input.email.length > 254 || input.password.length > 1024 || !input.email.trim() || !input.password) {
    throw authError(HttpStatus.BAD_REQUEST, 'MALFORMED_REQUEST', '請求格式不正確。');
  }
  return { email: normalizeEmail(input.email), password: input.password };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginLimiterService,
  ) {}

  async login(body: unknown, ip: string): Promise<{ user: UserPublic; token: string }> {
    const { email, password } = parseLogin(body);
    if (this.limiter.isBlocked(email, ip)) {
      throw authError(HttpStatus.TOO_MANY_REQUESTS, 'LOGIN_RATE_LIMITED', '嘗試次數過多，請稍後再試。');
    }
    dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
    const fallbackHash = await dummyHash;
    const user = await this.prisma.user.findUnique({ where: { email } });
    let valid = false;
    try { valid = await argon2.verify(user?.passwordHash ?? fallbackHash, password); }
    catch { valid = false; }
    if (!user || user.status !== 'active' || !user.passwordHash || !valid) {
      this.limiter.failed(email, ip);
      throw authError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email 或密碼錯誤。');
    }
    this.limiter.succeeded(email, ip);
    const token = await this.sessions.create(user.id);
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }
}
