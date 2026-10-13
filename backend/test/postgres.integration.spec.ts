import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedDevelopmentProjects } from '../prisma/seed';
import { ApiExceptionFilter } from '../src/shared/api-exception.filter';
import { PROJECT_STATUSES, ProjectStatus } from '../src/projects/project-query';
import { canTransitionProjectStatus } from '../src/projects/project-transition';
import { hashPassword } from '../src/auth/auth.service';
import { hashSessionToken, SessionService } from '../src/auth/session.service';
import { randomBytes } from 'node:crypto';

// Run only through npm run test:db, which checks the isolated *_test URL and applies migrations.
describe('PostgreSQL integration (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let api: ReturnType<typeof request.agent>;
  let testAdminId: number;
  const testAdminEmail = 'admin@phase6a-auth.test';
  const authFixturePassword = randomBytes(24).toString('base64url');

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) !== 'case_management_test') {
      throw new Error('Integration tests may only use case_management_test.');
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const prior = await prisma.user.findUnique({ where: { email: testAdminEmail } });
    if (prior) {
      await prisma.session.deleteMany({ where: { userId: prior.id } });
      await prisma.user.delete({ where: { id: prior.id } });
    }
    const admin = await prisma.user.create({ data: {
      name: '測試管理員', email: testAdminEmail, role: 'admin', status: 'active',
      passwordHash: await hashPassword(authFixturePassword),
    } });
    testAdminId = admin.id;
    const sessionToken = randomBytes(32).toString('base64url');
    const now = new Date();
    await prisma.session.create({ data: {
      userId: admin.id, tokenHash: hashSessionToken(sessionToken),
      idleExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    } });
    const csrf = (await request(app.getHttpServer()).get('/api/auth/csrf')
      .set('Cookie', `case_session=${sessionToken}`).expect(200)).body.data.csrfToken as string;
    api = request.agent(app.getHttpServer());
    api.set('Cookie', `case_session=${sessionToken}; XSRF-TOKEN=${csrf}`);
    api.set('X-XSRF-TOKEN', csrf);
  });

  afterAll(async () => {
    if (prisma && testAdminId) {
      await prisma.session.deleteMany({ where: { userId: testAdminId } });
      await prisma.user.delete({ where: { id: testAdminId } });
    }
    await app?.close();
  });

  afterEach(async () => {
    // Only remove records created by this suite; fixed development seed rows remain untouched.
    await prisma.project.deleteMany({ where: { OR: [
      { name: { startsWith: '[5C2A]' } },
      { name: { startsWith: '[5C2B]' } },
      { name: { startsWith: '[5C3B0]' } },
      { name: { startsWith: '[5C3B1]' } },
    ] } });
  });

  async function createSoftDeleteProject() {
    const response = await api.post('/api/projects').send({
      name: '[5C2B] soft-delete project', description: 'Keep this metadata',
      priority: 'high', startDate: '2028-01-10', dueDate: '2028-02-10',
    }).expect(201);
    return response.body.data;
  }

  async function waitForBlockedStatements(expected: number): Promise<void> {
    let waiting = 0;
    const deadline = Date.now() + 3_000;
    while (waiting < expected && Date.now() < deadline) {
      const locks = await prisma.$queryRaw<Array<{ waiting: number }>>`
        SELECT COUNT(*)::integer AS waiting
        FROM pg_locks AS lock
        JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
        WHERE NOT lock.granted AND activity.datname = current_database()
      `;
      waiting = locks[0].waiting;
      if (waiting < expected) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBeGreaterThanOrEqual(expected);
  }

  async function createTransitionProject(): Promise<{ id: number; [key: string]: unknown }> {
    const response = await api.post('/api/projects').send({
      name: '[5C2A] transition project', description: 'Preserve this description',
      priority: 'urgent', startDate: '2028-01-10', dueDate: '2028-02-10',
    }).expect(201);
    return response.body.data;
  }

  async function moveToStatus(id: number, status: ProjectStatus): Promise<void> {
    if (status === 'pending') return;
    await api.post(`/api/projects/${id}/transitions`)
      .send({ toStatus: status === 'cancelled' ? 'cancelled' : 'in_progress' }).expect(200);
    if (status === 'completed') {
      await api.post(`/api/projects/${id}/transitions`)
        .send({ toStatus: 'completed' }).expect(200);
    }
  }

  it('connects to PostgreSQL and sees the applied migration', async () => {
    const result = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    expect(result.some((row) => row.migration_name === '20261009000100_init_projects')).toBe(true);
    expect(result.some((row) => row.migration_name === '20261010000100_project_code_counters')).toBe(true);
    expect(result.some((row) => row.migration_name === '20261010000200_project_soft_delete')).toBe(true);
    await seedDevelopmentProjects(prisma);
    const seeded = await prisma.project.findUniqueOrThrow({ where: { projectCode: 'PRJ-2026-0001' } });
    expect(seeded.deletedAt).toBeNull();
  });

  it('seeds three development projects idempotently without overwriting edits', async () => {
    await seedDevelopmentProjects(prisma);
    expect(await prisma.project.count({ where: { projectCode: { in: ['PRJ-2026-0001', 'PRJ-2026-0002', 'PRJ-2025-0001'] } } })).toBe(3);
    const original = await prisma.project.findUniqueOrThrow({ where: { projectCode: 'PRJ-2026-0001' } });
    try {
      await prisma.project.update({ where: { id: original.id }, data: { name: '本機測試修改' } });
      expect(await seedDevelopmentProjects(prisma)).toBe(0);
      const after = await prisma.project.findUniqueOrThrow({ where: { id: original.id } });
      expect(after.name).toBe('本機測試修改');
    } finally {
      await prisma.project.update({ where: { id: original.id }, data: { name: original.name } });
    }
  });

  it('reads seeded projects through real HTTP and preserves API date/status/priority values', async () => {
    await seedDevelopmentProjects(prisma);
    const list = await api.get('/api/projects?limit=5').expect(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(3);
    expect(list.body.data.map((project: { id: number }) => project.id)).toContain(1);

    const detail = await api.get('/api/projects/1').expect(200);
    expect(detail.body.data).toMatchObject({
      id: 1, projectCode: 'PRJ-2026-0001', status: 'in_progress', priority: 'high',
      startDate: '2026-01-06', dueDate: '2026-03-31',
    });
    expect(detail.body.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    await api.get('/api/projects/999999').expect(404);
    await api.get('/api/projects/not-a-number').expect(400);
  });

  it('returns full active PostgreSQL statistics including cancelled but excluding soft-deleted rows', async () => {
    const baseline = (await api.get('/api/projects/stats').expect(200)).body.data;
    expect(baseline.total).toBe(baseline.pending + baseline.inProgress + baseline.completed + baseline.cancelled);

    const ids: number[] = [];
    for (const status of PROJECT_STATUSES) {
      const created = await api.post('/api/projects')
        .send({ name: `[5C3B0] stats ${status}` }).expect(201);
      ids.push(created.body.data.id);
      await moveToStatus(created.body.data.id, status);
    }
    const removed = await api.post('/api/projects')
      .send({ name: '[5C3B0] stats deleted' }).expect(201);
    await api.delete(`/api/projects/${removed.body.data.id}`).expect(204);

    const stats = (await api.get('/api/projects/stats').expect(200)).body.data;
    expect(stats).toEqual({
      total: baseline.total + 4,
      pending: baseline.pending + 1,
      inProgress: baseline.inProgress + 1,
      completed: baseline.completed + 1,
      cancelled: baseline.cancelled + 1,
    });
    expect(stats.total).toBe(stats.pending + stats.inProgress + stats.completed + stats.cancelled);
    expect(ids).toHaveLength(4);
  });

  it('filters active projects in PostgreSQL before pagination and uses updatedAt/id ordering', async () => {
    const ids: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await api.post('/api/projects')
        .send({ name: `[5C3B0] list ${index}` }).expect(201);
      ids.push(created.body.data.id);
    }
    const sameTimestamp = new Date();
    await prisma.project.updateMany({ where: { id: { in: ids } }, data: { updatedAt: sameTimestamp } });

    const first = await api.get('/api/projects')
      .query({ q: '[5C3B0] list', status: 'pending', limit: 2, offset: 0 }).expect(200);
    expect(first.body.meta).toEqual({ total: 3, limit: 2, offset: 0 });
    expect(first.body.data.map((project: { id: number }) => project.id)).toEqual([...ids].sort((a, b) => b - a).slice(0, 2));
    const second = await api.get('/api/projects')
      .query({ q: '[5C3B0] list', status: 'pending', limit: 2, offset: 2 }).expect(200);
    expect(second.body.meta).toEqual({ total: 3, limit: 2, offset: 2 });
    expect(second.body.data.map((project: { id: number }) => project.id)).toEqual([ids[0]]);

    await api.post(`/api/projects/${ids[0]}/transitions`)
      .send({ toStatus: 'cancelled' }).expect(200);
    await api.delete(`/api/projects/${ids[1]}`).expect(204);
    const pending = await api.get('/api/projects')
      .query({ q: '[5C3B0] list', status: 'pending', limit: 1, offset: 0 }).expect(200);
    expect(pending.body.meta.total).toBe(1);
    expect(pending.body.data.map((project: { id: number }) => project.id)).toEqual([ids[2]]);
    const cancelled = await api.get('/api/projects')
      .query({ q: '[5C3B0] list', status: 'cancelled' }).expect(200);
    expect(cancelled.body.meta.total).toBe(1);
    expect(cancelled.body.data.map((project: { id: number }) => project.id)).toEqual([ids[0]]);
  });

  it('rejects an invalid list status with the existing query error contract', async () => {
    const response = await api.get('/api/projects?status=unknown').expect(400);
    expect(response.body.error.code).toBe('INVALID_QUERY');
  });

  it('searches real PostgreSQL names with Chinese partial matches, status, pagination, and soft-delete exclusion', async () => {
    const create = async (name: string, description?: string) => (
      await api.post('/api/projects').send({ name, description }).expect(201)
    ).body.data;
    const first = await create('[5C3B1] 蘭嶼官網第一案');
    const second = await create('[5C3B1] 蘭嶼官網第二案');
    const working = await create('[5C3B1] 蘭嶼官網進行案');
    const deleted = await create('[5C3B1] 蘭嶼官網刪除案');
    await create('[5C3B1] 說明專用', '蘭嶼官網');
    const english = await create('[5C3B1] Website Upgrade');

    await api.post(`/api/projects/${working.id}/transitions`)
      .send({ toStatus: 'in_progress' }).expect(200);
    await api.delete(`/api/projects/${deleted.id}`).expect(204);
    const sameTimestamp = new Date();
    await prisma.project.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { updatedAt: sameTimestamp } });

    const allMatches = await api.get('/api/projects')
      .query({ q: '蘭嶼官網' }).expect(200);
    expect(allMatches.body.meta.total).toBe(3);
    expect(allMatches.body.data.map((project: { id: number }) => project.id).sort((a: number, b: number) => a - b))
      .toEqual([first.id, second.id, working.id]);

    const firstPage = await api.get('/api/projects')
      .query({ q: '  蘭嶼官網  ', status: 'pending', limit: 1, offset: 0 }).expect(200);
    const secondPage = await api.get('/api/projects')
      .query({ q: '蘭嶼官網', status: 'pending', limit: 1, offset: 1 }).expect(200);
    expect(firstPage.body.meta).toEqual({ total: 2, limit: 1, offset: 0 });
    expect(secondPage.body.meta).toEqual({ total: 2, limit: 1, offset: 1 });
    expect([firstPage.body.data[0].id, secondPage.body.data[0].id]).toEqual([second.id, first.id]);

    const englishMatch = await api.get('/api/projects')
      .query({ q: 'wEbSiTe uPgRaDe' }).expect(200);
    expect(englishMatch.body.data.map((project: { id: number }) => project.id)).toEqual([english.id]);
    expect(englishMatch.body.meta.total).toBe(1);
    const codeMatch = await api.get('/api/projects')
      .query({ q: first.projectCode }).expect(200);
    expect(codeMatch.body).toEqual({ data: [], meta: { total: 0, limit: 20, offset: 0 } });
    const missing = await api.get('/api/projects')
      .query({ q: '蘭嶼官網不存在' }).expect(200);
    expect(missing.body.meta.total).toBe(0);
  });

  it('initializes yearly counters from existing seed codes without changing those rows', async () => {
    await seedDevelopmentProjects(prisma);
    const seed = await prisma.project.findUniqueOrThrow({ where: { projectCode: 'PRJ-2026-0002' } });
    expect(seed.name).toBe('會員系統開發');
    expect(seed.id).toBe(2);
    const counter2026 = await prisma.projectCodeCounter.findUniqueOrThrow({ where: { year: 2026 } });
    const counter2025 = await prisma.projectCodeCounter.findUniqueOrThrow({ where: { year: 2025 } });
    expect(Number(counter2026.lastSequence)).toBeGreaterThanOrEqual(2);
    expect(Number(counter2025.lastSequence)).toBeGreaterThanOrEqual(1);
  });

  it('POST creates a complete pending project, permits duplicate names, and remains readable by GET', async () => {
    await seedDevelopmentProjects(prisma);
    const input = {
      name: '[5C2A] 同名案件', description: '  真實資料庫測試  ', priority: 'high',
      startDate: '2028-02-29', dueDate: '2028-03-01',
    };
    const first = await api.post('/api/projects').send(input).expect(201);
    const second = await api.post('/api/projects').send({ name: input.name }).expect(201);
    expect(first.headers.location).toBe(`/api/projects/${first.body.data.id}`);
    expect(first.body.data).toMatchObject({
      name: input.name, description: '真實資料庫測試', status: 'pending', priority: 'high',
      startDate: '2028-02-29', dueDate: '2028-03-01',
    });
    expect(first.body.data.projectCode).toMatch(/^PRJ-\d{4}-\d{4,}$/);
    expect(first.body.data.createdAt).toBe(first.body.data.updatedAt);
    expect(second.body.data).toMatchObject({ name: input.name, status: 'pending', priority: 'medium' });
    expect(second.body.data.projectCode).not.toBe(first.body.data.projectCode);
    const detail = await api.get(`/api/projects/${first.body.data.id}`).expect(200);
    expect(detail.body.data).toEqual(first.body.data);
  });

  it.each([
    ['blank name', { name: '   ' }, 'VALIDATION_ERROR'],
    ['long name', { name: 'x'.repeat(51) }, 'VALIDATION_ERROR'],
    ['long description', { name: '[5C2A] test', description: 'x'.repeat(4001) }, 'VALIDATION_ERROR'],
    ['invalid priority', { name: '[5C2A] test', priority: 'critical' }, 'VALIDATION_ERROR'],
    ['invalid date', { name: '[5C2A] test', startDate: '2026-02-30' }, 'VALIDATION_ERROR'],
    ['reversed dates', { name: '[5C2A] test', startDate: '2026-10-12', dueDate: '2026-10-11' }, 'VALIDATION_ERROR'],
    ['status override', { name: '[5C2A] test', status: 'completed' }, 'READ_ONLY_FIELD'],
    ['code override', { name: '[5C2A] test', projectCode: 'PRJ-2026-9999' }, 'READ_ONLY_FIELD'],
  ])('POST rejects %s against the real DB', async (_label, body, code) => {
    const response = await api.post('/api/projects').send(body).expect(422);
    expect(response.body.error.code).toBe(code);
  });

  it('PATCH partially updates fields, clears nullable values, and preserves system metadata', async () => {
    const created = (await api.post('/api/projects').send({
      name: '[5C2A] 編輯案件', description: '原描述', priority: 'low',
      startDate: '2028-01-10', dueDate: '2028-01-20',
    }).expect(201)).body.data;
    const updated = (await api.patch(`/api/projects/${created.id}`)
      .send({ description: null, priority: 'urgent' }).expect(200)).body.data;
    expect(updated).toMatchObject({
      id: created.id, projectCode: created.projectCode, name: created.name,
      status: 'pending', priority: 'urgent', description: null,
      startDate: '2028-01-10', dueDate: '2028-01-20', createdAt: created.createdAt,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    const stored = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.projectCode).toBe(created.projectCode);
    expect(stored.createdAt.toISOString()).toBe(created.createdAt);
    expect(stored.status).toBe('pending');
  });

  it('PATCH validates dates against stored values and permits an explicit null clear', async () => {
    const created = (await api.post('/api/projects').send({
      name: '[5C2A] 日期案件', startDate: '2028-01-10', dueDate: '2028-01-20',
    }).expect(201)).body.data;
    const invalid = await api.patch(`/api/projects/${created.id}`)
      .send({ startDate: '2028-01-21' }).expect(422);
    expect(invalid.body.error.fieldErrors.dueDate[0].code).toBe('BEFORE_START_DATE');
    expect((await api.get(`/api/projects/${created.id}`).expect(200)).body.data).toEqual(created);
    const cleared = (await api.patch(`/api/projects/${created.id}`)
      .send({ dueDate: null }).expect(200)).body.data;
    expect(cleared.dueDate).toBeNull();
    const moved = (await api.patch(`/api/projects/${created.id}`)
      .send({ startDate: '2028-01-21' }).expect(200)).body.data;
    expect(moved.startDate).toBe('2028-01-21');
  });

  it('PATCH rejects missing projects, invalid IDs, and read-only fields', async () => {
    expect((await api.patch('/api/projects/2147483647').send({ name: '[5C2A] test' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.patch('/api/projects/nope').send({ name: '[5C2A] test' }).expect(400)).body.error.code).toBe('INVALID_ID');
    expect((await api.patch('/api/projects/1').send({ status: 'completed' }).expect(422)).body.error.code).toBe('READ_ONLY_FIELD');
    expect((await api.patch('/api/projects/1').send({}).expect(400)).body.error.code).toBe('MALFORMED_REQUEST');
  });

  it('allocates distinct project codes under concurrent POST requests', async () => {
    await seedDevelopmentProjects(prisma);
    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      api.post('/api/projects').send({ name: '[5C2A] 併發案件' })));
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(201));
    const codes = responses.map((response) => response.body.data.projectCode as string);
    expect(new Set(codes).size).toBe(8);
    expect(await prisma.project.count({ where: { projectCode: { in: codes } } })).toBe(8);
  });

  it('returns 409 rather than overflowing the maximum 23-digit code sequence', async () => {
    const year = new Date().getUTCFullYear();
    const original = await prisma.projectCodeCounter.findUnique({ where: { year } });
    await prisma.projectCodeCounter.upsert({
      where: { year },
      create: { year, lastSequence: '99999999999999999999999' },
      update: { lastSequence: '99999999999999999999999' },
    });
    try {
      const response = await api.post('/api/projects')
        .send({ name: '[5C2A] 溢位案件' }).expect(409);
      expect(response.body.error.code).toBe('CODE_EXHAUSTED');
      expect(await prisma.project.count({ where: { name: '[5C2A] 溢位案件' } })).toBe(0);
    } finally {
      if (original) {
        await prisma.projectCodeCounter.update({ where: { year }, data: { lastSequence: original.lastSequence } });
      } else {
        await prisma.projectCodeCounter.delete({ where: { year } });
      }
    }
  });

  const statusPairs = PROJECT_STATUSES.flatMap((from) => PROJECT_STATUSES.map((to) => ({ from, to })));

  it.each(statusPairs.filter(({ from, to }) => canTransitionProjectStatus(from, to)))(
    'persists legal transition $from -> $to and preserves metadata', async ({ from, to }) => {
      const created = await createTransitionProject();
      await moveToStatus(created.id, from);
      const before = (await api.get(`/api/projects/${created.id}`).expect(200)).body.data;

      const response = await api.post(`/api/projects/${created.id}/transitions`)
        .send({ toStatus: to }).expect(200);
      expect(response.body.data).toMatchObject({
        id: created.id, projectCode: created.projectCode, name: created.name,
        description: created.description, priority: created.priority,
        startDate: created.startDate, dueDate: created.dueDate,
        createdAt: created.createdAt, status: to,
      });
      expect(Date.parse(response.body.data.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
      const stored = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.status).toBe(to);
      expect(stored.updatedAt.toISOString()).toBe(response.body.data.updatedAt);
      expect(stored.createdAt.toISOString()).toBe(created.createdAt);
    },
  );

  it.each(statusPairs.filter(({ from, to }) => !canTransitionProjectStatus(from, to)))(
    'rejects illegal transition $from -> $to without changing the row', async ({ from, to }) => {
      const created = await createTransitionProject();
      await moveToStatus(created.id, from);
      const before = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      const response = await api.post(`/api/projects/${created.id}/transitions`)
        .send({ toStatus: to }).expect(409);
      expect(response.body.error).toMatchObject({
        code: 'INVALID_TRANSITION', details: { currentStatus: from, requestedStatus: to },
      });
      const after = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      expect(after).toEqual(before);
    },
  );

  it('rejects malformed IDs, missing projects and invalid transition bodies', async () => {
    const created = await createTransitionProject();
    expect((await api.post('/api/projects/nope/transitions')
      .send({ toStatus: 'in_progress' }).expect(400)).body.error.code).toBe('INVALID_ID');
    expect((await api.post('/api/projects/2147483647/transitions')
      .send({ toStatus: 'in_progress' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.post(`/api/projects/${created.id}/transitions`)
      .send({ toStatus: 'unknown' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await api.post(`/api/projects/${created.id}/transitions`)
      .send({ toStatus: 'in_progress', status: 'completed' }).expect(422)).body.error.code).toBe('READ_ONLY_FIELD');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('pending');
  });

  it('allows only one of two concurrent transitions from the same state', async () => {
    const created = await createTransitionProject();
    const url = `/api/projects/${created.id}/transitions`;
    const responses = await Promise.all([
      api.post(url).send({ toStatus: 'in_progress' }),
      api.post(url).send({ toStatus: 'in_progress' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe('INVALID_TRANSITION');
    const stored = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe('in_progress');
  });

  it('does not let a stale concurrent target overwrite a different completed transition', async () => {
    const created = await createTransitionProject();
    let lockReady!: () => void;
    let releaseLock!: () => void;
    const ready = new Promise<void>((resolve) => { lockReady = resolve; });
    const released = new Promise<void>((resolve) => { releaseLock = resolve; });
    const holder = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${created.id} FOR UPDATE`;
      lockReady();
      await released;
    }, { timeout: 10_000 });

    try {
      await ready;
      const url = `/api/projects/${created.id}/transitions`;
      // Start both HTTP requests before releasing the row lock. Plain reads see
      // pending, while their conditional UPDATE statements wait in PostgreSQL.
      const first = api.post(url).send({ toStatus: 'in_progress' }).then((response) => response);
      const second = api.post(url).send({ toStatus: 'cancelled' }).then((response) => response);

      let waiting = 0;
      const deadline = Date.now() + 3_000;
      while (waiting < 2 && Date.now() < deadline) {
        const locks = await prisma.$queryRaw<Array<{ waiting: number }>>`
          SELECT COUNT(*)::integer AS waiting
          FROM pg_locks AS lock
          JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
          WHERE NOT lock.granted AND activity.datname = current_database()
        `;
        waiting = locks[0].waiting;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
      releaseLock();
      await holder;

      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(responses.find((response) => response.status === 409)?.body.error.code).toBe('INVALID_TRANSITION');
      const winner = responses.find((response) => response.status === 200)?.body.data.status;
      expect((await prisma.project.findUniqueOrThrow({ where: { id: created.id } })).status).toBe(winner);
    } finally {
      releaseLock();
      await holder;
    }
  }, 10_000);

  it('soft-deletes without a body, hides the row, and preserves stored metadata', async () => {
    const created = await createSoftDeleteProject();
    const response = await api.delete(`/api/projects/${created.id}`).expect(204);
    expect(response.text).toBe('');
    expect(response.body).toEqual({});

    const stored = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toMatchObject({
      id: created.id, projectCode: created.projectCode, name: created.name,
      description: created.description, status: created.status, priority: created.priority,
    });
    expect(stored.createdAt.toISOString()).toBe(created.createdAt);
    expect(stored.startDate?.toISOString().slice(0, 10)).toBe(created.startDate);
    expect(stored.dueDate?.toISOString().slice(0, 10)).toBe(created.dueDate);
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.deletedAt?.toISOString()).toBe(stored.updatedAt.toISOString());
    expect(stored.updatedAt.getTime()).toBeGreaterThan(Date.parse(created.updatedAt));

    expect((await api.get(`/api/projects/${created.id}`).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.patch(`/api/projects/${created.id}`)
      .send({ name: '[5C2B] changed' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.post(`/api/projects/${created.id}/transitions`)
      .send({ toStatus: 'in_progress' }).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await api.delete(`/api/projects/${created.id}`).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect(await prisma.project.findUniqueOrThrow({ where: { id: created.id } })).toEqual(stored);
  });

  it('excludes deleted projects from filtered total and every pagination page', async () => {
    const projects = await Promise.all(Array.from({ length: 3 }, () => createSoftDeleteProject()));
    await api.delete(`/api/projects/${projects[1].id}`).expect(204);
    const pages = await Promise.all([0, 1].map((offset) => api.get('/api/projects')
      .query({ q: '[5C2B]', status: 'pending', limit: 1, offset }).expect(200)));
    expect(pages.map((page) => page.body.meta.total)).toEqual([2, 2]);
    expect(pages.map((page) => page.body.data.length)).toEqual([1, 1]);
    expect(new Set(pages.map((page) => page.body.data[0].id))).toEqual(new Set([projects[0].id, projects[2].id]));
    expect(pages.every((page) => !page.body.data[0].deletedAt)).toBe(true);
  });

  it('keeps cancelled visible until deleted and never reuses a deleted code', async () => {
    const created = await createSoftDeleteProject();
    await api.post(`/api/projects/${created.id}/transitions`)
      .send({ toStatus: 'cancelled' }).expect(200);
    const before = await api.get('/api/projects')
      .query({ q: '[5C2B]', status: 'cancelled' }).expect(200);
    expect(before.body.data.map((project: { id: number }) => project.id)).toContain(created.id);
    await api.delete(`/api/projects/${created.id}`).expect(204);
    const after = await api.get('/api/projects')
      .query({ q: '[5C2B]', status: 'cancelled' }).expect(200);
    expect(after.body.meta.total).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('cancelled');

    const next = await createSoftDeleteProject();
    expect(next.name).toBe(created.name);
    expect(next.projectCode).not.toBe(created.projectCode);
    await expect(prisma.project.create({ data: {
      projectCode: created.projectCode, name: '[5C2B] duplicate code',
    } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects client deletedAt writes, invalid DELETE IDs and missing projects', async () => {
    const created = await createSoftDeleteProject();
    const post = await api.post('/api/projects')
      .send({ name: '[5C2B] invalid', deletedAt: null }).expect(422);
    expect(post.body.error).toMatchObject({ code: 'READ_ONLY_FIELD' });
    expect(post.body.error.fieldErrors.deletedAt).toBeDefined();
    const patch = await api.patch(`/api/projects/${created.id}`)
      .send({ deletedAt: null }).expect(422);
    expect(patch.body.error.fieldErrors.deletedAt).toBeDefined();
    const transition = await api.post(`/api/projects/${created.id}/transitions`)
      .send({ toStatus: 'in_progress', deletedAt: null }).expect(422);
    expect(transition.body.error.fieldErrors.deletedAt).toBeDefined();
    expect((await api.delete('/api/projects/nope').expect(400)).body.error.code).toBe('INVALID_ID');
    expect((await api.delete('/api/projects/2147483647').expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: created.id } })).deletedAt).toBeNull();
  });

  it('does not revive a soft-deleted development seed when seeding again', async () => {
    await seedDevelopmentProjects(prisma);
    const original = await prisma.project.findUniqueOrThrow({ where: { projectCode: 'PRJ-2026-0001' } });
    try {
      await api.delete(`/api/projects/${original.id}`).expect(204);
      expect(await seedDevelopmentProjects(prisma)).toBe(0);
      const after = await prisma.project.findUniqueOrThrow({ where: { id: original.id } });
      expect(after.deletedAt).not.toBeNull();
      expect(after.projectCode).toBe(original.projectCode);
      expect((await api.get(`/api/projects/${original.id}`).expect(404)).body.error.code).toBe('PROJECT_NOT_FOUND');
    } finally {
      // Restore this fixed seed fixture in the isolated test DB only.
      await prisma.project.update({ where: { id: original.id }, data: {
        deletedAt: original.deletedAt, updatedAt: original.updatedAt,
      } });
    }
  });

  it('lets only one of two concurrent DELETE requests succeed', async () => {
    const created = await createSoftDeleteProject();
    const url = `/api/projects/${created.id}`;
    const responses = await Promise.all([
      api.delete(url),
      api.delete(url),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 404]);
    expect(responses.find((response) => response.status === 404)?.body.error.code).toBe('PROJECT_NOT_FOUND');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: created.id } })).deletedAt).not.toBeNull();
  });

  it.each(['PATCH', 'transition'])('prevents %s from writing after a concurrent DELETE', async (mutation) => {
    const created = await createSoftDeleteProject();
    let lockReady!: () => void;
    let releaseLock!: () => void;
    const ready = new Promise<void>((resolve) => { lockReady = resolve; });
    const released = new Promise<void>((resolve) => { releaseLock = resolve; });
    const holder = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${created.id} FOR UPDATE`;
      lockReady();
      await released;
    }, { timeout: 10_000 });

    try {
      await ready;
      const deletion = api.delete(`/api/projects/${created.id}`).then((response) => response);
      await waitForBlockedStatements(1);
      const writing = mutation === 'PATCH'
        ? api.patch(`/api/projects/${created.id}`)
          .send({ name: '[5C2B] changed' }).then((response) => response)
        : api.post(`/api/projects/${created.id}/transitions`)
          .send({ toStatus: 'in_progress' }).then((response) => response);
      await waitForBlockedStatements(2);
      releaseLock();
      await holder;

      const [deleted, attempted] = await Promise.all([deletion, writing]);
      expect(deleted.status).toBe(204);
      expect(attempted.status).toBe(404);
      expect(attempted.body.error.code).toBe('PROJECT_NOT_FOUND');
      const stored = await prisma.project.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.deletedAt).not.toBeNull();
      expect(stored.name).toBe(created.name);
      expect(stored.status).toBe('pending');
    } finally {
      releaseLock();
      await holder;
    }
  }, 10_000);

  describe('employee and session data model', () => {
    const testDomain = '@phase6a-model.test';
    const firstHash = 'a'.repeat(64);
    const secondHash = 'b'.repeat(64);

    afterEach(async () => {
      const users = await prisma.user.findMany({
        where: { email: { endsWith: testDomain } },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      if (ids.length === 0) return;
      await prisma.session.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    });

    const createTestUser = (email = `staff${testDomain}`) => prisma.user.create({
      data: { name: '測試員工', email, role: 'staff' },
    });

    it('applies the additive migration without altering existing projects or code counters', async () => {
      const beforeProjects = await prisma.project.findMany({
        select: { id: true, projectCode: true }, orderBy: { id: 'asc' },
      });
      const beforeCounters = await prisma.projectCodeCounter.findMany({ orderBy: { year: 'asc' } });
      const migration = await prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM _prisma_migrations
        WHERE migration_name = '20261012000100_users_sessions' AND finished_at IS NOT NULL
      `;
      expect(migration).toHaveLength(1);
      await createTestUser();
      expect(await prisma.project.findMany({
        select: { id: true, projectCode: true }, orderBy: { id: 'asc' },
      })).toEqual(beforeProjects);
      expect(await prisma.projectCodeCounter.findMany({ orderBy: { year: 'asc' } })).toEqual(beforeCounters);
    });

    it('creates a pending employee with nullable password hash and canonical email', async () => {
      const user = await createTestUser(`  Staff.One${testDomain.toUpperCase()}  `);
      expect(user.email).toBe(`staff.one${testDomain}`);
      expect(user.role).toBe('staff');
      expect(user.status).toBe('pending_activation');
      expect(user.passwordHash).toBeNull();
      expect(user.disabledAt).toBeNull();
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('rejects duplicate email after trimming and lowercasing, including updates', async () => {
      const first = await createTestUser(`  Alice${testDomain}  `);
      expect(first.email).toBe(`alice${testDomain}`);
      await expect(createTestUser(`ALICE${testDomain.toUpperCase()}`)).rejects.toMatchObject({ code: 'P2002' });
      const second = await createTestUser(`second${testDomain}`);
      await expect(prisma.user.update({
        where: { id: second.id }, data: { email: ` ALICE${testDomain.toUpperCase()} ` },
      })).rejects.toMatchObject({ code: 'P2002' });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).email).toBe(`second${testDomain}`);
    });

    it('persists role and status values and requires a hash for an active local account', async () => {
      const admin = await prisma.user.create({ data: {
        name: '測試管理員', email: `admin${testDomain}`, role: 'admin', status: 'active',
        // A fixture string only; this phase does not generate usable credentials.
        passwordHash: 'test-only-hash-placeholder',
      } });
      const manager = await prisma.user.create({ data: {
        name: '測試主管', email: `manager${testDomain}`, role: 'manager',
      } });
      expect([admin.role, admin.status, manager.role, manager.status]).toEqual([
        'admin', 'active', 'manager', 'pending_activation',
      ]);
      await expect(prisma.user.create({ data: {
        name: '無雜湊帳號', email: `invalid${testDomain}`, role: 'staff', status: 'active',
      } })).rejects.toThrow();
    });

    it('stores a session linked to its user with independent idle and absolute expiry', async () => {
      const user = await createTestUser();
      const session = await prisma.session.create({ data: {
        userId: user.id,
        tokenHash: firstHash,
        idleExpiresAt: new Date('2030-01-01T01:00:00.000Z'),
        absoluteExpiresAt: new Date('2030-01-01T08:00:00.000Z'),
      }, include: { user: true } });
      expect(session.user.id).toBe(user.id);
      expect(session.tokenHash).toBe(firstHash);
      expect(session.lastSeenAt).toBeInstanceOf(Date);
      expect(session.idleExpiresAt.toISOString()).toBe('2030-01-01T01:00:00.000Z');
      expect(session.absoluteExpiresAt.toISOString()).toBe('2030-01-01T08:00:00.000Z');
      expect(session.revokedAt).toBeNull();
    });

    it('enforces unique token hashes and rejects raw-token-shaped or inverted expiry data', async () => {
      const user = await createTestUser();
      const expiry = {
        idleExpiresAt: new Date('2030-01-01T01:00:00.000Z'),
        absoluteExpiresAt: new Date('2030-01-01T08:00:00.000Z'),
      };
      await prisma.session.create({ data: { userId: user.id, tokenHash: firstHash, ...expiry } });
      await expect(prisma.session.create({ data: {
        userId: user.id, tokenHash: firstHash, ...expiry,
      } })).rejects.toMatchObject({ code: 'P2002' });
      await expect(prisma.session.create({ data: {
        userId: user.id, tokenHash: 'raw-session-token', ...expiry,
      } })).rejects.toThrow();
      await expect(prisma.session.create({ data: {
        userId: user.id, tokenHash: secondHash,
        idleExpiresAt: new Date('2030-01-01T09:00:00.000Z'),
        absoluteExpiresAt: expiry.absoluteExpiresAt,
      } })).rejects.toThrow();
    });

    it('persists employee disable and bulk session revocation without deleting identity', async () => {
      const user = await createTestUser();
      for (const tokenHash of [firstHash, secondHash]) {
        await prisma.session.create({ data: {
          userId: user.id, tokenHash,
          idleExpiresAt: new Date('2030-01-01T01:00:00.000Z'),
          absoluteExpiresAt: new Date('2030-01-01T08:00:00.000Z'),
        } });
      }
      const disabledAt = new Date();
      await prisma.$transaction([
        prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: disabledAt } }),
        prisma.user.update({ where: { id: user.id }, data: {
          status: 'disabled', disabledAt, updatedAt: disabledAt,
        } }),
      ]);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { sessions: true } });
      expect(stored.status).toBe('disabled');
      expect(stored.disabledAt?.toISOString()).toBe(disabledAt.toISOString());
      expect(stored.sessions).toHaveLength(2);
      expect(stored.sessions.every((session) => session.revokedAt?.toISOString() === disabledAt.toISOString())).toBe(true);
    });
  });

  describe('employee authentication and PostgreSQL sessions', () => {
    const domain = '@phase6a-auth.test';
    const testPassword = authFixturePassword;

    afterEach(async () => {
      const users = await prisma.user.findMany({ where: { email: { endsWith: domain } }, select: { id: true } });
      const ids = users.map((user) => user.id).filter((id) => id !== testAdminId);
      if (ids.length) {
        await prisma.session.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
    });

    async function createEmployee(name: string, role: 'admin' | 'manager' | 'staff', status: 'active' | 'pending_activation' | 'disabled' = 'active') {
      const now = new Date();
      return prisma.user.create({ data: {
        name, email: `${name.toLowerCase()}${domain}`, role, status,
        passwordHash: await hashPassword(testPassword),
        disabledAt: status === 'disabled' ? now : null,
      } });
    }

    async function login(email: string, password = testPassword) {
      const agent = request.agent(app.getHttpServer());
      const csrf = (await agent.get('/api/auth/csrf').expect(200)).body.data.csrfToken as string;
      const response = await agent.post('/api/auth/login').set('X-XSRF-TOKEN', csrf)
        .send({ email, password });
      return { agent, response };
    }

    function setCookie(response: { headers: Record<string, unknown> }, name: string): string | undefined {
      const cookies = response.headers['set-cookie'] as string[] | undefined;
      return cookies?.find((cookie) => cookie.startsWith(`${name}=`));
    }

    it('logs in with Argon2id, issues an HttpOnly session, resolves /me, and logs out', async () => {
      const { agent, response } = await login(testAdminEmail.toUpperCase());
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ email: testAdminEmail, role: 'admin' });
      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(setCookie(response, 'case_session')).toContain('HttpOnly');
      expect(setCookie(response, 'case_session')).toContain('SameSite=Lax');
      expect(setCookie(response, 'XSRF-TOKEN')).not.toContain('HttpOnly');
      const token = setCookie(response, 'case_session')?.split(';')[0].split('=')[1];
      expect(token).toBeDefined();
      const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token!) } });
      expect(session.userId).toBe(testAdminId);
      expect(session.tokenHash).not.toBe(token);
      expect(session.idleExpiresAt.getTime() - session.createdAt.getTime()).toBe(8 * 60 * 60 * 1000);
      expect(session.absoluteExpiresAt.getTime() - session.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
      expect((await agent.get('/api/auth/me').expect(200)).body.data.role).toBe('admin');
      const xsrf = setCookie(response, 'XSRF-TOKEN')?.split(';')[0].split('=')[1];
      await agent.post('/api/auth/logout').set('X-XSRF-TOKEN', xsrf!).expect(204);
      expect((await agent.get('/api/auth/me').expect(401)).body.error.code).toBe('AUTH_REQUIRED');
      expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    });

    it('uses a generic response for wrong, unknown, pending and disabled accounts', async () => {
      await createEmployee('pending', 'staff', 'pending_activation');
      await createEmployee('disabled', 'staff', 'disabled');
      const attempts = [
        [testAdminEmail, 'wrong-password'],
        [`unknown${domain}`, testPassword],
        [`pending${domain}`, testPassword],
        [`disabled${domain}`, testPassword],
      ];
      for (const [email, password] of attempts) {
        const { response } = await login(email, password);
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
        expect(setCookie(response, 'case_session')).toBeUndefined();
      }
    });

    it('rejects missing/forged CSRF tokens and cross-origin writes before login or Project mutation', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.get('/api/auth/csrf').expect(200);
      expect((await agent.post('/api/auth/login').send({ email: testAdminEmail, password: testPassword }).expect(403)).body.error.code).toBe('CSRF_INVALID');
      expect((await agent.post('/api/auth/login').set('X-XSRF-TOKEN', 'forged')
        .send({ email: testAdminEmail, password: testPassword }).expect(403)).body.error.code).toBe('CSRF_INVALID');
      expect((await api.post('/api/projects').set('Origin', 'https://attacker.example')
        .send({ name: '[5C2A] rejected' }).expect(403)).body.error.code).toBe('CSRF_INVALID');
      const anonymous = request.agent(app.getHttpServer());
      const anonymousCsrf = (await anonymous.get('/api/auth/csrf').expect(200)).body.data.csrfToken as string;
      expect((await anonymous.post('/api/projects').set('X-XSRF-TOKEN', anonymousCsrf)
        .send({ name: '[5C2A] rejected' }).expect(401)).body.error.code).toBe('AUTH_REQUIRED');
      expect((await request(app.getHttpServer()).get('/api/projects').expect(401)).body.error.code).toBe('AUTH_REQUIRED');
      expect((await request(app.getHttpServer()).get('/api/auth/me').expect(401)).body.error.code).toBe('AUTH_REQUIRED');
    });

    it('expires, revokes and disables PostgreSQL-backed sessions', async () => {
      const user = await createEmployee('lifecycle', 'staff');
      const { agent, response } = await login(user.email);
      expect(response.status).toBe(200);
      const token = setCookie(response, 'case_session')?.split(';')[0].split('=')[1];
      const tokenHash = hashSessionToken(token!);
      const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      const earlier = new Date(Date.now() - 60 * 60 * 1000);
      await prisma.session.update({ where: { id: session.id }, data: {
        createdAt: earlier, lastSeenAt: earlier,
        idleExpiresAt: new Date(Date.now() - 1000), absoluteExpiresAt: new Date(Date.now() + 1000),
      } });
      await agent.get('/api/auth/me').expect(401);
      await prisma.session.update({ where: { id: session.id }, data: {
        idleExpiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() + 120_000),
        revokedAt: new Date(),
      } });
      await agent.get('/api/auth/me').expect(401);
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: null } });
      await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled', disabledAt: new Date() } });
      await agent.get('/api/auth/me').expect(401);
    });

    it('renews idle expiry at the touch interval without extending absolute expiry', async () => {
      const user = await createEmployee('touch', 'staff');
      const { agent, response } = await login(user.email);
      expect(response.status).toBe(200);
      const token = setCookie(response, 'case_session')?.split(';')[0].split('=')[1];
      const tokenHash = hashSessionToken(token!);
      const initial = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      const old = new Date(Date.now() - 10 * 60_000);
      await prisma.session.update({ where: { id: initial.id }, data: { createdAt: old, lastSeenAt: old } });
      await agent.get('/api/auth/me').expect(200);
      const touched = await prisma.session.findUniqueOrThrow({ where: { id: initial.id } });
      expect(touched.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
      expect(touched.idleExpiresAt.getTime()).toBeGreaterThan(initial.idleExpiresAt.getTime());
      expect(touched.absoluteExpiresAt).toEqual(initial.absoluteExpiresAt);
    });

    it('rotates the session on login and can revoke all sessions for a user', async () => {
      const user = await createEmployee('rotation', 'staff');
      const first = await login(user.email);
      expect(first.response.status).toBe(200);
      const oldToken = setCookie(first.response, 'case_session')?.split(';')[0].split('=')[1];
      const firstCsrf = setCookie(first.response, 'XSRF-TOKEN')?.split(';')[0].split('=')[1];
      const second = await first.agent.post('/api/auth/login').set('X-XSRF-TOKEN', firstCsrf!)
        .send({ email: user.email, password: testPassword }).expect(200);
      const newToken = setCookie(second, 'case_session')?.split(';')[0].split('=')[1];
      expect(newToken).not.toBe(oldToken);
      expect((await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(oldToken!) } })).revokedAt).not.toBeNull();
      expect((await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(newToken!) } })).revokedAt).toBeNull();
      await app.get(SessionService).revokeAll(user.id);
      expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
      await first.agent.get('/api/auth/me').expect(401);
    });

    it('limits repeated login attempts without revealing account existence', async () => {
      const email = `rate${domain}`;
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await login(email, 'incorrect')).response.status).toBe(401);
      }
      const { response } = await login(email, 'incorrect');
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('LOGIN_RATE_LIMITED');
    });

    it('denies Manager/Staff Project access but allows the temporary Admin policy', async () => {
      for (const role of ['manager', 'staff'] as const) {
        const user = await createEmployee(role, role);
        const { agent, response } = await login(user.email);
        expect(response.status).toBe(200);
        const xsrf = setCookie(response, 'XSRF-TOKEN')?.split(';')[0].split('=')[1];
        const token = setCookie(response, 'case_session')?.split(';')[0].split('=')[1];
        expect(token).toBeDefined();
        expect((await agent.get('/api/projects').expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await agent.get('/api/projects/stats').expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await agent.get('/api/projects/1').expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await agent.post('/api/projects').set('X-XSRF-TOKEN', xsrf!).send({}).expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await agent.patch('/api/projects/not-an-id').set('X-XSRF-TOKEN', xsrf!).send({}).expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await agent.post('/api/projects/not-an-id/transitions').set('X-XSRF-TOKEN', xsrf!)
          .send({}).expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await agent.delete('/api/projects/not-an-id').set('X-XSRF-TOKEN', xsrf!).expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await agent.get('/api/auth/me').expect(200)).body.data.role).toBe(role);
        expect((await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token!) } })).revokedAt).toBeNull();
      }
      await api.get('/api/projects').expect(200);
      await api.get('/api/projects/stats').expect(200);
    });

    it('requires authentication on every Project endpoint', async () => {
      const anonymous = request.agent(app.getHttpServer());
      const csrf = (await anonymous.get('/api/auth/csrf').expect(200)).body.data.csrfToken as string;
      const responses = [
        await anonymous.get('/api/projects').expect(401),
        await anonymous.get('/api/projects/stats').expect(401),
        await anonymous.get('/api/projects/1').expect(401),
        await anonymous.post('/api/projects').set('X-XSRF-TOKEN', csrf).send({}).expect(401),
        await anonymous.patch('/api/projects/not-an-id').set('X-XSRF-TOKEN', csrf).send({}).expect(401),
        await anonymous.post('/api/projects/not-an-id/transitions').set('X-XSRF-TOKEN', csrf)
          .send({}).expect(401),
        await anonymous.delete('/api/projects/not-an-id').set('X-XSRF-TOKEN', csrf).expect(401),
      ];
      for (const response of responses) {
        expect(response.body.error.code).toBe('AUTH_REQUIRED');
      }
    });
  });
});
