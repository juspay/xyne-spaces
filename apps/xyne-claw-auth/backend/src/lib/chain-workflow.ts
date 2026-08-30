import { createLogger } from "../logger.js";

const log = createLogger("chain-workflow");

export type ChainWorkflowEdgeMode = "always" | "tools" | "judge" | "commands";

export const CHAIN_EDGE_MODES: readonly ChainWorkflowEdgeMode[] = [
  "always",
  "tools",
  "judge",
  "commands",
];

export interface ChainWorkflowNode {
  id: string;
  agentSlug: string;
  taskTemplate?: string | undefined;
}

export interface ChainWorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  mode?: ChainWorkflowEdgeMode | undefined;
  toolsMustInclude?: string[] | undefined;
  toolsMustExclude?: string[] | undefined;
  commandsMustMatch?: string[] | undefined;
  commandsMustNotMatch?: string[] | undefined;
  judgeContext?: string | undefined;
  taskTemplate?: string | undefined;
}

export interface ChainWorkflowDefinition {
  version?: number | undefined;
  maxDepth?: number | undefined;
  nodes: ChainWorkflowNode[];
  edges: ChainWorkflowEdge[];
}

export interface ChainToolInvocationSummary {
  toolName: string;
  command?: string | undefined;
  isError?: boolean | undefined;
}

export const CHAIN_COMMAND_PATTERN_MAX_LENGTH = 200;
export const CHAIN_COMMAND_TEXT_MAX_LENGTH = 2000;
export const CHAIN_JUDGE_INVOCATION_LIMIT = 40;
export const CHAIN_JUDGE_COMMAND_EXCERPT_LENGTH = 200;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string");
}

function isEdgeMode(value: unknown): value is ChainWorkflowEdgeMode {
  return typeof value === "string" && (CHAIN_EDGE_MODES as readonly string[]).includes(value);
}

export function parseChainWorkflowDefinition(definition: unknown): ChainWorkflowDefinition | null {
  if (!definition || typeof definition !== "object") return null;

  const raw = definition as Record<string, unknown>;
  if (!Array.isArray(raw["nodes"]) || !Array.isArray(raw["edges"])) return null;

  const nodes: ChainWorkflowNode[] = raw["nodes"]
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .filter((n) => typeof n["id"] === "string" && typeof n["agentSlug"] === "string")
    .map((n) => ({
      id: n["id"] as string,
      agentSlug: n["agentSlug"] as string,
      ...(typeof n["taskTemplate"] === "string" ? { taskTemplate: n["taskTemplate"] } : {}),
    }));

  const edges: ChainWorkflowEdge[] = raw["edges"]
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .filter(
      (e) =>
        typeof e["id"] === "string" &&
        typeof e["fromNodeId"] === "string" &&
        typeof e["toNodeId"] === "string",
    )
    .map((e) => {
      const edge: ChainWorkflowEdge = {
        id: e["id"] as string,
        fromNodeId: e["fromNodeId"] as string,
        toNodeId: e["toNodeId"] as string,
      };
      if (isEdgeMode(e["mode"])) edge.mode = e["mode"];
      const include = toStringArray(e["toolsMustInclude"]);
      if (include) edge.toolsMustInclude = include;
      const exclude = toStringArray(e["toolsMustExclude"]);
      if (exclude) edge.toolsMustExclude = exclude;
      const cmdMatch = toStringArray(e["commandsMustMatch"]);
      if (cmdMatch) edge.commandsMustMatch = cmdMatch;
      const cmdNotMatch = toStringArray(e["commandsMustNotMatch"]);
      if (cmdNotMatch) edge.commandsMustNotMatch = cmdNotMatch;
      if (typeof e["judgeContext"] === "string") edge.judgeContext = e["judgeContext"];
      if (typeof e["taskTemplate"] === "string") edge.taskTemplate = e["taskTemplate"];
      return edge;
    });

  if (nodes.length === 0) return null;

  return {
    nodes,
    edges,
    ...(typeof raw["version"] === "number" ? { version: raw["version"] } : {}),
    ...(typeof raw["maxDepth"] === "number" ? { maxDepth: raw["maxDepth"] } : {}),
  };
}

export function resolveChainEdgeMode(edge: ChainWorkflowEdge): ChainWorkflowEdgeMode {
  if (edge.mode) return edge.mode;
  if (edge.commandsMustMatch?.length || edge.commandsMustNotMatch?.length) return "commands";
  if (edge.toolsMustInclude?.length || edge.toolsMustExclude?.length) return "tools";
  return "always";
}

export function validateChainWorkflowDefinition(definition: ChainWorkflowDefinition): string | null {
  if (definition.nodes.length === 0) return "workflow must include at least one node";

  const nodeIdSet = new Set<string>();
  for (const node of definition.nodes) {
    if (!node.id.trim()) return "node id is required";
    if (!node.agentSlug.trim()) return "node agentSlug is required";
    if (nodeIdSet.has(node.id)) return `duplicate node id: ${node.id}`;
    nodeIdSet.add(node.id);
  }

  for (const edge of definition.edges) {
    if (!nodeIdSet.has(edge.fromNodeId) || !nodeIdSet.has(edge.toNodeId)) {
      return `edge ${edge.id} references missing nodes`;
    }

    const mode = resolveChainEdgeMode(edge);

    if (mode === "judge" && !edge.judgeContext?.trim()) {
      return `edge ${edge.id} uses judge mode but has no judgeContext — describe when the chain should continue`;
    }

    if (mode === "tools" && !edge.toolsMustInclude?.length && !edge.toolsMustExclude?.length) {
      return `edge ${edge.id} uses tools mode but lists neither toolsMustInclude nor toolsMustExclude`;
    }

    if (mode === "commands" && !edge.commandsMustMatch?.length && !edge.commandsMustNotMatch?.length) {
      return `edge ${edge.id} uses commands mode but lists neither commandsMustMatch nor commandsMustNotMatch`;
    }

    for (const pattern of [...(edge.commandsMustMatch ?? []), ...(edge.commandsMustNotMatch ?? [])]) {
      if (pattern.length > CHAIN_COMMAND_PATTERN_MAX_LENGTH) {
        return `edge ${edge.id} has a command pattern longer than ${CHAIN_COMMAND_PATTERN_MAX_LENGTH} characters`;
      }
      if (pattern.length >= 2 && pattern.startsWith("/") && pattern.endsWith("/") && chainCommandRegexBodyIfSafe(pattern) === null) {
        return `edge ${edge.id} has an invalid or unsafe regex pattern: ${pattern}`;
      }
    }
  }

  if (definition.maxDepth !== undefined && (definition.maxDepth < 1 || definition.maxDepth > 50)) {
    return "maxDepth must be between 1 and 50";
  }

  return null;
}

export function evaluateChainToolConditions(
  conditions: { toolsMustInclude?: string[] | undefined; toolsMustExclude?: string[] | undefined } | undefined,
  toolsUsed: string[],
): boolean {
  if (!conditions) return true;

  if (conditions.toolsMustInclude?.length) {
    const allPresent = conditions.toolsMustInclude.every((t) => toolsUsed.includes(t));
    if (!allPresent) return false;
  }

  if (conditions.toolsMustExclude?.length) {
    const anyExcluded = conditions.toolsMustExclude.some((t) => toolsUsed.includes(t));
    if (anyExcluded) return false;
  }

  return true;
}

export function commandTextForInvocation(invocation: unknown): string {
  if (!invocation || typeof invocation !== "object") return "";
  const inv = invocation as Record<string, unknown>;
  const args = inv["args"];
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const direct = a["cmd"] ?? a["command"];
  if (typeof direct === "string") return direct.slice(0, CHAIN_COMMAND_TEXT_MAX_LENGTH);
  try {
    return JSON.stringify(args).slice(0, CHAIN_COMMAND_TEXT_MAX_LENGTH);
  } catch {
    return "";
  }
}

export function summarizeChainToolInvocations(raw: unknown): ChainToolInvocationSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: ChainToolInvocationSummary[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const inv = item as Record<string, unknown>;
    const toolName = typeof inv["toolName"] === "string" ? inv["toolName"] : "";
    if (!toolName) continue;
    const command = commandTextForInvocation(inv);
    out.push({
      toolName,
      ...(command ? { command: command.slice(0, CHAIN_JUDGE_COMMAND_EXCERPT_LENGTH) } : {}),
      ...(typeof inv["isError"] === "boolean" ? { isError: inv["isError"] } : {}),
    });
    if (out.length >= CHAIN_JUDGE_INVOCATION_LIMIT) break;
  }
  return out;
}

const NESTED_QUANTIFIER_RE = /\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)[+*{]/;
const CHAIN_COMMAND_MATCH_INPUT_LENGTH = 512;

export function chainCommandRegexBodyIfSafe(pattern: string): string | null {
  const body = pattern.slice(1, -1);
  if (!body) return null;
  if (NESTED_QUANTIFIER_RE.test(body)) return null;
  try {
    new RegExp(body, "i");
    return body;
  } catch {
    return null;
  }
}

export type ChainCommandPatternResult = "match" | "no-match" | "invalid";

export function chainCommandPatternMatches(pattern: string, commandText: string): ChainCommandPatternResult {
  if (!pattern) return "invalid";
  if (pattern.length > CHAIN_COMMAND_PATTERN_MAX_LENGTH) {
    log.warn(`[chain-commands] pattern exceeds ${CHAIN_COMMAND_PATTERN_MAX_LENGTH} chars, treating as invalid`);
    return "invalid";
  }

  const input = commandText.slice(0, CHAIN_COMMAND_MATCH_INPUT_LENGTH);
  const isRegex = pattern.length >= 2 && pattern.startsWith("/") && pattern.endsWith("/");
  if (!isRegex) {
    return input.toLowerCase().includes(pattern.toLowerCase()) ? "match" : "no-match";
  }

  const body = chainCommandRegexBodyIfSafe(pattern);
  if (body === null) {
    log.warn(`[chain-commands] rejected regex pattern ${pattern} (invalid or nested quantifier), treating as invalid`);
    return "invalid";
  }
  return new RegExp(body, "i").test(input) ? "match" : "no-match";
}

export function evaluateChainCommandConditions(
  conditions:
    | { commandsMustMatch?: string[] | undefined; commandsMustNotMatch?: string[] | undefined }
    | undefined,
  toolInvocations: unknown,
): boolean {
  if (!conditions) return true;

  const commandTexts = Array.isArray(toolInvocations)
    ? toolInvocations.map((inv) => {
        const name =
          inv && typeof inv === "object" && typeof (inv as Record<string, unknown>)["toolName"] === "string"
            ? ((inv as Record<string, unknown>)["toolName"] as string)
            : "";
        const text = commandTextForInvocation(inv);
        return `${name} ${text}`.trim();
      })
    : [];

  if (conditions.commandsMustMatch?.length) {
    const allMatched = conditions.commandsMustMatch.every((pattern) =>
      commandTexts.some((text) => chainCommandPatternMatches(pattern, text) === "match"),
    );
    if (!allMatched) return false;
  }

  if (conditions.commandsMustNotMatch?.length) {
    for (const pattern of conditions.commandsMustNotMatch) {
      for (const text of commandTexts) {
        const result = chainCommandPatternMatches(pattern, text);
        if (result === "match") return false;
        if (result === "invalid") {
          log.warn(`[chain-commands] mustNotMatch pattern ${pattern} is invalid — failing closed, not traversing`);
          return false;
        }
      }
      if (commandTexts.length === 0 && chainCommandPatternMatches(pattern, "") === "invalid") {
        log.warn(`[chain-commands] mustNotMatch pattern ${pattern} is invalid — failing closed, not traversing`);
        return false;
      }
    }
  }

  return true;
}
