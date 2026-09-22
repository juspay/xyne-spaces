import fs from 'node:fs';
import path from 'node:path';
import { fail, log, run } from './util.mjs';
import { PG } from './postgres.mjs';
import { REDIS_PORT } from './redis.mjs';
import { GCS_PORT } from './fakegcs.mjs';

/**
 * Same steps scripts/start-services.sh runs after the containers are healthy
 * (sections 9-10), executed against the embedded services. Idempotent.
 */
export async function dbSetup(repo, { demoSeed = true, devLogin } = {}) {
  const backend = path.join(repo, 'apps', 'backend');
  if (!fs.existsSync(path.join(backend, 'node_modules'))) fail(`${backend}/node_modules missing. Run "pnpm install" at the repo root first.`);
  if (!fs.existsSync(path.join(backend, '.env.local'))) {
    log('db-setup', '.env.local missing in apps/backend, creating from .env.example');
    fs.copyFileSync(path.join(backend, '.env.example'), path.join(backend, '.env.local'));
  }
  await run('db-setup', 'node', [path.join(repo, 'scripts', 'generate-local-secrets.mjs')], { cwd: repo, env: {} });

  // `dotenv -e .env.local` never overrides variables already in the environment, so
  // these pins guarantee the scripts talk to the embedded services and nothing else
  // (e.g. a Docker postgres that also happens to be on 5433).
  const env = {
    DATABASE_URL: `postgresql://${PG.user}:${PG.password}@127.0.0.1:${PG.port}/xyne_dev_db?schema=public`,
    COMMON_DATABASE_URL: `postgresql://${PG.user}:${PG.password}@127.0.0.1:${PG.port}/xyne_common?schema=common`,
    ZERO_UPSTREAM_DB: `postgresql://${PG.user}:${PG.password}@127.0.0.1:${PG.port}/xyne_dev_db`,
    REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(REDIS_PORT),
    FAKE_GCS_HOST: `localhost:${GCS_PORT}`,
  };
  log('db-setup', `target: ${env.DATABASE_URL}`);
  const dotenv = ['exec', 'dotenv', '-e', '.env.local', '--', 'pnpm', 'exec'];
  const steps = [
    ['prisma db push (xyne_dev_db)', [...dotenv, 'prisma', 'db', 'push']],
    ['prisma db push (xyne_common)', [...dotenv, 'prisma', 'db', 'push', '--schema', 'prisma-common/schema.prisma', '--accept-data-loss', '--skip-generate']],
    ['prisma generate', ['exec', 'prisma', 'generate']],
    ['prisma generate (common)', ['exec', 'prisma', 'generate', '--schema', 'prisma-common/schema.prisma']],
    ['seed ACL + default workspace + admin@xyne.ai', [...dotenv, 'tsx', 'scripts/seed-acl.ts']],
    ['assign developer user group', [...dotenv, 'tsx', 'scripts/assign-user-group.ts']],
    ['seed app permissions', [...dotenv, 'tsx', 'scripts/seed-app-permissions.ts']],
  ];
  if (devLogin) steps.push([`add login ${devLogin.email}`, [...dotenv, 'tsx', 'scripts/create-dev-login.ts', devLogin.email, devLogin.password]]);
  if (demoSeed) steps.push(['demo seed (sample workspace data)', [...dotenv, 'tsx', 'scripts/demo-seed.ts']]);

  for (const [label, args] of steps) {
    log('db-setup', `→ ${label}`);
    try { await run('db-setup', 'pnpm', args, { cwd: backend, env }); }
    catch (e) {
      if (/assign-user-group|demo-seed|create-dev-login/.test(args.join(' '))) { log('db-setup', `  (non-fatal) ${e.message}`); continue; }
      throw e;
    }
  }
  log('db-setup', 'done');
}
