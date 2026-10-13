import { provideHttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CreateProjectInput, Project, UpdateProjectInput } from '../project';
import { ProjectApiService, ProjectListResponse, ProjectStats } from './project-api.service';

const apiUrl = '/api/projects';
const project: Project = {
  id: 3,
  projectCode: 'PRJ-2025-0001',
  name: '後台管理系統',
  description: '唯讀測試案件',
  status: 'completed',
  priority: 'high',
  startDate: '2025-01-10',
  dueDate: '2025-03-30',
  createdAt: '2025-01-01T08:00:00.000Z',
  updatedAt: '2025-04-01T09:30:00.000Z',
};

describe('ProjectApiService', () => {
  let service: ProjectApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProjectApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses GET /api/projects and preserves the data/meta envelope', () => {
    const response: ProjectListResponse = {
      data: [project],
      meta: { total: 3, limit: 20, offset: 0 },
    };
    let actual: ProjectListResponse | undefined;
    service.getProjects().subscribe((value) => actual = value);

    const request = http.expectOne(apiUrl);
    expect(request.request.method).toBe('GET');
    request.flush(response);

    expect(actual).toEqual(response);
    expect(actual?.meta.total).toBe(3);
    expect(actual?.data[0].startDate).toBe('2025-01-10');
    expect(actual?.data[0].dueDate).toBe('2025-03-30');
    expect(actual?.data[0].createdAt).toBe('2025-01-01T08:00:00.000Z');
    expect(actual?.data[0].updatedAt).toBe('2025-04-01T09:30:00.000Z');
    expect(typeof actual?.data[0].startDate).toBe('string');
  });

  it('keeps the no-argument list request free of undefined, null, or all query values', () => {
    service.getProjects().subscribe();
    const request = http.expectOne(apiUrl);
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.urlWithParams).toBe(apiUrl);
    request.flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
  });

  it('sends a Traditional Chinese name keyword through HttpParams', () => {
    let actual: ProjectListResponse | undefined;
    service.getProjects({ q: '官網' }).subscribe((value) => actual = value);
    const request = http.expectOne((candidate) => candidate.url === apiUrl && candidate.params.get('q') === '官網');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual(['q']);
    request.flush({ data: [project], meta: { total: 9, limit: 20, offset: 0 } });
    expect(actual?.meta).toEqual({ total: 9, limit: 20, offset: 0 });
  });

  it('combines q with status and pagination without dropping filtered total', () => {
    let actual: ProjectListResponse | undefined;
    service.getProjects({ q: 'Website', status: 'in_progress', limit: 5, offset: 10 })
      .subscribe((value) => actual = value);
    const request = http.expectOne(`${apiUrl}?q=Website&status=in_progress&limit=5&offset=10`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [], meta: { total: 12, limit: 5, offset: 10 } });
    expect(actual).toEqual({ data: [], meta: { total: 12, limit: 5, offset: 10 } });
  });

  it('passes an explicitly blank q to the backend without inventing a search result', () => {
    service.getProjects({ q: '   ' }).subscribe();
    const request = http.expectOne((candidate) => candidate.url === apiUrl && candidate.params.get('q') === '   ');
    expect(request.request.params.keys()).toEqual(['q']);
    request.flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
  });

  it('preserves a search HTTP validation error and backend error code', () => {
    let actual: HttpErrorResponse | undefined;
    service.getProjects({ q: 'x'.repeat(101) }).subscribe({ error: (error) => actual = error });
    const backendError = { error: { code: 'INVALID_QUERY', message: '搜尋文字不可超過 100 個字元。' } };
    http.expectOne((candidate) => candidate.url === apiUrl && candidate.params.get('q') === 'x'.repeat(101))
      .flush(backendError, { status: 400, statusText: 'Bad Request' });
    expect(actual?.status).toBe(400);
    expect(actual?.error).toEqual(backendError);
  });

  it.each(['pending', 'in_progress', 'completed', 'cancelled'] as const)(
    'sends status=%s using the existing ProjectStatus API value', (status) => {
      service.getProjects({ status }).subscribe();
      const request = http.expectOne(`${apiUrl}?status=${status}`);
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('status')).toBe(status);
      request.flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    },
  );

  it('sends limit without adding other query parameters', () => {
    service.getProjects({ limit: 5 }).subscribe();
    const request = http.expectOne(`${apiUrl}?limit=5`);
    expect(request.request.params.keys()).toEqual(['limit']);
    request.flush({ data: [], meta: { total: 0, limit: 5, offset: 0 } });
  });

  it('preserves an explicit offset of zero', () => {
    service.getProjects({ offset: 0 }).subscribe();
    const request = http.expectOne(`${apiUrl}?offset=0`);
    expect(request.request.params.get('offset')).toBe('0');
    request.flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
  });

  it('combines status, limit, and offset while preserving filtered total and page metadata', () => {
    let actual: ProjectListResponse | undefined;
    service.getProjects({ status: 'pending', limit: 5, offset: 5 }).subscribe((value) => actual = value);
    const request = http.expectOne(`${apiUrl}?status=pending&limit=5&offset=5`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [project], meta: { total: 12, limit: 5, offset: 5 } });
    expect(actual?.data).toEqual([project]);
    expect(actual?.meta).toEqual({ total: 12, limit: 5, offset: 5 });
    expect(actual?.meta.total).not.toBe(actual?.data.length);
  });

  it('preserves metadata for an empty filtered page', () => {
    let actual: ProjectListResponse | undefined;
    service.getProjects({ status: 'completed', limit: 5, offset: 10 }).subscribe((value) => actual = value);
    http.expectOne(`${apiUrl}?status=completed&limit=5&offset=10`)
      .flush({ data: [], meta: { total: 7, limit: 5, offset: 10 } });
    expect(actual).toEqual({ data: [], meta: { total: 7, limit: 5, offset: 10 } });
  });

  it('passes invalid-status query errors through with the backend code', () => {
    let actual: HttpErrorResponse | undefined;
    service.getProjects({ status: 'invalid' as Project['status'] }).subscribe({ error: (error) => actual = error });
    const backendError = { error: { code: 'INVALID_QUERY', message: '案件狀態無效。' } };
    http.expectOne(`${apiUrl}?status=invalid`)
      .flush(backendError, { status: 400, statusText: 'Bad Request' });
    expect(actual?.status).toBe(400);
    expect(actual?.error).toEqual(backendError);
  });

  it('GETs stats and unwraps all five server counts', () => {
    const stats: ProjectStats = { total: 100, pending: 20, inProgress: 40, completed: 30, cancelled: 10 };
    let actual: ProjectStats | undefined;
    service.getProjectStats().subscribe((value) => actual = value);
    const request = http.expectOne(`${apiUrl}/stats`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: stats });
    expect(actual).toEqual(stats);
  });

  it('accepts an all-zero stats response as successful data', () => {
    const stats: ProjectStats = { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
    let actual: ProjectStats | undefined;
    service.getProjectStats().subscribe((value) => actual = value);
    http.expectOne(`${apiUrl}/stats`).flush({ data: stats });
    expect(actual).toEqual(stats);
  });

  it('passes stats HTTP 500 through without converting it to zero counts', () => {
    let actual: HttpErrorResponse | undefined;
    service.getProjectStats().subscribe({ error: (error) => actual = error });
    const backendError = { error: { code: 'INTERNAL_ERROR', message: '請稍後重試。' } };
    http.expectOne(`${apiUrl}/stats`)
      .flush(backendError, { status: 500, statusText: 'Internal Server Error' });
    expect(actual?.status).toBe(500);
    expect(actual?.error).toEqual(backendError);
  });

  it('passes stats network errors through as HTTP status 0', () => {
    let actual: HttpErrorResponse | undefined;
    service.getProjectStats().subscribe({ error: (error) => actual = error });
    http.expectOne(`${apiUrl}/stats`).error(new ProgressEvent('error'));
    expect(actual?.status).toBe(0);
  });

  it('rejects a malformed stats envelope instead of reporting an empty dashboard', () => {
    let actual: Error | undefined;
    service.getProjectStats().subscribe({ error: (error) => actual = error });
    http.expectOne(`${apiUrl}/stats`).flush({ data: { total: 0 } });
    expect(actual?.message).toBe('Invalid project stats response');
  });

  it('uses GET /api/projects/:id and unwraps data without changing date strings', () => {
    let actual: Project | undefined;
    service.getProjectById(3).subscribe((value) => actual = value);

    const request = http.expectOne(`${apiUrl}/3`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: project });

    expect(actual).toEqual(project);
    expect(actual?.dueDate).toBe('2025-03-30');
    expect(actual?.updatedAt).toBe('2025-04-01T09:30:00.000Z');
  });

  it('treats an empty list as a successful response', () => {
    let actual: ProjectListResponse | undefined;
    service.getProjects().subscribe((value) => actual = value);
    http.expectOne(apiUrl).flush({ data: [], meta: { total: 0, limit: 20, offset: 0 } });

    expect(actual).toEqual({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
  });

  it.each([400, 404, 500])('passes HTTP %i errors to the caller', (status) => {
    let actual: HttpErrorResponse | undefined;
    service.getProjectById(3).subscribe({ error: (error) => actual = error });
    http.expectOne(`${apiUrl}/3`).flush(
      { error: { code: 'TEST_ERROR', message: 'Test response' } },
      { status, statusText: 'Test error' },
    );

    expect(actual).toBeInstanceOf(HttpErrorResponse);
    expect(actual?.status).toBe(status);
  });

  it('passes network failures as status 0', () => {
    let actual: HttpErrorResponse | undefined;
    service.getProjects().subscribe({ error: (error) => actual = error });
    http.expectOne(apiUrl).error(new ProgressEvent('error'));

    expect(actual).toBeInstanceOf(HttpErrorResponse);
    expect(actual?.status).toBe(0);
  });

  it('rejects a missing response envelope instead of treating it as an empty list', () => {
    let actual: Error | undefined;
    service.getProjects().subscribe({ error: (error) => actual = error });
    http.expectOne(apiUrl).flush(null);

    expect(actual?.message).toBe('Invalid project list response');
  });

  it('POSTs only create fields and unwraps the 201 Project without changing date strings', () => {
    const input = {
      name: '新案件', description: '測試描述', priority: 'high' as const,
      startDate: '2026-10-10', dueDate: '2026-11-10',
      id: 99, projectCode: 'client-code', status: 'completed',
      createdAt: 'client-time', updatedAt: 'client-time', deletedAt: 'client-time',
    } satisfies CreateProjectInput & Record<string, unknown>;
    const created: Project = { ...project, id: 4, name: '新案件', status: 'pending',
      startDate: input.startDate, dueDate: input.dueDate };
    let actual: Project | undefined;
    service.createProject(input).subscribe((value) => actual = value);

    const request = http.expectOne(apiUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: input.name, description: input.description, priority: input.priority,
      startDate: '2026-10-10', dueDate: '2026-11-10',
    });
    request.flush({ data: created }, { status: 201, statusText: 'Created' });

    expect(actual).toEqual(created);
    expect(actual?.startDate).toBe('2026-10-10');
    expect(actual?.dueDate).toBe('2026-11-10');
    expect(actual?.createdAt).toBe(project.createdAt);
  });

  it('POSTs only supplied optional fields', () => {
    service.createProject({ name: '新案件' }).subscribe();
    const request = http.expectOne(apiUrl);
    expect(request.request.body).toEqual({ name: '新案件' });
    request.flush({ data: { ...project, name: '新案件', status: 'pending' } }, { status: 201, statusText: 'Created' });
  });

  it('PATCHes only supplied metadata, preserving explicit null and leaving status out', () => {
    const input = { dueDate: null, status: 'cancelled', deletedAt: null, id: 99 } satisfies UpdateProjectInput & Record<string, unknown>;
    const updated: Project = { ...project, dueDate: null };
    let actual: Project | undefined;
    service.updateProject(3, input).subscribe((value) => actual = value);

    const request = http.expectOne(`${apiUrl}/3`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ dueDate: null });
    request.flush({ data: updated }, { status: 200, statusText: 'OK' });

    expect(actual).toEqual(updated);
    expect(actual?.startDate).toBe('2025-01-10');
    expect(actual?.createdAt).toBe(project.createdAt);
  });

  it('POSTs a transition with only toStatus and unwraps the 200 Project', () => {
    const changed: Project = { ...project, status: 'in_progress' };
    let actual: Project | undefined;
    service.transitionProjectStatus(3, 'in_progress').subscribe((value) => actual = value);

    const request = http.expectOne(`${apiUrl}/3/transitions`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ toStatus: 'in_progress' });
    request.flush({ data: changed }, { status: 200, statusText: 'OK' });

    expect(actual).toEqual(changed);
  });

  it('DELETEs by ID and treats 204 No Content as a void success', () => {
    let actual: unknown = 'not emitted';
    service.deleteProject(3).subscribe((value) => actual = value);

    const request = http.expectOne(`${apiUrl}/3`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toBeNull();
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(actual).toBeUndefined();
  });

  it.each([
    { label: 'invalid ID', status: 400, code: 'INVALID_ID' },
    { label: 'missing project', status: 404, code: 'PROJECT_NOT_FOUND' },
    { label: 'invalid transition', status: 409, code: 'INVALID_TRANSITION' },
    { label: 'server failure', status: 500, code: 'INTERNAL_ERROR' },
  ])('keeps HTTP $status $label status and backend error code', ({ status, code }) => {
    let actual: HttpErrorResponse | undefined;
    service.transitionProjectStatus(3, 'in_progress').subscribe({ error: (error) => actual = error });
    const backendError = { error: { code, message: 'Backend message' } };
    http.expectOne(`${apiUrl}/3/transitions`).flush(backendError, { status, statusText: 'Backend error' });

    expect(actual).toBeInstanceOf(HttpErrorResponse);
    expect(actual?.status).toBe(status);
    expect(actual?.error).toEqual(backendError);
  });

  it('keeps 422 fieldErrors and the backend code for form handling', () => {
    let actual: HttpErrorResponse | undefined;
    service.createProject({ name: '' }).subscribe({ error: (error) => actual = error });
    const backendError = { error: {
      code: 'VALIDATION_ERROR', message: '請修正案件資料。',
      fieldErrors: { name: [{ code: 'REQUIRED', message: '請輸入案件名稱。' }] },
    } };
    http.expectOne(apiUrl).flush(backendError, { status: 422, statusText: 'Unprocessable Entity' });

    expect(actual?.status).toBe(422);
    expect(actual?.error).toEqual(backendError);
    expect(actual?.error.error.fieldErrors.name[0].code).toBe('REQUIRED');
  });

  it('keeps network failures as HttpErrorResponse status 0 on mutations', () => {
    let actual: HttpErrorResponse | undefined;
    service.deleteProject(3).subscribe({ error: (error) => actual = error });
    http.expectOne(`${apiUrl}/3`).error(new ProgressEvent('error'));

    expect(actual).toBeInstanceOf(HttpErrorResponse);
    expect(actual?.status).toBe(0);
  });

  it('rejects a missing mutation response envelope instead of treating it as success', () => {
    let actual: Error | undefined;
    service.updateProject(3, { name: '改名' }).subscribe({ error: (error) => actual = error });
    http.expectOne(`${apiUrl}/3`).flush(null);

    expect(actual?.message).toBe('Invalid project detail response');
  });
});
