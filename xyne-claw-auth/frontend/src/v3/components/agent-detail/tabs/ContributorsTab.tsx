import { useState, useEffect, useCallback, useRef } from "react";
import {
  UsersThreeIcon,
  CrownIcon,
  XIcon,
  PlusIcon,
  CaretDownIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { listAgentShares, removeAgentShare, addAgentShare } from "../../../../lib/api";
import type { Agent } from "../../../../lib/types";
import type { AgentPermissions } from "../../../lib/agentPermissions";
import { Avatar } from "../../ui/Avatar";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Menu, MenuItem } from "../../ui/Menu";
import { Skeleton } from "../../ui/Skeleton";
import { useSnackbar } from "../../ui/Snackbar";

// Role options for the contributor dropdown. Tuple of internal value +
// display label so the menu can show friendly capitalization without
// drifting from the backend's UPPER_SNAKE enum strings.
const ROLE_OPTIONS: Array<{ value: "VIEWER" | "CONTRIBUTOR" | "EDITOR"; label: string }> = [
  { value: "VIEWER",      label: "Viewer" },
  { value: "CONTRIBUTOR", label: "Contributor" },
  { value: "EDITOR",      label: "Editor" },
];

interface Props {
  agent: Agent;
  userId: string;
  permissions: AgentPermissions;
}

interface ShareRow {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

function RoleBadge({ role }: { role: string }) {
  const label = role.charAt(0) + role.slice(1).toLowerCase();
  const variant =
    role === "EDITOR"
      ? "info"
      : role === "CONTRIBUTOR"
        ? "warning"
        : role === "VIEWER"
          ? "neutral"
          : "neutral";
  return <Badge as="span" label={label} variant={variant} size="sm" />;
}

export function ContributorsTab({ agent, userId, permissions }: Props) {
  const { show: showSnackbar } = useSnackbar();
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<"VIEWER" | "EDITOR" | "CONTRIBUTOR">("VIEWER");

  // Optimistic removal state: userId -> { share, timeout }
  const pendingRef = useRef<Map<string, { share: ShareRow; timeout: ReturnType<typeof setTimeout> }>>(new Map());
  const [, forceRender] = useState(0);

  const refreshPending = useCallback(() => {
    forceRender((n) => n + 1);
  }, []);

  useEffect(() => {
    setLoading(true);
    listAgentShares(agent.slug, userId)
      .then((data) => setShares(data))
      .catch(() => setShares([]))
      .finally(() => setLoading(false));
  }, [agent.slug, userId]);

  const handleRemove = useCallback(
    (shareUserId: string) => {
      const share = shares.find((s) => s.userId === shareUserId);
      if (!share) return;

      // Optimistically hide
      setShares((prev) => prev.filter((s) => s.userId !== shareUserId));

      const timeout = setTimeout(() => {
        pendingRef.current.delete(shareUserId);
        refreshPending();
        removeAgentShare(agent.slug, userId, shareUserId).catch(() => {
          // Restore on failure
          setShares((prev) =>
            [...prev, share].sort((a, b) => a.user.name.localeCompare(b.user.name))
          );
          showSnackbar({
            variant: "error",
            title: "Failed to remove contributor",
          });
        });
      }, 5000);

      pendingRef.current.set(shareUserId, { share, timeout });
      refreshPending();
    },
    [shares, agent.slug, userId, refreshPending, showSnackbar]
  );

  const handleUndo = useCallback(
    (shareUserId: string) => {
      const pending = pendingRef.current.get(shareUserId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingRef.current.delete(shareUserId);
      refreshPending();
      setShares((prev) =>
        [...prev, pending.share].sort((a, b) => a.user.name.localeCompare(b.user.name))
      );
    },
    [refreshPending]
  );

  const handleAdd = useCallback(async () => {
    if (!newUserId.trim() || adding) return;
    setAdding(true);
    try {
      await addAgentShare(agent.slug, userId, newUserId.trim(), newRole);
      showSnackbar({ variant: "success", title: "Contributor added" });
      setNewUserId("");
      // Refresh list
      const updated = await listAgentShares(agent.slug, userId);
      setShares(updated);
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to add contributor",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAdding(false);
    }
  }, [newUserId, newRole, adding, agent.slug, userId, showSnackbar]);

  const visibleShares = shares.filter((s) => !pendingRef.current.has(s.userId));
  const pendingList = Array.from(pendingRef.current.values()).map((p) => p.share);

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Owner row */}
      {agent.owner && (
        <div className="flex items-center gap-3 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-3">
          <Avatar name={agent.owner.name} size={28} shape="circle" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-xyne-fg-primary">
              {agent.owner.name}
            </span>
            <span className="truncate text-[11px] text-xyne-fg-tertiary">
              {agent.owner.email}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <CrownIcon size={10} className="text-xyne-success" />
            <Badge as="span" label="Owner" variant="success" size="sm" />
          </div>
        </div>
      )}

      {/* Share rows */}
      {visibleShares.length > 0 && (
        <div className="flex flex-col gap-2">
          {visibleShares.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-3 rounded-xl border border-xyne-border px-4 py-3"
            >
              <Avatar name={share.user.name} size={28} shape="circle" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-xyne-fg-primary">
                  {share.user.name}
                </span>
                <span className="truncate text-[11px] text-xyne-fg-tertiary">
                  {share.user.email}
                </span>
              </div>
              <RoleBadge role={share.role} />
              {permissions.canShare && (
                <button
                  onClick={() => handleRemove(share.userId)}
                  className="shrink-0 rounded-md p-1.5 text-xyne-fg-muted transition-colors hover:bg-xyne-error-bg hover:text-xyne-error-fg"
                  title="Remove contributor"
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {visibleShares.length === 0 && !agent.owner && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <UsersThreeIcon size={28} className="text-xyne-fg-muted" />
          <p className="text-[13px] text-xyne-fg-tertiary">No contributors yet</p>
        </div>
      )}

      {/* Undo banners for pending removals */}
      {pendingList.map((share) => (
        <div
          key={share.id}
          className="flex items-center gap-3 rounded-lg border border-xyne-warning-border bg-xyne-warning-bg px-4 py-2.5"
        >
          <span className="flex-1 text-[12px] text-xyne-warning-fg">
            Removing {share.user.name}…
          </span>
          <button
            onClick={() => handleUndo(share.userId)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-xyne-warning-fg transition-colors hover:bg-xyne-warning-bg/80"
          >
            <ArrowCounterClockwiseIcon size={12} />
            Undo
          </button>
        </div>
      ))}

      {/* Add form — only for owners */}
      {permissions.canShare && (
        <div className="flex flex-col gap-2 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle p-4">
          <p className="text-[13px] font-medium text-xyne-fg-primary">Add contributor</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              placeholder="User ID"
              className="flex-1 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
            />
            {/* Role dropdown — styled Menu (same primitive used on the
                  provider chip elsewhere) instead of a native <select>, so
                  the popup matches the rest of the UI in light + dark mode
                  and on every OS. */}
            <Menu
              trigger={(triggerProps) => (
                <button
                  {...(triggerProps as React.HTMLAttributes<HTMLButtonElement>)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-xyne-border bg-xyne-surface px-3 py-1.5 text-[13px] text-xyne-fg-primary transition-colors hover:border-xyne-border-strong focus:outline-none focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)]"
                >
                  {ROLE_OPTIONS.find((o) => o.value === newRole)?.label ?? "Role"}
                  <CaretDownIcon size={10} className="text-xyne-fg-tertiary" />
                </button>
              )}
            >
              {ROLE_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.value}
                  selected={newRole === opt.value}
                  onSelect={() => setNewRole(opt.value)}
                >
                  {opt.label}
                </MenuItem>
              ))}
            </Menu>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<PlusIcon size={12} />}
              onClick={handleAdd}
              disabled={adding || !newUserId.trim()}
            >
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
