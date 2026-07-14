import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  Handle,
  Position,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  PlusIcon,
  FloppyDiskIcon,
  TrashIcon,
  XIcon,
  HashIcon,
  CaretDownIcon,
  CheckIcon,
  RobotIcon,
  MagnifyingGlassIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import {
  createChainWorkflow,
  listSpacesChannels,
  listSpacesBoards,
  listSpacesProjects,
  updateChainWorkflow,
  upsertChannelChainBinding,
  deleteChannelChainBinding,
  listSpacesTriggers,
  getSpacesTriggerSchema,
  type ChainWorkflow,
  type ChainWorkflowDefinition,
  type ChainWorkflowEdge as ApiEdge,
  type ChainWorkflowNode as ApiNode,
  type SpacesBoard,
  type SpacesChannel,
  type SpacesProject,
  type SpacesTriggerSummary,
  type SpacesTriggerSchema,
  type SpacesTriggerPropertySchema,
} from "../../lib/api";
import type { AgentLight } from "../../lib/types";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { useSnackbar } from "./ui/Snackbar";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

/** Claw-defined VCS trigger templates. Not native Spaces triggers — the
 *  backend (chain-workflows.ts buildSpacesConfig) compiles these to a generic
 *  WEBHOOK automation + RUN_AGENT step and issues a webhook URL to paste into
 *  the repo. Surfaced alongside Spaces' native trigger catalog. */
const VCS_TEMPLATE_TRIGGERS: SpacesTriggerSummary[] = [
  { type: "GITHUB_EVENT", name: "GitHub event (webhook)", description: "Fires when GitHub POSTs a repo event to the generated webhook URL. Paste the URL into your repo's webhook settings." },
  { type: "BITBUCKET_EVENT", name: "Bitbucket event (webhook)", description: "Fires when Bitbucket POSTs a repo event to the generated webhook URL. Paste the URL into your repo's webhook settings." },
];

const VCS_TEMPLATE_CONFIG_FIELDS: Record<string, {
  props: Record<string, SpacesTriggerPropertySchema>;
  required: string[];
}> = {
  GITHUB_EVENT: {
    props: {
      eventTypes: {
        type: "array",
        description: "push, pull_request, issues, issue_comment, release, workflow_run",
        items: { type: "string" },
      },
      repoName: {
        type: "string",
        description: "owner/repository, for example juspay/xyne-spaces",
      },
    },
    required: [],
  },
  BITBUCKET_EVENT: {
    props: {
      eventTypes: {
        type: "array",
        description: "repo:push, pullrequest:created, pullrequest:updated, pullrequest:fulfilled",
        items: { type: "string" },
      },
      repoName: {
        type: "string",
        description: "repository slug or full name",
      },
    },
    required: [],
  },
};

const VCS_EVENT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  GITHUB_EVENT: [
    { value: "push", label: "Push" },
    { value: "pull_request", label: "Pull request" },
    { value: "issues", label: "Issues" },
    { value: "issue_comment", label: "Issue comments" },
    { value: "release", label: "Releases" },
    { value: "workflow_run", label: "Workflow runs" },
  ],
  BITBUCKET_EVENT: [
    { value: "repo:push", label: "Push" },
    { value: "pullrequest:created", label: "Pull request created" },
    { value: "pullrequest:updated", label: "Pull request updated" },
    { value: "pullrequest:fulfilled", label: "Pull request merged" },
    { value: "pullrequest:rejected", label: "Pull request declined" },
  ],
};

/** A draft event trigger being edited in the modal. `dbId` is set when editing
 *  an existing trigger so the backend updates rather than recreates it.
 *  Channels are NOT stored here — triggers reuse the workflow's channel binding. */
interface TriggerDraft {
  id: string;            // client-side row id (for React keys)
  dbId?: string;         // existing trigger id (edit mode)
  type: string;
  configValues: Record<string, string>;
}

/** Extract the config field map + required list from a trigger schema,
 *  resolving the zod-to-json-schema `$ref → definitions.config` indirection. */
function triggerSchemaFields(
  schema: SpacesTriggerSchema | undefined,
  triggerType?: string,
): { props: Record<string, SpacesTriggerPropertySchema>; required: string[] } {
  if (triggerType && VCS_TEMPLATE_CONFIG_FIELDS[triggerType]) {
    return VCS_TEMPLATE_CONFIG_FIELDS[triggerType];
  }
  if (!schema) return { props: {}, required: [] };
  const cs = schema.configSchema;
  if (cs.properties && Object.keys(cs.properties).length > 0) {
    return { props: cs.properties, required: cs.required ?? [] };
  }
  const refName = cs.$ref?.split("/").pop();
  const def = refName ? cs.definitions?.[refName] : undefined;
  return { props: def?.properties ?? {}, required: def?.required ?? [] };
}

/**
 * Flatten a trigger's OUTPUT schema into the `{{trigger.*}}` paths a user can
 * reference in the Context box — one level into nested objects (e.g. message →
 * message.content). Resolves the zodToJsonSchema $ref/definitions wrapping.
 */
function triggerOutputRefs(schema: SpacesTriggerSchema | undefined): string[] {
  const out = schema?.outputSchema;
  if (!out) return [];
  const defs = out.definitions ?? {};
  const rootProps =
    out.properties && Object.keys(out.properties).length > 0
      ? out.properties
      : (out.$ref?.split("/").pop() ? defs[out.$ref.split("/").pop()!]?.properties : undefined) ?? {};
  const deref = (p: SpacesTriggerPropertySchema): SpacesTriggerPropertySchema => {
    const refName = p.$ref?.split("/").pop();
    return (refName ? (defs[refName] as SpacesTriggerPropertySchema | undefined) : undefined) ?? p;
  };
  const paths: string[] = [];
  for (const [key, raw] of Object.entries(rootProps)) {
    const p = deref(raw);
    const nested = p.properties;
    if (nested && Object.keys(nested).length > 0) {
      for (const sub of Object.keys(nested)) paths.push(`${key}.${sub}`);
    } else {
      paths.push(key);
    }
  }
  return paths;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentLight[];
  onSaved: () => void;
  editingWorkflow?: ChainWorkflow | null;
}

interface AgentOption {
  slug: string;
  name: string;
}

interface AgentNodeData extends Record<string, unknown> {
  agentSlug: string;
  taskTemplate: string;
  agentOptions: AgentOption[];
  onChange: (id: string, patch: Partial<{ agentSlug: string; taskTemplate: string }>) => void;
  onDelete: (id: string) => void;
}

/** Persisted edge config (serialized on save) */
interface EdgeData extends Record<string, unknown> {
  mode: "always" | "tools" | "judge";
  toolsMustInclude: string;
  toolsMustExclude: string;
  judgeContext: string;
  taskTemplate: string;
}

/** Extended edge data with inline-popover state + callbacks */
interface ChainEdgeData extends EdgeData {
  isOpen: boolean;
  onToggle: (id: string) => void;
  onChange: (id: string, patch: Partial<EdgeData>) => void;
  onDelete: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const randomId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const fromCsv = (value: string): string[] =>
  value.split(",").map((v) => v.trim()).filter((v) => v.length > 0);

const toCsv = (values: string[]): string => values.join(", ");

function eventTypeLabel(triggerType: string, value: string): string {
  return VCS_EVENT_OPTIONS[triggerType]?.find((o) => o.value === value)?.label ?? value;
}

const TRIGGER_FIELD_LABELS: Record<string, string> = {
  boardIds: "Boards",
  projectIds: "Projects",
};

function triggerFieldLabel(key: string, required: boolean): string {
  return `${TRIGGER_FIELD_LABELS[key] ?? key}${required ? " *" : ""}`;
}

/* ------------------------------------------------------------------ */
/*  AgentPicker — elegant custom dropdown shared by modal + nodes       */
/* ------------------------------------------------------------------ */

interface AgentPickerProps {
  value: string;
  onChange: (slug: string) => void;
  options: AgentOption[];
  placeholder: string;
  size?: "sm" | "md";
  className?: string;
  /** Inside a ReactFlow node — stop click/mousedown from selecting/dragging. */
  stopPropagation?: boolean;
}

function AgentPicker({
  value,
  onChange,
  options,
  placeholder,
  size = "md",
  className,
  stopPropagation = false,
}: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !wrapRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const selected = options.find((o) => o.slug === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [options, query]);

  const stop = (e: React.SyntheticEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  const isSm = size === "sm";

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setOpen((o) => !o);
        }}
        onMouseDown={stop}
        className={`flex w-full items-center gap-2 rounded-lg border border-xyne-border bg-xyne-surface-sunken text-left text-xyne-fg-primary outline-none transition-colors hover:border-xyne-border-strong focus:border-xyne-border-focus ${
          isSm ? "h-8 px-2 text-[12px]" : "h-10 px-3 text-[13px]"
        }`}
      >
        <RobotIcon
          size={isSm ? 11 : 13}
          className="shrink-0 text-xyne-fg-tertiary"
        />
        <span
          className={`min-w-0 flex-1 truncate ${selected ? "" : "text-xyne-fg-placeholder"}`}
        >
          {selected ? selected.name : placeholder}
        </span>
        <CaretDownIcon
          size={isSm ? 10 : 12}
          className={`shrink-0 text-xyne-fg-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          onMouseDown={stop}
          onClick={stop}
          className="absolute left-0 right-0 top-full z-30 mt-1.5 min-w-[220px] overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface p-1 text-xyne-fg-primary shadow-[0_8px_28px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]"
        >
          {options.length > 6 && (
            <div className="relative mb-1 px-1">
              <MagnifyingGlassIcon
                size={11}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onMouseDown={stop}
                placeholder="Filter…"
                className="h-7 w-full rounded-md border border-xyne-border bg-xyne-surface-subtle pl-7 pr-2 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-[12px] text-xyne-fg-muted">No matches.</div>
            ) : (
              filtered.map((o) => {
                const isSelected = o.slug === value;
                return (
                  <button
                    type="button"
                    key={o.slug}
                    onClick={(e) => {
                      stop(e);
                      onChange(o.slug);
                      setOpen(false);
                      setQuery("");
                    }}
                    onMouseDown={stop}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-xyne-fg-primary transition-colors ${
                      isSelected
                        ? "bg-xyne-surface-subtle font-medium"
                        : "hover:bg-xyne-surface-subtle"
                    }`}
                  >
                    <RobotIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />
                    <span className="min-w-0 flex-1 truncate">
                      {o.name || o.slug}
                    </span>
                    {o.name && o.name !== o.slug && (
                      <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">
                        {o.slug}
                      </span>
                    )}
                    {isSelected && (
                      <CheckIcon
                        size={11}
                        weight="bold"
                        className="shrink-0 text-xyne-success-fg"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Spaces entity picker for native trigger filters                     */
/* ------------------------------------------------------------------ */

type SpacesEntityKind = "boards" | "projects";

interface SpacesEntityOption {
  id: string;
  label: string;
  subtitle?: string | null;
}

interface SpacesEntityMultiSelectProps {
  kind: SpacesEntityKind;
  value: string[];
  onChange: (next: string[]) => void;
}

function SpacesEntityMultiSelect({ kind, value, onChange }: SpacesEntityMultiSelectProps) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<SpacesEntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const load =
        kind === "boards"
          ? listSpacesBoards(search, 50).then((rows: SpacesBoard[]) =>
              rows.map((row) => ({
                id: row.id,
                label: row.name || row.id,
                subtitle: row.projectName,
              })),
            )
          : listSpacesProjects(search, 50).then((rows: SpacesProject[]) =>
              rows.map((row) => ({
                id: row.id,
                label: row.name || row.id,
                subtitle: row.description,
              })),
            );

      load
        .then((nextOptions) => {
          if (!cancelled) setOptions(nextOptions);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : `Failed to load ${kind}`);
            setOptions([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, search]);

  const selectedOptions = value.map(
    (id) => options.find((option) => option.id === id) ?? { id, label: id },
  );

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((nextId) => nextId !== id) : [...value, id]);
  };

  const emptyLabel = kind === "boards" ? "No boards found." : "No projects found.";
  const placeholder = kind === "boards" ? "Search boards..." : "Search projects...";

  return (
    <div className="mt-1 rounded-lg border border-xyne-border bg-xyne-surface">
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-xyne-border px-2.5 py-2">
          {selectedOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              className="flex max-w-full items-center gap-1 rounded-md border border-xyne-border bg-xyne-surface-sunken px-2 py-1 text-[11px] text-xyne-fg-secondary hover:border-xyne-border-strong"
              title={option.id}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              <XIcon size={10} className="shrink-0 text-xyne-fg-tertiary" />
            </button>
          ))}
        </div>
      )}
      <div className="relative border-b border-xyne-border">
        <MagnifyingGlassIcon
          size={12}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-t-lg bg-transparent pl-8 pr-3 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none"
        />
      </div>
      <div className="max-h-44 overflow-y-auto p-1">
        {error ? (
          <div className="px-2 py-2 text-[12px] text-rose-400">{error}</div>
        ) : loading ? (
          <div className="px-2 py-2 text-[12px] text-xyne-fg-muted">Loading...</div>
        ) : options.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-xyne-fg-muted">{emptyLabel}</div>
        ) : (
          options.map((option) => {
            const checked = value.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggle(option.id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle"
                title={option.id}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked
                      ? "border-xyne-brand bg-xyne-brand text-white"
                      : "border-xyne-border bg-xyne-surface-sunken"
                  }`}
                >
                  {checked && <CheckIcon size={10} weight="bold" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.subtitle && (
                    <span className="block truncate text-[11px] text-xyne-fg-tertiary">
                      {option.subtitle}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom Node                                                         */
/* ------------------------------------------------------------------ */

function AgentNode({ id, data, selected }: NodeProps<Node<AgentNodeData>>) {
  return (
    <div
      className={`min-w-[220px] rounded-xl border bg-xyne-surface-subtle p-3 shadow-sm transition-colors ${
        selected ? "border-xyne-border-strong" : "border-xyne-border"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-xyne-border !bg-xyne-fg-muted"
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-xyne-fg-muted">
          Agent
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete(id);
          }}
          className="rounded p-0.5 text-xyne-fg-muted transition-colors hover:bg-xyne-error-bg hover:text-xyne-error-fg"
          title="Delete node"
        >
          <TrashIcon size={12} />
        </button>
      </div>
      <AgentPicker
        value={data.agentSlug}
        onChange={(slug) => data.onChange(id, { agentSlug: slug })}
        options={data.agentOptions}
        placeholder="Select agent…"
        size="sm"
        stopPropagation
        className="mb-2"
      />
      <input
        value={data.taskTemplate}
        onChange={(e) => data.onChange(id, { taskTemplate: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder="Task template (e.g. {{result}})"
        className="w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-xyne-border !bg-xyne-brand"
      />
    </div>
  );
}

const NODE_TYPES = { agent: AgentNode };

/* ------------------------------------------------------------------ */
/*  Custom Edge with Inline Popover                                     */
/* ------------------------------------------------------------------ */

type EdgeMode = ChainEdgeData["mode"];

/* Mode is a 3-way exclusive choice, so a segmented control beats a native
   <select>: every option is visible at once, it takes one click, and the
   active segment can carry the same semantic color as the edge badge
   (always = neutral · tools = info · judge = brand). */
const MODE_OPTIONS: ReadonlyArray<{ value: EdgeMode; label: string }> = [
  { value: "always", label: "Always" },
  { value: "tools", label: "Tools" },
  { value: "judge", label: "Judge" },
];

const MODE_ACTIVE: Record<EdgeMode, string> = {
  always: "bg-xyne-surface text-xyne-fg-primary",
  tools: "bg-xyne-info-bg text-xyne-info-fg",
  judge: "bg-xyne-brand/15 text-xyne-brand",
};

const MODE_HINT: Record<EdgeMode, string> = {
  always: "Always continue to the next agent.",
  tools: "Continue only when the upstream tool use matches the filters below.",
  judge: "An LLM decides whether to continue, based on the upstream result.",
};

function ChainConfigEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<Edge<ChainEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  if (!data) {
    return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />;
  }

  const { mode, isOpen } = data;
  const modeStyles =
    mode === "always"
      ? "bg-xyne-surface-sunken text-xyne-fg-secondary border border-xyne-border"
      : mode === "tools"
        ? "bg-xyne-info-bg text-xyne-info-fg border border-xyne-info-border"
        : "bg-xyne-brand/10 text-xyne-brand border border-xyne-brand/20";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: selected ? "#9ca3af" : "#6b7280", strokeWidth: selected ? 2.5 : 1.5 }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            zIndex: data.isOpen ? 1000 : 5,
          }}
          className="nodrag nopan"
        >
          {!isOpen ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                data.onToggle(id);
              }}
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide shadow-sm transition hover:scale-105 ${modeStyles}`}
              title="Click to configure"
            >
              {mode}
            </button>
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-72 rounded-xl border border-xyne-border bg-xyne-surface p-3 shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-xyne-fg-primary">Chain Config</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => data.onDelete(id)}
                    className="rounded p-1 text-xyne-fg-muted transition-colors hover:bg-xyne-error-bg hover:text-xyne-error-fg"
                    title="Delete edge"
                  >
                    <TrashIcon size={12} />
                  </button>
                  <button
                    onClick={() => data.onToggle(id)}
                    className="rounded px-1.5 text-[12px] text-xyne-fg-muted transition-colors hover:text-xyne-fg-primary"
                    title="Close"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              </div>

              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-xyne-fg-muted">
                Mode
              </label>
              <div
                role="radiogroup"
                aria-label="Chain mode"
                className="grid grid-cols-3 gap-0.5 rounded-lg border border-xyne-border bg-xyne-surface-sunken p-0.5"
              >
                {MODE_OPTIONS.map((opt) => {
                  const active = data.mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => data.onChange(id, { mode: opt.value })}
                      className={`rounded-[7px] px-2 py-1 text-[12px] font-medium outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-xyne-border-focus ${
                        active
                          ? `${MODE_ACTIVE[opt.value]} shadow-[0_1px_2px_rgba(0,0,0,0.2)]`
                          : "text-xyne-fg-tertiary hover:bg-xyne-surface hover:text-xyne-fg-secondary"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mb-2 mt-1 text-[10px] leading-snug text-xyne-fg-muted">
                {MODE_HINT[data.mode]}
              </p>

              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-xyne-fg-muted">
                Task template
              </label>
              <input
                value={data.taskTemplate}
                onChange={(e) => data.onChange(id, { taskTemplate: e.target.value })}
                placeholder="e.g. Investigate this finding: {{result}}"
                className="mb-1 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
              />
              <p className="mb-2 text-[10px] text-xyne-fg-muted">
                Vars:{" "}
                <code className="text-xyne-fg-tertiary">{"{{result}}"}</code>,{" "}
                <code className="text-xyne-fg-tertiary">{"{{agentSlug}}"}</code>,{" "}
                <code className="text-xyne-fg-tertiary">{"{{channelId}}"}</code>,{" "}
                <code className="text-xyne-fg-tertiary">{"{{rootAgentSlug}}"}</code>
              </p>

              {data.mode === "tools" && (
                <>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-xyne-fg-muted">
                    tools must include (csv)
                  </label>
                  <input
                    value={data.toolsMustInclude}
                    onChange={(e) => data.onChange(id, { toolsMustInclude: e.target.value })}
                    placeholder="e.g. spaces-search, victoria-metrics-query"
                    className="mb-2 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
                  />

                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-xyne-fg-muted">
                    tools must exclude (csv)
                  </label>
                  <input
                    value={data.toolsMustExclude}
                    onChange={(e) => data.onChange(id, { toolsMustExclude: e.target.value })}
                    placeholder="e.g. spaces-postMessage"
                    className="mb-2 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
                  />
                </>
              )}

              {data.mode === "judge" && (
                <>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-xyne-fg-muted">
                    Judge context
                  </label>
                  <textarea
                    value={data.judgeContext}
                    onChange={(e) => data.onChange(id, { judgeContext: e.target.value })}
                    rows={3}
                    placeholder="e.g. Continue only if the result mentions a P0 incident or a customer-facing outage. Stop if it's just informational."
                    className="w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus resize-y"
                  />
                  <p className="mt-1 text-[10px] text-xyne-fg-muted">
                    Hint passed to the chain-judge LLM. It returns continue/stop based on the upstream result + this context.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { chainConfig: ChainConfigEdge };

/* ------------------------------------------------------------------ */
/*  Inner Component                                                     */
/* ------------------------------------------------------------------ */

function ChainWorkflowModalInner({
  open,
  onOpenChange,
  agents,
  onSaved,
  editingWorkflow,
}: Props) {
  const agentOptions = useMemo<AgentOption[]>(
    () => agents.map((a) => ({ slug: a.slug, name: a.name || a.slug })),
    [agents],
  );
  const isEditing = !!editingWorkflow;

  const [name, setName] = useState("New Channel Workflow");
  const [isPublished, setIsPublished] = useState(true);
  // Owner consent: run triggered executions with the creator's own creds.
  const [useCreatorCredentials, setUseCreatorCredentials] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { show: showSnackbar } = useSnackbar();
  const [nodes, setNodes] = useState<Node<AgentNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<ChainEdgeData>[]>([]);

  // Channel binding — multi-select. `allChannels` binds across every channel
  // via the "*" sentinel; otherwise each selected channel becomes its own row.
  const [selectedChannels, setSelectedChannels] = useState<SpacesChannel[]>([]);
  const [allChannels, setAllChannels] = useState<boolean>(false);
  const [entryAgentSlug, setEntryAgentSlug] = useState<string>("");
  const [channelSearch, setChannelSearch] = useState<string>("");
  const [channelOptions, setChannelOptions] = useState<SpacesChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelListOpen, setChannelListOpen] = useState(false);
  const channelSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelComboRef = useRef<HTMLDivElement | null>(null);

  // ── Event triggers (optional) ──────────────────────────────────────
  // Each trigger fires the workflow on the channel(s) bound above, in
  // response to a Spaces automation event (e.g. a Bitbucket push).
  //
  // ENABLED: Spaces ships the automation CRUD endpoints (POST/PUT/DELETE
  // /api/automations) and claw-auth's bridge creates + submits each trigger
  // for admin approval (chain-workflows.ts createAndSubmitSpacesAutomation).
  // A created trigger is DRAFT→PENDING_APPROVAL and only fires once an
  // automations admin approves it — the save handler surfaces that to the user.
  const SPACES_AUTOMATIONS_ENABLED = true;
  const [triggerOptions, setTriggerOptions] = useState<SpacesTriggerSummary[]>([]);
  const [triggersLoading, setTriggersLoading] = useState(false);
  const [triggersError, setTriggersError] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<TriggerDraft[]>([]);
  const [schemaCache, setSchemaCache] = useState<Record<string, SpacesTriggerSchema>>({});
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);

  // Load available trigger types when the modal opens. GitHub/Bitbucket aren't
  // native Spaces triggers (and won't be added) — claw offers them as templates
  // that compile to a generic WEBHOOK automation server-side, so we prepend them
  // to whatever Spaces' catalog returns.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTriggersLoading(true);
    setTriggersError(null);
    listSpacesTriggers()
      .then((opts) => { if (!cancelled) setTriggerOptions([...VCS_TEMPLATE_TRIGGERS, ...opts]); })
      .catch(() => {
        // Even if the Spaces catalog fetch fails, the VCS templates still work
        // (they're claw-side) — surface them rather than blocking.
        if (!cancelled) {
          setTriggerOptions([...VCS_TEMPLATE_TRIGGERS]);
          setTriggersError("Could not load Spaces trigger catalog; webhook templates still available.");
        }
      })
      .finally(() => { if (!cancelled) setTriggersLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Lazily load + cache the config schema for each trigger type in use.
  useEffect(() => {
    const wanted = [...new Set(triggers.map((t) => t.type).filter(Boolean))];
    for (const type of wanted) {
      if (VCS_TEMPLATE_CONFIG_FIELDS[type]) continue;
      if (schemaCache[type]) continue;
      getSpacesTriggerSchema(type)
        .then((schema) => setSchemaCache((prev) => (prev[type] ? prev : { ...prev, [type]: schema })))
        .catch(() => { /* leave uncached — fields just won't render */ });
    }
  }, [triggers, schemaCache]);

  const addTrigger = useCallback(() => {
    setTriggers((prev) => [...prev, { id: crypto.randomUUID(), type: "", configValues: {} }]);
    setTriggerDialogOpen(true);
  }, []);
  const removeTrigger = useCallback((id: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const setTriggerType = useCallback((id: string, type: string) => {
    setTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, type, configValues: {} } : t)));
  }, []);
  const setTriggerConfig = useCallback((id: string, key: string, value: string) => {
    setTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, configValues: { ...t.configValues, [key]: value } } : t)));
  }, []);
  const setTriggerEventEnabled = useCallback((id: string, eventType: string, enabled: boolean) => {
    setTriggers((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const current = new Set(fromCsv(t.configValues["eventTypes"] ?? ""));
      if (enabled) current.add(eventType);
      else current.delete(eventType);
      return {
        ...t,
        configValues: { ...t.configValues, eventTypes: toCsv([...current]) },
      };
    }));
  }, []);
  const triggerOptionName = useCallback((type: string): string => {
    return triggerOptions.find((o) => o.type === type)?.name ?? type;
  }, [triggerOptions]);
  const triggerSummary = useMemo(() => {
    const configured = triggers.filter((t) => t.type);
    if (configured.length === 0) return "No event triggers";
    return configured.map((t) => {
      const events = fromCsv(t.configValues["eventTypes"] ?? "")
        .slice(0, 2)
        .map((v) => eventTypeLabel(t.type, v));
      const suffix = events.length > 0 ? `: ${events.join(", ")}${fromCsv(t.configValues["eventTypes"] ?? "").length > 2 ? "…" : ""}` : "";
      return `${triggerOptionName(t.type)}${suffix}`;
    }).join(" · ");
  }, [triggers, triggerOptionName]);

  // Close channel list on outside click
  useEffect(() => {
    if (!channelListOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!channelComboRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && !channelComboRef.current.contains(target)) {
        setChannelListOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [channelListOpen]);

  // Debounced channel search
  useEffect(() => {
    if (!open) return;
    if (channelSearchTimer.current) clearTimeout(channelSearchTimer.current);
    channelSearchTimer.current = setTimeout(() => {
      setChannelsLoading(true);
      listSpacesChannels(channelSearch, 50)
        .then(setChannelOptions)
        .catch((err) => {
          setMessage(err instanceof Error ? err.message : "Failed to load channels from Spaces");
        })
        .finally(() => setChannelsLoading(false));
    }, 300);
    return () => {
      if (channelSearchTimer.current) clearTimeout(channelSearchTimer.current);
    };
  }, [open, channelSearch]);

  const updateNodeFields = useCallback(
    (id: string, patch: Partial<{ agentSlug: string; taskTemplate: string }>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [],
  );

  const deleteNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const buildNode = useCallback(
    (slug: string, x: number, y: number): Node<AgentNodeData> => ({
      id: randomId(),
      type: "agent",
      position: { x, y },
      data: {
        agentSlug: slug,
        taskTemplate: "{{result}}",
        agentOptions,
        onChange: updateNodeFields,
        onDelete: deleteNode,
      },
    }),
    [agentOptions, updateNodeFields, deleteNode],
  );

  const onAddNode = useCallback(() => {
    const offset = nodes.length * 40;
    setNodes((prev) => [
      ...prev,
      buildNode("", 80 + offset, 80 + offset),
    ]);
  }, [buildNode, nodes.length]);

  // Auto-create entry agent node
  useEffect(() => {
    if (!open) return;
    if (!entryAgentSlug) return;
    setNodes((prev) => {
      if (prev.some((n) => n.data.agentSlug === entryAgentSlug)) return prev;
      return [...prev, buildNode(entryAgentSlug, 80, 80)];
    });
  }, [open, entryAgentSlug, buildNode]);

  // Edge callbacks
  const toggleEdgeOpen = useCallback((id: string) => {
    setEdges((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, data: { ...(e.data as ChainEdgeData), isOpen: !(e.data as ChainEdgeData).isOpen } }
          : { ...e, data: { ...(e.data as ChainEdgeData), isOpen: false } },
      ),
    );
  }, []);

  const updateEdge = useCallback((id: string, patch: Partial<EdgeData>) => {
    setEdges((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, data: { ...(e.data as ChainEdgeData), ...patch } } : e,
      ),
    );
  }, []);

  const deleteEdge = useCallback((id: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Hydrate from editingWorkflow
  useEffect(() => {
    if (!open) return;
    if (!editingWorkflow) return;

    setName(editingWorkflow.name);
    setIsPublished(editingWorkflow.isPublished);
    setUseCreatorCredentials(editingWorkflow.credentialUserId != null);

    const def = editingWorkflow.definition;
    const COLS = 3;
    const COL_W = 280;
    const ROW_H = 200;
    const hydratedNodes: Node<AgentNodeData>[] = (def.nodes ?? []).map((n, idx) => ({
      id: n.id,
      type: "agent",
      position: { x: 80 + (idx % COLS) * COL_W, y: 80 + Math.floor(idx / COLS) * ROW_H },
      data: {
        agentSlug: n.agentSlug,
        taskTemplate: n.taskTemplate ?? "{{result}}",
        agentOptions,
        onChange: updateNodeFields,
        onDelete: deleteNode,
      },
    }));
    setNodes(hydratedNodes);

    const hydratedEdges: Edge<ChainEdgeData>[] = (def.edges ?? []).map((e) => ({
      id: e.id,
      source: e.fromNodeId,
      target: e.toNodeId,
      type: "chainConfig",
      animated: true,
      data: {
        mode: e.mode ?? "always",
        toolsMustInclude: (e.toolsMustInclude ?? []).join(", "),
        toolsMustExclude: (e.toolsMustExclude ?? []).join(", "),
        judgeContext: e.judgeContext ?? "",
        taskTemplate: e.taskTemplate ?? "{{result}}",
        isOpen: false,
        onToggle: toggleEdgeOpen,
        onChange: updateEdge,
        onDelete: deleteEdge,
      },
    }));
    setEdges(hydratedEdges);

    const bindings = editingWorkflow.bindings ?? [];
    if (bindings.length > 0) {
      const primaryBinding = bindings.find((b) => b.userId !== "*") ?? bindings[0]!;
      setEntryAgentSlug(primaryBinding.entryAgentSlug);
      setAllChannels(bindings.some((b) => b.channelId === "*"));
      const uniqueChannelIds = [
        ...new Set(bindings.filter((b) => b.channelId !== "*").map((b) => b.channelId)),
      ];
      setSelectedChannels(
        uniqueChannelIds
          .map((channelId) => ({
            id: channelId,
            name: channelId,
            scopeType: "default",
            visibility: "",
            participantCount: 0,
            lastActivityAt: null,
            projectName: null,
          })),
      );
    }

    // Hydrate existing event triggers (carry their dbId so the backend updates
    // rather than recreates). Channels aren't restored here — triggers reuse
    // the workflow's channel binding above.
    setTriggers(
      (editingWorkflow.triggers ?? []).map((t) => ({
        id: t.id,
        dbId: t.id,
        type: t.type,
        configValues: t.configValues ?? {},
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingWorkflow]);

  if (!open) return null;

  const onNodesChange = (changes: NodeChange<Node<AgentNodeData>>[]) =>
    setNodes((prev) => applyNodeChanges(changes, prev));

  const onEdgesChange = (changes: EdgeChange<Edge<ChainEdgeData>>[]) =>
    setEdges((prev) => applyEdgeChanges(changes, prev));

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    const newId = randomId();
    setEdges((prev) =>
      addEdge<Edge<ChainEdgeData>>(
        {
          ...connection,
          id: newId,
          type: "chainConfig",
          animated: true,
          data: {
            mode: "always",
            toolsMustInclude: "",
            toolsMustExclude: "",
            judgeContext: "",
            taskTemplate: "{{result}}",
            isOpen: true,
            onToggle: toggleEdgeOpen,
            onChange: updateEdge,
            onDelete: deleteEdge,
          },
        },
        prev.map((e) => ({
          ...e,
          data: { ...(e.data as ChainEdgeData), isOpen: false },
        })),
      ),
    );
  };

  const reset = () => {
    setName("New Channel Workflow");
    setIsPublished(true);
    setUseCreatorCredentials(false);
    setNodes([]);
    setEdges([]);
    setMessage(null);
    setSelectedChannels([]);
    setAllChannels(false);
    setChannelListOpen(false);
    setTriggers([]);
    setEntryAgentSlug("");
    setChannelSearch("");
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setMessage("Workflow name is required");
      return;
    }

    const apiNodes: ApiNode[] = nodes
      .filter((n) => n.data.agentSlug.trim().length > 0)
      .map((n) => ({
        id: n.id,
        agentSlug: n.data.agentSlug.trim(),
        taskTemplate: n.data.taskTemplate.trim() || "{{result}}",
      }));

    if (apiNodes.length === 0) {
      setMessage("Add at least one node with an agent selected.");
      return;
    }

    const channelIds = allChannels ? ["*"] : selectedChannels.map((c) => c.id);
    if (channelIds.length === 0) {
      setMessage("Pick at least one channel, or choose All channels.");
      return;
    }
    if (!entryAgentSlug) {
      setMessage("Pick an entry agent for the channel binding.");
      return;
    }

    if (!apiNodes.some((n) => n.agentSlug === entryAgentSlug)) {
      setMessage(`Entry agent "${entryAgentSlug}" must appear as a node in the workflow.`);
      return;
    }

    const orderedApiNodes = [
      ...apiNodes.filter((n) => n.agentSlug === entryAgentSlug),
      ...apiNodes.filter((n) => n.agentSlug !== entryAgentSlug),
    ];

    const validIds = new Set(orderedApiNodes.map((n) => n.id));
    const apiEdges: ApiEdge[] = edges
      .filter((e) => e.source && e.target && validIds.has(e.source) && validIds.has(e.target))
      .map((e) => {
        const d = (e.data ?? {}) as EdgeData;
        return {
          id: e.id,
          fromNodeId: e.source,
          toNodeId: e.target,
          mode: d.mode ?? "always",
          ...(fromCsv(d.toolsMustInclude ?? "").length > 0
            ? { toolsMustInclude: fromCsv(d.toolsMustInclude ?? "") }
            : {}),
          ...(fromCsv(d.toolsMustExclude ?? "").length > 0
            ? { toolsMustExclude: fromCsv(d.toolsMustExclude ?? "") }
            : {}),
          ...(d.judgeContext?.trim() ? { judgeContext: d.judgeContext.trim() } : {}),
          ...(d.taskTemplate?.trim() ? { taskTemplate: d.taskTemplate.trim() } : {}),
        };
      });

    const definition: ChainWorkflowDefinition = {
      version: 1,
      nodes: orderedApiNodes,
      edges: apiEdges,
    };

    // Event triggers (optional). They reuse the workflow's channel binding —
    // each enabled trigger fires the workflow on the same channel(s) picked
    // above. configValues carries the trigger-type's schema fields as strings
    // (the backend splits comma-separated array fields like eventTypes).
    const triggersPayload = triggers
      .filter((t) => t.type.trim())
      .map((t) => ({
        ...(t.dbId ? { id: t.dbId } : {}),
        type: t.type,
        channelIds,
        configValues: t.configValues,
      }));

    setSaving(true);
    setMessage(null);
    try {
      const saved =
        isEditing && editingWorkflow
          ? await updateChainWorkflow(editingWorkflow.id, {
              name: name.trim(),
              definition,
              isPublished,
              triggers: triggersPayload,
              useCreatorCredentials,
            })
          : await createChainWorkflow({
              name: name.trim(),
              definition,
              isPublished,
              ...(triggersPayload.length > 0 ? { triggers: triggersPayload } : {}),
              useCreatorCredentials,
            });

      await upsertChannelChainBinding({
        channelIds,
        entryAgentSlug,
        workflowId: saved.id,
        enabled: true,
      });

      // Edit mode: drop bindings for channels the user unselected.
      if (isEditing && editingWorkflow) {
        const keep = new Set(channelIds);
        await Promise.all(
          (editingWorkflow.bindings ?? [])
            .filter((b) => !keep.has(b.channelId))
            .map((b) => deleteChannelChainBinding(b.id)),
        );
      }

      // Event triggers are created as DRAFT and submitted for admin approval
      // (claw-auth bridge → Spaces). They only start firing once an automations
      // admin approves. Webhook-backed (GitHub/Bitbucket) triggers also return a
      // URL to paste into the repo — surface it in a copyable dialog since the
      // user must act on it, plus the approval note.
      const webhookUrls = (saved.triggers ?? [])
        .flatMap((t) => t.channels.map((c) => c.webhookUrl))
        .filter((u): u is string => Boolean(u));
      if (webhookUrls.length > 0) {
        window.alert(
          "Trigger submitted for approval — an automations admin will review it. You can ask in the #xyne-spaces channel.\n\n" +
            "Paste this webhook URL into your GitHub/Bitbucket repo's webhook settings:\n\n" +
            webhookUrls.join("\n"),
        );
      } else if (triggersPayload.length > 0) {
        showSnackbar({
          variant: "info",
          title: "Trigger submitted for approval",
          description: "An automations admin will review it — you can ask in the #xyne-spaces channel.",
          duration: 8000,
        });
      }

      onSaved();
      close();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : `Failed to ${isEditing ? "update" : "create"} workflow`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div
      data-id="chain-workflow-modal"
      className="fixed inset-0 z-[var(--comp-z-modal)] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="my-auto flex h-[85vh] max-h-[820px] w-full max-w-7xl flex-col rounded-xl border border-xyne-border bg-xyne-surface shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-xyne-border px-5 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-xyne-fg-primary">
              {isEditing ? "Edit Workflow" : "Create Workflow"}
            </h2>
            <p className="text-[12px] text-xyne-fg-muted">
              Drag a node's orange handle onto another node to link them · Click an edge to configure
            </p>
          </div>
          <button
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-full text-xyne-fg-muted transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            title="Close"
          >
            <XIcon size={14} weight="bold" />
          </button>
        </div>

        {/* Form: identity + bindings on a single row */}
        <div className="grid grid-cols-1 gap-3 border-b border-xyne-border px-5 py-3 md:grid-cols-[1fr_1.4fr_minmax(220px,_260px)]">
          {/* Name */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled workflow"
              className="h-10 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none transition-colors focus:border-xyne-border-focus"
            />
          </div>

          {/* Channel binding — multi-select + All channels */}
          <div className="relative" ref={channelComboRef}>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
                Bind to Spaces channel(s) <span className="normal-case text-xyne-fg-muted">(required)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-xyne-fg-muted">
                <input
                  type="checkbox"
                  checked={allChannels}
                  onChange={(e) => {
                    setAllChannels(e.target.checked);
                    setChannelListOpen(false);
                  }}
                  className="h-3.5 w-3.5 accent-xyne-brand"
                />
                All channels
              </label>
            </div>

            {allChannels ? (
              <div className="flex h-10 items-center gap-2 rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 text-[13px] text-xyne-fg-muted">
                <HashIcon size={13} className="shrink-0 text-xyne-fg-tertiary" />
                Applies to <span className="font-medium text-xyne-fg-primary">all channels</span>
              </div>
            ) : (
              <>
                {selectedChannels.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {selectedChannels.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-full bg-xyne-surface-sunken px-2 py-0.5 text-[12px] text-xyne-fg-primary"
                      >
                        <HashIcon size={11} className="shrink-0 text-xyne-fg-tertiary" />
                        <span className="max-w-[140px] truncate">{c.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedChannels((prev) => prev.filter((x) => x.id !== c.id))
                          }
                          className="flex h-4 w-4 items-center justify-center rounded text-xyne-fg-muted transition-colors hover:bg-xyne-surface hover:text-xyne-fg-primary"
                          title="Remove channel"
                        >
                          <XIcon size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <HashIcon
                    size={13}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
                  />
                  <input
                    value={channelSearch}
                    onChange={(e) => {
                      setChannelSearch(e.target.value);
                      setChannelListOpen(true);
                    }}
                    onFocus={() => setChannelListOpen(true)}
                    placeholder={channelsLoading ? "Loading channels…" : "Search channels to add…"}
                    className="h-10 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken pl-8 pr-9 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none transition-colors hover:border-xyne-border-strong focus:border-xyne-border-focus"
                  />
                  <CaretDownIcon
                    size={12}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
                  />
                </div>

                {channelListOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-72 overflow-auto rounded-xl border border-xyne-border bg-xyne-surface p-1 shadow-[0_8px_28px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]">
                    {channelsLoading && channelOptions.length === 0 ? (
                      <div className="px-3 py-2.5 text-[12px] text-xyne-fg-muted">Loading channels…</div>
                    ) : channelOptions.length === 0 ? (
                      <div className="px-3 py-2.5 text-[12px] text-xyne-fg-muted">No channels match.</div>
                    ) : (
                      channelOptions.map((c) => {
                        const picked = selectedChannels.some((x) => x.id === c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setSelectedChannels((prev) =>
                                prev.some((x) => x.id === c.id)
                                  ? prev.filter((x) => x.id !== c.id)
                                  : [...prev, c],
                              )
                            }
                            className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] text-xyne-fg-primary transition-colors hover:bg-xyne-surface-subtle"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <HashIcon
                                size={12}
                                className={`shrink-0 ${picked ? "text-xyne-brand" : "text-xyne-fg-tertiary"}`}
                              />
                              <span className="truncate">
                                <span className="font-medium">{c.name}</span>
                                {c.projectName ? <span className="text-xyne-fg-muted"> · {c.projectName}</span> : null}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-full bg-xyne-surface-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-xyne-fg-tertiary">
                              {picked ? "added" : c.scopeType.toLowerCase()}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Entry agent picker */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
              Entry agent <span className="normal-case text-xyne-fg-muted">(required)</span>
            </label>
            <AgentPicker
              value={entryAgentSlug}
              onChange={setEntryAgentSlug}
              options={agentOptions}
              placeholder="Pick an agent…"
            />
          </div>
        </div>

        {/* Event triggers — HIDDEN while Spaces automations are undeployed
            (creating one 404s on POST /api/automations). Gated by
            SPACES_AUTOMATIONS_ENABLED above. */}
        {SPACES_AUTOMATIONS_ENABLED && (
        <div className="shrink-0 border-b border-xyne-border px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
              Event triggers{" "}
              <span className="normal-case text-xyne-fg-muted">(optional — also fire on Spaces events)</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (triggers.length === 0) addTrigger();
                else setTriggerDialogOpen(true);
              }}
              disabled={triggersLoading || triggerOptions.length === 0}
              className="inline-flex items-center gap-1 rounded-full border border-xyne-border px-2.5 py-1 text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary disabled:opacity-50"
            >
              <PlusIcon size={11} /> {triggers.length === 0 ? "Add trigger" : "Configure"}
            </button>
          </div>
          {triggersError && <p className="text-[11px] text-rose-400">{triggersError}</p>}
          <button
            type="button"
            onClick={() => setTriggerDialogOpen(true)}
            className="flex w-full items-center justify-between rounded-lg border border-xyne-border bg-xyne-surface-subtle/40 px-3 py-2 text-left hover:border-xyne-border-focus"
          >
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-medium text-xyne-fg-primary">{triggerSummary}</span>
              <span className="mt-0.5 block truncate text-[11px] text-xyne-fg-muted">
                {triggers.length === 0
                  ? "Workflow still runs on @mention in the bound channel(s)."
                  : "Edit provider, events, repository filters, and native trigger fields."}
              </span>
            </span>
            <span className="ml-3 shrink-0 text-[11px] font-medium text-xyne-fg-secondary">Configure</span>
          </button>
        </div>
        )}

        {/* Toolbar: status toggle + canvas actions */}
        <div className="flex items-center justify-between border-b border-xyne-border bg-xyne-surface-subtle/40 px-5 py-2">
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPublished(!isPublished)}
            aria-pressed={isPublished}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              isPublished
                ? "border-xyne-success-border bg-xyne-success-bg text-xyne-success-fg"
                : "border-xyne-border bg-xyne-surface text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
            }`}
            title={
              isPublished
                ? "Active — this workflow runs when messages arrive in the bound channel. Click to switch to Draft."
                : "Draft — workflow is saved but won't respond to channel messages. Click to activate."
            }
          >
            <span
              className={`flex h-1.5 w-1.5 rounded-full ${
                isPublished ? "bg-xyne-success-fg animate-pulse" : "bg-xyne-fg-muted"
              }`}
            />
            {isPublished ? "Active" : "Draft"}
          </button>

          <button
            type="button"
            onClick={() => setUseCreatorCredentials((v) => !v)}
            aria-pressed={useCreatorCredentials}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              useCreatorCredentials
                ? "border-xyne-info-border bg-xyne-info-bg text-xyne-info-fg"
                : "border-xyne-border bg-xyne-surface text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
            }`}
            title={
              useCreatorCredentials
                ? "Triggered runs use YOUR connected credentials (MCP/tools) for this workflow. Only you (the owner) can change this. Click to switch back to the agent's identity."
                : "Triggered runs use the agent's app identity. Click to run them with YOUR credentials instead (consent to lend your creds)."
            }
          >
            <span
              className={`flex h-1.5 w-1.5 rounded-full ${
                useCreatorCredentials ? "bg-xyne-info-fg" : "bg-xyne-fg-muted"
              }`}
            />
            {useCreatorCredentials ? "My credentials" : "Agent credentials"}
          </button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<PlusIcon size={12} />}
            onClick={onAddNode}
            className="shrink-0"
          >
            Add Agent Node
          </Button>
        </div>

        {/* Canvas */}
        <div className="flex min-h-0 flex-1">
          <div className="chain-flow-bubbles relative flex-1 bg-xyne-surface-subtle">
            {/* Override ReactFlow's stacked-rectangle Controls to look like separate bubbles */}
            <style>{`
              .chain-flow-bubbles .react-flow__controls {
                display: flex !important;
                flex-direction: column;
                gap: 8px;
                background: transparent !important;
                border: 0 !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                overflow: visible !important;
              }
              .chain-flow-bubbles .react-flow__controls-button {
                width: 36px !important;
                height: 36px !important;
                padding: 0 !important;
                border: 1px solid var(--color-xyne-border) !important;
                border-radius: 9999px !important;
                background: var(--color-xyne-surface) !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12) !important;
                transition: background-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
              }
              .chain-flow-bubbles .react-flow__controls-button:hover {
                background: var(--color-xyne-surface-subtle) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18) !important;
                transform: translateY(-1px);
              }
              .chain-flow-bubbles .react-flow__controls-button svg {
                fill: var(--color-xyne-fg-secondary) !important;
                max-width: 14px;
                max-height: 14px;
              }
            `}</style>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeClick={(_, edge) => toggleEdgeOpen(edge.id)}
              onPaneClick={() => {
                setEdges((prev) =>
                  prev.map((e) => ({
                    ...e,
                    data: { ...(e.data as ChainEdgeData), isOpen: false },
                  })),
                );
              }}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              fitView={nodes.length > 0}
              colorMode="dark"
              defaultEdgeOptions={{ animated: true }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} color="#374151" />
              <Controls />
              <MiniMap
                pannable
                zoomable
                maskColor="rgba(0,0,0,0.6)"
                className="!rounded-lg !border !border-xyne-border !bg-xyne-surface"
              />
            </ReactFlow>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="text-center text-[13px] text-xyne-fg-muted">
                  Click <span className="text-xyne-fg-secondary">+ Add Agent Node</span> to start.
                  <br />
                  Drag the orange handle on a node onto another node to connect them.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-xyne-border px-5 py-3">
          <div className="text-[12px] text-xyne-fg-muted">
            {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge
            {edges.length === 1 ? "" : "s"}
            {message && <span className="ml-3 text-xyne-fg-primary">{message}</span>}
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const Icon = isEditing ? FloppyDiskIcon : ArrowRightIcon;
              const label = saving
                ? isEditing ? "Saving…" : "Creating…"
                : isEditing ? "Save" : "Create";
              const tooltip = isEditing ? "Save workflow" : "Create workflow";
              return (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  title={tooltip}
                  aria-label={tooltip}
                  className="group inline-flex h-10 items-center rounded-full bg-xyne-fg-primary px-2.5 text-xyne-fg-inverse shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-all duration-200 hover:px-4 hover:shadow-[0_4px_14px_rgba(0,0,0,0.18)] disabled:opacity-50"
                >
                  <span className="flex h-5 w-5 items-center justify-center">
                    <Icon size={14} weight="bold" />
                  </span>
                  <span className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-200 group-hover:grid-cols-[1fr]">
                    <span className="min-w-0 overflow-hidden whitespace-nowrap pl-2 text-[13px] font-medium">
                      {label}
                    </span>
                  </span>
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
    {SPACES_AUTOMATIONS_ENABLED && (
      <Dialog
        open={triggerDialogOpen}
        onOpenChange={setTriggerDialogOpen}
        title="Configure Event Triggers"
        description="Choose external events that should also start this workflow."
        maxWidth={780}
        maxHeight="82vh"
        footer={
          <Button variant="primary" size="sm" onClick={() => setTriggerDialogOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-xyne-fg-primary">{triggerSummary}</p>
              <p className="mt-0.5 text-[11px] text-xyne-fg-muted">
                GitHub and Bitbucket triggers create a generated webhook URL after save.
              </p>
            </div>
            <button
              type="button"
              onClick={addTrigger}
              disabled={triggersLoading || triggerOptions.length === 0}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-xyne-border px-3 py-1.5 text-[12px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary disabled:opacity-50"
            >
              <PlusIcon size={12} /> Add trigger
            </button>
          </div>

          {triggersError && <p className="text-[12px] text-rose-400">{triggersError}</p>}

          {triggers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-xyne-border bg-xyne-surface-subtle/30 px-4 py-6 text-center">
              <p className="text-[13px] text-xyne-fg-secondary">No event triggers configured.</p>
              <p className="mt-1 text-[12px] text-xyne-fg-muted">
                The workflow will still run on @mention in the bound channel(s).
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {triggers.map((t) => {
                const { props, required } = triggerSchemaFields(schemaCache[t.type], t.type);
                const configKeys = Object.keys(props).filter((k) => k !== "channelIds");
                const vcsEvents = VCS_EVENT_OPTIONS[t.type] ?? [];
                const selectedEvents = new Set(fromCsv(t.configValues["eventTypes"] ?? ""));
                const isVcs = vcsEvents.length > 0;

                return (
                  <div key={t.id} className="rounded-lg border border-xyne-border bg-xyne-surface-subtle/40 p-3">
                    <div className="flex items-center gap-2">
                      <label className="min-w-0 flex-1">
                        <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
                          Provider
                        </span>
                        <select
                          value={t.type}
                          onChange={(e) => setTriggerType(t.id, e.target.value)}
                          className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-2 text-[13px] text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
                        >
                          <option value="">Select event type…</option>
                          {triggerOptions.map((o) => (
                            <option key={o.type} value={o.type}>{o.name}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeTrigger(t.id)}
                        title="Remove trigger"
                        className="mt-5 rounded p-2 text-xyne-fg-tertiary hover:text-rose-400"
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>

                    {isVcs && (
                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
                        <div>
                          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
                            Events
                          </span>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {vcsEvents.map((event) => (
                              <label
                                key={event.value}
                                className="flex min-h-9 items-center gap-2 rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[12px] text-xyne-fg-secondary"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedEvents.has(event.value)}
                                  onChange={(e) => setTriggerEventEnabled(t.id, event.value, e.target.checked)}
                                  className="h-3.5 w-3.5 accent-xyne-accent"
                                />
                                <span>{event.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <label className="block">
                          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
                            Repository filter
                          </span>
                          <input
                            type="text"
                            value={t.configValues["repoName"] ?? ""}
                            onChange={(e) => setTriggerConfig(t.id, "repoName", e.target.value)}
                            placeholder={t.type === "GITHUB_EVENT" ? "owner/repository" : "repository slug or full name"}
                            className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
                          />
                          <p className="mt-1 text-[11px] text-xyne-fg-muted">
                            Leave blank to accept events from any repository using this webhook URL.
                          </p>
                        </label>
                      </div>
                    )}

                    {!isVcs && t.type && configKeys.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {configKeys.map((key) => {
                          const p = props[key]!;
                          const isRequired = required.includes(key);
                          const label = triggerFieldLabel(key, isRequired);
                          if (key === "boardIds" || key === "projectIds") {
                            const kind = key === "boardIds" ? "boards" : "projects";
                            return (
                              <label key={key} className="block text-[11px] text-xyne-fg-tertiary">
                                {label}
                                <SpacesEntityMultiSelect
                                  kind={kind}
                                  value={fromCsv(t.configValues[key] ?? "")}
                                  onChange={(next) => setTriggerConfig(t.id, key, toCsv(next))}
                                />
                                <span className="mt-1 block text-[11px] text-xyne-fg-muted">
                                  Empty matches all {kind}.
                                </span>
                              </label>
                            );
                          }
                          if (p.enum && p.enum.length > 0) {
                            return (
                              <label key={key} className="block text-[11px] text-xyne-fg-tertiary">
                                {label}
                                <select
                                  value={t.configValues[key] ?? ""}
                                  onChange={(e) => setTriggerConfig(t.id, key, e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-2 text-[13px] text-xyne-fg-primary outline-none focus:border-xyne-border-focus"
                                >
                                  <option value="">—</option>
                                  {p.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </label>
                            );
                          }
                          const isArray = p.type === "array";
                          return (
                            <label key={key} className="block text-[11px] text-xyne-fg-tertiary">
                              {label}{isArray ? " (comma-separated)" : ""}
                              <input
                                type="text"
                                value={t.configValues[key] ?? ""}
                                onChange={(e) => setTriggerConfig(t.id, key, e.target.value)}
                                placeholder={p.description ?? (isArray && p.items?.enum ? p.items.enum.join(", ") : "")}
                                className="mt-1 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {t.type && (
                      <label className="mt-3 block">
                        <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.04em] text-xyne-fg-tertiary">
                          Context for the agent (optional)
                        </span>
                        <textarea
                          value={t.configValues["context"] ?? ""}
                          onChange={(e) => setTriggerConfig(t.id, "context", e.target.value)}
                          rows={4}
                          placeholder={
                            t.type === "MESSAGE_RECEIVED"
                              ? 'e.g. A new message was posted:\n"{{trigger.message.content}}"\nFrom {{trigger.author.name}}. Summarize it and file a bug if needed.'
                              : "What the agent should do. Use {{trigger.…}} to inject fields from the event."
                          }
                          className="w-full rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:border-xyne-border-focus"
                        />
                        <p className="mt-1 text-[11px] text-xyne-fg-muted">
                          Becomes the agent&apos;s prompt. Click a field below to insert its{" "}
                          <code className="rounded bg-xyne-surface px-1 text-xyne-fg-secondary">{"{{trigger.…}}"}</code>{" "}
                          reference. Leave blank to use the default.
                        </p>
                        {(() => {
                          const refs = triggerOutputRefs(schemaCache[t.type]);
                          if (refs.length === 0) return null;
                          return (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-xyne-fg-tertiary">Available fields:</span>
                              {refs.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() =>
                                    setTriggerConfig(
                                      t.id,
                                      "context",
                                      `${t.configValues["context"] ?? ""}{{trigger.${r}}}`,
                                    )
                                  }
                                  title={`Insert {{trigger.${r}}}`}
                                  className="rounded border border-xyne-border bg-xyne-surface px-1.5 py-0.5 font-mono text-[10.5px] text-xyne-fg-secondary hover:border-xyne-border-focus hover:text-xyne-fg-primary"
                                >
                                  {`{{trigger.${r}}}`}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Dialog>
    )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported Wrapper                                                    */
/* ------------------------------------------------------------------ */

export function ChainWorkflowModal(props: Props) {
  return (
    <ReactFlowProvider>
      <ChainWorkflowModalInner {...props} />
    </ReactFlowProvider>
  );
}
