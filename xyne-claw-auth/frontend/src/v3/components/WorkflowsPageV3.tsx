import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PlusIcon,
  FlowArrowIcon,
  PencilSimpleIcon,
  TrashIcon,
  GlobeIcon,
} from "@phosphor-icons/react";
import type { Agent } from "../../lib/types";
import {
  listChainWorkflows,
  deleteChainWorkflow,
  deleteChannelChainBinding,
  requestWorkflowGlobal,
  listAgents,
  type ChainWorkflow,
} from "../../lib/api";
import { PageListHeader } from "./ui/PageListHeader";
import { PageLayout } from "./ui/PageLayout";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Skeleton } from "./ui/Skeleton";
import { ChainWorkflowModal } from "./ChainWorkflowModal";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";

interface Props {
  userId: string;
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                  */
/* ------------------------------------------------------------------ */

function WorkflowCardSkeleton() {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-64" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                       */
/* ------------------------------------------------------------------ */

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-xyne-surface-sunken">
        <FlowArrowIcon size={24} className="text-xyne-fg-muted" />
      </div>
      <h3 className="mb-1 text-[14px] font-semibold text-xyne-fg-primary">
        No workflows yet
      </h3>
      <p className="mb-6 max-w-sm text-[13px] text-xyne-fg-tertiary">
        Chain workflows let you wire multiple agents into a directed graph. When one agent
        finishes, the next one is triggered automatically based on conditions you define.
      </p>
      <Button
        variant="primary"
        size="md"
        leadingIcon={<PlusIcon size={14} />}
        onClick={onCreate}
      >
        Create Workflow
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Workflow card                                                     */
/* ------------------------------------------------------------------ */

function WorkflowCard({
  workflow,
  userId,
  onEdit,
  onDelete,
  onRequestGlobal,
  onDeleteBinding,
}: {
  workflow: ChainWorkflow;
  userId: string;
  onEdit: (w: ChainWorkflow) => void;
  onDelete: (w: ChainWorkflow) => void;
  onRequestGlobal: (w: ChainWorkflow) => void;
  onDeleteBinding: (bindingId: string, workflowId: string) => void;
}) {
  const nodeCount = workflow.definition.nodes.length;
  const edgeCount = workflow.definition.edges.length;
  const bindingCount = workflow.bindings?.length ?? 0;
  const isOwner = workflow.createdByUserId === userId;
  const canRequestGlobal = isOwner && !workflow.global;

  return (
    <div
      data-id="workflow-card"
      className={`rounded-xl border bg-xyne-surface p-5 transition-colors ${
        workflow.isPublished
          ? "border-xyne-success/20 hover:border-xyne-success/40"
          : "border-xyne-warning/20 hover:border-xyne-warning/40"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="truncate text-[15px] font-semibold text-xyne-fg-primary">
              {workflow.name}
            </h3>
            {workflow.isPublished ? (
              <Badge label="Active" variant="success" size="sm" dot as="span" />
            ) : (
              <Badge label="Draft" variant="warning" size="sm" dot as="span" />
            )}
            {workflow.global && (
              <Badge label="Global" variant="info" size="sm" dot as="span" />
            )}
          </div>
          <p className="mt-1 text-[12px] text-xyne-fg-muted">
            {nodeCount} node{nodeCount === 1 ? "" : "s"} · {edgeCount} edge
            {edgeCount === 1 ? "" : "s"} · updated{" "}
            {new Date(workflow.updatedAt).toLocaleString()}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-xyne-fg-placeholder">
            {workflow.id}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {canRequestGlobal && (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<GlobeIcon size={14} />}
              onClick={() => onRequestGlobal(workflow)}
              title="Request to publish globally"
            >
              Publish
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(workflow)}
            title="Edit workflow"
          >
            <PencilSimpleIcon size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(workflow)}
            title="Delete workflow"
          >
            <TrashIcon size={16} />
          </Button>
        </div>
      </div>

      {/* Bindings */}
      {bindingCount > 0 && (
        <div className="mt-4 border-t border-xyne-border-subtle pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-xyne-fg-muted">
            Bindings ({bindingCount})
          </p>
          <div className="flex flex-wrap gap-2">
            {workflow.bindings?.map((binding) => (
              <div
                key={binding.id}
                className="flex items-center gap-2 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-1.5"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-xyne-success" />
                <span className="font-mono text-[12px] text-xyne-fg-secondary">
                  {binding.channelId}
                </span>
                <span className="text-xyne-fg-muted">→</span>
                <span className="text-[12px] font-medium text-xyne-fg-primary">
                  {binding.entryAgentSlug}
                </span>
                {binding.enabled ? (
                  <Badge label="Active" variant="success" size="sm" as="span" />
                ) : (
                  <Badge label="Inactive" variant="neutral" size="sm" as="span" />
                )}
                <button
                  onClick={() => onDeleteBinding(binding.id, workflow.id)}
                  className="ml-1 rounded p-[3px] text-xyne-fg-muted hover:bg-xyne-error-bg hover:text-xyne-error-fg transition-colors"
                  title="Remove binding"
                >
                  <TrashIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                         */
/* ------------------------------------------------------------------ */

export function WorkflowsPageV3({ userId }: Props) {
  const [workflows, setWorkflows] = useState<ChainWorkflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<ChainWorkflow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChainWorkflow | null>(null);
  const { show: showSnackbar } = useSnackbar();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter((w) => w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q));
  }, [workflows, searchQuery]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rawWorkflows, allAgents] = await Promise.all([
        listChainWorkflows(),
        listAgents(userId),
      ]);
      const normalized = (rawWorkflows ?? [])
        .map((w) => ("workflow" in w ? w.workflow : w))
        .filter((w, i, arr) => arr.findIndex((x) => x.id === w.id) === i);
      setWorkflows(normalized);
      setAgents(allAgents);
    } catch {
      showSnackbar({ variant: "error", title: "Failed to load workflows" });
    } finally {
      setLoading(false);
    }
  }, [userId, showSnackbar]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteChainWorkflow(deleteTarget.id);
      setWorkflows((prev) => prev.filter((w) => w.id !== deleteTarget.id));
      showSnackbar({ variant: "success", title: "Workflow deleted" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Failed to delete workflow",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleCreate = () => {
    setEditingWorkflow(null);
    setModalOpen(true);
  };

  const handleEdit = (workflow: ChainWorkflow) => {
    setEditingWorkflow(workflow);
    setModalOpen(true);
  };

  const activeCount = workflows.filter((w) => w.isPublished).length;
  const draftCount = workflows.filter((w) => !w.isPublished).length;

  const handleDeleteBinding = async (bindingId: string, workflowId: string) => {
    try {
      await deleteChannelChainBinding(bindingId);
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId
            ? { ...w, bindings: (w.bindings ?? []).filter((b) => b.id !== bindingId) }
            : w,
        ),
      );
      showSnackbar({ variant: "success", title: "Binding removed" });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to remove binding",
      });
    }
  };

  const handleRequestGlobal = async (workflow: ChainWorkflow) => {
    try {
      await requestWorkflowGlobal(workflow.id, userId);
      showSnackbar({
        variant: "success",
        title: "Publish request submitted",
        description: "An admin will review and approve before this workflow becomes global.",
      });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to submit publish request",
      });
    }
  };

  return (
    <>
      <PageLayout
        header={
          <PageListHeader
            title="Workflows"
            icon={<FlowArrowIcon size={18} />}
            stats={[
              { value: loading ? undefined : workflows.length, label: "Total" },
              { value: loading ? undefined : activeCount, label: "Active", highlight: "success" as const },
              { value: loading ? undefined : draftCount, label: "Draft", highlight: draftCount > 0 ? "warning" : null },
            ]}
            createLabel="New workflow"
            onCreateClick={handleCreate}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search workflows…"
            loading={loading}
          />
        }
        body={
          loading ? (
            <div className="max-w-[1024px] mx-auto w-full px-[20px] py-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <WorkflowCardSkeleton key={i} />
              ))}
            </div>
          ) : workflows.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : filteredWorkflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20">
              <p className="text-[14px] text-xyne-fg-secondary">
                No workflows match "{searchQuery}"
              </p>
              <button
                onClick={() => setSearchQuery("")}
                className="text-[13px] text-xyne-brand hover:underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="max-w-[1024px] mx-auto w-full px-[20px] py-6 space-y-3">
              {filteredWorkflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  userId={userId}
                  onEdit={handleEdit}
                  onDelete={setDeleteTarget}
                  onRequestGlobal={handleRequestGlobal}
                  onDeleteBinding={handleDeleteBinding}
                />
              ))}
            </div>
          )
        }
      />

      <ChainWorkflowModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        agents={agents}
        onSaved={fetchAll}
        editingWorkflow={editingWorkflow}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete workflow?"
        description={`"${deleteTarget?.name ?? ""}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
      />
    </>
  );
}
