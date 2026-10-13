import { HttpException, HttpStatus } from '@nestjs/common';
import { PROJECT_PRIORITIES, ProjectPriority } from './project-query';

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  priority?: ProjectPriority;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  priority?: ProjectPriority;
  startDate?: string | null;
  dueDate?: string | null;
}

type FieldError = { code: string; message: string };
type FieldErrors = Record<string, FieldError[]>;

const writableFields = new Set(['name', 'description', 'priority', 'startDate', 'dueDate']);
const readOnlyFields = new Set(['id', 'projectCode', 'status', 'createdAt', 'updatedAt', 'deletedAt']);

function addError(errors: FieldErrors, field: string, code: string, message: string): void {
  (errors[field] ??= []).push({ code, message });
}

function validationError(errors: FieldErrors, code = 'VALIDATION_ERROR'): never {
  throw new HttpException({
    error: {
      code,
      message: code === 'READ_ONLY_FIELD' ? '包含不可修改的案件欄位。' : '請修正案件資料。',
      fieldErrors: errors,
    },
  }, HttpStatus.UNPROCESSABLE_ENTITY);
}

function requestBody(raw: unknown, isPatch: boolean): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpException({ error: { code: 'MALFORMED_REQUEST', message: '請求內容必須是 JSON 物件。' } }, HttpStatus.BAD_REQUEST);
  }
  const body = raw as Record<string, unknown>;
  if (isPatch && Object.keys(body).length === 0) {
    throw new HttpException({ error: { code: 'MALFORMED_REQUEST', message: '請至少提供一個要修改的欄位。' } }, HttpStatus.BAD_REQUEST);
  }

  const errors: FieldErrors = {};
  for (const field of Object.keys(body)) {
    if (readOnlyFields.has(field)) addError(errors, field, 'READ_ONLY_FIELD', '此欄位由系統管理，不可修改。');
  }
  if (Object.keys(errors).length > 0) validationError(errors, 'READ_ONLY_FIELD');
  for (const field of Object.keys(body)) {
    if (!writableFields.has(field)) addError(errors, field, 'UNKNOWN_FIELD', '不支援此欄位。');
  }
  if (Object.keys(errors).length > 0) validationError(errors);
  return body;
}

function parseName(value: unknown, errors: FieldErrors): string | undefined {
  if (typeof value !== 'string') {
    addError(errors, 'name', 'INVALID_TYPE', '案件名稱必須是文字。');
    return undefined;
  }
  const name = value.trim();
  if (!name) addError(errors, 'name', 'REQUIRED', '請輸入案件名稱。');
  else if ([...name].length > 50) addError(errors, 'name', 'TOO_LONG', '案件名稱不可超過 50 個字元。');
  return name;
}

function parseDescription(value: unknown, errors: FieldErrors): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') {
    addError(errors, 'description', 'INVALID_TYPE', '案件描述必須是文字或 null。');
    return undefined;
  }
  const description = value.trim();
  if ([...description].length > 4000) {
    addError(errors, 'description', 'TOO_LONG', '案件描述不可超過 4000 個字元。');
  }
  return description || null;
}

function parsePriority(value: unknown, errors: FieldErrors): ProjectPriority | undefined {
  if (typeof value !== 'string' || !PROJECT_PRIORITIES.includes(value as ProjectPriority)) {
    addError(errors, 'priority', 'INVALID_VALUE', '案件優先級無效。');
    return undefined;
  }
  return value as ProjectPriority;
}

function parseDate(value: unknown, field: 'startDate' | 'dueDate', errors: FieldErrors): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    addError(errors, field, 'INVALID_DATE', '日期必須是真實的 YYYY-MM-DD。');
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    addError(errors, field, 'INVALID_DATE', '日期必須是真實的 YYYY-MM-DD。');
    return undefined;
  }
  return value;
}

export function validateProjectDateRange(startDate: string | null, dueDate: string | null): void {
  if (startDate !== null && dueDate !== null && dueDate < startDate) {
    validationError({ dueDate: [{ code: 'BEFORE_START_DATE', message: '預計完成日期不可早於開始日期。' }] });
  }
}

function parseFields(body: Record<string, unknown>, errors: FieldErrors): UpdateProjectInput {
  const input: UpdateProjectInput = {};
  if (Object.hasOwn(body, 'name')) input.name = parseName(body.name, errors);
  if (Object.hasOwn(body, 'description')) input.description = parseDescription(body.description, errors);
  if (Object.hasOwn(body, 'priority')) input.priority = parsePriority(body.priority, errors);
  if (Object.hasOwn(body, 'startDate')) input.startDate = parseDate(body.startDate, 'startDate', errors);
  if (Object.hasOwn(body, 'dueDate')) input.dueDate = parseDate(body.dueDate, 'dueDate', errors);
  return input;
}

export function parseCreateProjectInput(raw: unknown): CreateProjectInput {
  const body = requestBody(raw, false);
  const errors: FieldErrors = {};
  if (!Object.hasOwn(body, 'name')) addError(errors, 'name', 'REQUIRED', '請輸入案件名稱。');
  const input = parseFields(body, errors);
  if (Object.keys(errors).length > 0) validationError(errors);
  validateProjectDateRange(input.startDate ?? null, input.dueDate ?? null);
  return input as CreateProjectInput;
}

export function parseUpdateProjectInput(raw: unknown): UpdateProjectInput {
  const body = requestBody(raw, true);
  const errors: FieldErrors = {};
  const input = parseFields(body, errors);
  if (Object.keys(errors).length > 0) validationError(errors);
  return input;
}
