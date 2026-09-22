import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT, httpOk, launch, log, parseEnvFile, waitFor } from './util.mjs';
import { pgUrl } from './postgres.mjs';

export const ZERO_PORT = Number(process.env.ZERO_PORT ?? 4848);
const ZERO_BIN = path.join(ROOT, 'node_modules', '.bin', 'zero-cache');

export const zeroHealthy = () => httpOk(`http://127.0.0.1:${ZERO_PORT}/`);

/**
 * Same settings as the zero-cache service in docker-compose.dev.yml. ZERO_AUTH_SECRET
 * (and any other ZERO_* you set) come from apps/backend/.env.local so the backend and
 * zero-cache always share them; DB URLs, replica path and push/query URLs are pinned here.
 */
export async function startZero(repo) {
  const envLocal = repo ? parseEnvFile(path.join(repo, 'apps/backend/.env.local')) : {};
  const backendPort = envLocal.PORT ?? '3001';
  const fromRepo = Object.fromEntries(Object.entries(envLocal).filter(([k]) => k.startsWith('ZERO_')));
  if (!fromRepo.ZERO_AUTH_SECRET) {
    log('zero', 'WARNING: ZERO_AUTH_SECRET not found in apps/backend/.env.local; the dashboard will not be able to authenticate to zero-cache.');
  }
  const dir = path.join(DATA, 'zero');
  fs.mkdirSync(dir, { recursive: true });
  const env = {
    NODE_ENV: 'development',
    ZERO_LOG_LEVEL: 'info',
    ZERO_ADMIN_PASSWORD: 'dev-admin-password',
    ZERO_CVR_MAX_CONNS: '10',
    ZERO_UPSTREAM_MAX_CONNS: '10',
    ZERO_NUM_SYNC_WORKERS: '5',
    ...fromRepo,
    ZERO_PORT: String(ZERO_PORT),
    ZERO_UPSTREAM_DB: pgUrl('xyne_dev_db'),
    ZERO_CVR_DB: pgUrl('xyne_dev_db'),
    ZERO_CHANGE_DB: pgUrl('xyne_dev_db'),
    ZERO_REPLICA_FILE: path.join(dir, 'replica.db'),
    ZERO_MUTATE_URL: `http://localhost:${backendPort}/api/zero/push`,
    ZERO_QUERY_URL: `http://localhost:${backendPort}/api/zero/query`,
    ZERO_MUTATE_FORWARD_COOKIES: 'true',
    ZERO_QUERY_FORWARD_COOKIES: 'true',
  };
  const child = launch('zero', ZERO_BIN, [], { env });
  await waitFor('zero-cache', zeroHealthy, { timeoutMs: 90_000 });
  log('zero', `ready on http://localhost:${ZERO_PORT}`);
  return child;
}
