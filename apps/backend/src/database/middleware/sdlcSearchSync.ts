import type { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { requestSdlcSearchSync, type SdlcSearchSyncTarget } from '@/queues/sdlcSearchSyncQueue';

/**
 * Prisma middleware that keeps SDLC Hub search in step with server-side writes.
 *
 * The hub tables are written Prisma-direct from many places — agents through the claw routes,
 * the wiki store, uploads filed into a track, ticket and discussion links, repository
 * attachment — none via Zero. Hooking the shared client covers all of them, the way
 * userVespaSync.ts does for users, instead of wiring each call site. UI writes go through
 * Zero and are covered by zero/vespa-injection/tables/sdlc-handlers.ts.
 *
 * Each write only asks for a debounced sync of its hub; the sync re-reads Postgres a few
 * seconds later, so it does not matter that $use runs before an enclosing transaction commits.
 * Best-effort: never blocks or fails the write.
 */
const MODELS = new Set(['SdlcEntityLink', 'SdlcTrack', 'SdlcFolder', 'CanvasFolder', 'SdlcArtifact', 'Repo']);
const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

type Row = Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const rowsOf = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : value && typeof value === 'object' ? [value as Row] : [];

export function setupSdlcSearchSync(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (!params.model || !MODELS.has(params.model) || !WRITES.has(params.action)) {
      return next(params);
    }

    // A bulk delete of links may not name its hub; read the rows it is about to remove first.
    let deletedLinkHubs: string[] = [];
    if (params.model === 'SdlcEntityLink' && params.action === 'deleteMany' && !str(params.args?.where?.channelId)) {
      try {
        const rows = await (prisma as unknown as { sdlcEntityLink: { findMany: (a: unknown) => Promise<Row[]> } })
          .sdlcEntityLink.findMany({ where: params.args?.where, select: { channelId: true }, distinct: ['channelId'] });
        deletedLinkHubs = rows.map(r => str(r.channelId)).filter((id): id is string => Boolean(id));
      } catch (error) {
        logger.warn('[SDLC_SEARCH_SYNC] could not read links before delete', { error });
      }
    }

    const result = await next(params);

    try {
      for (const target of targetsOf(params.model, params.args ?? {}, result, deletedLinkHubs)) {
        requestSdlcSearchSync(target, `prisma:${params.model}.${params.action}`);
      }
    } catch (error) {
      logger.warn('[SDLC_SEARCH_SYNC] could not request a hub sync', { model: params.model, action: params.action, error });
    }
    return result;
  });
}

function targetsOf(model: string, args: Row, result: unknown, deletedLinkHubs: string[]): SdlcSearchSyncTarget[] {
  // The rows the write touched, as far as the call says: the returned row, the data written,
  // and the where clause.
  const where = (args.where ?? {}) as Row;
  const rows = [...rowsOf(result), ...rowsOf(args.data), ...rowsOf(args.create), where];
  const values = (key: string) => [...new Set(rows.map(r => str(r[key])).filter((v): v is string => Boolean(v)))];

  switch (model) {
    case 'SdlcEntityLink':
    case 'CanvasFolder':
      return [...new Set([...values('channelId'), ...deletedLinkHubs])].map(hubId => ({ hubId }));
    case 'SdlcTrack':
    case 'SdlcFolder':
      return values('id').map(containerId => ({ containerId }));
    case 'SdlcArtifact':
      return values('artifactId').map(canvasId => ({ canvasId }));
    case 'Repo':
      return values('id').map(repoId => ({ repoId }));
    default:
      return [];
  }
}
