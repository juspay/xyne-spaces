import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("loop-graph");

export type LoopNodeKind = "pass" | "checker" | "decide" | "report" | "end" | "wait";

export interface LoopNodeResult<L, O> {
  ledger?: L;
  output?: O;
}

export interface LoopNode<L, C, O> {
  kind: LoopNodeKind;
  run?: (ledger: L, ctx: C) => Promise<LoopNodeResult<L, O> | void>;
}

export interface LoopEdge<L, C> {
  from: string | "*";
  on: string;
  to: string;
  label: string;
  when?: (ledger: L, ctx: C) => boolean | Promise<boolean>;
}

export interface LoopPolicy<L> {
  deadline?: (ledger: L) => Date | null;
  graceAfterDeadlineMs?: number;
  maxPasses?: (ledger: L) => number | null;
  passes?: (ledger: L) => number;
  minPassMs?: number;
  staleAfterMs?: number;
  onTimeout?: "report" | "stop";
}

export interface LoopSpec<L, C, O = unknown> {
  id: string;
  nodes: Record<string, LoopNode<L, C, O>>;
  edges: Array<LoopEdge<L, C>>;
  policy: LoopPolicy<L>;
}

export interface LoopStep<L, O> {
  path: string[];
  labels: string[];
  stoppedAt: string | null;
  ledger: L;
  output?: O;
}

const CHAINING_KINDS = new Set<LoopNodeKind>(["checker", "decide"]);
export const CHAIN_EVENT = "done";
const MAX_CHAIN = 16;

export function pastDeadline<L>(policy: LoopPolicy<L>, ledger: L, now: number): boolean {
  const deadline = policy.deadline?.(ledger);
  return deadline ? now >= deadline.getTime() : false;
}

export function pastHardStop<L>(policy: LoopPolicy<L>, ledger: L, now: number): boolean {
  const deadline = policy.deadline?.(ledger);
  return deadline ? now > deadline.getTime() + (policy.graceAfterDeadlineMs ?? 0) : false;
}

export function passesExhausted<L>(policy: LoopPolicy<L>, ledger: L): boolean {
  const max = policy.maxPasses?.(ledger);
  const passes = policy.passes?.(ledger);
  return max != null && passes != null && passes >= max;
}

async function pickEdge<L, C>(
  spec: LoopSpec<L, C, unknown>,
  from: string,
  on: string,
  ledger: L,
  ctx: C,
): Promise<LoopEdge<L, C> | null> {
  for (const edge of spec.edges) {
    if (edge.on !== on || (edge.from !== from && edge.from !== "*")) continue;
    if (!edge.when || (await edge.when(ledger, ctx))) return edge;
  }
  return null;
}

export async function advanceLoop<L, C, O>(
  spec: LoopSpec<L, C, O>,
  args: { from: string; on: string; ledger: L; ctx: C },
): Promise<LoopStep<L, O>> {
  let current = args.from;
  let event = args.on;
  let ledger = args.ledger;
  const path: string[] = [];
  const labels: string[] = [];
  for (let hop = 0; hop < MAX_CHAIN; hop++) {
    const edge = await pickEdge(spec as LoopSpec<L, C, unknown>, current, event, ledger, args.ctx);
    if (!edge) {
      log.debug(`[loop] spec=${spec.id} from=${current} on=${event} no edge — waiting`);
      return { path, labels, stoppedAt: null, ledger };
    }
    const node = spec.nodes[edge.to];
    if (!node) throw new Error(`[loop] spec=${spec.id} edge "${edge.label}" targets unknown node ${edge.to}`);
    path.push(edge.to);
    labels.push(edge.label);
    const line = `[loop] spec=${spec.id} ${current} --${edge.label}--> ${edge.to}`;
    if (node.kind === "wait") log.debug(line);
    else log.info(line);
    if (node.kind === "checker") {
      const pending = node.run?.(ledger, args.ctx);
      void Promise.resolve(pending).catch((err) => {
        log.warn(`[loop] spec=${spec.id} background node ${edge.to} failed: ${errMsg(err)}`);
      });
    } else {
      const result = await node.run?.(ledger, args.ctx);
      if (result?.ledger !== undefined) ledger = result.ledger;
      if (!CHAINING_KINDS.has(node.kind)) {
        return { path, labels, stoppedAt: edge.to, ledger, ...(result?.output !== undefined ? { output: result.output } : {}) };
      }
    }
    current = edge.to;
    event = CHAIN_EVENT;
  }
  throw new Error(`[loop] spec=${spec.id} exceeded ${MAX_CHAIN} chained nodes from ${args.from}`);
}

export function validateLoopSpec(spec: LoopSpec<unknown, unknown, unknown>): string[] {
  const problems: string[] = [];
  for (const edge of spec.edges) {
    if (!spec.nodes[edge.to]) problems.push(`edge "${edge.label}" targets unknown node ${edge.to}`);
    if (edge.from !== "*" && !spec.nodes[edge.from]) problems.push(`edge "${edge.label}" starts at unknown node ${edge.from}`);
  }
  for (const [id, node] of Object.entries(spec.nodes)) {
    if (CHAINING_KINDS.has(node.kind) && !spec.edges.some((e) => e.from === id && e.on === CHAIN_EVENT && !e.when)) {
      problems.push(`${node.kind} node ${id} has no unconditional "${CHAIN_EVENT}" edge`);
    }
  }
  return problems;
}
