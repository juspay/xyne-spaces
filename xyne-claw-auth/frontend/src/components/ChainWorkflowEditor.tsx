import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  createChainWorkflow,
  resolveChannelChainBinding,
  updateChainWorkflow,
  upsertChannelChainBinding,
  type ChainWorkflowDefinition,
  type ChainWorkflowEdge,
  type ChainWorkflowNode,
} from "../lib/api";
import type { Agent, AgentLight } from "../lib/types";

interface Props {
  agent: Agent;
  allAgents: AgentLight[];
}

interface EditableEdge extends ChainWorkflowEdge {
  toolsMustIncludeText: string;
  toolsMustExcludeText: string;
}

const randomId = (): string =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function toCsv(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

function fromCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function ChainWorkflowEditor({ agent, allAgents }: Props) {
  const [channelId, setChannelId] = useState("");
  // Bind to more than one channel: `channelId` above is the load/resolve key;
  // these broaden the binding. `allChannels` adds the "*" (any channel)
  // sentinel; `extraChannels` is a comma-separated list of extra channel ids.
  const [allChannels, setAllChannels] = useState(false);
  const [extraChannels, setExtraChannels] = useState("");
  const [entryAgentSlug, setEntryAgentSlug] = useState(agent.slug);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState(`${agent.name} Channel Workflow`);
  const [isPublished, setIsPublished] = useState(true);
  const [nodes, setNodes] = useState<ChainWorkflowNode[]>([
    { id: randomId(), agentSlug: agent.slug, taskTemplate: "{{result}}" },
  ]);
  const [edges, setEdges] = useState<EditableEdge[]>([]);
  const [loadingBinding, setLoadingBinding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const nodeOptions = useMemo(() => nodes.map((n) => ({ id: n.id, label: `${n.agentSlug} (${n.id.slice(0, 6)})` })), [nodes]);

  useEffect(() => {
    if (!channelId.trim() || !entryAgentSlug.trim()) return;
    setLoadingBinding(true);
    resolveChannelChainBinding(channelId.trim(), entryAgentSlug.trim())
      .then((binding) => {
        if (!binding?.workflow) {
          setWorkflowId(null);
          setWorkflowName(`${agent.name} Channel Workflow`);
          setIsPublished(true);
          setNodes([{ id: randomId(), agentSlug: entryAgentSlug, taskTemplate: "{{result}}" }]);
          setEdges([]);
          return;
        }

        const def = binding.workflow.definition as ChainWorkflowDefinition;
        setWorkflowId(binding.workflow.id);
        setWorkflowName(binding.workflow.name);
        setIsPublished(binding.workflow.isPublished);
        setNodes(def.nodes?.length ? def.nodes : [{ id: randomId(), agentSlug: entryAgentSlug, taskTemplate: "{{result}}" }]);
        setEdges((def.edges ?? []).map((e) => ({
          ...e,
          toolsMustIncludeText: toCsv(e.toolsMustInclude),
          toolsMustExcludeText: toCsv(e.toolsMustExclude),
        })));
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "Failed to load channel binding");
      })
      .finally(() => setLoadingBinding(false));
  }, [channelId, entryAgentSlug, agent.name]);

  const addNode = () => {
    setNodes((prev) => [...prev, { id: randomId(), agentSlug: "", taskTemplate: "{{result}}" }]);
  };

  const removeNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.fromNodeId !== id && e.toNodeId !== id));
  };

  const addEdge = () => {
    if (nodes.length < 2) return;
    setEdges((prev) => ([
      ...prev,
      {
        id: randomId(),
        fromNodeId: nodes[0]!.id,
        toNodeId: nodes[1]!.id,
        mode: "always",
        taskTemplate: "{{result}}",
        toolsMustIncludeText: "",
        toolsMustExcludeText: "",
      },
    ]));
  };

  const saveWorkflow = async () => {
    // Bind to: the primary channel + any extra channels + "*" (all) if checked.
    const channelIds = Array.from(
      new Set(
        [channelId.trim(), ...fromCsv(extraChannels), ...(allChannels ? ["*"] : [])].filter(Boolean),
      ),
    );
    if (channelIds.length === 0) {
      setMessage("Enter a channel ID, add extra channels, or choose All channels");
      return;
    }
    if (!entryAgentSlug.trim()) {
      setMessage("Entry agent is required");
      return;
    }
    if (!workflowName.trim()) {
      setMessage("Workflow name is required");
      return;
    }

    const normalizedNodes = nodes
      .filter((n) => n.agentSlug.trim().length > 0)
      .map((n) => ({ ...n, taskTemplate: n.taskTemplate?.trim() || "{{result}}" }));

    if (!normalizedNodes.some((n) => n.agentSlug === entryAgentSlug)) {
      normalizedNodes.unshift({ id: randomId(), agentSlug: entryAgentSlug, taskTemplate: "{{result}}" });
    }

    if (normalizedNodes.length === 0) {
      setMessage("Add at least one node");
      return;
    }

    const nodeIds = new Set(normalizedNodes.map((n) => n.id));
    const normalizedEdges: ChainWorkflowEdge[] = edges
      .filter((e) => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId))
      .map((e) => ({
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        mode: e.mode ?? "always",
        ...(fromCsv(e.toolsMustIncludeText).length > 0 ? { toolsMustInclude: fromCsv(e.toolsMustIncludeText) } : {}),
        ...(fromCsv(e.toolsMustExcludeText).length > 0 ? { toolsMustExclude: fromCsv(e.toolsMustExcludeText) } : {}),
        ...(e.judgeContext?.trim() ? { judgeContext: e.judgeContext.trim() } : {}),
        ...(e.taskTemplate?.trim() ? { taskTemplate: e.taskTemplate.trim() } : {}),
      }));

    const definition: ChainWorkflowDefinition = {
      version: 1,
      nodes: normalizedNodes,
      edges: normalizedEdges,
    };

    setSaving(true);
    setMessage(null);
    try {
      const workflow = workflowId
        ? await updateChainWorkflow(workflowId, { name: workflowName.trim(), definition, isPublished })
        : await createChainWorkflow({ name: workflowName.trim(), definition, isPublished });

      await upsertChannelChainBinding({
        channelIds,
        entryAgentSlug: entryAgentSlug.trim(),
        workflowId: workflow.id,
        enabled: true,
      });

      setWorkflowId(workflow.id);
      setMessage(
        `Saved and bound to ${channelIds.length} ${channelIds.length === 1 ? "channel" : "channels"}${allChannels ? " (incl. all channels)" : ""}.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Channel Agent Workflow (DAG)</h3>
        <p className="mb-4 text-xs text-zinc-500">Configure channel-level agent chaining by entry agent. Runtime resolves using (channelId, entryAgent).</p>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Channel ID</label>
            <input
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="cmnlpbora0nlxma4f68oprodg"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Entry Agent</label>
            <select
              value={entryAgentSlug}
              onChange={(e) => setEntryAgentSlug(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              {[agent, ...allAgents.filter((a) => a.slug !== agent.slug)].map((a) => (
                <option key={a.slug} value={a.slug}>{a.name} ({a.slug})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Workflow Name</label>
            <input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-zinc-400">
              Additional channels <span className="text-zinc-600">(optional, comma-separated IDs)</span>
            </label>
            <input
              value={extraChannels}
              onChange={(e) => setExtraChannels(e.target.value)}
              disabled={allChannels}
              placeholder="cmnl…, cmpm…"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-5">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} /> Published
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={allChannels} onChange={(e) => setAllChannels(e.target.checked)} /> All channels
          </label>
        </div>
        {loadingBinding && <p className="mt-2 text-xs text-zinc-500">Loading channel workflow…</p>}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-zinc-200">Nodes</h4>
          <button onClick={addNode} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"><Plus size={12} /> Add Node</button>
        </div>
        <div className="space-y-2">
          {nodes.map((node, idx) => (
            <div key={node.id} className="grid gap-2 md:grid-cols-[120px_1fr_1fr_auto]">
              <input value={node.id} readOnly className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-500" />
              <select
                value={node.agentSlug}
                onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, agentSlug: e.target.value } : n))}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200"
              >
                <option value="">Select agent...</option>
                {[agent, ...allAgents.filter((a) => a.slug !== agent.slug)].map((a) => (
                  <option key={a.slug} value={a.slug}>{a.slug}</option>
                ))}
              </select>
              <input
                value={node.taskTemplate ?? ""}
                onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, taskTemplate: e.target.value } : n))}
                placeholder="Task template"
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200"
              />
              <button onClick={() => removeNode(node.id)} disabled={idx === 0} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 disabled:opacity-40"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-zinc-200">Edges</h4>
          <button onClick={addEdge} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"><Plus size={12} /> Add Edge</button>
        </div>
        <div className="space-y-2">
          {edges.map((edge) => (
            <div key={edge.id} className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <select value={edge.fromNodeId} onChange={(e) => setEdges((prev) => prev.map((x) => x.id === edge.id ? { ...x, fromNodeId: e.target.value } : x))} className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                  {nodeOptions.map((o) => <option key={o.id} value={o.id}>from: {o.label}</option>)}
                </select>
                <select value={edge.toNodeId} onChange={(e) => setEdges((prev) => prev.map((x) => x.id === edge.id ? { ...x, toNodeId: e.target.value } : x))} className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                  {nodeOptions.map((o) => <option key={o.id} value={o.id}>to: {o.label}</option>)}
                </select>
                <select value={edge.mode ?? "always"} onChange={(e) => setEdges((prev) => prev.map((x) => x.id === edge.id ? { ...x, mode: e.target.value as EditableEdge["mode"] } : x))} className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                  <option value="always">always</option>
                  <option value="tools">tools</option>
                  <option value="judge">judge</option>
                </select>
                <button onClick={() => setEdges((prev) => prev.filter((x) => x.id !== edge.id))} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300">Remove</button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <input value={edge.taskTemplate ?? ""} onChange={(e) => setEdges((prev) => prev.map((x) => x.id === edge.id ? { ...x, taskTemplate: e.target.value } : x))} placeholder="Edge task template" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200" />
                <input value={edge.judgeContext ?? ""} onChange={(e) => setEdges((prev) => prev.map((x) => x.id === edge.id ? { ...x, judgeContext: e.target.value } : x))} placeholder="Judge context (mode=judge)" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200" />
                <input value={edge.toolsMustIncludeText} onChange={(e) => setEdges((prev) => prev.map((x) => x.id === edge.id ? { ...x, toolsMustIncludeText: e.target.value } : x))} placeholder="toolsMustInclude (comma separated)" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200" />
                <input value={edge.toolsMustExcludeText} onChange={(e) => setEdges((prev) => prev.map((x) => x.id === edge.id ? { ...x, toolsMustExcludeText: e.target.value } : x))} placeholder="toolsMustExclude (comma separated)" className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200" />
              </div>
            </div>
          ))}
          {edges.length === 0 && <p className="text-xs text-zinc-500">No edges yet. Add at least one edge to chain agents.</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={saveWorkflow} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50">
          <Save size={16} />
          {saving ? "Saving…" : workflowId ? "Update Workflow" : "Create + Bind Workflow"}
        </button>
        {workflowId && <span className="text-xs text-zinc-500">workflowId: {workflowId}</span>}
      </div>

      {message && (
        <div className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">{message}</div>
      )}
    </div>
  );
}
