import { asService } from './base';
import { markDoclingFileSplitComplete, upsertDoclingAsyncFileForSplit } from '@/services/ingestion/docling/scheduler/store';

/**
 * Relocated from services/ingestion/docling/workers/scheduler.ts's commit-split path. Background
 * scheduler job → no request context; the split-complete write needs workspaceId stamped from
 * the file's own workspace.
 */
export function commitDoclingSplit(
  workspaceId: string,
  ...args: Parameters<typeof markDoclingFileSplitComplete>
): ReturnType<typeof markDoclingFileSplitComplete> {
  return asService(
    ['DoclingAsyncFile', 'DoclingAsyncPart'],
    'docling splitter: background scheduler job has no request context, write stamped from the file\'s own workspace',
    'docling-splitter',
    workspaceId,
    () => markDoclingFileSplitComplete(...args),
  );
}

/**
 * Relocated from services/ingestion/docling/scheduler/intake.ts's routing functions. Background
 * ingestion path → no request context; the pending_split insert needs workspaceId stamped from
 * the attachment's own workspace.
 */
export function routeDoclingIntake(
  workspaceId: string,
  input: Parameters<typeof upsertDoclingAsyncFileForSplit>[0],
): ReturnType<typeof upsertDoclingAsyncFileForSplit> {
  return asService(
    ['DoclingAsyncFile'],
    'docling intake: background ingestion path has no request context, insert stamped from the attachment\'s own workspace',
    'docling-intake',
    workspaceId,
    () => upsertDoclingAsyncFileForSplit(input),
  );
}
