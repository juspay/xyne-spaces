import { CheckIcon, XIcon, CopyIcon } from "@phosphor-icons/react";
import type { AgentDelegationRequest, CloneRequestItem } from "../../../../lib/api";

/**
 * Owner inbox for pending clone and delegation requests on this agent, rendered inside the
 * right-column "Requests" panel. Presentational — the parent
 * (AgentDetailRightColumn) owns the fetch + resolve state so the dashboard
 * badge and this list stay in sync.
 */
export function CloneRequestsTab({
  requests,
  busyId,
  loading,
  onResolve,
  delegationRequests,
  activeDelegations,
  delegationBusyId,
  delegationLoading,
  onResolveDelegation,
  onRevokeDelegation,
}: {
  requests: CloneRequestItem[];
  busyId: string | null;
  loading: boolean;
  onResolve: (req: CloneRequestItem, decision: "approve" | "reject") => void;
  delegationRequests: AgentDelegationRequest[];
  activeDelegations: AgentDelegationRequest[];
  delegationBusyId: string | null;
  delegationLoading: boolean;
  onResolveDelegation: (req: AgentDelegationRequest, decision: "approve" | "reject") => void;
  onRevokeDelegation: (req: AgentDelegationRequest) => void;
}) {
  if ((loading || delegationLoading) && requests.length === 0 && delegationRequests.length === 0 && activeDelegations.length === 0) {
    return <p className="px-4 py-6 text-[12px] text-xyne-fg-tertiary">Loading requests…</p>;
  }

  if (requests.length === 0 && delegationRequests.length === 0 && activeDelegations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
        <CopyIcon size={26} className="text-xyne-fg-muted" />
        <p className="text-[13px] font-medium text-xyne-fg-secondary">No pending requests</p>
        <p className="max-w-[280px] text-[12px] leading-relaxed text-xyne-fg-tertiary">
          When someone requests a copy of this agent or access for another agent to call it,
          it shows up here for you to approve or decline.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-xyne-fg-secondary">Clone requests</p>
          {loading && <span className="text-[11px] text-xyne-fg-tertiary">Loading…</span>}
        </div>
        {requests.length === 0 ? (
          <p className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5 text-[12px] text-xyne-fg-tertiary">
            No pending clone requests.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
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
                    title="Approve — gives the requester a personal copy with this agent's prompt, tools, skills, behaviour and knowledge-base grants. Your integration credentials are not shared."
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
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-xyne-fg-secondary">Delegation requests</p>
          {delegationLoading && <span className="text-[11px] text-xyne-fg-tertiary">Loading…</span>}
        </div>
        {delegationRequests.length === 0 ? (
          <p className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5 text-[12px] text-xyne-fg-tertiary">
            No pending delegation requests.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {delegationRequests.map((req) => {
              const caller = req.caller;
              const callerName = caller?.name ?? caller?.slug ?? req.callerAgentId;
              const callerSlug = caller?.slug ?? req.callerAgentId;
              const owner = caller?.owner?.name || caller?.owner?.email || caller?.ownerUserId;
              const requestedBy =
                req.createdByUserId || owner || "Unknown user";
              return (
                <li
                  key={req.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-xyne-fg-primary">
                      {callerName}
                    </p>
                    <p className="truncate text-[11.5px] text-xyne-fg-tertiary">
                      {callerSlug} · requested by {requestedBy}
                    </p>
                    <p className="truncate text-[11.5px] text-xyne-fg-tertiary">
                      requested {new Date(req.createdAt).toLocaleString()}
                    </p>
                    {req.requestReason && (
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-xyne-fg-secondary">
                        Reason: {req.requestReason}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onResolveDelegation(req, "approve")}
                      disabled={delegationBusyId !== null}
                      className="inline-flex items-center gap-1 rounded-md bg-xyne-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
                      title="Approve this delegation request"
                    >
                      <CheckIcon size={14} weight="bold" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolveDelegation(req, "reject")}
                      disabled={delegationBusyId !== null}
                      className="inline-flex items-center gap-1 rounded-md border border-xyne-border-subtle px-2.5 py-1 text-[12px] font-medium text-xyne-fg-secondary disabled:opacity-50"
                      title="Reject this delegation request"
                    >
                      <XIcon size={14} weight="bold" />
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-xyne-fg-secondary">Active delegations</p>
          {delegationLoading && <span className="text-[11px] text-xyne-fg-tertiary">Loading…</span>}
        </div>
        {activeDelegations.length === 0 ? (
          <p className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5 text-[12px] text-xyne-fg-tertiary">
            No active delegations.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeDelegations.map((req) => {
              const caller = req.caller;
              const callerName = caller?.name ?? caller?.slug ?? req.callerAgentId;
              const callerSlug = caller?.slug ?? req.callerAgentId;
              const owner = caller?.owner?.name || caller?.owner?.email || caller?.ownerUserId || "Unknown owner";
              return (
                <li
                  key={req.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-xyne-fg-primary">
                      {callerName}
                    </p>
                    <p className="truncate text-[11.5px] text-xyne-fg-tertiary">
                      {callerSlug} · owner {owner}
                    </p>
                    {req.requestReason && (
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-xyne-fg-secondary">
                        Reason: {req.requestReason}
                      </p>
                    )}
                    <p className="truncate text-[11.5px] text-xyne-fg-tertiary">
                      approved {req.approvedAt ? new Date(req.approvedAt).toLocaleString() : "previously"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevokeDelegation(req)}
                    disabled={delegationBusyId !== null}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-xyne-border-subtle px-2.5 py-1 text-[12px] font-medium text-xyne-fg-secondary disabled:opacity-50"
                    title="Revoke this delegation"
                  >
                    <XIcon size={14} weight="bold" />
                    Revoke
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
