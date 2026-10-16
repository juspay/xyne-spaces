import { SDLC_MEMBERSHIP_RELATION } from '@xyne/shared';
import { db } from '@/database/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SdlcEntityLinkPreviousValue, SideEffectJobConfig } from '../types';
import { queueSdlcSearchJobs, type SdlcLink } from '@/zero/vespa-injection/core/sdlc-sync';
import { hubOfContainer } from '@/zero/vespa-injection/core/sdlc-index';

/**
 * SDLC Hub search for changes made through Zero (the hub UI). Each change queues the Vespa jobs
 * of the entries it affects (zero/vespa-injection/core/sdlc-sync.ts). These run as side effects,
 * after the write commits, because working out those entries reads the hub: the containers
 * under a folder, the documents of a type, the tickets and discussions on a document.
 * Archiving a document goes through the hub API, which queues its own update.
 */
const linkOf = (row: Record<string, unknown> | undefined): (SdlcLink & { channelId: string }) | null =>
  row && typeof row.channelId === 'string' && typeof row.targetId === 'string'
    ? (row as unknown as SdlcLink & { channelId: string })
    : null;
const idOf = (job: SideEffectJobConfig): string | null => {
  const value = (job.args as Record<string, unknown> | undefined)?.id;
  return typeof value === 'string' ? value : null;
};

/** Placement, related documents, discussions, ticket links and repository membership. */
export class SdlcEntityLinksSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const link = linkOf(job.args);
    if (link) queueSdlcSearchJobs(link.channelId, { link });
  }

  // A delete carries only the link id; the collector keeps the row as it was.
  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const link = linkOf(job.previousValue as SdlcEntityLinkPreviousValue | undefined as unknown as Record<string, unknown> | undefined);
    if (link) queueSdlcSearchJobs(link.channelId, { link, removed: true });
  }
}

/** Tracks and folders (track folders, Wiki and Hub Knowledge folders): name, description, status. */
class SdlcContainerSideEffectHandler extends BaseSideEffectHandler {
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const id = idOf(job);
    const hubId = id ? await hubOfContainer(id) : null;
    if (id && hubId) queueSdlcSearchJobs(hubId, { containers: [id] });
  }
}
export class SdlcTracksSideEffectHandler extends SdlcContainerSideEffectHandler {}
export class SdlcFoldersSideEffectHandler extends SdlcContainerSideEffectHandler {}

/** A document's type is its canvas folder: renaming one renames the type of its documents. */
export class CanvasFoldersSideEffectHandler extends BaseSideEffectHandler {
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const id = idOf(job);
    const folder = id ? await db.canvasFolder.findUnique({ where: { id }, select: { channelId: true } }) : null;
    if (id && folder?.channelId) queueSdlcSearchJobs(folder.channelId, { typeIds: [id] });
  }
}

/** A repository's name or URL, in every hub it is attached to. */
export class ReposSideEffectHandler extends BaseSideEffectHandler {
  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const repoId = idOf(job);
    if (!repoId) return;
    const links = await db.sdlcEntityLink.findMany({
      where: { sourceType: 'CHANNEL', targetType: 'REPOSITORY', targetId: repoId, relationType: SDLC_MEMBERSHIP_RELATION },
      select: { channelId: true },
      distinct: ['channelId'],
    });
    for (const { channelId } of links) queueSdlcSearchJobs(channelId, { repositories: [repoId] });
  }
}
