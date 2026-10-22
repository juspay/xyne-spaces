import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeftIcon, CircleDashedIcon, FlagCheckeredIcon, PlayIcon, PlusIcon, TreeStructureIcon, XIcon } from "@phosphor-icons/react";
import { createLoopCommand, getLoopTemplates, listLoopCommands, publishLoopCommand, updateLoopCommand } from "../../../lib/api";
import type { LoopCommandRow, LoopTemplateCatalogue } from "../../../lib/api";
import { Button } from "../ui/Button";
import { useSnackbar } from "../ui/Snackbar";
import { END_ID, START_ID, appendStep, chainEdge, graphToSteps, layout, removeStep, stepsToGraph, type StepNodeData } from "../../lib/loopGraph";

const NAME_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

interface EditorCtx {
  setArgs: (id: string, args: string) => void;
  remove: (id: string) => void;
  positional: (command: string) => boolean;
}

const Ctx = createContext<EditorCtx | null>(null);

function StepNode({ id, data, selected }: NodeProps) {
  const ctx = useContext(Ctx)!;
  const d = data as StepNodeData;
  return (
    <div className={`w-[240px] rounded-xl border-2 bg-xyne-surface p-2.5 shadow-sm ${selected ? "border-xyne-brand" : "border-xyne-border-strong"}`} data-id="editor-step">
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-xyne-brand" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[13px] font-medium text-xyne-fg-primary">{d.command}</span>
        <button type="button" aria-label={`Remove ${d.command}`} onClick={() => ctx.remove(id)} className="nodrag text-xyne-fg-muted hover:text-xyne-error-fg">
          <XIcon size={13} />
        </button>
      </div>
      <input
        value={d.args}
        onChange={(e) => ctx.setArgs(id, e.target.value)}
        placeholder={ctx.positional(d.command) ? "route, e.g. /settings or {focus}" : "args, e.g. 30m auth or {focus}"}
        aria-label={`Arguments for ${d.command}`}
        className="nodrag mt-1.5 w-full rounded border border-xyne-border bg-xyne-surface px-2 py-1 font-mono text-[11px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
      />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-xyne-brand" />
    </div>
  );
}

function TerminalNode({ id, data }: NodeProps) {
  const start = id === START_ID;
  return (
    <div className="flex w-[120px] items-center justify-center gap-1.5 rounded-full border-2 border-xyne-border-strong bg-xyne-surface-subtle px-3 py-2 text-[12px] font-medium text-xyne-fg-secondary" data-id={`editor-${id}`}>
      {start ? <PlayIcon size={12} /> : <FlagCheckeredIcon size={12} />}
      {(data as { label: string }).label}
      {start ? <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-xyne-brand" /> : <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-xyne-brand" />}
    </div>
  );
}

const nodeTypes = { step: StepNode, terminal: TerminalNode };

function EditorInner() {
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const [params] = useSearchParams();
  const editId = params.get("id");
  const [catalogue, setCatalogue] = useState<LoopTemplateCatalogue | null>(null);
  const [rows, setRows] = useState<LoopCommandRow[]>([]);
  const [row, setRow] = useState<LoopCommandRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<Node[]>(() => stepsToGraph([]).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => [chainEdge(START_ID, END_ID)]);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { fitView } = useReactFlow();
  const stepCount = nodes.filter((n) => n.type === "step").length;

  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.12, maxZoom: 1.1, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [stepCount, fitView]);

  useEffect(() => {
    void Promise.all([getLoopTemplates(), listLoopCommands()])
      .then(([c, r]) => {
        setCatalogue(c);
        setRows(r);
        const existing = editId ? r.find((x) => x.id === editId) ?? null : null;
        if (editId && !existing) setLoadError("This loop command was not found or you cannot edit it.");
        if (existing) {
          setRow(existing);
          setName(existing.name);
          setDescription(existing.description);
          const g = stepsToGraph(existing.steps ?? []);
          setNodes(g.nodes);
          setEdges(g.edges);
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load"));
  }, [editId]);

  const composite = useMemo(() => new Set((catalogue?.templates ?? []).filter((t) => t.composite).map((t) => t.id as string)), [catalogue]);
  const palette = useMemo(
    () => [
      ...(catalogue?.builtinLoops ?? []).map((b) => ({ command: b.command, summary: b.summary, builtin: true, positional: Boolean(b.positional) })),
      ...rows.filter((r) => !composite.has(r.template) && r.name !== name).map((r) => ({ command: r.command, summary: r.description, builtin: false, positional: false })),
    ],
    [catalogue, rows, composite, name],
  );

  const ctx: EditorCtx = useMemo(
    () => ({
      setArgs: (id, args) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, args } } : n))),
      remove: (id) => {
        setNodes((ns) => {
          const next = removeStep(ns, edges, id);
          setEdges(next.edges);
          return next.nodes;
        });
      },
      positional: (command) => palette.find((p) => p.command === command)?.positional ?? false,
    }),
    [edges, palette],
  );

  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c.filter((x) => !(x.type === "remove" && (x.id === START_ID || x.id === END_ID))), ns)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es)), []);
  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) => addEdge({ ...c, type: "smoothstep" }, es.filter((e) => e.source !== c.source && e.target !== c.target))),
    [],
  );

  const add = (command: string) => {
    const next = appendStep(nodes, edges, command);
    setNodes(next.nodes);
    setEdges(next.edges);
  };

  const check = graphToSteps(nodes, edges);
  const problems = [
    ...(row ? [] : !NAME_RE.test(name) ? ["Name: 3–32 lowercase letters, digits and hyphens"] : rows.some((r) => r.name === name) ? [`/${name} already exists`] : []),
    ...(description.trim().length < 3 ? ["Write a one-line description"] : []),
    ...(check.ok ? [] : check.problems),
  ];

  const save = async () => {
    if (!check.ok || problems.length > 0) return;
    setSaving(true);
    try {
      const body = { description: description.trim(), template: "sequence" as const, instruction: "", skills: [], subagents: [], maxDurationMinutes: 60, steps: check.steps };
      const saved = row ? await updateLoopCommand(row.id, body) : await createLoopCommand({ ...body, name });
      setRow(saved);
      showSnackbar({ variant: "success", title: row ? `Saved /${saved.name} v${saved.version}` : `Created /${saved.name} as a draft` });
      if (!row) navigate(`/v3/loop-commands/editor?id=${saved.id}`, { replace: true });
    } catch (err) {
      showSnackbar({ variant: "error", title: "Save failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    if (!row) return;
    try {
      setRow(await publishLoopCommand(row.id, !row.published));
    } catch (err) {
      showSnackbar({ variant: "error", title: "Could not change visibility", description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full flex-col overflow-hidden bg-xyne-surface" data-id="loop-editor">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-xyne-border px-5 py-3">
          <button type="button" onClick={() => navigate("/v3/loop-commands")} className="flex items-center gap-1 text-[13px] text-xyne-fg-muted hover:text-xyne-fg-primary">
            <ArrowLeftIcon size={14} /> Loop commands
          </button>
          <span className="flex items-center gap-1.5 text-[15px] font-semibold text-xyne-fg-primary">
            <TreeStructureIcon size={16} /> {row ? `/${row.name}` : "New sequence"}
            {row && <span className="text-[12px] font-normal text-xyne-fg-muted">v{row.version} · {row.published ? "published" : "draft"}</span>}
          </span>
          {!row && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/--+/g, "-"))}
              placeholder="release-check"
              aria-label="Command name"
              className="w-44 rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-2.5 py-1.5 font-mono text-[13px] focus:border-xyne-border-focus focus:outline-none"
            />
          )}
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this sequence is for (shown in /help)"
            aria-label="Description"
            className="min-w-[260px] flex-1 rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[13px] focus:border-xyne-border-focus focus:outline-none"
          />
          {row && <Button size="sm" variant="ghost" onClick={() => void togglePublish()}>{row.published ? "Unpublish" : "Publish to org"}</Button>}
          <Button size="sm" variant="primary" disabled={saving || problems.length > 0} onClick={() => void save()} leadingIcon={saving ? <CircleDashedIcon size={14} className="animate-spin" /> : undefined}>
            {row ? "Save version" : "Create draft"}
          </Button>
        </div>
        {loadError && <p className="px-5 py-2 text-[13px] text-xyne-error-fg">{loadError}</p>}
        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 space-y-1.5 overflow-y-auto border-r border-xyne-border p-3" data-id="editor-palette">
            <p className="text-[12px] font-medium text-xyne-fg-secondary">Loop commands</p>
            <p className="text-[11px] text-xyne-fg-muted">Click to add a step at the end, then drag the handles to change the order. Write {"{focus}"} in a step's arguments to pass on what the user types.</p>
            {palette.map((p) => (
              <button
                key={p.command}
                type="button"
                onClick={() => add(p.command)}
                title={p.summary}
                className="flex w-full items-start gap-2 rounded-lg border border-xyne-border bg-xyne-surface p-2 text-left hover:border-xyne-border-strong"
                data-id="editor-palette-item"
              >
                <PlusIcon size={13} className="mt-0.5 shrink-0 text-xyne-fg-muted" />
                <span className="min-w-0">
                  <span className="block font-mono text-[12px] text-xyne-fg-primary">{p.command}</span>
                  <span className="block truncate text-[11px] text-xyne-fg-muted">{p.builtin ? "built in · " : ""}{p.summary}</span>
                </span>
              </button>
            ))}
          </aside>
          <div className="relative min-w-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              fitView
              fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
              deleteKeyCode={["Backspace", "Delete"]}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
            <div className="absolute right-3 top-3">
              <Button size="sm" onClick={() => { setNodes((ns) => layout(ns, edges)); setTimeout(() => void fitView({ padding: 0.12, maxZoom: 1.1, duration: 200 }), 30); }}>Tidy layout</Button>
            </div>
            <div className="absolute bottom-3 left-3 right-3 rounded-xl border border-xyne-border bg-xyne-surface/95 px-3 py-2 text-[12px] shadow-sm" data-id="editor-status">
              {problems.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-xyne-error-fg">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : (
                <p className="text-xyne-fg-secondary">
                  Runs as <span className="font-mono text-xyne-fg-primary">/{name || row?.name} &lt;focus&gt;</span>: {check.ok ? check.steps.map((s) => `${s.command}${s.args ? ` ${s.args}` : ""}`).join(" → ") : ""} → summary
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function LoopGraphEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
