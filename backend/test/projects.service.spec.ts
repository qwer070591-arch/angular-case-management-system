import { ProjectsService, toProjectResponse } from '../src/projects/projects.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { Project as DatabaseProject, Prisma } from '../src/generated/prisma/client';
import { PROJECT_STATUSES } from '../src/projects/project-query';
import { canTransitionProjectStatus } from '../src/projects/project-transition';

const row: DatabaseProject = {
  id: 3,
  projectCode: 'PRJ-2025-0001',
  name: '後台管理系統',
  description: '測試描述',
  status: 'completed',
  priority: 'medium',
  startDate: new Date('2025-12-18T00:00:00.000Z'),
  dueDate: new Date('2026-01-09T00:00:00.000Z'),
  createdAt: new Date('2025-12-18T09:00:00.000Z'),
  updatedAt: new Date('2026-01-03T08:00:00.000Z'),
  deletedAt: null,
};

describe('ProjectsService (mocked Prisma, no database)', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const groupBy = jest.fn();
  const findUnique = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const queryRaw = jest.fn();
  const transactionClient = { project: { create, update, findUnique }, $queryRaw: queryRaw };
  const transaction = jest.fn((callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
  const prisma = { project: { findMany, count, groupBy, findUnique, update }, $transaction: transaction, $queryRaw: queryRaw } as unknown as PrismaService;
  const service = new ProjectsService(prisma);

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([row]);
    count.mockReset().mockResolvedValue(1);
    groupBy.mockReset().mockResolvedValue([]);
    findUnique.mockReset().mockResolvedValue(row);
    create.mockReset().mockImplementation(async ({ data }) => ({ ...row, id: 4, ...data }));
    update.mockReset().mockImplementation(async ({ data }) => ({ ...row, ...data }));
    queryRaw.mockReset().mockResolvedValue([{ id: row.id, last_sequence: new Prisma.Decimal(2) }]);
    transaction.mockClear();
  });

  it('queries a stable updatedAt/id order and returns pagination metadata', async () => {
    const result = await service.findAll({ status: 'completed', q: '後台', limit: 5, offset: 10 });
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, name: { contains: '後台', mode: 'insensitive' }, status: 'completed' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 5,
    });
    expect(count).toHaveBeenCalledWith({ where: { deletedAt: null, name: { contains: '後台', mode: 'insensitive' }, status: 'completed' } });
    expect(result.meta).toEqual({ total: 1, limit: 5, offset: 10 });
  });

  it('searches only project names in the database before pagination', async () => {
    count.mockResolvedValue(7);
    const result = await service.findAll({ q: '官網', limit: 2, offset: 2 });
    const where = { deletedAt: null, name: { contains: '官網', mode: 'insensitive' } };
    expect(findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 2,
      take: 2,
    });
    expect(count).toHaveBeenCalledWith({ where });
    expect(result.meta).toEqual({ total: 7, limit: 2, offset: 2 });
  });

  it('counts all four active statuses in one unpaginated database grouping', async () => {
    groupBy.mockResolvedValue([
      { status: 'pending', _count: { _all: 2 } },
      { status: 'in_progress', _count: { _all: 3 } },
      { status: 'completed', _count: { _all: 4 } },
      { status: 'cancelled', _count: { _all: 1 } },
    ]);
    expect(await service.getStats()).toEqual({ data: {
      total: 10, pending: 2, inProgress: 3, completed: 4, cancelled: 1,
    } });
    expect(groupBy).toHaveBeenCalledWith({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns zero for every statistic when there are no active projects', async () => {
    expect(await service.getStats()).toEqual({ data: {
      total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0,
    } });
  });

  it('omits status filtering when listing all active projects', async () => {
    await service.findAll({ limit: 5, offset: 0 });
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(count).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it('gets one project by numeric ID', async () => {
    expect(await service.findById(3)).toEqual(toProjectResponse(row));
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 3, deletedAt: null } });
  });

  it('returns undefined when the database has no row', async () => {
    findUnique.mockResolvedValue(null);
    expect(await service.findById(999999)).toBeUndefined();
  });

  it('does not pass an out-of-range PostgreSQL INTEGER ID to Prisma', async () => {
    expect(await service.findById(2_147_483_648)).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('maps date-only, timestamps, status and priority without leaking Date objects', () => {
    expect(toProjectResponse(row)).toEqual({
      id: 3,
      projectCode: 'PRJ-2025-0001',
      name: '後台管理系統',
      description: '測試描述',
      status: 'completed',
      priority: 'medium',
      startDate: '2025-12-18',
      dueDate: '2026-01-09',
      createdAt: '2025-12-18T09:00:00.000Z',
      updatedAt: '2026-01-03T08:00:00.000Z',
    });
  });

  it('keeps missing optional dates as null', () => {
    expect(toProjectResponse({ ...row, startDate: null, dueDate: null }).startDate).toBeNull();
    expect(toProjectResponse({ ...row, startDate: null, dueDate: null }).dueDate).toBeNull();
  });

  it('creates pending/medium with one timestamp and an allocated UTC-year code', async () => {
    const project = await service.create({ name: '同名案件' });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      projectCode: `PRJ-${new Date().getUTCFullYear()}-0002`,
      name: '同名案件', status: 'pending', priority: 'medium', description: null,
    });
    expect(data.createdAt).toEqual(data.updatedAt);
    expect(data.deletedAt).toBeNull();
    expect(project.projectCode).toBe(data.projectCode);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when the annual code space has no remaining sequence', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(service.create({ name: 'Overflow' })).rejects.toMatchObject({ status: 409 });
    expect(create).not.toHaveBeenCalled();
  });

  it('formats a 23-digit sequence without scientific notation', async () => {
    queryRaw.mockResolvedValue([{ last_sequence: new Prisma.Decimal('10000000000000000000000') }]);
    const project = await service.create({ name: 'Large code' });
    expect(project.projectCode).toBe(`PRJ-${new Date().getUTCFullYear()}-10000000000000000000000`);
    expect(project.projectCode).toHaveLength(32);
  });

  it('updates only supplied fields and preserves identity, status, and createdAt', async () => {
    const project = await service.update(3, { name: '新名稱', dueDate: null });
    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: '新名稱', dueDate: null });
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('projectCode');
    expect(data).not.toHaveProperty('createdAt');
    expect(data).not.toHaveProperty('deletedAt');
    expect(data.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
    expect(update.mock.calls[0][0].where).toEqual({ id: 3, deletedAt: null });
    expect(project).toMatchObject({ id: 3, projectCode: row.projectCode, status: row.status, createdAt: row.createdAt.toISOString() });
  });

  it('checks PATCH dates against the existing row before updating', async () => {
    await expect(service.update(3, { startDate: '2026-01-10' })).rejects.toMatchObject({ status: 422 });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing or out-of-range update ID', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(service.update(999999, { name: 'test' })).rejects.toMatchObject({ status: 404 });
    await expect(service.update(2_147_483_648, { name: 'test' })).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it('maps a database transaction conflict to HTTP 409', async () => {
    transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Transaction conflict', {
      code: 'P2034', clientVersion: '7.10.0',
    }));
    await expect(service.update(3, { name: 'test' })).rejects.toMatchObject({ status: 409 });
  });

  const statusPairs = PROJECT_STATUSES.flatMap((from) => PROJECT_STATUSES.map((to) => ({ from, to })));

  it.each(statusPairs.filter(({ from, to }) => canTransitionProjectStatus(from, to)))(
    'allows $from -> $to and changes only status/updatedAt', async ({ from, to }) => {
      const existing = { ...row, status: from };
      findUnique.mockResolvedValue(existing);
      update.mockImplementationOnce(async ({ data }) => ({ ...existing, ...data }));

      const result = await service.transitionProjectStatus(row.id, to);
      const mutation = update.mock.calls[0][0];
      expect(mutation.where).toEqual({ id: row.id, status: from, updatedAt: row.updatedAt, deletedAt: null });
      expect(Object.keys(mutation.data).sort()).toEqual(['status', 'updatedAt']);
      expect(mutation.data.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
      expect(result).toMatchObject({
        id: row.id, projectCode: row.projectCode, name: row.name,
        description: row.description, status: to, priority: row.priority,
        createdAt: row.createdAt.toISOString(),
      });
    },
  );

  it.each(statusPairs.filter(({ from, to }) => !canTransitionProjectStatus(from, to)))(
    'rejects $from -> $to without writing', async ({ from, to }) => {
      findUnique.mockResolvedValue({ ...row, status: from });
      await expect(service.transitionProjectStatus(row.id, to)).rejects.toMatchObject({
        status: 409,
        response: { error: { code: 'INVALID_TRANSITION', details: { currentStatus: from, requestedStatus: to } } },
      });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for a missing or out-of-range transition ID', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.transitionProjectStatus(999999, 'in_progress')).rejects.toMatchObject({ status: 404 });
    await expect(service.transitionProjectStatus(2_147_483_648, 'in_progress')).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it('maps a failed conditional update to INVALID_TRANSITION without retrying', async () => {
    findUnique.mockResolvedValueOnce({ ...row, status: 'pending' }).mockResolvedValueOnce({ ...row, status: 'in_progress' });
    update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Conditional update missed', {
      code: 'P2025', clientVersion: '7.10.0',
    }));
    await expect(service.transitionProjectStatus(row.id, 'cancelled')).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'INVALID_TRANSITION', details: { currentStatus: 'in_progress', requestedStatus: 'cancelled' } } },
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('treats a deleted project as missing for detail, PATCH and transition', async () => {
    findUnique.mockResolvedValue(null);
    expect(await service.findById(row.id)).toBeUndefined();
    queryRaw.mockResolvedValue([]);
    await expect(service.update(row.id, { name: 'changed' })).rejects.toMatchObject({ status: 404 });
    await expect(service.transitionProjectStatus(row.id, 'in_progress')).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: row.id, deletedAt: null } });
  });

  it('returns 404 when deletion wins a transition race', async () => {
    findUnique.mockResolvedValueOnce({ ...row, status: 'pending' }).mockResolvedValueOnce(null);
    update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Conditional update missed', {
      code: 'P2025', clientVersion: '7.10.0',
    }));
    await expect(service.transitionProjectStatus(row.id, 'in_progress')).rejects.toMatchObject({ status: 404 });
  });

  it('soft-deletes with a single conditional database statement', async () => {
    queryRaw.mockResolvedValueOnce([{ id: row.id }]);
    await expect(service.remove(row.id)).resolves.toBeUndefined();
    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(sql).toContain('UPDATE "projects"');
    expect(sql).toContain('"deleted_at" IS NULL');
    expect(sql).toContain('"updated_at"');
    expect(sql).toContain('"deleted_at" =');
  });

  it('returns 404 when a project is missing, already deleted, or ID is out of range', async () => {
    queryRaw.mockResolvedValueOnce([]);
    await expect(service.remove(row.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(2_147_483_648)).rejects.toMatchObject({ status: 404 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
