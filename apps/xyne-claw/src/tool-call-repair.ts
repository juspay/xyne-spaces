/**
 * Tool-call repair BEFORE pi's gate (XYNE-66597).
 *
 * pi-agent-core looks a call's name up in the turn's tool list and answers a
 * miss with a bare "Tool X not found" — the model then spends a full round on
 * a call that was one prefix away from right. pi has no hook before that
 * lookup, so this wraps the agent's streamFn and edits the FINISHED assistant
 * message (the `done` event / `result()`), which is the same object pi then
 * executes and persists:
 *
 *  1. A name that matches exactly one callable tool once the server prefix is
 *     ignored (short name, `App_Tools` prefix mix-up, case/separator drift) is
 *     renamed to that tool.
 *  2. A catalog tool the model called without loading it is loaded on the spot
 *     and added to this turn's tool list (`autoLoad`, the `tool_auto_load`
 *     switch) — pi's context.tools is the array the streamFn receives, so the
 *     gate sees it in the same turn.
 *  3. Anything else gets a stand-in tool for this turn only, whose result says
 *     what to do instead (closest names, load-tools, plan tracking off). The
 *     text keeps pi's "Tool X not found" prefix so claw-auth's tool stats still
 *     count it as a palette miss. Stand-ins are removed from the list at the
 *     start of the next model call.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("tool-call-repair");

type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

const STAND_IN = Symbol.for("xyne.toolCallRepair.standIn");
const PLAN_TOOL_NAMES = new Set(["todo-write", "todo-read"]);
const MIN_SUFFIX_MATCH = 6;

export type ToolNameResolution =
  | { kind: "active" }
  | { kind: "renamed"; name: string; inCatalog: boolean }
  | { kind: "catalog"; name: string }
  | { kind: "unknown"; closest: string[] };

/** The tool part of a prefixed name: `Xyne_Spaces__spaces-emails` → `spaces-emails`. */
function bareName(name: string): string {
  const i = name.lastIndexOf("__");
  return i >= 0 ? name.slice(i + 2) : name;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

function similarity(a: string, b: string): number {
  const x = bigrams(normalize(a));
  const y = bigrams(normalize(b));
  if (x.length === 0 || y.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1);
  let shared = 0;
  for (const g of x) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      shared += 1;
      pool.set(g, n - 1);
    }
  }
  return (2 * shared) / (x.length + y.length);
}

/** One match wins; among several, the only already-loaded one wins. */
function pickOne(matches: string[], active: ReadonlySet<string>): string | undefined {
  if (matches.length === 1) return matches[0];
  const loaded = matches.filter((n) => active.has(n));
  return loaded.length === 1 ? loaded[0] : undefined;
}

/**
 * Map a called name onto the run's tools. Exported for tests.
 * `active` = callable this turn; `catalog` = loadable with load-tools.
 */
export function resolveToolName(
  called: string,
  active: ReadonlySet<string>,
  catalog: ReadonlySet<string>,
): ToolNameResolution {
  if (active.has(called)) return { kind: "active" };
  if (catalog.has(called)) return { kind: "catalog", name: called };
  const candidates = [...new Set([...active, ...catalog])];
  const wantedBare = normalize(bareName(called));
  const wantedFull = normalize(called);
  const renamedTo = (name: string): ToolNameResolution => ({ kind: "renamed", name, inCatalog: !active.has(name) });

  if (wantedBare) {
    const sameBare = pickOne(candidates.filter((c) => normalize(bareName(c)) === wantedBare), active);
    if (sameBare) return renamedTo(sameBare);
  }
  // `Notion_notion-search` ends with both `notion-search` and a bare `search`:
  // only the longest (most specific) tool names compete.
  const suffixMatches = candidates.filter((c) => {
    const bare = normalize(bareName(c));
    return bare.length >= MIN_SUFFIX_MATCH && wantedFull.endsWith(bare);
  });
  const longest = Math.max(0, ...suffixMatches.map((c) => normalize(bareName(c)).length));
  const suffix = pickOne(suffixMatches.filter((c) => normalize(bareName(c)).length === longest), active);
  if (suffix) return renamedTo(suffix);

  const closest = candidates
    .map((name) => ({ name, score: Math.max(similarity(called, name), similarity(bareName(called), bareName(name))) }))
    .filter((c) => c.score >= 0.4)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((c) => c.name);
  return { kind: "unknown", closest };
}

/** The result text for a call that cannot run. Starts with pi's own wording. */
export function notFoundMessage(
  called: string,
  resolution: ToolNameResolution,
  opts: { searchTools: boolean },
): string {
  const head = `Tool ${called} not found`;
  if (resolution.kind === "catalog" || (resolution.kind === "renamed" && resolution.inCatalog)) {
    const name = resolution.name;
    return `${head} among the loaded tools. ${name === called ? "It" : `\`${name}\``} is in your catalog: call load-tools({ "names": ["${name}"] }) and call it on your next turn.`;
  }
  if (PLAN_TOOL_NAMES.has(called)) {
    return `${head}: plan tracking is off for this reply. Continue the work without a plan.`;
  }
  const closest = resolution.kind === "unknown" ? resolution.closest : [];
  const parts = [`${head}.`];
  if (closest.length > 0) parts.push(`Closest tools you can call: ${closest.join(", ")}.`);
  parts.push(opts.searchTools ? "Use search-tools to find the right one." : "Use only tool names from your tool list.");
  return parts.join(" ");
}

function standInTool(name: string, message: string): AgentTool {
  const tool = {
    name,
    label: name,
    description: "",
    parameters: { type: "object" },
    execute: async (): Promise<never> => {
      throw new Error(message);
    },
    [STAND_IN]: true,
  };
  return tool as unknown as AgentTool;
}

function isStandIn(tool: unknown): boolean {
  return !!tool && typeof tool === "object" && (tool as Record<symbol, unknown>)[STAND_IN] === true;
}

function dropStandIns(tools: AgentTool[] | undefined): void {
  if (!tools) return;
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    if (isStandIn(tools[i])) tools.splice(i, 1);
  }
}

export interface ToolCallRepairOptions {
  /** Names loadable with load-tools this run. Read per turn. */
  catalogNames?: () => ReadonlySet<string>;
  /** Load catalog tools now (the run's load-tools controller). */
  loadTools?: (names: string[]) => Promise<{ loaded: string[]; alreadyLoaded: string[] }>;
  /** A loaded tool's object, once loadTools has put it in the agent's state. */
  findLoadedTool?: (name: string) => AgentTool | undefined;
  /** `tool_auto_load` — load a catalog tool on call instead of answering "load it first". */
  autoLoad?: () => boolean;
  /** Labels for the repair metric. */
  agentSlug?: string;
}

/** Repair every tool call of one finished assistant message, in place. */
export async function repairToolCalls(
  message: AssistantMessage,
  tools: AgentTool[],
  opts: ToolCallRepairOptions,
): Promise<void> {
  const calls = message.content.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall");
  if (calls.length === 0) return;
  const active = new Set(tools.filter((t) => !isStandIn(t)).map((t) => t.name));
  const catalog = opts.catalogNames?.() ?? new Set<string>();
  const standIns = new Set(tools.filter(isStandIn).map((t) => t.name));

  for (const call of calls) {
    if (active.has(call.name)) continue;
    const called = call.name;
    const resolution = resolveToolName(called, active, catalog);
    if (resolution.kind === "renamed" && !resolution.inCatalog) {
      call.name = resolution.name;
      metric.count("tool_call_repair", { repair: "name", agent: opts.agentSlug });
      log.info(`[tool-call-repair] renamed ${called} → ${resolution.name}`);
      continue;
    }
    const loadable = resolution.kind === "catalog" || (resolution.kind === "renamed" && resolution.inCatalog)
      ? resolution.name
      : undefined;
    if (loadable && opts.autoLoad?.() && opts.loadTools && opts.findLoadedTool) {
      try {
        const { loaded, alreadyLoaded } = await opts.loadTools([loadable]);
        const tool = loaded.includes(loadable) || alreadyLoaded.includes(loadable) ? opts.findLoadedTool(loadable) : undefined;
        if (tool) {
          if (!active.has(loadable)) tools.push(tool);
          active.add(loadable);
          call.name = loadable;
          metric.count("tool_call_repair", { repair: "auto_load", agent: opts.agentSlug });
          log.info(`[tool-call-repair] auto-loaded ${loadable}${loadable !== called ? ` (called as ${called})` : ""}`);
          continue;
        }
      } catch (err) {
        log.warn(`[tool-call-repair] auto-load of ${loadable} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (standIns.has(called)) continue;
    tools.push(standInTool(called, notFoundMessage(called, resolution, { searchTools: active.has("search-tools") })));
    standIns.add(called);
  }
}

function wrapStream(
  stream: AssistantMessageEventStream,
  repair: (message: AssistantMessage) => Promise<void>,
): AssistantMessageEventStream {
  const repaired = new WeakSet<AssistantMessage>();
  const once = async (message: AssistantMessage): Promise<void> => {
    if (repaired.has(message)) return;
    repaired.add(message);
    try {
      await repair(message);
    } catch (err) {
      log.warn(`[tool-call-repair] skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const resultPromise = stream.result().then(async (message) => {
    await once(message);
    return message;
  });
  const wrapped = {
    async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
      for await (const event of stream) {
        if (event.type === "done") await once(event.message);
        yield event;
      }
    },
    result(): Promise<AssistantMessage> {
      return resultPromise;
    },
  };
  return wrapped as AssistantMessageEventStream;
}

/**
 * Install on a pi Agent. Every streamFn wrapper in claw passes `context`
 * through untouched, so `context.tools` here is the loop's own turn list.
 */
export function installToolCallRepair(agent: { streamFn: StreamFn }, opts: ToolCallRepairOptions = {}): void {
  const base = agent.streamFn;
  agent.streamFn = (model, context, options) => {
    const tools = context.tools as AgentTool[] | undefined;
    dropStandIns(tools);
    return Promise.resolve(base(model, context, options)).then((stream) =>
      tools ? wrapStream(stream, (message) => repairToolCalls(message, tools, opts)) : stream,
    );
  };
}
