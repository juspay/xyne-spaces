import type { DestinationKind, EffectClass, TrustTier } from "./types.js";

export interface ToolAnnotations {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
  openWorldHint?: boolean | undefined;
}

export interface ToolDescriptorInput {
  /** The tool's own name (the MCP tool name for MCP tools, the pi name for claw-local tools). */
  toolName: string;
  /** The MCP server type; absent for claw-local tools. */
  serverType?: string | undefined;
  /** Declared by claw-auth's write policy or the gateway catalog: true raises to write, false settles an unknown verb as read. */
  writeTool?: boolean | undefined;
  annotations?: ToolAnnotations | undefined;
  /** Defaults to reviewed: every server that existed before trust tiers shipped. */
  trustTier?: TrustTier | undefined;
  /** The call's arguments, searched for hosts the data would reach. */
  args?: unknown;
}

export interface ToolDescriptor {
  effect: EffectClass | "unknown";
  destination: { kind: DestinationKind; host?: string };
  /** What settled the effect; "unknown" counts as an external send and a write at the gate. */
  source: "first_party" | "policy" | "annotations" | "verb" | "unknown";
  /** The tool answers with mail, messages or files a person did not type. */
  returnsPrivateData: boolean;
}

/** Servers that run inside the platform; their calls never leave the org. */
const FIRST_PARTY_SERVERS: ReadonlySet<string> = new Set([
  "xyne-spaces", "xyne-spaces-app-tools", "xyne-dashboard", "xyne-workflows", "knowledge-base", "memory", "agent-tools", "skill",
]);
const PRIVATE_DATA_SERVERS: ReadonlySet<string> = new Set(["google", "microsoft", "slack", "whatsapp", "telegram", "xyne-spaces"]);

/** claw-local tools, classified in code. */
const LOCAL_TOOLS: Readonly<Record<string, EffectClass>> = {
  read: "read", grep: "read", find: "read", ls: "read", glob: "read", "read-memory-file": "read", "task-status": "read", "load-tools": "read",
  write: "write", edit: "write", "suggest-goal": "write", "task-stop": "write",
  bash: "execute", "sandbox-run": "execute",
  "write-memory-file": "persist", "create-skill": "persist",
  "xyne-claw": "publish", "call-agent": "publish", "twin-deliver": "publish",
};

const VERBS: ReadonlyArray<[RegExp, EffectClass]> = [
  [/^(delete|remove|destroy|purge|drop|archive|unlink|revoke|trash|discard)$/, "delete"],
  [/^(send|post|publish|reply|email|mail|message|notify|comment|share|invite|announce|broadcast|tweet|dm)$/, "publish"],
  [/^(run|execute|exec|invoke|trigger|deploy|restart|start|stop|kill|rerun|build|launch|rollback)$/, "execute"],
  [/^(save|store|remember|persist|memorize|pin)$/, "persist"],
  [/^(grant|promote|demote|permission|permissions|role|roles|admin|configure|settings)$/, "admin"],
  [/^(create|update|edit|set|add|put|patch|upload|move|rename|write|modify|change|insert|append|merge|approve|reject|assign|close|open|resolve|transition|label|tag|submit|schedule|cancel|import|sync|star|unstar|fork|push|commit)$/, "write"],
  [/^(get|list|search|find|fetch|read|describe|query|show|view|lookup|check|count|retrieve|browse|head|download|export|summarize|analyze|analyse|compare|preview|status|history|info|detail|details|whoami|me|ping|health|version|echo|validate|verify|exists|current|who)$/, "read"],
];

const INTERNAL_HOSTS = /(^|\.)(localhost|internal|local|svc|cluster\.local)$/i;
const URL_IN_TEXT = /https?:\/\/([a-z0-9.-]{1,253})(?::\d{1,5})?(?=[/?#\s"'<>]|$)/gi;

function effectFromVerb(toolName: string): EffectClass | undefined {
  for (const token of toolName.toLowerCase().split(/[^a-z0-9]+/)) {
    for (const [re, effect] of VERBS) if (re.test(token)) return effect;
  }
  return undefined;
}

const RANK: Readonly<Record<EffectClass | "unknown", number>> = { read: 0, write: 1, persist: 2, publish: 3, send: 4, execute: 5, delete: 6, admin: 7, unknown: 1 };
const raise = (current: EffectClass | "unknown", to: EffectClass): EffectClass | "unknown" => (current === "unknown" || RANK[to] > RANK[current] ? to : current);

/** The first host in the arguments that is not an internal address, searching at most 64 KB of them. */
export function externalHostInArgs(args: unknown): string | undefined {
  let text: string;
  try {
    text = typeof args === "string" ? args : JSON.stringify(args ?? "");
  } catch {
    return undefined;
  }
  URL_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  const bounded = text.slice(0, 65_536);
  while ((m = URL_IN_TEXT.exec(bounded)) !== null) {
    const host = m[1]!.toLowerCase();
    if (!INTERNAL_HOSTS.test(host) && !/^(10|127|0)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return host;
  }
  return undefined;
}

/**
 * One classification for every tool the gate sees: first-party tools from a code table, MCP tools from
 * their declared write policy and verb, raised by annotations but never lowered. Unknown stays unknown,
 * which decide() treats as an external send and a write.
 */
export function resolveToolDescriptor(input: ToolDescriptorInput): ToolDescriptor {
  const { toolName, serverType } = input;
  let effect: EffectClass | "unknown" = "unknown";
  let source: ToolDescriptor["source"] = "unknown";
  if (serverType === undefined && Object.hasOwn(LOCAL_TOOLS, toolName)) {
    effect = LOCAL_TOOLS[toolName]!;
    source = "first_party";
  } else {
    const verb = effectFromVerb(toolName);
    if (verb !== undefined) {
      effect = verb;
      source = "verb";
    }
    if (input.writeTool === true) {
      effect = raise(effect, "write");
      if (source === "unknown") source = "policy";
    } else if (input.writeTool === false && effect === "unknown") {
      effect = "read";
      source = "policy";
    }
  }
  if (input.annotations?.destructiveHint === true) {
    effect = raise(effect, "delete");
    if (source === "unknown") source = "annotations";
  }

  const firstParty = serverType === undefined || FIRST_PARTY_SERVERS.has(serverType);
  const tier = input.trustTier ?? (firstParty ? "trusted" : "reviewed");
  const host = externalHostInArgs(input.args);
  let destination: ToolDescriptor["destination"];
  if (host !== undefined) destination = { kind: "external", host };
  else if (input.annotations?.openWorldHint === true) destination = { kind: "external" };
  else if (tier === "trusted") destination = { kind: "internal" };
  else destination = { kind: "untrusted_mcp" };
  // A publish whose data leaves the org is a send; a web fetch is a read whose destination makes it one at the gate.
  if (effect === "publish" && destination.kind !== "internal") effect = "send";

  const returnsPrivateData = serverType !== undefined && PRIVATE_DATA_SERVERS.has(serverType) && effect === "read";
  return { effect, destination, source, returnsPrivateData };
}
