import { BaseSideEffectHandler } from '../base-handler';
import type { SdlcEntityLinkPreviousValue, SideEffectJobConfig } from '../types';
import { requestSdlcSearchSync } from '@/queues/sdlcSearchSyncQueue';

/**
 * Removing an SDLC edge (unlinking a ticket or context, unfiling an item, deleting a
 * discussion) changes where things sit in the hub's search entries. A Zero delete carries only
 * the link id, so the Vespa handler cannot tell which hub to sync; the collector reads the
 * row's hub before the delete, and this asks for that hub's sync once the write commits.
 */
export class SdlcEntityLinksSideEffectHandler extends BaseSideEffectHandler {
  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const prev = job.previousValue as SdlcEntityLinkPreviousValue | undefined;
    if (!prev?.channelId) return;
    requestSdlcSearchSync({ hubId: prev.channelId }, 'zero:sdlc_entity_links.delete');
  }
}
