import { HttpErrorResponse } from '@angular/common/http';

export type ProjectFieldName = 'name' | 'description' | 'priority' | 'startDate' | 'dueDate';

export function projectFieldErrors(error: unknown): Partial<Record<ProjectFieldName, string>> {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) return {};
  const fields = error.error?.error?.fieldErrors;
  if (!fields || typeof fields !== 'object') return {};

  const result: Partial<Record<ProjectFieldName, string>> = {};
  for (const field of ['name', 'description', 'priority', 'startDate', 'dueDate'] as const) {
    const message = fields[field]?.[0]?.message;
    if (typeof message === 'string') result[field] = message;
  }
  return result;
}

export function projectRequestError(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return '無法連線至案件服務，請確認服務已啟動後重試。';
  if (error.status >= 500) return '案件服務暫時無法處理請求，請稍後重試。';
  const message = error.error?.error?.message;
  return typeof message === 'string' && message ? message : fallback;
}
