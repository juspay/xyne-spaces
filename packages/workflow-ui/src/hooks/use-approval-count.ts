import { useQuery } from '@tanstack/react-query';
import type { PendingApprovalBucket } from '@xyne/workflow-sdk/client';
import { useWorkflowClient } from './use-workflow-client.js';
import { wfKeys } from './queries.js';

export interface ApprovalCountParams {
  /** Count one deadline slice instead of the whole queue. */
  bucket?: PendingApprovalBucket | undefined;
  /** End of the reader's day — see `endOfToday()`. Must be stable per render. */
  dayEnd?: number | undefined;
}

/**
 * How many runs are waiting on a gate — the sidebar badge, and the total a
 * section header states.
 *
 * It is a COUNT, not the length of a list, and that distinction is the whole
 * point: a list holds one page, so counting it reports how much has been
 * downloaded rather than how much exists. Passing a bucket answers the same
 * question for Overdue or Due today.
 *
 * The badge is global, so there is no topic to subscribe to; it revalidates on
 * focus, on reconnect, and whenever `run_changed` invalidates the approvals
 * family. Mounted in several places, which the shared key collapses per bucket.
 */
export function useApprovalCount(params?: ApprovalCountParams): number | undefined {
  const client = useWorkflowClient();
  const { bucket, dayEnd } = params ?? {};

  const { data } = useQuery({
    queryKey: wfKeys.approvalCount(bucket, dayEnd),
    queryFn: ({ signal }) =>
      client.executions.countPendingApprovals(
        {
          ...(bucket ? { bucket } : {}),
          ...(dayEnd !== undefined ? { dayEnd } : {}),
        },
        { signal },
      ),
    staleTime: 60_000,
  });

  // Deliberately not `0`: "none waiting" and "not known yet" render differently.
  return data;
}
