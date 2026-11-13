import { useQuery } from '@tanstack/react-query';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

/** `createdAt` is an epoch, for sorting. */
export interface LastRunEntry {
  status: string;
  createdAt: number;
}

/**
 * The most recent run of each workflow in a folder — the "Last run" column.
 *
 * One grouped query server-side, invalidated by `run_changed`.
 */
export function useLastRuns(folderId: string | undefined): Record<string, LastRunEntry> {
  const client = useWorkflowClient();

  const { data } = useQuery({
    queryKey: wfKeys.lastRunsIn(folderId),
    queryFn: async ({ signal }) => {
      const lastRuns = await client.workflows.lastRuns(
        folderId !== undefined ? { folderId } : {},
        { signal },
      );
      const out: Record<string, LastRunEntry> = {};
      for (const [workflowId, run] of Object.entries(lastRuns)) {
        out[workflowId] = { status: run.status, createdAt: new Date(run.createdAt).getTime() };
      }
      return out;
    },
    enabled: folderId !== undefined,
  });

  // Stable identity, so readers can memoise on it.
  return data ?? EMPTY;
}

const EMPTY: Record<string, LastRunEntry> = {};
