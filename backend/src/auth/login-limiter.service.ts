import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 100;

interface Attempt { count: number; expiresAt: number }

@Injectable()
export class LoginLimiterService {
  private readonly attempts = new Map<string, Attempt>();

  isBlocked(email: string, ip: string): boolean {
    return this.count(`account:${ip}:${email}`) >= ACCOUNT_LIMIT || this.count(`ip:${ip}`) >= IP_LIMIT;
  }

  failed(email: string, ip: string): void {
    this.increment(`account:${ip}:${email}`);
    this.increment(`ip:${ip}`);
  }

  succeeded(email: string, ip: string): void {
    this.attempts.delete(`account:${ip}:${email}`);
  }

  private count(key: string): number {
    const item = this.attempts.get(key);
    if (!item) return 0;
    if (item.expiresAt <= Date.now()) { this.attempts.delete(key); return 0; }
    return item.count;
  }

  private increment(key: string): void {
    const count = this.count(key);
    this.attempts.set(key, { count: count + 1, expiresAt: Date.now() + WINDOW_MS });
  }
}
