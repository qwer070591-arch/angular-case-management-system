import { HttpException, HttpStatus } from '@nestjs/common';
import { PROJECT_STATUSES, ProjectStatus } from './project-query';

export const PROJECT_STATUS_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['pending', 'completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['pending'],
};

export function canTransitionProjectStatus(current: ProjectStatus, next: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[current].includes(next);
}

export function parseTransitionInput(raw: unknown): ProjectStatus {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpException({ error: { code: 'MALFORMED_REQUEST', message: '請提供 JSON 物件。' } }, HttpStatus.BAD_REQUEST);
  }

  const body = raw as Record<string, unknown>;
  const readOnlyFields = ['id', 'projectCode', 'status', 'createdAt', 'updatedAt', 'deletedAt'];
  const forbidden = Object.keys(body).filter((field) => readOnlyFields.includes(field));
  if (forbidden.length > 0) {
    throw new HttpException({ error: {
      code: 'READ_ONLY_FIELD',
      message: '不得修改唯讀欄位。',
      fieldErrors: Object.fromEntries(forbidden.map((field) => [field, [{ code: 'READ_ONLY_FIELD', message: '此欄位不可由請求修改。' }]])),
    } }, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  const unknown = Object.keys(body).filter((field) => field !== 'toStatus');
  if (unknown.length > 0) {
    throw new HttpException({ error: {
      code: 'VALIDATION_ERROR',
      message: '請檢查輸入的案件資料。',
      fieldErrors: Object.fromEntries(unknown.map((field) => [field, [{ code: 'UNKNOWN_FIELD', message: '不支援的欄位。' }]])),
    } }, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  if (typeof body.toStatus !== 'string' || !PROJECT_STATUSES.includes(body.toStatus as ProjectStatus)) {
    throw new HttpException({ error: {
      code: 'VALIDATION_ERROR',
      message: '請檢查輸入的案件資料。',
      fieldErrors: { toStatus: [{ code: 'INVALID_VALUE', message: '請指定有效的下一個案件狀態。' }] },
    } }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return body.toStatus as ProjectStatus;
}
