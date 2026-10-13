import { PassThrough } from 'node:stream';
import { BootstrapCliError, bootstrapFirstAdmin, confirmPasswords, hiddenPassword, safeBootstrapError } from '../src/auth/bootstrap-admin';
import { PrismaService } from '../src/prisma/prisma.service';

class TestTerminal extends PassThrough {
  isTTY = true;
  isRaw = false;
  readonly modes: boolean[] = [];
  setRawMode(mode: boolean): void {
    this.isRaw = mode;
    this.modes.push(mode);
  }
}

describe('bootstrap CLI input (no database)', () => {
  function terminal() {
    const input = new TestTerminal();
    const output = new PassThrough();
    let visible = '';
    output.on('data', (chunk: Buffer) => { visible += chunk.toString('utf8'); });
    return { input, output, visible: () => visible };
  }

  it('reads hidden input, Enter, and a second password after restoring terminal mode', async () => {
    const { input, output, visible } = terminal();
    const first = hiddenPassword('Password: ', input, output);
    input.write('dummy-secret-123\r');
    expect(await first).toBe('dummy-secret-123');
    expect(input.isRaw).toBe(false);
    expect(input.isPaused()).toBe(true);
    const second = hiddenPassword('Confirm: ', input, output);
    input.write('dummy-secret-123\r');
    expect(await second).toBe('dummy-secret-123');
    expect(input.modes).toEqual([true, false, true, false]);
    expect(input.isPaused()).toBe(true);
    expect(visible()).not.toContain('dummy-secret-123');
  });

  it('handles Backspace without exposing typed characters', async () => {
    const { input, output, visible } = terminal();
    const password = hiddenPassword('Password: ', input, output);
    input.write('dummy-secret-12x\x7f3\r');
    expect(await password).toBe('dummy-secret-123');
    expect(visible()).not.toContain('dummy-secret');
  });

  it('rejects Ctrl+C and restores normal terminal mode', async () => {
    const { input, output } = terminal();
    const password = hiddenPassword('Password: ', input, output);
    input.write('dummy\x03');
    await expect(password).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(input.isRaw).toBe(false);
  });

  it('rejects unexpected terminal end instead of hanging', async () => {
    const { input, output } = terminal();
    const password = hiddenPassword('Password: ', input, output);
    input.end();
    await expect(password).rejects.toMatchObject({ code: 'TERMINAL' });
  });

  it('rejects overlong pasted input instead of silently truncating it to 128', async () => {
    const { input, output } = terminal();
    const password = hiddenPassword('Password: ', input, output);
    input.write(`${'x'.repeat(129)}\r`);
    await expect(password).rejects.toMatchObject({ code: 'PASSWORD_LENGTH' });
  });

  it('distinguishes a password mismatch without revealing either value', () => {
    expect(() => confirmPasswords('dummy-secret-123', 'different-secret')).toThrow(BootstrapCliError);
    try { confirmPasswords('dummy-secret-123', 'different-secret'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'PASSWORD_MISMATCH' });
      expect(safeBootstrapError(error)).toBe('The two passwords do not match.');
      expect(safeBootstrapError(error)).not.toContain('dummy');
    }
  });

  it('keeps database driver details out of the displayed error', () => {
    expect(safeBootstrapError(new Error('secret database connection string'))).toContain('Database operation failed');
    expect(safeBootstrapError(new Error('secret database connection string'))).not.toContain('secret');
  });

  it('accepts a Unicode name and ASCII email in a mock transaction', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1, name: '系統管理員', email: 'admin@example.test', role: 'admin' });
    const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: 1 }]), user: { count: jest.fn().mockResolvedValue(0), create },
    }));
    await bootstrapFirstAdmin({ $transaction: transaction } as unknown as PrismaService, {
      name: ' 系統管理員 ', email: ' ADMIN@Example.Test ', password: 'dummy-secret-123',
    });
    expect(create.mock.calls[0][0].data).toMatchObject({ name: '系統管理員', email: 'admin@example.test' });
    expect(create.mock.calls[0][0].data.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects short passwords before opening a transaction', async () => {
    const transaction = jest.fn();
    await expect(bootstrapFirstAdmin({ $transaction: transaction } as unknown as PrismaService, {
      name: '系統管理員', email: 'admin@example.test', password: 'short',
    })).rejects.toMatchObject({ code: 'PASSWORD_LENGTH' });
    expect(transaction).not.toHaveBeenCalled();
  });
});
