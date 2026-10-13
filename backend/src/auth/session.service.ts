import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserPublic } from './auth-http';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_TOUCH_MS } from './auth-config';

export interface SessionIdentity { user: UserPublic; tokenHash: string }

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.session.create({ data: {
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    } });
    return token;
  }

  async resolve(token: string | undefined): Promise<SessionIdentity | undefined> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash }, include: { user: true },
    });
    if (!session || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now
      || session.user.status !== 'active' || !session.user.passwordHash) return undefined;

    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_MS) {
      const touched = await this.prisma.session.updateMany({
        where: { id: session.id, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now },
          user: { status: 'active' } },
        data: { lastSeenAt: now, idleExpiresAt: new Date(Math.min(now.getTime() + SESSION_IDLE_MS,
          session.absoluteExpiresAt.getTime())) },
      });
      if (touched.count !== 1) return undefined;
    }
    const { id, name, email, role } = session.user;
    return { user: { id, name, email, role }, tokenHash };
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null }, data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: number): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
