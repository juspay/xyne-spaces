import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  TreeStructureIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useSnackbar } from "./ui/Snackbar";
import { PageLayout } from "./ui/PageLayout";
import { PageListHeader } from "./ui/PageListHeader";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSubagents } from "../hooks/useSubagents";
import { enableSubagent, disableSubagent, deleteSubagent } from "../../lib/api";
import type { SubagentDef } from "../../lib/api";
import { SubagentRow } from "./subagents/SubagentRow";
import { SubagentSlideOver } from "./subagents/SubagentSlideOver";
import { CreateSubagentDialog } from "./dialogs/CreateSubagentDialog";

interface SubagentsPageV3Props {
  userId: string;
}

function sortSubagents(subs: SubagentDef[]): SubagentDef[] {
  return [...subs].sort((a, b) => {
    if (a.enabled === b.enabled) return a.name.localeCompare(b.name);
    return a.enabled ? -1 : 1;
  });
}

export function SubagentsPageV3({ userId }: SubagentsPageV3Props) {
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const {
    subagents,
    builtIn,
    custom,
    loading,
    error,
    reload,
  } = useSubagents(userId);

  const [searchQuery, setSearchQuery] = useState("");
  /* Track the selected subagent by name (its permanent slug), not by full
     object. The full object is a snapshot taken at click time; once we
     reload() after a toggle, the snapshot's `enabled` field is stale even
     though the underlying row in `subagents` has the new value. Deriving
     `selectedSubagent` from the live array each render fixes the slide-
     over's "green dot says active after I disabled it" bug — same pattern
     we apply on the Skills page. */
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedIsBuiltIn, setSelectedIsBuiltIn] = useState(false);
  const selectedSubagent =
    selectedName == null
      ? null
      : subagents.find((s) => s.name === selectedName) ?? null;
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubagentDef | null>(null);

  function matchesSearch(s: SubagentDef): boolean {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  }

  const filteredBuiltIn = useMemo(
    () => sortSubagents(builtIn.filter(matchesSearch)),
    [builtIn, searchQuery]
  );
  const filteredCustom = useMemo(
    () => sortSubagents(custom.filter(matchesSearch)),
    [custom, searchQuery]
  );

  const disabledCount = useMemo(
    () => subagents.filter((s) => !s.enabled).length,
    [subagents]
  );

  const handleToggle = async (subagent: SubagentDef, value: boolean) => {
    if (subagent.enabled === value) return;
    setTogglingId(subagent.name);
    try {
      // Route to the right endpoint based on intent — the earlier version
      // called `enableSubagent` regardless of `value`, so toggling OFF was a
      // no-op (the snackbar lied and the list never updated). Disable on the
      // backend is a soft-delete (DELETE /:name); enable is POST /:name/enable.
      if (value) {
        await enableSubagent(subagent.name);
      } else {
        await disableSubagent(subagent.name);
      }
      showSnackbar({
        variant: "success",
        title: value
          ? `${subagent.name} enabled`
          : `${subagent.name} disabled`,
      });
      reload();
    } catch {
      showSnackbar({
        variant: "error",
        title: "Failed to update subagent",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSubagent(deleteTarget.name);
      setDeleteTarget(null);
      setSelectedName(null);
      showSnackbar({
        variant: "success",
        title: `${deleteTarget.name} deleted`,
      });
      reload();
    } catch {
      showSnackbar({
        variant: "error",
        title: "Failed to delete subagent",
      });
    }
  };

  return (
    <>
      <div className="flex h-full w-full overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden">
          <PageLayout
            header={
              <PageListHeader
                title="Specialists"
                subtitle="Pre-built domain experts your agents can delegate to. Each comes with a persona and a tool set."
                icon={<TreeStructureIcon size={18} />}
                stats={[
                  { value: loading ? undefined : subagents.length, label: "Total" },
                  { value: loading ? undefined : builtIn.length, label: "Built-in" },
                  { value: loading ? undefined : custom.length, label: "Custom" },
                  { value: loading ? undefined : disabledCount, label: "Disabled", highlight: disabledCount > 0 ? "warning" : null },
                ]}
                createLabel="New specialist"
                onCreateClick={() => setShowCreateDialog(true)}
                searchValue={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="Search specialists…"
                loading={loading}
              />
            }
            body={
              <div className="pb-[20px] px-[20px] max-w-[1024px] mx-auto w-full">
                {loading ? (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-[52px] w-full rounded-xl" />
                    ))}
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16">
                    <p className="text-[14px] text-xyne-fg-secondary">
                      {error}
                    </p>
                    <Button variant="secondary" size="sm" onClick={reload}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Custom section */}
                    <div className="mb-4">
                      <div className="flex items-baseline gap-[8px] mb-[8px]">
                        <span className="text-[12px] font-medium text-xyne-fg-primary">
                          Custom
                        </span>
                        <span className="text-[11px] text-xyne-fg-tertiary">
                          · {filteredCustom.length}
                        </span>
                        <span className="text-[11px] text-xyne-fg-tertiary ml-[4px]">
                          Created by your team
                        </span>
                      </div>
                      {filteredCustom.length > 0 ? (
                        filteredCustom.map((s) => (
                          <SubagentRow
                            key={s.name}
                            subagent={s}
                            isBuiltIn={false}
                            onSelect={(sub) => {
                              setSelectedName(sub.name);
                              setSelectedIsBuiltIn(false);
                            }}
                            onToggleEnabled={handleToggle}
                            toggling={togglingId === s.name}
                          />
                        ))
                      ) : custom.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                          <TreeStructureIcon
                            size={32}
                            weight="thin"
                            className="text-xyne-fg-muted"
                          />
                          <p className="text-[14px] font-medium text-xyne-fg-secondary">
                            No custom subagents yet
                          </p>
                          <button
                            onClick={() => setShowCreateDialog(true)}
                            className="text-[13px] text-xyne-brand hover:underline"
                          >
                            Create your first subagent
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                          <MagnifyingGlassIcon
                            size={28}
                            className="text-xyne-fg-muted"
                          />
                          <p className="text-[13px] text-xyne-fg-tertiary">
                            No custom subagents match &ldquo;{searchQuery}
                            &rdquo;
                          </p>
                          <button
                            onClick={() => setSearchQuery("")}
                            className="text-[13px] text-xyne-brand hover:underline"
                          >
                            Clear search
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Built-in section */}
                    {filteredBuiltIn.length > 0 && (
                      <div>
                        <div className="flex items-baseline gap-[8px] mb-[8px]">
                          <span className="text-[12px] font-medium text-xyne-fg-primary">
                            Built-in
                          </span>
                          <span className="text-[11px] text-xyne-fg-tertiary">
                            · {filteredBuiltIn.length}
                          </span>
                          <span className="text-[11px] text-xyne-fg-tertiary ml-[4px]">
                            Read-only — provided by the platform
                          </span>
                        </div>
                        {filteredBuiltIn.map((s) => (
                          <SubagentRow
                            key={s.name}
                            subagent={s}
                            isBuiltIn={true}
                            onSelect={(sub) => {
                              setSelectedName(sub.name);
                              setSelectedIsBuiltIn(true);
                            }}
                            onToggleEnabled={handleToggle}
                            toggling={togglingId === s.name}
                          />
                        ))}
                      </div>
                    )}

                    {/* Search no results across both sections */}
                    {filteredBuiltIn.length === 0 &&
                      filteredCustom.length === 0 &&
                      searchQuery.trim() && (
                        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                          <MagnifyingGlassIcon
                            size={32}
                            className="text-xyne-fg-muted"
                          />
                          <p className="text-[14px] font-medium text-xyne-fg-secondary">
                            No subagents match &ldquo;{searchQuery}&rdquo;
                          </p>
                          <button
                            onClick={() => setSearchQuery("")}
                            className="text-[13px] text-xyne-brand hover:underline"
                          >
                            Clear search
                          </button>
                        </div>
                      )}
                  </>
                )}
              </div>
            }
          />
        </div>

        {/* Tinted tray — matches the agent / MCP slide-over treatment so the
            white floating panel reads as a lifted card against a soft gray
            strip instead of bleeding into the list to its left. */}
        {selectedSubagent && (
          <div className="h-full bg-xyne-surface-sunken border-l border-xyne-border-subtle">
            <SubagentSlideOver
              subagent={selectedSubagent}
              isBuiltIn={selectedIsBuiltIn}
              userId={userId}
              onClose={() => setSelectedName(null)}
              onToggleEnabled={handleToggle}
              onEdit={(name) => {
                setSelectedName(null);
                navigate(`/v3/subagents/${name}`);
              }}
              onDelete={setDeleteTarget}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete subagent"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone. Agents using this subagent will lose access.`}
        danger
        onConfirm={handleDelete}
      />

      <CreateSubagentDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={() => {
          setShowCreateDialog(false);
          reload();
        }}
        userId={userId}
        existingNames={subagents.map((s) => s.name)}
      />
    </>
  );
}
