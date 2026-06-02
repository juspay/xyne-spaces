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
import { Plus, Save, Trash2 } from "lucide-react";
import {
  createChainWorkflow,
  listSpacesChannels,
  updateChainWorkflow,
  upsertChannelChainBinding,
  deleteChannelChainBinding,
  type ChainWorkflow,
  type ChainWorkflowDefinition,
  type ChainWorkflowEdge as ApiEdge,
  type ChainWorkflowNode as ApiNode,
  type SpacesChannel,
} from "../lib/api";
import type { Agent } from "../lib/types";

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
    setNodes([]);
    setEdges([]);
    setMessage(null);
    setSelectedChannels([]);
    setAllChannels(false);
    setChannelListOpen(false);
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

    setSaving(true);
    setMessage(null);
    try {
      const saved = isEditing && editingWorkflow
        ? await updateChainWorkflow(editingWorkflow.id, { name: name.trim(), definition, isPublished })
        : await createChainWorkflow({ name: name.trim(), definition, isPublished });

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

      onCreated();
      close();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to ${isEditing ? "update" : "create"} workflow`);
    } finally {
      setSaving(false);
    }
  };

  return (
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
  );
}

export function CreateWorkflowModal(props: Props) {
  return (
    <ReactFlowProvider>
      <CreateWorkflowModalInner {...props} />
    </ReactFlowProvider>
  );
}
