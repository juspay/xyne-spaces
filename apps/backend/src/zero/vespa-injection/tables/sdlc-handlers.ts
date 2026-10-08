import type { DeleteID, Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { TableName, VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { sdlcContainerSchema, sdlcRepositorySchema } from '@/vespa/src/types';
import { requestSdlcSearchSync, type SdlcSearchSyncTarget } from '@/queues/sdlcSearchSyncQueue';

/**
 * SDLC Hub search: hub changes made through Zero mutators (the hub UI) request a debounced
 * hub sync, which recomputes the hub's search entries from Postgres. Server-side writes
 * (agents, the wiki store, uploads, ticket and discussion links) reach the same sync through
 * the Prisma middleware in database/middleware/sdlcSearchSync.ts.
 *
 * A delete carries only the row id, so a deleted track, folder or repository is removed from
 * Vespa here directly; whatever else it leaves stale is reconciled by the hub's next sync.
 */
abstract class SdlcSyncHandler<T extends TableName> extends BaseVespaHandler<T> {
  protected abstract target(args: Record<string, unknown>): SdlcSearchSyncTarget | null;

  private request(args: unknown): VespaQueueHandler[] {
    const target = this.target(args as Record<string, unknown>);
    if (target) requestSdlcSearchSync(target, `zero:${this.tableName}`);
    return [];
  }

  onInsert(args: Parameters<BaseVespaHandler<T>['onInsert']>[0], _tx: Transaction<Schema>): VespaQueueHandler[] {
    return this.request(args);
  }

  onUpdate(args: Parameters<BaseVespaHandler<T>['onUpdate']>[0], _tx: Transaction<Schema>): VespaQueueHandler[] {
    return this.request(args);
  }

  onUpsert(args: Parameters<BaseVespaHandler<T>['onUpsert']>[0], _tx: Transaction<Schema>): VespaQueueHandler[] {
    return this.request(args);
  }
}

const idOf = (args: Record<string, unknown>): string | null => (typeof args.id === 'string' ? args.id : null);

/** Placement, related documents, discussions, ticket links and repository membership. */
export class SdlcEntityLinksVespaHandler extends SdlcSyncHandler<'sdlc_entity_links'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'sdlc_entity_links');
  }

  protected target(args: Record<string, unknown>): SdlcSearchSyncTarget | null {
    return typeof args.channelId === 'string' ? { hubId: args.channelId } : null;
  }
}

/** Tracks: name, description and status, plus removal. */
export class SdlcTracksVespaHandler extends SdlcSyncHandler<'sdlc_tracks'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'sdlc_tracks');
  }

  protected target(args: Record<string, unknown>): SdlcSearchSyncTarget | null {
    const id = idOf(args);
    return id ? { containerId: id } : null;
  }

  onDelete(args: DeleteID<Schema['tables']['sdlc_tracks']>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: sdlcContainerSchema, jobType: 'delete', docId: args.id }];
  }
}

/** Track folders and the Wiki and Hub Knowledge trees: renames, plus removal. */
export class SdlcFoldersVespaHandler extends SdlcSyncHandler<'sdlc_folders'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'sdlc_folders');
  }

  protected target(args: Record<string, unknown>): SdlcSearchSyncTarget | null {
    const id = idOf(args);
    return id ? { containerId: id } : null;
  }

  onDelete(args: DeleteID<Schema['tables']['sdlc_folders']>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: sdlcContainerSchema, jobType: 'delete', docId: args.id }];
  }
}

/** A document's type is its canvas folder: renaming one renames the type of its documents. */
export class CanvasFoldersVespaHandler extends SdlcSyncHandler<'canvas_folders'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'canvas_folders');
  }

  protected target(args: Record<string, unknown>): SdlcSearchSyncTarget | null {
    return typeof args.channelId === 'string' ? { hubId: args.channelId } : null;
  }
}

/** An SDLC document's status changed (archive / restore). */
export class SdlcArtifactsVespaHandler extends SdlcSyncHandler<'sdlc_artifacts'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'sdlc_artifacts');
  }

  protected target(args: Record<string, unknown>): SdlcSearchSyncTarget | null {
    return typeof args.artifactId === 'string' ? { canvasId: args.artifactId } : null;
  }
}

/** Repositories: name or URL changed, or removed. */
export class ReposVespaHandler extends SdlcSyncHandler<'repos'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'repos');
  }

  protected target(args: Record<string, unknown>): SdlcSearchSyncTarget | null {
    const id = idOf(args);
    return id ? { repoId: id } : null;
  }

  onDelete(args: DeleteID<Schema['tables']['repos']>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [{ schema: sdlcRepositorySchema, jobType: 'delete', docId: args.id }];
  }
}
