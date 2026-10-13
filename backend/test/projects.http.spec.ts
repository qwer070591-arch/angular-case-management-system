import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ApiExceptionFilter } from '../src/shared/api-exception.filter';
import { hashSessionToken } from '../src/auth/session.service';

const row = {
  id: 1,
  projectCode: 'PRJ-2026-0001',
  name: '公司官網改版',
  description: '網站更新',
  status: 'in_progress',
  priority: 'high',
  startDate: new Date('2026-01-06T00:00:00.000Z'),
  dueDate: new Date('2026-03-31T00:00:00.000Z'),
  createdAt: new Date('2026-01-06T09:00:00.000Z'),
  updatedAt: new Date('2026-01-15T04:30:00.000Z'),
  deletedAt: null,
};

describe('Projects HTTP (mocked Prisma, no database)', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request.agent>;
  const sessionToken = Buffer.alloc(32, 7).toString('base64url');
  const sessionFindUnique = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const groupBy = jest.fn();
  const findUnique = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const queryRaw = jest.fn();
  const transactionClient = { project: { create, update, findUnique }, $queryRaw: queryRaw };
  const transaction = jest.fn((callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ project: { findMany, count, groupBy, findUnique, update }, session: { findUnique: sessionFindUnique },
        $transaction: transaction, $queryRaw: queryRaw })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    const csrf = (await request(app.getHttpServer()).get('/api/auth/csrf')
      .set('Cookie', `case_session=${sessionToken}`).expect(200)).body.data.csrfToken as string;
    api = request.agent(app.getHttpServer());
    api.set('Cookie', `case_session=${sessionToken}; XSRF-TOKEN=${csrf}`);
    api.set('X-XSRF-TOKEN', csrf);
  });

  beforeEach(() => {
    sessionFindUnique.mockReset().mockResolvedValue({
      id: 1, userId: 1, tokenHash: hashSessionToken(sessionToken), revokedAt: null,
      createdAt: new Date(), lastSeenAt: new Date(),
      idleExpiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() + 60_000),
      user: { id: 1, name: '測試管理員', email: 'admin@example.test', role: 'admin', status: 'active', passwordHash: 'test-hash' },
    });
    findMany.mockReset().mockResolvedValue([row]);
    count.mockReset().mockResolvedValue(1);
    groupBy.mockReset().mockResolvedValue([]);
    findUnique.mockReset().mockResolvedValue(row);
    create.mockReset().mockImplementation(async ({ data }) => ({ ...row, id: 4, ...data }));
    update.mockReset().mockImplementation(async ({ data }) => ({ ...row, ...data }));
    queryRaw.mockReset().mockResolvedValue([{ id: row.id, last_sequence: new Prisma.Decimal(3) }]);
    transaction.mockClear();
  });

  afterAll(async () => { await app.close(); });

  it('GET /api/projects returns data/meta and serializes DATE as YYYY-MM-DD', async () => {
    const response = await api.get('/api/projects?status=in_progress&limit=5').expect(200);
    expect(response.body.meta).toEqual({ total: 1, limit: 5, offset: 0 });
    expect(response.body.data[0]).toMatchObject({
      id: 1, projectCode: 'PRJ-2026-0001', status: 'in_progress', priority: 'high',
      startDate: '2026-01-06', dueDate: '2026-03-31', createdAt: '2026-01-06T09:00:00.000Z',
    });
    expect(findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    expect(count.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it('GET /api/projects/stats resolves before /:id and returns all active counts', async () => {
    groupBy.mockResolvedValue([
      { status: 'pending', _count: { _all: 2 } },
      { status: 'in_progress', _count: { _all: 1 } },
      { status: 'completed', _count: { _all: 3 } },
      { status: 'cancelled', _count: { _all: 1 } },
    ]);
    const response = await api.get('/api/projects/stats').expect(200);
    expect(response.body).toEqual({ data: {
      total: 7, pending: 2, inProgress: 1, completed: 3, cancelled: 1,
    } });
    expect(groupBy).toHaveBeenCalledWith({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('GET /api/projects/stats returns zeros for an empty active set', async () => {
    expect((await api.get('/api/projects/stats').expect(200)).body).toEqual({ data: {
      total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0,
    } });
  });

  it('filters status before pagination and counts all matching active rows', async () => {
    count.mockResolvedValue(12);
    const response = await api
      .get('/api/projects?status=pending&limit=5&offset=5').expect(200);
    expect(response.body.meta).toEqual({ total: 12, limit: 5, offset: 5 });
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, status: 'pending' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 5,
      take: 5,
    });
    expect(count).toHaveBeenCalledWith({ where: { deletedAt: null, status: 'pending' } });
  });

  it('searches by name with q alone and preserves the database total', async () => {
    count.mockResolvedValue(8);
    const response = await api.get('/api/projects').query({ q: '官網' }).expect(200);
    const where = { deletedAt: null, name: { contains: '官網', mode: 'insensitive' } };
    expect(findMany).toHaveBeenCalledWith({
      where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: 0, take: 20,
    });
    expect(count).toHaveBeenCalledWith({ where });
    expect(response.body.meta).toEqual({ total: 8, limit: 20, offset: 0 });
  });

  it('combines trimmed q, status, and pagination with AND conditions', async () => {
    count.mockResolvedValue(6);
    const response = await api.get('/api/projects')
      .query({ q: ' 官網 ', status: 'in_progress', limit: 2, offset: 2 }).expect(200);
    const where = {
      deletedAt: null, status: 'in_progress', name: { contains: '官網', mode: 'insensitive' },
    };
    expect(findMany).toHaveBeenCalledWith({
      where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: 2, take: 2,
    });
    expect(count).toHaveBeenCalledWith({ where });
    expect(response.body.meta).toEqual({ total: 6, limit: 2, offset: 2 });
  });

  it.each(['', '   '])('treats q=%j as an unfiltered list', async (q) => {
    await api.get('/api/projects').query({ q }).expect(200);
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(count).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('returns an empty search page with the filtered meta envelope', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    const response = await api.get('/api/projects').query({ q: '不存在' }).expect(200);
    expect(response.body).toEqual({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
  });

  it.each(['/api/projects?q=' + 'x'.repeat(101), '/api/projects?q=first&q=second'])(
    'rejects invalid search query %s', async (url) => {
      const response = await api.get(url).expect(400);
      expect(response.body.error.code).toBe('INVALID_QUERY');
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('GET /api/projects/:id returns one mapped project', async () => {
    const response = await api.get('/api/projects/1').expect(200);
    expect(response.body.data.name).toBe('公司官網改版');
    expect(response.body.data.startDate).toBe('2026-01-06');
    expect(response.body.data).not.toHaveProperty('deletedAt');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 1, deletedAt: null } });
  });

  it.each(['0', '-1', '1.5', 'abc', '9007199254740992'])('rejects invalid id %s with 400', async (id) => {
    const response = await api.get(`/api/projects/${id}`).expect(400);
    expect(response.body.error.code).toBe('INVALID_ID');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns PROJECT_NOT_FOUND for a legal missing id', async () => {
    findUnique.mockResolvedValue(null);
    const response = await api.get('/api/projects/999999').expect(404);
    expect(response.body).toEqual({ error: { code: 'PROJECT_NOT_FOUND', message: '找不到案件。' } });
  });

  it('rejects invalid query values with 400', async () => {
    const response = await api.get('/api/projects?status=unknown').expect(400);
    expect(response.body.error.code).toBe('INVALID_QUERY');
  });

  it('does not expose internal errors or database details', async () => {
    findUnique.mockRejectedValue(new Error('password=secret internal SQL trace'));
    const response = await api.get('/api/projects/1').expect(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('POST creates a pending/medium project with Location and full response', async () => {
    const response = await api.post('/api/projects').send({ name: '  客服改善  ' }).expect(201);
    expect(response.headers.location).toBe('/api/projects/4');
    expect(response.body.data).toMatchObject({
      id: 4, name: '客服改善', status: 'pending', priority: 'medium',
      description: null, startDate: null, dueDate: null,
    });
    expect(create.mock.calls[0][0].data.projectCode).toMatch(/^PRJ-\d{4}-0003$/);
    expect(response.body.data.createdAt).toBe(response.body.data.updatedAt);
  });

  it('POST accepts custom priority and date-only values', async () => {
    const response = await api.post('/api/projects').send({
      name: '客服改善', priority: 'urgent', startDate: '2028-02-29', dueDate: '2028-03-01',
    }).expect(201);
    expect(response.body.data).toMatchObject({ priority: 'urgent', startDate: '2028-02-29', dueDate: '2028-03-01' });
  });

  it.each([
    ['blank name', { name: '   ' }, 'VALIDATION_ERROR', 'name'],
    ['long name', { name: 'x'.repeat(51) }, 'VALIDATION_ERROR', 'name'],
    ['long description', { name: 'test', description: 'x'.repeat(4001) }, 'VALIDATION_ERROR', 'description'],
    ['unknown priority', { name: 'test', priority: 'unknown' }, 'VALIDATION_ERROR', 'priority'],
    ['invalid date', { name: 'test', startDate: '2026-02-30' }, 'VALIDATION_ERROR', 'startDate'],
    ['reversed dates', { name: 'test', startDate: '2026-10-11', dueDate: '2026-10-10' }, 'VALIDATION_ERROR', 'dueDate'],
    ['status override', { name: 'test', status: 'completed' }, 'READ_ONLY_FIELD', 'status'],
    ['code override', { name: 'test', projectCode: 'PRJ-2026-9999' }, 'READ_ONLY_FIELD', 'projectCode'],
    ['deletedAt override', { name: 'test', deletedAt: '2026-01-01T00:00:00.000Z' }, 'READ_ONLY_FIELD', 'deletedAt'],
  ])('POST rejects %s with 422', async (_label, body, code, field) => {
    const response = await api.post('/api/projects').send(body).expect(422);
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.fieldErrors[field]).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('POST rejects malformed JSON with 400', async () => {
    const response = await api.post('/api/projects')
      .set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(response.body.error.code).toBe('MALFORMED_REQUEST');
  });

  it('PATCH changes only supplied fields and clears an explicit null', async () => {
    const response = await api.patch('/api/projects/1').send({ name: '更新名稱', dueDate: null }).expect(200);
    expect(response.body.data).toMatchObject({
      id: 1, projectCode: row.projectCode, name: '更新名稱', status: row.status,
      dueDate: null, createdAt: row.createdAt.toISOString(),
    });
    expect(update.mock.calls[0][0].data).toMatchObject({ name: '更新名稱', dueDate: null });
  });

  it('PATCH validates the merged date range, not only supplied fields', async () => {
    const response = await api.patch('/api/projects/1')
      .send({ startDate: '2026-04-01' }).expect(422);
    expect(response.body.error.fieldErrors.dueDate[0].code).toBe('BEFORE_START_DATE');
    expect(update).not.toHaveBeenCalled();
  });

  it('PATCH rejects read-only fields, empty bodies, bad IDs and missing projects', async () => {
    expect((await api.patch('/api/projects/1').send({ status: 'completed' }).expect(422)).body.error.code).toBe('READ_ONLY_FIELD');
    expect((await api.patch('/api/projects/1').send({ deletedAt: null }).expect(422)).body.error.code).toBe('READ_ONLY_FIELD');
    expect((await api.patch('/api/projects/1').send({}).expect(400)).body.error.code).toBe('MALFORMED_REQUEST');
    expect((await api.patch('/api/projects/abc').send({ name: 'test' }).expect(400)).body.error.code).toBe('INVALID_ID');
    queryRaw.mockResolvedValue([]);
    expect((await api.patch('/api/projects/999999').send({ name: 'test' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(update).not.toHaveBeenCalled();
  });

  it('POST /api/projects/:id/transitions returns the updated full Project', async () => {
    const response = await api.post('/api/projects/1/transitions')
      .send({ toStatus: 'completed' }).expect(200);
    expect(response.body.data).toMatchObject({
      id: row.id, projectCode: row.projectCode, name: row.name, status: 'completed',
      priority: row.priority, createdAt: row.createdAt.toISOString(),
    });
    expect(update.mock.calls[0][0].where).toEqual({ id: row.id, status: row.status, updatedAt: row.updatedAt, deletedAt: null });
    expect(update.mock.calls[0][0].data.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });

  it('POST /api/projects/:id/transitions rejects invalid transitions and IDs', async () => {
    const invalid = await api.post('/api/projects/1/transitions')
      .send({ toStatus: 'in_progress' }).expect(409);
    expect(invalid.body.error.code).toBe('INVALID_TRANSITION');
    expect(update).not.toHaveBeenCalled();
    expect((await api.post('/api/projects/abc/transitions')
      .send({ toStatus: 'completed' }).expect(400)).body.error.code).toBe('INVALID_ID');
    findUnique.mockResolvedValue(null);
    expect((await api.post('/api/projects/999999/transitions')
      .send({ toStatus: 'completed' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it.each([
    [{}, 'VALIDATION_ERROR'],
    [{ toStatus: 'unknown' }, 'VALIDATION_ERROR'],
    [{ toStatus: null }, 'VALIDATION_ERROR'],
    [{ toStatus: 'completed', status: 'completed' }, 'READ_ONLY_FIELD'],
    [{ toStatus: 'completed', projectCode: 'PRJ-2026-9999' }, 'READ_ONLY_FIELD'],
    [{ toStatus: 'completed', extra: true }, 'VALIDATION_ERROR'],
  ])('rejects invalid transition body %j', async (body, code) => {
    const response = await api.post('/api/projects/1/transitions').send(body).expect(422);
    expect(response.body.error.code).toBe(code);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects malformed transition JSON with 400', async () => {
    const response = await api.post('/api/projects/1/transitions')
      .set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(response.body.error.code).toBe('MALFORMED_REQUEST');
  });

  it('DELETE /api/projects/:id returns 204 without a body', async () => {
    const response = await api.delete('/api/projects/1').expect(204);
    expect(response.text).toBe('');
    expect(response.body).toEqual({});
  });

  it('DELETE rejects invalid IDs and missing or already-deleted projects', async () => {
    expect((await api.delete('/api/projects/nope').expect(400)).body.error.code).toBe('INVALID_ID');
    queryRaw.mockResolvedValue([]);
    expect((await api.delete('/api/projects/999999').expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.delete('/api/projects/1').expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('GET, PATCH and transition treat a deleted project as not found', async () => {
    findUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);
    expect((await api.get('/api/projects/1').expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.patch('/api/projects/1').send({ name: 'changed' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.post('/api/projects/1/transitions').send({ toStatus: 'completed' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not expose internal database errors from POST', async () => {
    queryRaw.mockRejectedValue(new Error('password=secret internal SQL trace'));
    const response = await api.post('/api/projects').send({ name: 'test' }).expect(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
