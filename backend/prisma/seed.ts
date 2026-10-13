import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const developmentProjects = [
  {
    id: 1,
    projectCode: 'PRJ-2026-0001',
    name: '公司官網改版',
    description: '更新公司官方網站的資訊架構、內容與前端體驗。',
    status: 'in_progress',
    priority: 'high',
    startDate: new Date('2026-01-06T00:00:00.000Z'),
    dueDate: new Date('2026-03-31T00:00:00.000Z'),
    createdAt: new Date('2026-01-06T09:00:00.000Z'),
    updatedAt: new Date('2026-01-15T04:30:00.000Z'),
  },
  {
    id: 2,
    projectCode: 'PRJ-2026-0002',
    name: '會員系統開發',
    description: '規劃並實作新版會員註冊、登入與帳戶管理流程。',
    status: 'pending',
    priority: 'urgent',
    startDate: new Date('2026-02-02T00:00:00.000Z'),
    dueDate: new Date('2026-05-29T00:00:00.000Z'),
    createdAt: new Date('2026-01-10T09:00:00.000Z'),
    updatedAt: new Date('2026-01-10T09:00:00.000Z'),
  },
  {
    id: 3,
    projectCode: 'PRJ-2025-0001',
    name: '後台管理系統',
    description: '建立內部案件管理與追蹤作業的後台系統。',
    status: 'completed',
    priority: 'medium',
    startDate: new Date('2025-12-18T00:00:00.000Z'),
    dueDate: new Date('2026-01-09T00:00:00.000Z'),
    createdAt: new Date('2025-12-18T09:00:00.000Z'),
    updatedAt: new Date('2026-01-03T08:00:00.000Z'),
  },
];

export async function seedDevelopmentProjects(prisma: PrismaClient): Promise<number> {
  // projectCode is the immutable seed identity. Existing rows are never updated.
  return prisma.$transaction(async (transaction) => {
    const result = await transaction.project.createMany({ data: developmentProjects, skipDuplicates: true });
    for (const seed of developmentProjects) {
      const existing = await transaction.project.findUnique({ where: { projectCode: seed.projectCode } });
      if (!existing || existing.id !== seed.id) {
        throw new Error(`Development seed identity conflict for ${seed.projectCode}; no seed changes were committed.`);
      }
    }
    // Explicit seed IDs do not advance PostgreSQL's SERIAL sequence.
    await transaction.$queryRaw`SELECT setval(pg_get_serial_sequence('projects', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM projects), 1), true)`;
    // A fresh test database is migrated before these fixed development codes are inserted.
    // Never lower a counter; other projects may already have consumed later numbers.
    await transaction.$executeRaw`
      INSERT INTO "project_code_counters" ("year", "last_sequence")
      SELECT substring("project_code" from 5 for 4)::INTEGER,
             MAX(substring("project_code" from 10)::NUMERIC(23,0))
      FROM "projects"
      GROUP BY substring("project_code" from 5 for 4)::INTEGER
      ON CONFLICT ("year") DO UPDATE
      SET "last_sequence" = GREATEST("project_code_counters"."last_sequence", EXCLUDED."last_sequence")
    `;
    return result.count;
  });
}

function assertDevelopmentDatabase(url: string): void {
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  if (process.env.NODE_ENV === 'production' || !/_(dev|test)$/.test(database)) {
    throw new Error('Development seed is permitted only for a database named *_dev or *_test outside production.');
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to seed the development database.');
  assertDevelopmentDatabase(connectionString);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const inserted = await seedDevelopmentProjects(prisma);
    console.log(`Development seed complete: ${inserted} new project(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
