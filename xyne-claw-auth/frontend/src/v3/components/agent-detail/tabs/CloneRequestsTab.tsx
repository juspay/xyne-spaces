import { CheckIcon, XIcon, CopyIcon } from "@phosphor-icons/react";
import type { CloneRequestItem } from "../../../../lib/api";

/**
 * Owner inbox for pending clone requests on this agent, rendered inside the
 * right-column "Requests" panel. Presentational — the parent
 * (AgentDetailRightColumn) owns the fetch + resolve state so the dashboard
 * badge and this list stay in sync.
 */
export function CloneRequestsTab({
  requests,
  busyId,
  loading,
  onResolve,
}: {
  requests: CloneRequestItem[];
  busyId: string | null;
  loading: boolean;
  onResolve: (req: CloneRequestItem, decision: "approve" | "reject") => void;
}) {
  if (loading) {
    return <p className="px-4 py-6 text-[12px] text-xyne-fg-tertiary">Loading requests…</p>;
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
        <CopyIcon size={26} className="text-xyne-fg-muted" />
        <p className="text-[13px] font-medium text-xyne-fg-secondary">No pending requests</p>
        <p className="max-w-[280px] text-[12px] leading-relaxed text-xyne-fg-tertiary">
          When someone requests a copy of this agent, it shows up here for you to approve or
          decline. A clone copies only the system prompt, tools, and skills — never your
          credentials or knowledge-base grants.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 px-4 py-4">
      {requests.map((req) => (
        <li
          key={req.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-xyne-fg-primary">
              {req.requesterName || req.requesterEmail || req.requesterId}
            </p>
            <p className="truncate text-[11.5px] text-xyne-fg-tertiary">wants to clone this agent</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onResolve(req, "approve")}
              disabled={busyId !== null}
              className="inline-flex items-center gap-1 rounded-md bg-xyne-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
              title="Approve — creates a copy for the requester"
            >
              <CheckIcon size={14} weight="bold" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => onResolve(req, "reject")}
              disabled={busyId !== null}
              className="inline-flex items-center gap-1 rounded-md border border-xyne-border-subtle px-2.5 py-1 text-[12px] font-medium text-xyne-fg-secondary disabled:opacity-50"
              title="Decline this clone request"
            >
              <XIcon size={14} weight="bold" />
              Decline
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
