import { rawQuery } from './base';

/** Structural shape of any generated Prisma client, so the probe works for every one of them. */
type RawCapable = { $queryRaw: (q: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> };

/**
 * Connectivity probe used by the Prisma client bootstraps (database/client.ts and
 * database/commonClient.ts) to confirm a connection is usable. It reads no table, so there is no
 * tenant to scope to — but it is still a raw statement, and raw statements live here.
 */
export function pingDatabase(client: RawCapable): Promise<unknown> {
  return rawQuery(
    [],
    'prisma client bootstrap: SELECT 1 connectivity probe, touches no table',
    () => client.$queryRaw`SELECT 1`,
  );
}
