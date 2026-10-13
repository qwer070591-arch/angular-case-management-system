import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testUrl = process.env.TEST_DATABASE_URL;
const devUrl = process.env.DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests.');
const database = decodeURIComponent(new URL(testUrl).pathname.slice(1));
if (database !== 'case_management_test' || testUrl === devUrl) {
  throw new Error('TEST_DATABASE_URL must point to case_management_test, separate from the development database.');
}

const env = { ...process.env, DATABASE_URL: testUrl };
for (const [program, args] of [
  ['node_modules/prisma/build/index.js', ['migrate', 'deploy']],
  ['node_modules/jest/bin/jest.js', ['--runInBand', 'test/postgres.integration.spec.ts']],
]) {
  const result = spawnSync(process.execPath, [path.join(root, program), ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
