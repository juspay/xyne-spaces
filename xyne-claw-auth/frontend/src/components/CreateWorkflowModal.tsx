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
import { Check, Plus, Save, Search, Trash2, X } from "lucide-react";
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
} from "../lib/api";
import type { Agent } from "../lib/types";

/** Claw-defined VCS trigger templates (compiled to a generic WEBHOOK automation
 *  + RUN_AGENT server-side). Surfaced alongside Spaces' native trigger catalog. */
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

/** Draft event trigger. `dbId` set when editing an existing trigger.
 *  Channels are not stored here — triggers reuse the workflow's binding. */
interface TriggerDraft {
  id: string;
  dbId?: string;
  type: string;
  configValues: Record<string, string>;
}

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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Agent[];
  onCreated: () => void;
  editingWorkflow?: ChainWorkflow | null;
}

interface AgentNodeData extends Record<string, unknown> {
  agentSlug: string;
  taskTemplate: string;
  agentOptions: string[];
  onChange: (id: string, patch: Partial<{ agentSlug: string; taskTemplate: string }>) => void;
  onDelete: (id: string) => void;
}

// EdgeData = persisted edge config (what gets serialized on save).
// ChainEdgeData (defined below) extends this with the inline-popover state +
// callbacks the custom edge component needs at render time.
interface EdgeData extends Record<string, unknown> {
  mode: "always" | "tools" | "judge";
  toolsMustInclude: string;
  toolsMustExclude: string;
  judgeContext: string;
  taskTemplate: string;
}

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
    <div className="mt-1 rounded-md border border-zinc-700 bg-zinc-900">
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-zinc-800 px-2.5 py-2">
          {selectedOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              className="flex max-w-full items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
              title={option.id}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              <X size={11} className="shrink-0 text-zinc-500" />
            </button>
          ))}
        </div>
      )}
      <div className="relative border-b border-zinc-800">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-t-md bg-transparent pl-8 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none"
        />
      </div>
      <div className="max-h-44 overflow-y-auto p-1">
        {error ? (
          <div className="px-2 py-2 text-xs text-rose-400">{error}</div>
        ) : loading ? (
          <div className="px-2 py-2 text-xs text-zinc-500">Loading...</div>
        ) : options.length === 0 ? (
          <div className="px-2 py-2 text-xs text-zinc-500">{emptyLabel}</div>
        ) : (
          options.map((option) => {
            const checked = value.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggle(option.id)}
                className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                title={option.id}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? "border-zinc-200 bg-zinc-100 text-zinc-900" : "border-zinc-700 bg-zinc-950"
                  }`}
                >
                  {checked && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.subtitle && <span className="block truncate text-[11px] text-zinc-500">{option.subtitle}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// Custom node — single card with agent picker, task-template input, drag handles.
function AgentNode({ id, data, selected }: NodeProps<Node<AgentNodeData>>) {
  return (
    <div
      className={`min-w-[220px] rounded-lg border bg-zinc-900 p-3 shadow-sm transition ${
        selected ? "border-zinc-300" : "border-zinc-700"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-zinc-700 !bg-zinc-500"
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Agent
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete(id);
          }}
          className="rounded p-0.5 text-zinc-500 transition hover:bg-red-950 hover:text-red-400"
          title="Delete node"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <select
        value={data.agentSlug}
        onChange={(e) => data.onChange(id, { agentSlug: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="mb-2 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
      >
        <option value="">Select agent…</option>
        {data.agentOptions.map((slug) => (
          <option key={slug} value={slug}>
            {slug}
          </option>
        ))}
      </select>
      <input
        value={data.taskTemplate}
        onChange={(e) => data.onChange(id, { taskTemplate: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder="Task template (e.g. {{result}})"
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-zinc-700 !bg-blue-400"
      />
    </div>
  );
}

const NODE_TYPES = { agent: AgentNode };

// Custom edge that renders the bezier path PLUS a clickable mode-badge at
// the edge midpoint. Clicking the badge opens a Chain Config popover anchored
// to the edge so configuration happens on-canvas instead of in a side panel.
// The popover lives in EdgeLabelRenderer (React Flow's overlay layer) so it
// stays positioned over the edge through pan/zoom.
interface ChainEdgeData extends EdgeData {
  isOpen: boolean;
  onToggle: (id: string) => void;
  onChange: (id: string, patch: Partial<EdgeData>) => void;
  onDelete: (id: string) => void;
}

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
  const modeColor =
    mode === "always" ? "bg-zinc-700 text-zinc-200"
    : mode === "tools" ? "bg-blue-900 text-blue-200"
    : "bg-purple-900 text-purple-200";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: selected ? "#a1a1aa" : "#52525b", strokeWidth: selected ? 2 : 1.5 }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            // React Flow puts nodes on a higher layer than edge labels, so an
            // inline popover ends up visually behind the downstream node when
            // the graph is dense. Force it above with a high z-index.
            zIndex: data.isOpen ? 1000 : 5,
          }}
          className="nodrag nopan"
        >
          {!isOpen ? (
            <button
              onClick={(e) => { e.stopPropagation(); data.onToggle(id); }}
              className={`rounded-full ${modeColor} border border-zinc-700 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide shadow-sm transition hover:scale-105`}
              title="Click to configure"
            >
              {mode}
            </button>
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-72 rounded-lg border border-zinc-600 bg-zinc-950 p-3 shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">Chain Config</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => data.onDelete(id)}
                    className="rounded p-1 text-zinc-500 hover:bg-red-950 hover:text-red-400"
                    title="Delete edge"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    onClick={() => data.onToggle(id)}
                    className="rounded px-1.5 text-xs text-zinc-500 hover:text-zinc-200"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">Mode</label>
              <select
                value={data.mode}
                onChange={(e) => data.onChange(id, { mode: e.target.value as ChainEdgeData["mode"] })}
                className="mb-2 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
              >
                <option value="always">always</option>
                <option value="tools">tools</option>
                <option value="judge">judge</option>
              </select>

              <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">Task template</label>
              <input
                value={data.taskTemplate}
                onChange={(e) => data.onChange(id, { taskTemplate: e.target.value })}
                placeholder="e.g. Investigate this finding: {{result}}"
                className="mb-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
              />
              <p className="mb-2 text-[10px] text-zinc-500">
                Vars: <code className="text-zinc-400">{"{{result}}"}</code>, <code className="text-zinc-400">{"{{agentSlug}}"}</code>, <code className="text-zinc-400">{"{{channelId}}"}</code>, <code className="text-zinc-400">{"{{rootAgentSlug}}"}</code>
              </p>

              {data.mode === "tools" && (
                <>
                  <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">tools must include (csv)</label>
                  <input
                    value={data.toolsMustInclude}
                    onChange={(e) => data.onChange(id, { toolsMustInclude: e.target.value })}
                    placeholder="e.g. spaces-search, victoria-metrics-query"
                    className="mb-2 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
                  />

                  <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">tools must exclude (csv)</label>
                  <input
                    value={data.toolsMustExclude}
                    onChange={(e) => data.onChange(id, { toolsMustExclude: e.target.value })}
                    placeholder="e.g. spaces-postMessage"
                    className="mb-2 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
                  />
                </>
              )}

              {data.mode === "judge" && (
                <>
                  <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">Judge context</label>
                  <textarea
                    value={data.judgeContext}
                    onChange={(e) => data.onChange(id, { judgeContext: e.target.value })}
                    rows={3}
                    placeholder={"e.g. Continue only if the result mentions a P0 incident or a customer-facing outage. Stop if it's just informational."}
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
                  />
                  <p className="mt-1 text-[10px] text-zinc-500">
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

function CreateWorkflowModalInner({ open, onOpenChange, agents, onCreated, editingWorkflow }: Props) {
  const agentOptions = useMemo(() => agents.map((a) => a.slug), [agents]);
  const isEditing = !!editingWorkflow;

  const [name, setName] = useState("New Channel Workflow");
  const [isPublished, setIsPublished] = useState(true);
  // Owner consent: run triggered executions with the creator's own creds.
  const [useCreatorCredentials, setUseCreatorCredentials] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node<AgentNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<ChainEdgeData>[]>([]);

  // Channel binding (optional). When channelId is set, on save we ALSO upsert
  // the channel→workflow binding so the workflow becomes live for that
  // channel. Channels come from Spaces via the /api/v1/spaces/channels proxy.
  // Multi-select: bind to several channels (one row each), or all channels via
  // the "*" sentinel.
  const [selectedChannels, setSelectedChannels] = useState<SpacesChannel[]>([]);
  const [allChannels, setAllChannels] = useState<boolean>(false);
  const [entryAgentSlug, setEntryAgentSlug] = useState<string>(agents[0]?.slug ?? "");
  const [channelSearch, setChannelSearch] = useState<string>("");
  const [channelOptions, setChannelOptions] = useState<SpacesChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelListOpen, setChannelListOpen] = useState(false);
  const channelSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelComboRef = useRef<HTMLDivElement | null>(null);

  // ── Event triggers (optional) — reuse the workflow's channel binding ──
  // ENABLED: Spaces ships the automation CRUD endpoints and claw-auth's bridge
  // creates + submits each trigger for admin approval. A created trigger is
  // DRAFT→PENDING_APPROVAL and only fires once an automations admin approves —
  // the save handler tells the user. (Legacy AppV2 modal; v3 ChainWorkflowModal
  // is the primary surface.)
  const SPACES_AUTOMATIONS_ENABLED = true;
  const [triggerOptions, setTriggerOptions] = useState<SpacesTriggerSummary[]>([]);
  const [triggersLoading, setTriggersLoading] = useState(false);
  const [triggersError, setTriggersError] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<TriggerDraft[]>([]);
  const [schemaCache, setSchemaCache] = useState<Record<string, SpacesTriggerSchema>>({});
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTriggersLoading(true);
    setTriggersError(null);
    listSpacesTriggers()
      .then((opts) => { if (!cancelled) setTriggerOptions([...VCS_TEMPLATE_TRIGGERS, ...opts]); })
      .catch(() => {
        if (!cancelled) {
          setTriggerOptions([...VCS_TEMPLATE_TRIGGERS]);
          setTriggersError("Could not load Spaces trigger catalog; webhook templates still available.");
        }
      })
      .finally(() => { if (!cancelled) setTriggersLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    const wanted = [...new Set(triggers.map((t) => t.type).filter(Boolean))];
    for (const type of wanted) {
      if (VCS_TEMPLATE_CONFIG_FIELDS[type]) continue;
      if (schemaCache[type]) continue;
      getSpacesTriggerSchema(type)
        .then((schema) => setSchemaCache((prev) => (prev[type] ? prev : { ...prev, [type]: schema })))
        .catch(() => { /* leave uncached */ });
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
      return { ...t, configValues: { ...t.configValues, eventTypes: toCsv([...current]) } };
    }));
  }, []);
  const triggerOptionName = useCallback((type: string): string => {
    return triggerOptions.find((o) => o.type === type)?.name ?? type;
  }, [triggerOptions]);
  const triggerSummary = useMemo(() => {
    const configured = triggers.filter((t) => t.type);
    if (configured.length === 0) return "No event triggers";
    return configured.map((t) => {
      const eventValues = fromCsv(t.configValues["eventTypes"] ?? "");
      const events = eventValues.slice(0, 2).map((v) => eventTypeLabel(t.type, v));
      const suffix = events.length > 0 ? `: ${events.join(", ")}${eventValues.length > 2 ? "…" : ""}` : "";
      return `${triggerOptionName(t.type)}${suffix}`;
    }).join(" · ");
  }, [triggers, triggerOptionName]);

  // Close the inline channel list when clicking outside the combobox.
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

  // Debounced channel search. Loads on first open and every 300ms after the
  // user pauses typing. Cap at 50 results to keep the dropdown manageable.
  useEffect(() => {
    if (!open) return;
    if (channelSearchTimer.current) clearTimeout(channelSearchTimer.current);
    channelSearchTimer.current = setTimeout(() => {
      setChannelsLoading(true);
      listSpacesChannels(channelSearch, 50)
        .then(setChannelOptions)
        .catch((err) => {
          console.error("[workflow-modal] listSpacesChannels error:", err);
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
      buildNode(agents[0]?.slug ?? "", 80 + offset, 80 + offset),
    ]);
  }, [agents, buildNode, nodes.length]);

  // Auto-create the entry agent's node when the user picks one. The save
  // handler requires the entry agent to also exist as a node in the graph;
  // doing this implicitly removes a manual step. The duplicate guard lives
  // INSIDE the functional setter (not in the effect deps) so the effect
  // fires once per entry-agent change. If we depended on `nodes` here, then
  // editing the auto-added node's slug via its inline dropdown would make
  // the effect re-fire, see no node matching the entry slug, and append a
  // fresh node every time — that was the "unable to change main agent" bug.
  useEffect(() => {
    if (!open) return;
    if (!entryAgentSlug) return;
    setNodes((prev) => {
      if (prev.some((n) => n.data.agentSlug === entryAgentSlug)) return prev;
      return [...prev, buildNode(entryAgentSlug, 80, 80)];
    });
  }, [open, entryAgentSlug, buildNode]);

  // Callbacks are injected onto every edge's `data` so the inline popover
  // (ChainConfigEdge) can mutate state from the EdgeLabelRenderer overlay.
  // Defined as stable refs (useCallback) so the same function ref is reused
  // across renders — otherwise React Flow re-renders every edge every frame.
  // CRITICAL: these MUST stay above the `if (!open) return null;` early
  // return. Hooks must be called in the same order on every render —
  // putting them after the early return makes hook #20 conditionally
  // present, which trips React's rules-of-hooks check.
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

  // Hydrate state from `editingWorkflow` once when the modal opens in edit
  // mode. Re-running on every change of editingWorkflow is intentional: if
  // the user closes and re-opens with a different workflow, we want a fresh
  // snapshot. We auto-layout nodes in a simple grid since positions aren't
  // persisted in the saved definition.
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
      setEntryAgentSlug(bindings[0]!.entryAgentSlug);
      setAllChannels(bindings.some((b) => b.channelId === "*"));
      // Stub channel chips — the user can remove (✕) and re-pick to get the
      // rich label (project / scope). Avoids an extra fetch by id.
      setSelectedChannels(
        bindings
          .filter((b) => b.channelId !== "*")
          .map((b) => ({
            id: b.channelId,
            name: b.channelId,
            scopeType: "default",
            visibility: "",
            participantCount: 0,
            lastActivityAt: null,
            projectName: null,
          })),
      );
    }

    // Hydrate existing event triggers (carry dbId so the backend updates them).
    setTriggers(
      (editingWorkflow.triggers ?? []).map((t) => ({
        id: t.id,
        dbId: t.id,
        type: t.type,
        configValues: t.configValues ?? {},
      })),
    );
    // We intentionally exclude the callback refs from deps — they're stable
    // (useCallback with [] / memoized inputs), and listing them would make
    // this effect fire spuriously and clobber user edits.
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
            isOpen: true, // auto-open the popover for the freshly drawn edge
            onToggle: toggleEdgeOpen,
            onChange: updateEdge,
            onDelete: deleteEdge,
          },
        },
        prev.map((e) => ({
          ...e,
          // Close any other open popover so only one is visible at a time.
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
    setTriggerDialogOpen(false);
    setEntryAgentSlug(agents[0]?.slug ?? "");
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

    const validIds = new Set(apiNodes.map((n) => n.id));
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
      nodes: apiNodes,
      edges: apiEdges,
    };

    // Channel binding is required — every workflow is tied to one or more
    // Spaces channels (or all channels) + an entry agent. The binding is the
    // only way the runtime resolves which workflow to fire.
    const channelIds = allChannels ? ["*"] : selectedChannels.map((c) => c.id);
    if (channelIds.length === 0) {
      setMessage("Pick at least one channel, or choose All channels.");
      return;
    }
    if (!entryAgentSlug) {
      setMessage("Pick an entry agent for the channel binding.");
      return;
    }

    // The entry agent must also be a node in the workflow. Otherwise the
    // binding resolver in webhook.ts can't match root → next-edge for the
    // first agent invocation.
    if (!apiNodes.some((n) => n.agentSlug === entryAgentSlug)) {
      setMessage(`Entry agent "${entryAgentSlug}" must appear as a node in the workflow.`);
      return;
    }

    // Event triggers (optional) reuse the workflow's channel binding.
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
      const saved = isEditing && editingWorkflow
        ? await updateChainWorkflow(editingWorkflow.id, { name: name.trim(), definition, isPublished, triggers: triggersPayload, useCreatorCredentials })
        : await createChainWorkflow({ name: name.trim(), definition, isPublished, useCreatorCredentials, ...(triggersPayload.length > 0 ? { triggers: triggersPayload } : {}) });

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
      // (claw-auth bridge → Spaces); they only fire once an automations admin
      // approves. Webhook-backed (GitHub/Bitbucket) triggers also return a URL
      // to paste into the repo. Legacy AppV2 modal has no Snackbar provider, so
      // a plain (copyable) popup surfaces both before closing.
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
        window.alert(
          "Trigger submitted for approval — an automations admin will review it. You can ask in the #xyne-spaces channel.",
        );
      }

      onCreated();
      close();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to ${isEditing ? "update" : "create"} workflow`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex h-[90vh] w-full max-w-7xl flex-col rounded-xl border border-zinc-800 bg-zinc-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{isEditing ? "Edit Workflow" : "Create Workflow"}</h2>
            <p className="text-xs text-zinc-500">
              Drag from the blue handle on a node onto another node to create an edge. Click an edge to configure it.
            </p>
          </div>
          <button onClick={close} className="text-zinc-500 hover:text-zinc-300">
            ✕
          </button>
        </div>

        {/* Top settings row 1: workflow identity */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-zinc-500">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <label className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            Published
          </label>
          <label
            className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-300"
            title="When ON, triggered runs of this workflow use YOUR connected credentials (MCP/tools) instead of the agent's app identity. Only you (the owner) can change this."
          >
            <input
              type="checkbox"
              checked={useCreatorCredentials}
              onChange={(e) => setUseCreatorCredentials(e.target.checked)}
            />
            Use my credentials
          </label>
          <button
            onClick={onAddNode}
            className="mt-5 inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
          >
            <Plus size={12} /> Add Agent Node
          </button>
        </div>

        {/* Top settings row 2: channel binding (optional). Channels are
            fetched live from Spaces (/api/v1/spaces/channels). When set,
            saving the workflow ALSO upserts the channel→workflow binding
            with the chosen entry agent. */}
        <div className="flex items-end gap-3 border-b border-zinc-800 bg-zinc-950 px-5 py-3">
          <div className="relative flex-1" ref={channelComboRef}>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs text-zinc-500">
                Bind to Spaces channel(s) <span className="text-zinc-600">(required)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
                <input
                  type="checkbox"
                  checked={allChannels}
                  onChange={(e) => {
                    setAllChannels(e.target.checked);
                    setChannelListOpen(false);
                  }}
                  className="h-3.5 w-3.5"
                />
                All channels
              </label>
            </div>

            {allChannels ? (
              <div className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-400">
                Applies to <span className="font-medium text-zinc-200">all channels</span>
              </div>
            ) : (
              <>
                {selectedChannels.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {selectedChannels.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200"
                      >
                        <span className="max-w-[140px] truncate">#{c.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedChannels((prev) => prev.filter((x) => x.id !== c.id))
                          }
                          className="rounded px-0.5 text-zinc-500 hover:text-zinc-200"
                          title="Remove channel"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  value={channelSearch}
                  onChange={(e) => {
                    setChannelSearch(e.target.value);
                    setChannelListOpen(true);
                  }}
                  onFocus={() => setChannelListOpen(true)}
                  placeholder={channelsLoading ? "Loading channels…" : "Type to add channels by name"}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
                />

                {channelListOpen && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
                    {channelsLoading && channelOptions.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-zinc-500">Loading channels…</div>
                    ) : channelOptions.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-zinc-500">No channels match.</div>
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
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                          >
                            <span className="min-w-0 truncate">
                              {picked ? "✓ " : ""}#{c.name}
                              {c.projectName ? <span className="text-zinc-500"> · {c.projectName}</span> : null}
                            </span>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
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
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Entry agent <span className="text-zinc-600">(required)</span>
            </label>
            <select
              value={entryAgentSlug}
              onChange={(e) => setEntryAgentSlug(e.target.value)}
              className="w-48 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">— pick an agent —</option>
              {agents.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.slug}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Event triggers — optional. The detailed editor opens in a modal so
            this V1 surface matches the V3 workflow UI. */}
        {SPACES_AUTOMATIONS_ENABLED && (
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs text-zinc-500">
              Event triggers <span className="text-zinc-600">(optional — also fire on Spaces events)</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (triggers.length === 0) addTrigger();
                else setTriggerDialogOpen(true);
              }}
              disabled={triggersLoading || triggerOptions.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
            >
              <Plus size={11} /> {triggers.length === 0 ? "Add trigger" : "Configure"}
            </button>
          </div>
          {triggersError && <p className="text-xs text-rose-400">{triggersError}</p>}
          <button
            type="button"
            onClick={() => setTriggerDialogOpen(true)}
            className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left hover:border-zinc-600"
          >
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-zinc-200">{triggerSummary}</span>
              <span className="mt-0.5 block truncate text-xs text-zinc-500">
                {triggers.length === 0
                  ? "Workflow still runs on @mention in the bound channel(s)."
                  : "Edit provider, events, repository filters, and native trigger fields."}
              </span>
            </span>
            <span className="ml-3 shrink-0 text-xs font-medium text-zinc-400">Configure</span>
          </button>
        </div>
        )}

        {/* Canvas + side panel */}
        <div className="flex min-h-0 flex-1">
          <div className="relative flex-1 bg-zinc-900">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeClick={(_, edge) => toggleEdgeOpen(edge.id)}
              onPaneClick={() => {
                // Close any open inline popover when clicking empty canvas.
                setEdges((prev) => prev.map((e) => ({
                  ...e,
                  data: { ...(e.data as ChainEdgeData), isOpen: false },
                })));
              }}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              fitView={nodes.length > 0}
              colorMode="dark"
              defaultEdgeOptions={{ animated: true }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} color="#27272a" />
              <Controls className="!rounded !border !border-zinc-700 !bg-zinc-900" />
              <MiniMap
                pannable
                zoomable
                maskColor="rgba(0,0,0,0.6)"
                className="!rounded !border !border-zinc-700 !bg-zinc-900"
              />
            </ReactFlow>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="text-center text-sm text-zinc-500">
                  Click <span className="text-zinc-300">+ Add Agent Node</span> to start.
                  <br />
                  Drag the blue handle on a node onto another node to connect them.
                </p>
              </div>
            )}
          </div>

          {/* Chain Config is rendered INLINE on each edge via the
              ChainConfigEdge custom component (EdgeLabelRenderer overlay).
              The old side panel is gone — click an edge's mode badge to
              open its popover. Click empty canvas to close all popovers. */}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <div className="text-xs text-zinc-500">
            {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge
            {edges.length === 1 ? "" : "s"}
            {message && <span className="ml-3 text-zinc-300">{message}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={close}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? (isEditing ? "Saving…" : "Creating…") : (isEditing ? "Save Workflow" : "Create Workflow")}
            </button>
          </div>
        </div>
      </div>
    </div>
    {SPACES_AUTOMATIONS_ENABLED && triggerDialogOpen && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) setTriggerDialogOpen(false);
        }}
      >
        <div className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
            <div>
              <h3 className="text-base font-semibold text-zinc-100">Configure Event Triggers</h3>
              <p className="mt-1 text-sm text-zinc-400">
                Choose external events that should also start this workflow.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTriggerDialogOpen(false)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="Close event trigger configuration"
            >
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">{triggerSummary}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  GitHub and Bitbucket triggers create a generated webhook URL after save.
                </p>
              </div>
              <button
                type="button"
                onClick={addTrigger}
                disabled={triggersLoading || triggerOptions.length === 0}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
              >
                <Plus size={14} /> Add trigger
              </button>
            </div>

            {triggersError && <p className="mb-3 text-sm text-rose-400">{triggersError}</p>}

            {triggers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/60 px-4 py-8 text-center">
                <p className="text-sm text-zinc-300">No event triggers configured.</p>
                <p className="mt-1 text-xs text-zinc-500">
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
                    <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                      <div className="flex items-center gap-2">
                        <label className="min-w-0 flex-1">
                          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Provider
                          </span>
                          <select
                            value={t.type}
                            onChange={(e) => setTriggerType(t.id, e.target.value)}
                            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
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
                          className="mt-5 rounded p-2 text-zinc-500 hover:text-rose-400"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {isVcs && (
                        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
                          <div>
                            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                              Events
                            </span>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {vcsEvents.map((event) => (
                                <label
                                  key={event.value}
                                  className="flex min-h-9 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedEvents.has(event.value)}
                                    onChange={(e) => setTriggerEventEnabled(t.id, event.value, e.target.checked)}
                                    className="h-3.5 w-3.5"
                                  />
                                  <span>{event.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <label className="block">
                            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                              Repository filter
                            </span>
                            <input
                              type="text"
                              value={t.configValues["repoName"] ?? ""}
                              onChange={(e) => setTriggerConfig(t.id, "repoName", e.target.value)}
                              placeholder={t.type === "GITHUB_EVENT" ? "owner/repository" : "repository slug or full name"}
                              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                            />
                            <p className="mt-1 text-xs text-zinc-500">
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
                                <label key={key} className="block text-xs text-zinc-500">
                                  {label}
                                  <SpacesEntityMultiSelect
                                    kind={kind}
                                    value={fromCsv(t.configValues[key] ?? "")}
                                    onChange={(next) => setTriggerConfig(t.id, key, toCsv(next))}
                                  />
                                  <span className="mt-1 block text-xs text-zinc-600">
                                    Empty matches all {kind}.
                                  </span>
                                </label>
                              );
                            }
                            if (p.enum && p.enum.length > 0) {
                              return (
                                <label key={key} className="block text-xs text-zinc-500">
                                  {label}
                                  <select
                                    value={t.configValues[key] ?? ""}
                                    onChange={(e) => setTriggerConfig(t.id, key, e.target.value)}
                                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
                                  >
                                    <option value="">—</option>
                                    {p.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                </label>
                              );
                            }
                            const isArray = p.type === "array";
                            return (
                              <label key={key} className="block text-xs text-zinc-500">
                                {label}{isArray ? " (comma-separated)" : ""}
                                <input
                                  type="text"
                                  value={t.configValues[key] ?? ""}
                                  onChange={(e) => setTriggerConfig(t.id, key, e.target.value)}
                                  placeholder={p.description ?? (isArray && p.items?.enum ? p.items.enum.join(", ") : "")}
                                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {t.type && (
                        <label className="mt-3 block">
                          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
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
                            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                          />
                          <p className="mt-1 text-xs text-zinc-500">
                            Becomes the agent&apos;s prompt. Reference event fields with{" "}
                            <code className="rounded bg-zinc-800 px-1 text-zinc-300">{"{{trigger.…}}"}</code>
                            {t.type === "MESSAGE_RECEIVED" ? (
                              <>
                                {" "}— e.g.{" "}
                                <code className="rounded bg-zinc-800 px-1 text-zinc-300">{"{{trigger.message.content}}"}</code>,{" "}
                                <code className="rounded bg-zinc-800 px-1 text-zinc-300">{"{{trigger.author.name}}"}</code>.
                              </>
                            ) : (
                              <>. Leave blank to use the default.</>
                            )}
                          </p>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
            <button
              type="button"
              onClick={() => setTriggerDialogOpen(false)}
              className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export function CreateWorkflowModal(props: Props) {
  return (
    <ReactFlowProvider>
      <CreateWorkflowModalInner {...props} />
    </ReactFlowProvider>
  );
}
