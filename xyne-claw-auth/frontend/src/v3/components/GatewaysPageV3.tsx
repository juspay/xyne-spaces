import { useState, useMemo, useEffect } from "react";
import {
  ShareNetworkIcon,
  WarningCircleIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { PageLayout } from "./ui/PageLayout";
import { PageListHeader } from "./ui/PageListHeader";
import { Badge } from "./ui/Badge";
import { Skeleton } from "./ui/Skeleton";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";
import { Avatar } from "./ui/Avatar";
import { GatewaySlideOver } from "./gateways/GatewaySlideOver";
import { AddGatewayDialog } from "./dialogs/AddGatewayDialog";
import { useGateways } from "../hooks/useGateways";
import { deleteGateway, listIdentities } from "../../lib/api";
import type { Gateway } from "../../lib/types";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function GatewaysPageV3() {
  const { gateways, loading, error, reload } = useGateways();
  const { show: showSnackbar } = useSnackbar();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGateway, setSelectedGateway] = useState<Gateway | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Gateway | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteIdentityCount, setDeleteIdentityCount] = useState(0);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return gateways;
    return gateways.filter(
      (g) => g.name.toLowerCase().includes(q) || g.type.toLowerCase().includes(q),
    );
  }, [gateways, searchQuery]);

  const enabledCount = gateways.filter((g) => g.enabled).length;
  const disabledCount = gateways.filter((g) => !g.enabled).length;

  useEffect(() => {
    if (!deleteTarget) {
      setDeleteIdentityCount(0);
      return;
    }
    listIdentities(deleteTarget.id)
      .then((ids) => setDeleteIdentityCount(ids.length))
      .catch(() => setDeleteIdentityCount(0));
  }, [deleteTarget?.id]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteGateway(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedGateway(null);
      showSnackbar({
        variant: "success",
        title: `${deleteTarget.name} deleted`,
      });
      reload();
    } catch {
      showSnackbar({
        variant: "error",
        title: "Failed to delete gateway",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    // Flex sibling layout (matches AgentsPageV3): the slide-over is rendered
    // as an actual column rather than an absolute overlay, so the main
    // content area shrinks when it's open instead of being hidden under
    // a positioned panel.
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden">
      <PageLayout
        header={
          <PageListHeader
            title="Channels"
            subtitle="Where your agents reach you — Slack, Xyne Spaces, etc. — to post results and ask for approvals."
            icon={<ShareNetworkIcon size={18} />}
            stats={[
              { value: loading ? undefined : gateways.length, label: "Total" },
              { value: loading ? undefined : enabledCount, label: "Enabled", highlight: "success" as const },
              { value: loading ? undefined : disabledCount, label: "Disabled", highlight: disabledCount > 0 ? "warning" : null },
            ]}
            createLabel="Add channel"
            onCreateClick={() => setShowAddDialog(true)}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search channels…"
            loading={loading}
          />
        }
        body={
          <div data-id="gateways-page-body" className="flex flex-col max-w-[1024px] mx-auto w-full px-[20px]">
            {loading ? (
              <div className="flex flex-col gap-[6px] py-[10px]">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-[56px] rounded-xl" />
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
                <WarningCircleIcon size={32} className="text-red-400" />
                <p className="text-[14px] text-xyne-fg-muted">{error}</p>
                <Button variant="secondary" onClick={reload}>
                  Retry
                </Button>
              </div>
            ) : gateways.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-[12px] py-[64px]">
                <ShareNetworkIcon size={48} weight="thin" className="text-xyne-fg-muted" />
                <div className="text-center">
                  <p className="mb-[4px] text-[14px] font-medium text-xyne-fg-primary">
                    No gateways configured
                  </p>
                  <p className="text-[12px] text-xyne-fg-tertiary">
                    Add a gateway to enable identity mapping for external integrations
                  </p>
                </div>
                <Button variant="primary" onClick={() => setShowAddDialog(true)}>
                  + Add gateway
                </Button>
              </div>
            ) : filtered.length === 0 && searchQuery.trim() ? (
              <div className="flex flex-col items-center justify-center gap-3 py-[64px]">
                <MagnifyingGlassIcon size={48} weight="thin" className="text-xyne-fg-muted" />
                <p className="text-[14px] text-xyne-fg-muted">
                  No gateways match &apos;{searchQuery}&apos;
                </p>
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-[12px] text-xyne-fg-link hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 py-[10px]">
                {/* Channel rows — flex card layout matching AgentsPageV3's
                    AgentRow pattern so all V3 list pages share the same
                    visual vocabulary: 32px avatar, status dot + name,
                    description / type, scope-like chip, right-aligned
                    timestamp, chevron. */}
                {filtered.map((gateway) => (
                  <div
                    key={gateway.id}
                    data-id="gateway-row"
                    onClick={() => setSelectedGateway(gateway)}
                    className={`flex min-w-0 w-full cursor-pointer items-center rounded-xl border bg-xyne-surface text-[14px] transition-[background-color,border-color,box-shadow] duration-[var(--comp-duration-normal)] ${
                      gateway.enabled
                        ? "border-xyne-border hover:border-xyne-success/30 hover:bg-xyne-surface-subtle hover:shadow-[0_1px_6px_0_rgba(0,0,0,0.07)]"
                        : "border-xyne-border hover:border-xyne-error/30 hover:bg-xyne-surface-subtle"
                    }`}
                  >
                    {/* Avatar */}
                    <div className="flex w-[60px] shrink-0 items-center justify-center py-3.5">
                      <Avatar
                        name={gateway.name}
                        size={32}
                        shape="circle"
                        className="!bg-xyne-surface-sunken !text-xyne-fg-secondary border border-xyne-border"
                      />
                    </div>

                    {/* Name + status dot */}
                    <div className="flex w-[220px] shrink-0 items-center gap-2 px-2 py-3.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          gateway.enabled ? "bg-xyne-success" : "bg-xyne-warning"
                        }`}
                        title={gateway.enabled ? "Enabled" : "Disabled"}
                      />
                      <span className="w-full truncate text-[14px] font-semibold text-xyne-fg-primary">
                        {gateway.name}
                      </span>
                    </div>

                    {/* Type — fixed width mono chip (no flex-1, otherwise the
                        row stretches and looks empty when the slide-over
                        overlay covers the right portion). */}
                    <div className="flex w-[180px] shrink-0 items-center px-3 py-3.5">
                      <span className="inline-flex items-center rounded-md bg-xyne-surface-sunken px-2 py-0.5 text-[11px] font-mono text-xyne-fg-secondary border border-xyne-border-subtle truncate max-w-full">
                        {gateway.type}
                      </span>
                    </div>

                    {/* Status pill */}
                    <div className="flex w-[110px] shrink-0 items-center px-3 py-3.5">
                      {gateway.enabled ? (
                        <Badge as="span" label="Enabled" variant="success" size="sm" />
                      ) : (
                        <Badge as="span" label="Disabled" variant="warning" size="sm" />
                      )}
                    </div>

                    {/* Spacer pushes Created + Chevron to the right edge */}
                    <div className="flex-1 min-w-0" />

                    {/* Created date — right-aligned, mirrors AgentRow's
                        last-used column. */}
                    <div className="flex w-[110px] shrink-0 items-center justify-end px-3 py-3.5">
                      <span className="text-[11px] text-xyne-fg-tertiary text-right">
                        {fmtDate(gateway.createdAt)}
                      </span>
                    </div>

                    {/* Chevron */}
                    <div className="flex w-[40px] shrink-0 items-center justify-center py-3.5">
                      <CaretRightIcon size={14} className="text-xyne-fg-tertiary" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
      />

      </div>

      {/* Slide-over — flex sibling, not an overlay. Tinted tray (sunken bg
          + border-l) reads as a lifted card against the page. The list to
          the left shrinks to accommodate the panel's 520px width. */}
      {selectedGateway && (
        <div className="h-full w-[520px] flex-shrink-0 bg-xyne-surface-sunken border-l border-xyne-border-subtle overflow-hidden">
          <GatewaySlideOver
            gateway={selectedGateway}
            onClose={() => setSelectedGateway(null)}
            onDeleteRequest={setDeleteTarget}
          />
        </div>
      )}

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete gateway"
        description={
          deleteTarget
            ? deleteIdentityCount > 0
              ? `Delete "${deleteTarget.name}"? This will also remove ${deleteIdentityCount} linked user identity mapping${deleteIdentityCount !== 1 ? "s" : ""}. This cannot be undone.`
              : `Delete "${deleteTarget.name}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
      />

      {/* Add gateway dialog */}
      <AddGatewayDialog
        open={showAddDialog}
        existingTypes={gateways.map((g) => g.type)}
        onClose={() => setShowAddDialog(false)}
        onCreated={(newGateway) => {
          setShowAddDialog(false);
          reload();
          setSelectedGateway(newGateway);
        }}
      />
    </div>
  );
}
