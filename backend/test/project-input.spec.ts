import { HttpException } from '@nestjs/common';
import { parseCreateProjectInput, parseUpdateProjectInput } from '../src/projects/project-input';

function expectApiError(action: () => unknown, status: number, code: string, field?: string): void {
  try {
    action();
    throw new Error('Expected an API error');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    const body = exception.getResponse() as { error: { code: string; fieldErrors?: Record<string, unknown> } };
    expect(body.error.code).toBe(code);
    if (field) expect(body.error.fieldErrors?.[field]).toBeDefined();
  }
}

describe('Project write input validation (unit)', () => {
  it('trims name/description and accepts real date-only values', () => {
    expect(parseCreateProjectInput({
      name: '  同名案件  ', description: '  描述  ', startDate: '2028-02-29', dueDate: '2028-03-01',
    })).toEqual({ name: '同名案件', description: '描述', startDate: '2028-02-29', dueDate: '2028-03-01' });
    expect(parseUpdateProjectInput({ description: '   ', dueDate: null })).toEqual({ description: null, dueDate: null });
  });

  it.each([{}, { name: '   ' }, { name: 'x'.repeat(51) }, { name: null }])(
    'rejects a missing, blank, too-long or non-text name: %j',
    (body) => expectApiError(() => parseCreateProjectInput(body), 422, 'VALIDATION_ERROR', 'name'),
  );

  it('rejects a description over 4000 Unicode code points', () => {
    expectApiError(() => parseCreateProjectInput({ name: 'test', description: 'x'.repeat(4001) }), 422, 'VALIDATION_ERROR', 'description');
  });

  it('rejects unsupported priority', () => {
    expectApiError(() => parseCreateProjectInput({ name: 'test', priority: 'critical' }), 422, 'VALIDATION_ERROR', 'priority');
  });

  it.each(['2026-02-30', '2026-13-01', '2026-2-01', '0000-01-01', '2026-02-29'])('rejects invalid calendar date %s', (date) => {
    expectApiError(() => parseCreateProjectInput({ name: 'test', startDate: date }), 422, 'VALIDATION_ERROR', 'startDate');
  });

  it('rejects dueDate before startDate', () => {
    expectApiError(() => parseCreateProjectInput({ name: 'test', startDate: '2026-10-11', dueDate: '2026-10-10' }), 422, 'VALIDATION_ERROR', 'dueDate');
  });

  it.each(['id', 'projectCode', 'status', 'createdAt', 'updatedAt'])('rejects read-only field %s', (field) => {
    expectApiError(() => parseCreateProjectInput({ name: 'test', [field]: 'client value' }), 422, 'READ_ONLY_FIELD', field);
    expectApiError(() => parseUpdateProjectInput({ [field]: 'client value' }), 422, 'READ_ONLY_FIELD', field);
  });

  it('rejects unknown fields and non-object or empty PATCH bodies', () => {
    expectApiError(() => parseCreateProjectInput({ name: 'test', ownerId: 1 }), 422, 'VALIDATION_ERROR', 'ownerId');
    expectApiError(() => parseUpdateProjectInput({}), 400, 'MALFORMED_REQUEST');
    expectApiError(() => parseUpdateProjectInput(null), 400, 'MALFORMED_REQUEST');
    expectApiError(() => parseCreateProjectInput([]), 400, 'MALFORMED_REQUEST');
  });
});
