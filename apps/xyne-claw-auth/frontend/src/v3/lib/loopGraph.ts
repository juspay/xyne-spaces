import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { LoopSequenceStep, LoopTemplateInfo } from "../../lib/api";

export const START_ID = "start";
export const END_ID = "end";
export const MIN_STEPS = 2;
export const MAX_STEPS = 6;

export interface StepNodeData extends Record<string, unknown> {
  command: string;
  args: string;
}

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  hint?: string;
  tone?: "start" | "end" | "pass" | "judge" | "checker" | "report" | "wait";
}

const NODE_W = 240;
const NODE_H = 86;

export function layout<T extends Node>(nodes: T[], edges: Edge[], rankdir: "LR" | "TB" = "LR"): T[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.id === START_ID || n.id === END_ID ? 120 : NODE_W, height: NODE_H });
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const w = n.id === START_ID || n.id === END_ID ? 120 : NODE_W;
    return { ...n, position: { x: p.x - w / 2, y: p.y - NODE_H / 2 } };
  });
}

let seq = 0;
export const newStepId = (): string => `step-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function chainEdge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target, type: "smoothstep", animated: false };
}

export function stepsToGraph(steps: LoopSequenceStep[]): { nodes: Node[]; edges: Edge[] } {
  const stepNodes: Node<StepNodeData>[] = steps.map((s) => ({ id: newStepId(), type: "step", position: { x: 0, y: 0 }, data: { command: s.command, args: s.args } }));
  const nodes: Node[] = [
    { id: START_ID, type: "terminal", position: { x: 0, y: 0 }, data: { label: "Start" }, deletable: false },
    ...stepNodes,
    { id: END_ID, type: "terminal", position: { x: 0, y: 0 }, data: { label: "Summary" }, deletable: false },
  ];
  const ids = nodes.map((n) => n.id);
  const edges = ids.slice(1).map((id, i) => chainEdge(ids[i]!, id));
  return { nodes: layout(nodes, edges), edges };
}

export type GraphCheck = { ok: true; steps: LoopSequenceStep[] } | { ok: false; problems: string[] };

export function graphToSteps(nodes: Node[], edges: Edge[]): GraphCheck {
  const problems: string[] = [];
  const steps = nodes.filter((n) => n.type === "step");
  const out = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  for (const n of nodes) {
    if ((out.get(n.id)?.length ?? 0) > 1) problems.push(`${label(n)} has more than one next step; a sequence runs one step at a time`);
    if ((inDeg.get(n.id) ?? 0) > 1) problems.push(`${label(n)} is reached from more than one step`);
  }
  const order: Node[] = [];
  const seen = new Set<string>();
  let cur = out.get(START_ID)?.[0];
  while (cur && cur !== END_ID && !seen.has(cur)) {
    seen.add(cur);
    const n = nodes.find((x) => x.id === cur);
    if (!n) break;
    order.push(n);
    cur = out.get(cur)?.[0];
  }
  if (cur && cur !== END_ID && seen.has(cur)) problems.push("The steps form a loop; connect them in a line from Start to Summary");
  else if (cur !== END_ID) problems.push(steps.length === 0 ? "Add steps from the palette" : "Connect the steps in a line from Start to Summary");
  const orphans = steps.filter((s) => !seen.has(s.id));
  if (orphans.length > 0 && problems.length === 0) problems.push(`${orphans.length} step(s) are not connected to the chain`);
  if (order.length < MIN_STEPS || order.length > MAX_STEPS) problems.push(`A sequence needs ${MIN_STEPS}–${MAX_STEPS} steps in the chain`);
  for (const n of order) if (!String((n.data as StepNodeData).command ?? "")) problems.push("Every step needs a command");
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, steps: order.map((n) => ({ command: String((n.data as StepNodeData).command), args: String((n.data as StepNodeData).args ?? "").trim() })) };
}

function label(n: Node): string {
  if (n.id === START_ID) return "Start";
  if (n.id === END_ID) return "Summary";
  return String((n.data as StepNodeData).command || "A step");
}

export function appendStep(nodes: Node[], edges: Edge[], command: string): { nodes: Node[]; edges: Edge[] } {
  const into = edges.find((e) => e.target === END_ID);
  const prev = into?.source ?? START_ID;
  const id = newStepId();
  const node: Node<StepNodeData> = { id, type: "step", position: { x: 0, y: 0 }, data: { command, args: "" } };
  const nextEdges = [...edges.filter((e) => e !== into), chainEdge(prev, id), chainEdge(id, END_ID)];
  const nextNodes = [...nodes.filter((n) => n.id !== END_ID), node, nodes.find((n) => n.id === END_ID)!];
  return { nodes: layout(nextNodes, nextEdges), edges: nextEdges };
}

export function removeStep(nodes: Node[], edges: Edge[], id: string): { nodes: Node[]; edges: Edge[] } {
  const into = edges.find((e) => e.target === id);
  const from = edges.find((e) => e.source === id);
  const kept = edges.filter((e) => e.source !== id && e.target !== id);
  const bridged = into && from ? [...kept, chainEdge(into.source, from.target)] : kept;
  const nextNodes = nodes.filter((n) => n.id !== id);
  return { nodes: layout(nextNodes, bridged), edges: bridged };
}

export function loopTemplateGraph(t: Pick<LoopTemplateInfo, "id" | "exit" | "question" | "title">): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const n = (id: string, label: string, tone: FlowNodeData["tone"], hint?: string): Node<FlowNodeData> => ({
    id,
    type: "flow",
    position: { x: 0, y: 0 },
    data: { label, tone, ...(hint ? { hint } : {}) },
  });
  const e = (source: string, target: string, label: string, dashed = false): Edge => ({
    id: `${source}-${target}-${label}`,
    source,
    target,
    label,
    type: "smoothstep",
    ...(dashed ? { style: { strokeDasharray: "4 4" } } : {}),
  });
  const judged = t.exit === "judge";
  const exitLabel = t.exit === "deadline" ? "deadline reached" : t.exit === "frontier" ? (t.id === "cursor-walk" ? "cursor at the end" : "nothing left open") : "";
  const nodes = [
    n("start", "Start", "start", "/command [duration] [focus]"),
    n("pass", "Pass", "pass", "the agent does the task and records it in the ledger"),
    judged
      ? n("judge", "xor judge", "judge", t.question ? `"${t.question.placeholder}"` : "asks the finish question")
      : n("checker", "Checker", "checker", "a second agent verifies the pass's findings"),
    n("report", "Final report", "report", "the agent writes and delivers the report"),
    n("done", "Done", "end", "posted to the thread"),
  ];
  const edges = judged
    ? [
        e("start", "pass", ""),
        e("pass", "judge", "pass finished"),
        e("judge", "pass", t.question?.retryWhen ? "yes → fix and retry" : "no → go again"),
        e("judge", "report", t.question?.retryWhen ? "no, unsure or out of retries" : "yes, unsure or out of retries"),
        e("report", "done", ""),
      ]
    : [
        e("start", "pass", ""),
        e("pass", "checker", "pass finished"),
        e("checker", "pass", "keep going"),
        e("checker", "report", exitLabel),
        ...(t.exit === "frontier" && t.id !== "cursor-walk" ? [e("pass", "report", "safety cap", true)] : []),
        e("report", "done", ""),
      ];
  return { nodes: layout(nodes, edges, "TB"), edges };
}
