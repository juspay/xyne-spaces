import {
  PlusIcon,
  PencilSimpleIcon,
  TrashIcon,
  FlowArrowIcon,
  LinkIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  DotsThreeIcon,
  WarningIcon,
  GlobeIcon,
} from "@phosphor-icons/react";
import type { ChainWorkflow, ChainWorkflowBinding } from "../../lib/api";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Skeleton } from "./ui/Skeleton";
import { Menu, MenuItem } from "./ui/Menu";

interface Props {
  workflows: ChainWorkflow[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (workflow: ChainWorkflow) => void;
  onDelete: (workflow: ChainWorkflow) => void;
  onRequestGlobal: (workflow: ChainWorkflow) => void;
}

function getPrimaryBinding(workflow: ChainWorkflow) {
  return workflow.bindings?.[0];
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      data-id="chain-empty-state"
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-xyne-surface-sunken">
        <FlowArrowIcon size={24} className="text-xyne-fg-muted" />
      </div>
      <h3 className="mb-1 text-[14px] font-semibold text-xyne-fg-primary">
        No chain workflows yet
      </h3>
      <p className="mb-6 max-w-sm text-[13px] text-xyne-fg-tertiary">
        Chain workflows let you wire multiple agents into a directed graph. When one agent finishes,
        the next one is triggered automatically based on conditions you define.
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

export function ChainWorkflowList({ workflows, loading, onCreate, onEdit, onDelete, onRequestGlobal }: Props) {
  if (loading) {
    return (
      <div data-id="chain-loading" className="space-y-3 px-6 py-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-xl border border-xyne-border p-4"
          >
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-[14px] font-semibold text-xyne-fg-primary">Chain Workflows</h2>
            <p className="mt-0.5 text-[13px] text-xyne-fg-tertiary">
              Multi-agent workflows this agent participates in
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            leadingIcon={<PlusIcon size={14} />}
            onClick={onCreate}
          >
            Create Workflow
          </Button>
        </div>
        <EmptyState onCreate={onCreate} />
      </div>
    );
  }

  return (
    <div data-id="chain-workflow-list" className="px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[14px] font-semibold text-xyne-fg-primary">Chain Workflows</h2>
          <p className="mt-0.5 text-[13px] text-xyne-fg-tertiary">
            Multi-agent workflows this agent participates in
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          leadingIcon={<PlusIcon size={14} />}
          onClick={onCreate}
        >
          Create Workflow
        </Button>
      </div>

      <div className="space-y-3">
        {workflows.map((workflow) => {
          const binding = getPrimaryBinding(workflow);
          const nodeCount = workflow.definition.nodes.length;
          const edgeCount = workflow.definition.edges.length;

          return (
            <div
              key={workflow.id}
              data-id="chain-workflow-card"
              className="group flex items-center gap-4 rounded-xl border border-xyne-border bg-xyne-surface p-4 transition-colors hover:border-xyne-border-strong"
            >
              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-xyne-surface-sunken">
                <FlowArrowIcon size={20} className="text-xyne-fg-muted" />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-xyne-fg-primary">
                    {workflow.name}
                  </span>
                  {workflow.isPublished ? (
                    <Badge
                      label="Published"
                      variant="success"
                      size="sm"
                      dot
                      as="span"
                    />
                  ) : (
                    <Badge
                      label="Draft"
                      variant="warning"
                      size="sm"
                      dot
                      as="span"
                    />
                  )}
                  {workflow.global && (
                    <Badge label="Global" variant="success" size="sm" as="span" />
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-xyne-fg-muted">
                  <span className="inline-flex items-center gap-1">
                    <LinkIcon size={12} />
                    {nodeCount} node{nodeCount === 1 ? "" : "s"} · {edgeCount} edge
                    {edgeCount === 1 ? "" : "s"}
                  </span>
                  {binding && (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircleIcon size={12} />
                      Bound to channel
                    </span>
                  )}
                  {!binding && (
                    <span className="inline-flex items-center gap-1 text-xyne-warning-fg">
                      <WarningIcon size={12} />
                      Not bound to a channel
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(workflow)}
                  title="Edit workflow"
                >
                  <PencilSimpleIcon size={16} />
                </Button>
                <Menu
                  trigger={(triggerProps) => (
                    <button
                      type="button"
                      {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-xyne-fg-muted border border-transparent transition-colors duration-[var(--comp-duration-normal)] ease-in hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1"
                      title="More options"
                    >
                      <DotsThreeIcon size={16} />
                    </button>
                  )}
                >
                  {!workflow.global && (
                    <MenuItem
                      onSelect={() => onRequestGlobal(workflow)}
                      leading={<GlobeIcon size={14} />}
                    >
                      Push to Global
                    </MenuItem>
                  )}
                  <MenuItem
                    onSelect={() => onDelete(workflow)}
                    leading={<TrashIcon size={14} className="text-xyne-error-fg" />}
                  >
                    <span className="text-xyne-error-fg">Delete</span>
                  </MenuItem>
                </Menu>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
