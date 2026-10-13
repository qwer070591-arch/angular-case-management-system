import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Project as DatabaseProject, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectInput, UpdateProjectInput, validateProjectDateRange } from './project-input';
import { ProjectListQuery, ProjectPriority, ProjectStatus } from './project-query';
import { canTransitionProjectStatus } from './project-transition';

function databaseDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function projectNotFound(): never {
  throw new HttpException({ error: { code: 'PROJECT_NOT_FOUND', message: '找不到案件。' } }, HttpStatus.NOT_FOUND);
}

function writeConflict(): never {
  throw new HttpException({ error: { code: 'CONFLICT', message: '案件資料發生衝突，請重試。' } }, HttpStatus.CONFLICT);
}

function invalidTransition(currentStatus: string, requestedStatus: ProjectStatus): never {
  throw new HttpException({ error: {
    code: 'INVALID_TRANSITION',
    message: '目前案件狀態不允許此操作。',
    details: { currentStatus, requestedStatus },
  } }, HttpStatus.CONFLICT);
}

export interface ProjectResponse {
  id: number;
  projectCode: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export function toProjectResponse(project: DatabaseProject): ProjectResponse {
  return {
    id: project.id,
    projectCode: project.projectCode,
    name: project.name,
    description: project.description,
    status: project.status as ProjectStatus,
    priority: project.priority as ProjectPriority,
    startDate: project.startDate?.toISOString().slice(0, 10) ?? null,
    dueDate: project.dueDate?.toISOString().slice(0, 10) ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<{ data: ProjectStats }> {
    const groups = await this.prisma.project.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const counts = { pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
    for (const group of groups) {
      switch (group.status) {
        case 'pending': counts.pending = group._count._all; break;
        case 'in_progress': counts.inProgress = group._count._all; break;
        case 'completed': counts.completed = group._count._all; break;
        case 'cancelled': counts.cancelled = group._count._all; break;
      }
    }
    return { data: { total: counts.pending + counts.inProgress + counts.completed + counts.cancelled, ...counts } };
  }

  async findAll(query: ProjectListQuery): Promise<{ data: ProjectResponse[]; meta: { total: number; limit: number; offset: number } }> {
    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { data: projects.map(toProjectResponse), meta: { total, limit: query.limit, offset: query.offset } };
  }

  async findById(id: number): Promise<ProjectResponse | undefined> {
    // PostgreSQL INTEGER cannot contain an otherwise valid larger JavaScript number.
    if (id > 2_147_483_647) return undefined;
    const project = await this.prisma.project.findUnique({ where: { id, deletedAt: null } });
    return project ? toProjectResponse(project) : undefined;
  }

  async create(input: CreateProjectInput): Promise<ProjectResponse> {
    const now = new Date();
    const year = now.getUTCFullYear();
    try {
      const project = await this.prisma.$transaction(async (transaction) => {
        // PostgreSQL locks this year's counter row during the atomic UPSERT.
        // Counter allocation and project creation commit or roll back together.
        const counters = await transaction.$queryRaw<Array<{ last_sequence: Prisma.Decimal }>>`
          INSERT INTO "project_code_counters" ("year", "last_sequence")
          VALUES (${year}, 1)
          ON CONFLICT ("year") DO UPDATE
          SET "last_sequence" = "project_code_counters"."last_sequence" + 1
          WHERE "project_code_counters"."last_sequence" < 99999999999999999999999
          RETURNING "last_sequence"
        `;
        if (counters.length !== 1) {
          throw new HttpException({ error: { code: 'CODE_EXHAUSTED', message: '本年度案件編號已用盡。' } }, HttpStatus.CONFLICT);
        }
        // Decimal.toString() switches to exponent notation for large integers.
        const sequence = counters[0].last_sequence.toFixed(0).padStart(4, '0');
        return transaction.project.create({
          data: {
            projectCode: `PRJ-${year}-${sequence}`,
            name: input.name,
            description: input.description ?? null,
            status: 'pending',
            priority: input.priority ?? 'medium',
            startDate: databaseDate(input.startDate ?? null),
            dueDate: databaseDate(input.dueDate ?? null),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        });
      }, { maxWait: 10_000, timeout: 10_000 });
      return toProjectResponse(project);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        writeConflict();
      }
      throw error;
    }
  }

  async update(id: number, input: UpdateProjectInput): Promise<ProjectResponse> {
    if (id > 2_147_483_647) projectNotFound();
    try {
      const project = await this.prisma.$transaction(async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: number }>>`
          SELECT "id" FROM "projects" WHERE "id" = ${id} AND "deleted_at" IS NULL FOR UPDATE
        `;
        if (locked.length === 0) projectNotFound();
        const existing = await transaction.project.findUnique({ where: { id, deletedAt: null } });
        if (!existing) projectNotFound();

        const startDate = input.startDate !== undefined
          ? input.startDate : existing.startDate?.toISOString().slice(0, 10) ?? null;
        const dueDate = input.dueDate !== undefined
          ? input.dueDate : existing.dueDate?.toISOString().slice(0, 10) ?? null;
        validateProjectDateRange(startDate, dueDate);

        // TIMESTAMPTZ(3) stores milliseconds; ensure a successful edit advances it.
        const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1));
        return transaction.project.update({
          where: { id, deletedAt: null },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.startDate !== undefined ? { startDate: databaseDate(input.startDate) } : {}),
            ...(input.dueDate !== undefined ? { dueDate: databaseDate(input.dueDate) } : {}),
            updatedAt,
          },
        });
      });
      return toProjectResponse(project);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        projectNotFound();
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        writeConflict();
      }
      throw error;
    }
  }

  async transitionProjectStatus(id: number, toStatus: ProjectStatus): Promise<ProjectResponse> {
    if (id > 2_147_483_647) projectNotFound();
    const existing = await this.prisma.project.findUnique({ where: { id, deletedAt: null } });
    if (!existing) projectNotFound();
    if (!canTransitionProjectStatus(existing.status as ProjectStatus, toStatus)) {
      invalidTransition(existing.status, toStatus);
    }

    try {
      // One conditional UPDATE is atomic in PostgreSQL. The timestamp also
      // detects an ABA transition back to the original status after this read.
      const project = await this.prisma.project.update({
        where: { id, status: existing.status, updatedAt: existing.updatedAt, deletedAt: null },
        data: {
          status: toStatus,
          updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
        },
      });
      return toProjectResponse(project);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        const current = await this.prisma.project.findUnique({ where: { id, deletedAt: null } });
        if (!current) projectNotFound();
        invalidTransition(current.status, toStatus);
      }
      throw error;
    }
  }

  async remove(id: number): Promise<void> {
    if (id > 2_147_483_647) projectNotFound();
    // A single PostgreSQL statement atomically claims the active row. Both
    // timestamps are server-generated and advance even within one millisecond.
    const deleted = await this.prisma.$queryRaw<Array<{ id: number }>>`
      UPDATE "projects"
      SET "updated_at" = GREATEST(CURRENT_TIMESTAMP, "updated_at" + INTERVAL '1 millisecond'),
          "deleted_at" = GREATEST(CURRENT_TIMESTAMP, "updated_at" + INTERVAL '1 millisecond')
      WHERE "id" = ${id} AND "deleted_at" IS NULL
      RETURNING "id"
    `;
    if (deleted.length === 0) projectNotFound();
  }
}
