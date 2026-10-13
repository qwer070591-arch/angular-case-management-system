import 'dotenv/config';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Readable, Writable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, normalizeEmail } from './auth.service';

export interface BootstrapAdminInput { name: string; email: string; password: string }

type BootstrapErrorCode = 'INVALID_IDENTITY' | 'PASSWORD_LENGTH' | 'PASSWORD_MISMATCH'
  | 'TERMINAL' | 'CANCELLED' | 'DATABASE_CONFIRMATION' | 'ALREADY_EXISTS' | 'PASSWORD_HASH';

export class BootstrapCliError extends Error {
  constructor(readonly code: BootstrapErrorCode, message: string) { super(message); }
}

interface PasswordInput extends Readable {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
}

const MAX_PASSWORD_LENGTH = 128;

export async function bootstrapFirstAdmin(prisma: PrismaService, input: BootstrapAdminInput) {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name || name.length > 120 || email.length > 254
    || !/^[\x21-\x7e]+$/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    throw new BootstrapCliError('INVALID_IDENTITY', 'Invalid admin name or email.');
  }
  if (input.password.length < 12 || input.password.length > MAX_PASSWORD_LENGTH) {
    throw new BootstrapCliError('PASSWORD_LENGTH', 'Admin password must contain 12–128 characters.');
  }
  let passwordHash: string;
  try { passwordHash = await hashPassword(input.password); }
  catch { throw new BootstrapCliError('PASSWORD_HASH', 'Password protection failed.'); }
  return prisma.$transaction(async (transaction) => {
    // Prisma cannot decode PostgreSQL's void result from a bare advisory-lock SELECT.
    const lock = await transaction.$queryRaw<Array<{ acquired: number }>>`
      SELECT 1::integer AS acquired FROM pg_advisory_xact_lock(60612, 1)
    `;
    if (lock[0]?.acquired !== 1) throw new Error('Bootstrap lock was not acquired.');
    if (await transaction.user.count() !== 0) {
      throw new BootstrapCliError('ALREADY_EXISTS', 'Bootstrap is unavailable: employee accounts already exist.');
    }
    return transaction.user.create({ data: {
      name, email, passwordHash, role: 'admin', status: 'active',
    }, select: { id: true, name: true, email: true, role: true } });
  });
}

export function hiddenPassword(prompt: string, input: PasswordInput = stdin, output: Writable = stdout): Promise<string> {
  const setRawMode = input.setRawMode;
  if (!input.isTTY || !setRawMode) {
    return Promise.reject(new BootstrapCliError('TERMINAL', 'Interactive terminal required.'));
  }
  return new Promise((resolve, reject) => {
    const characters: string[] = [];
    let overflow = 0;
    let finished = false;
    const wasRaw = input.isRaw === true;
    const finish = () => {
      if (finished) return;
      finished = true;
      input.off('keypress', onKey);
      input.off('end', onEnd);
      input.off('error', onError);
      try { setRawMode.call(input, wasRaw); } catch { /* Preserve the original terminal failure. */ }
      input.pause();
      output.write('\n');
    };
    const onEnd = () => { finish(); reject(new BootstrapCliError('TERMINAL', 'Terminal input ended.')); };
    const onError = () => { finish(); reject(new BootstrapCliError('TERMINAL', 'Terminal input failed.')); };
    const onKey = (character: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key?.ctrl && key.name === 'c') {
        finish(); reject(new BootstrapCliError('CANCELLED', 'Cancelled.')); return;
      }
      if (key?.name === 'return' || key?.name === 'enter') {
        finish();
        if (overflow > 0 || characters.join('').length > MAX_PASSWORD_LENGTH) {
          reject(new BootstrapCliError('PASSWORD_LENGTH', 'Admin password must contain 12–128 characters.'));
        } else {
          resolve(characters.join(''));
        }
        return;
      }
      if (key?.name === 'backspace') {
        if (overflow > 0) overflow--;
        else characters.pop();
        return;
      }
      if (character && !key?.ctrl && !key?.meta) {
        for (const symbol of character) {
          if (characters.length < MAX_PASSWORD_LENGTH) characters.push(symbol);
          else overflow++;
        }
      }
    };
    try {
      emitKeypressEvents(input);
      input.on('keypress', onKey);
      input.on('end', onEnd);
      input.on('error', onError);
      setRawMode.call(input, true);
      input.resume();
      output.write(prompt);
    } catch {
      finish();
      reject(new BootstrapCliError('TERMINAL', 'Terminal input failed.'));
    }
  });
}

async function main(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new BootstrapCliError('TERMINAL', 'Run this CLI in an interactive terminal.');
  }
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const [{ database }] = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    const io = createInterface({ input: stdin, output: stdout });
    let confirmation: string;
    let name: string;
    let email: string;
    try {
      stdout.write(`Target database: ${database}\n`);
      confirmation = await askQuestion(io, 'Type the exact database name to continue: ');
      if (confirmation !== database) throw new BootstrapCliError('DATABASE_CONFIRMATION', 'Database confirmation failed.');
      if (await prisma.user.count() !== 0) {
        throw new BootstrapCliError('ALREADY_EXISTS', 'Bootstrap is unavailable: employee accounts already exist.');
      }
      name = await askQuestion(io, 'Admin name: ');
      email = await askQuestion(io, 'Admin email: ');
    } finally { io.close(); }
    const password = await hiddenPassword('Password (12–128 characters, hidden): ');
    const repeat = await hiddenPassword('Confirm password (hidden): ');
    confirmPasswords(password, repeat);
    const user = await bootstrapFirstAdmin(prisma, { name, email, password });
    stdout.write(`Created first admin account ${user.email} (ID ${user.id}).\n`);
  } finally { await prisma.$disconnect(); }
}

async function askQuestion(io: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  try { return await io.question(prompt); }
  catch { throw new BootstrapCliError('TERMINAL', 'Terminal input failed.'); }
}

export function confirmPasswords(password: string, repeat: string): void {
  if (password !== repeat) throw new BootstrapCliError('PASSWORD_MISMATCH', 'Passwords do not match.');
}

const SAFE_ERRORS: Record<BootstrapErrorCode, string> = {
  INVALID_IDENTITY: 'Admin name or email is invalid.',
  PASSWORD_LENGTH: 'Password must contain 12–128 characters.',
  PASSWORD_MISMATCH: 'The two passwords do not match.',
  TERMINAL: 'Terminal input failed. Run this command in an interactive CMD window.',
  CANCELLED: 'Bootstrap cancelled.',
  DATABASE_CONFIRMATION: 'Database name confirmation failed.',
  ALREADY_EXISTS: 'Bootstrap is unavailable because employee accounts already exist.',
  PASSWORD_HASH: 'Password protection failed. No account was created.',
};

export function safeBootstrapError(error: unknown): string {
  return error instanceof BootstrapCliError
    ? SAFE_ERRORS[error.code]
    : 'Database operation failed. No account was created; verify the database connection and retry.';
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    // Never include a driver exception: it may contain connection details.
    process.stderr.write(`Bootstrap failed. ${safeBootstrapError(error)}\n`);
    process.exitCode = 1;
  });
}
