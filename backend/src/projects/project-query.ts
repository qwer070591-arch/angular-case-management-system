import { HttpException, HttpStatus } from '@nestjs/common';

export const PROJECT_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export interface ProjectListQuery {
  q?: string;
  status?: ProjectStatus;
  limit: number;
  offset: number;
}

function invalidQuery(message: string): never {
  throw new HttpException({ error: { code: 'INVALID_QUERY', message } }, HttpStatus.BAD_REQUEST);
}

export function parseProjectId(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new HttpException({ error: { code: 'INVALID_ID', message: '案件 ID 必須是正整數。' } }, HttpStatus.BAD_REQUEST);
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) {
    throw new HttpException({ error: { code: 'INVALID_ID', message: '案件 ID 超出有效範圍。' } }, HttpStatus.BAD_REQUEST);
  }
  return id;
}

export function parseProjectListQuery(raw: Record<string, unknown>): ProjectListQuery {
  const allowed = new Set(['q', 'status', 'limit', 'offset', 'sort']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) invalidQuery('包含不支援的查詢條件。');
  if (Object.values(raw).some((value) => typeof value !== 'string')) invalidQuery('查詢條件必須是單一文字值。');

  const q = typeof raw.q === 'string' ? raw.q.trim() : undefined;
  if (q && [...q].length > 100) invalidQuery('搜尋文字不可超過 100 個字元。');
  const status = raw.status as string | undefined;
  if (status !== undefined && !PROJECT_STATUSES.includes(status as ProjectStatus)) invalidQuery('案件狀態無效。');
  if (raw.sort !== undefined && raw.sort !== 'updatedAt:desc') invalidQuery('排序方式無效。');

  const parseInteger = (value: unknown, fallback: number, min: number, max: number): number => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) invalidQuery('分頁參數必須是整數。');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) invalidQuery('分頁參數超出有效範圍。');
    return number;
  };

  return {
    ...(q ? { q } : {}),
    ...(status ? { status: status as ProjectStatus } : {}),
    limit: parseInteger(raw.limit, 20, 1, 100),
    offset: parseInteger(raw.offset, 0, 0, 2_147_483_647),
  };
}
