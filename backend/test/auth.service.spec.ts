import 'reflect-metadata';
import * as argon2 from 'argon2';
import { bootstrapFirstAdmin } from '../src/auth/bootstrap-admin';
import { hashPassword, normalizeEmail } from '../src/auth/auth.service';
import { LoginLimiterService } from '../src/auth/login-limiter.service';
import { hashSessionToken, SessionService } from '../src/auth/session.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth primitives (no database)', () => {
  it('normalizes email and hashes passwords with Argon2id', async () => {
    expect(normalizeEmail('  EMPLOYEE@Example.Test  ')).toBe('employee@example.test');
    const hash = await hashPassword('unit-only-password');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(hash, 'unit-only-password')).toBe(true);
    expect(await argon2.verify(hash, 'incorrect')).toBe(false);
    expect(hash).not.toContain('unit-only-password');
  });

  it('rate-limits an account/IP pair without locking every account behind that IP', () => {
    const limiter = new LoginLimiterService();
    for (let attempt = 0; attempt < 5; attempt++) limiter.failed('first@example.test', '127.0.0.1');
    expect(limiter.isBlocked('first@example.test', '127.0.0.1')).toBe(true);
    expect(limiter.isBlocked('second@example.test', '127.0.0.1')).toBe(false);
    expect(limiter.isBlocked('first@example.test', '127.0.0.2')).toBe(false);
  });

  it('resolves only active, unrevoked, unexpired sessions and throttles touch writes', async () => {
    const now = new Date();
    const token = Buffer.alloc(32, 9).toString('base64url');
    const session = {
      id: 4, tokenHash: hashSessionToken(token), revokedAt: null,
      idleExpiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 120_000),
      lastSeenAt: now,
      user: { id: 2, name: 'Admin', email: 'admin@example.test', role: 'admin', status: 'active', passwordHash: 'hash' },
    };
    const findUnique = jest.fn().mockResolvedValue(session);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new SessionService({ session: { findUnique, updateMany } } as unknown as PrismaService);
    expect((await service.resolve(token))?.user).toMatchObject({ id: 2, role: 'admin' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(await service.resolve('invalid')).toBeUndefined();
    findUnique.mockResolvedValueOnce({ ...session, revokedAt: now });
    expect(await service.resolve(token)).toBeUndefined();
    findUnique.mockResolvedValueOnce({ ...session, user: { ...session.user, status: 'disabled' } });
    expect(await service.resolve(token)).toBeUndefined();
    findUnique.mockResolvedValueOnce({ ...session, idleExpiresAt: new Date(now.getTime() - 1) });
    expect(await service.resolve(token)).toBeUndefined();
  });

  it('bootstraps only when no users exist and never stores the raw password', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1, email: 'admin@example.test', role: 'admin' });
    const count = jest.fn().mockResolvedValue(0);
    const query = jest.fn().mockResolvedValue([{ acquired: 1 }]);
    const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: query, user: { count, create },
    }));
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    await bootstrapFirstAdmin(prisma, {
      name: ' Admin ', email: ' ADMIN@Example.Test ', password: 'bootstrap-only-password',
    });
    expect(query.mock.calls[0][0].join('')).toContain('SELECT 1::integer AS acquired FROM pg_advisory_xact_lock');
    expect(create.mock.calls[0][0].data).toMatchObject({
      name: 'Admin', email: 'admin@example.test', role: 'admin', status: 'active',
    });
    const hash = create.mock.calls[0][0].data.passwordHash as string;
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(hash, 'bootstrap-only-password')).toBe(true);
    count.mockResolvedValue(1);
    create.mockClear();
    await expect(bootstrapFirstAdmin(prisma, {
      name: 'Admin', email: 'admin@example.test', password: 'bootstrap-only-password',
    })).rejects.toThrow('already exist');
    expect(create).not.toHaveBeenCalled();
  });
});
