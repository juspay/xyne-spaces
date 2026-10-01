import { parseGatewayCatalogSource } from "../mcpgateway/key-format.js";
import { SPACES_SESSION_CREDENTIAL_SERVER_TYPES } from "./spaces-session-server-types.js";

export interface DraftChatTools {
  subagents: string[];
  direct: string[];
  custom: string[];
  gateway: string[];
  callableAgents: string[];
}

export interface DraftKnowledgeGrant {
  collectionId?: string;
  fileId?: string | null;
  name?: string;
}

export interface DraftChatSnapshot {
  name: string;
  description: string;
  systemPrompt: string;
  tools: DraftChatTools;
  skillIds: string[];
  kbScope: "COLLECTIONS" | "USER";
  knowledgeBase: DraftKnowledgeGrant[];
}

export interface DraftSkillPayload {
  slug?: string;
  name: string;
  description?: string;
  content: string;
}

/** A file sent with one test message; claw /run takes this shape as-is. */
export interface DraftAttachment {
  fileName: string;
  mimeType: string;
  data: string;
}

/** Same caps as the Ask AI composer. */
export const DRAFT_ATTACHMENT_MAX_COUNT = 20;
export const DRAFT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const EMPTY_TOOLS: DraftChatTools = {
  subagents: [],
  direct: [],
  custom: [],
  gateway: [],
  callableAgents: [],
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/** Parses the create-form snapshot. Returns null when the shape is unusable. */
export function parseDraftSnapshot(value: unknown): DraftChatSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const toolsRaw = raw["tools"] && typeof raw["tools"] === "object"
    ? (raw["tools"] as Record<string, unknown>)
    : {};
  const kbScope = raw["kbScope"] === "USER" ? "USER" : "COLLECTIONS";
  const knowledgeBase = Array.isArray(raw["knowledgeBase"])
    ? raw["knowledgeBase"].flatMap((item): DraftKnowledgeGrant[] => {
        if (!item || typeof item !== "object") return [];
        const grant = item as Record<string, unknown>;
        const collectionId = typeof grant["collectionId"] === "string" ? grant["collectionId"] : undefined;
        if (!collectionId) return [];
        return [{
          collectionId,
          fileId: typeof grant["fileId"] === "string" ? grant["fileId"] : null,
          ...(typeof grant["name"] === "string" ? { name: grant["name"] } : {}),
        }];
      })
    : [];
  return {
    name: typeof raw["name"] === "string" ? raw["name"] : "",
    description: typeof raw["description"] === "string" ? raw["description"] : "",
    systemPrompt: typeof raw["systemPrompt"] === "string" ? raw["systemPrompt"] : "",
    tools: {
      subagents: stringList(toolsRaw["subagents"]),
      direct: stringList(toolsRaw["direct"]),
      custom: stringList(toolsRaw["custom"]),
      gateway: stringList(toolsRaw["gateway"]),
      callableAgents: stringList(toolsRaw["callableAgents"]),
    },
    skillIds: stringList(raw["skillIds"]),
    kbScope,
    knowledgeBase,
  };
}

/**
 * Files for one test message. Missing means none; null means the list is
 * malformed or over the count / size caps.
 */
export function parseDraftAttachments(value: unknown): DraftAttachment[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > DRAFT_ATTACHMENT_MAX_COUNT) return null;
  let bytes = 0;
  const files: DraftAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const raw = item as Record<string, unknown>;
    const fileName = typeof raw["fileName"] === "string" ? raw["fileName"].trim() : "";
    const mimeType = typeof raw["mimeType"] === "string" ? raw["mimeType"].trim() : "";
    const data = typeof raw["data"] === "string" ? raw["data"] : "";
    if (!fileName || !mimeType || !data || data.length % 4 !== 0 || !BASE64.test(data)) return null;
    bytes += (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (bytes > DRAFT_ATTACHMENT_MAX_BYTES) return null;
    files.push({ fileName: fileName.slice(0, 255), mimeType, data });
  }
  return files;
}

export function draftAgentSlug(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return `draft-${safe || "user"}`;
}

/**
 * Test runs of an unsaved draft have no approval surface, so writes are
 * blocked. Worded so ordinary chat stays ordinary: the model should only bring
 * up the test when a request runs into it.
 */
export const DRAFT_TEST_RUN_NOTE =
  "You're being tried out in a test chat before the agent is saved. Talk normally and answer what was asked: a greeting gets a greeting back, a general question gets an answer. Don't bring up the test, your setup or what you can't do unless the request runs into it. You can't send, post, create, edit or delete anything in this test; if asked to, say what you would do. Work quietly: never narrate searching for, loading or delegating to tools, and never mention tool names, catalogs, MCP servers or subagents. Only the answer reaches the user.";

/**
 * Persona for a draft with no name, description or instructions. It is still
 * a model that can talk; it just has nothing to do the job with yet.
 */
export const DRAFT_BLANK_PERSONA =
  "You are a brand-new agent that hasn't been set up yet: no name, no instructions, and only the capabilities listed under \"What this test run can use\". You can still hold a normal conversation. Greet people, make small talk, answer general questions from what you know, and help with things that need no tools or live data, like explaining something or drafting a message. Don't volunteer what you can't do. Only when someone asks for something that needs data or an app you don't have, say so plainly in a sentence, the way a person would, and mention what would let you do it.";

/** claw adds its capability-gap tool to runs whose agentConfig carries this flag. */
export const DRAFT_TEST_RUN_FLAG = "draftTestRun";
export const CAPABILITY_GAP_TOOL = "report_capability_gap";

/**
 * The user's date and time, which claw doesn't give the model on its own.
 * An unknown or missing time zone falls back to UTC.
 */
export function currentTimeNote(timeZone: string | undefined, now: Date = new Date()): string {
  let zone = "UTC";
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone });
      zone = timeZone;
    } catch {
      // Not an IANA zone; keep UTC.
    }
  }
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return `For the user it is ${text} (${zone}).`;
}

/** The org's capability catalog, cut down to what the test-run summary needs. */
export interface DraftCapabilityCatalog {
  integrations: Array<{
    slug: string;
    label: string;
    kind: string;
    readTools: Array<{ slug: string; name: string }>;
    writeTools: Array<{ slug: string; name: string }>;
  }>;
  subagents: Array<{ name: string; description: string; serverType?: string | undefined }>;
  /** Skills the user can see, by name. */
  skillNames: string[];
  /**
   * MCP server types that need an account, and the ones this user can use
   * (their own connection or the org's shared one). Absent means unknown, and
   * every added server is treated as usable.
   */
  connections?: { serverTypes: string[]; connected: string[] } | null | undefined;
}

/** Longest "can be added" list per kind, so a big org doesn't flood the prompt. */
const ADDABLE_LIST_MAX = 40;

function capList(names: string[]): string {
  const shown = names.slice(0, ADDABLE_LIST_MAX).join(", ");
  return names.length > ADDABLE_LIST_MAX ? `${shown}, and ${names.length - ADDABLE_LIST_MAX} more` : shown;
}

/**
 * What the test run can use, sorted by whether it works now, connects only
 * after save, or is read-only while testing, plus what could be added. The
 * model names gaps from this list, and the Add button sends that name to the
 * Build chat, so names come from the catalog whenever the catalog knows them.
 */
export function describeDraftCapabilities(input: {
  snapshot: DraftChatSnapshot;
  /** Built-in tools on for this message, with the composer switches folded in. */
  custom: string[];
  /** Names of the selected skills that loaded. */
  skillNames: string[];
  catalog?: DraftCapabilityCatalog | null | undefined;
}): string {
  const { snapshot, catalog } = input;
  const tools = snapshot.tools ?? EMPTY_TOOLS;
  type Integration = DraftCapabilityCatalog["integrations"][number];
  const byKey = new Map<string, { integration: Integration; name: string; write: boolean }>();
  const byService = new Map<string, Integration[]>();
  for (const integration of catalog?.integrations ?? []) {
    for (const [list, write] of [[integration.readTools, false], [integration.writeTools, true]] as const) {
      for (const tool of list) {
        byKey.set(tool.slug, { integration, name: tool.name, write });
        if (!byKey.has(tool.name)) byKey.set(tool.name, { integration, name: tool.name, write });
        // A name two connectors share is picked with its connector in front (github__merge_pull_request).
        byKey.set(`${integration.slug}__${tool.name}`, { integration, name: tool.name, write });
      }
    }
    const service = integration.kind === "gateway" ? parseGatewayCatalogSource(integration.slug)?.serviceName : null;
    if (service) byService.set(service, [...(byService.get(service) ?? []), integration]);
  }

  const picked = new Map<string, { integration: Integration; read: string[]; write: string[] }>();
  const pick = (integration: Integration) => {
    const entry = picked.get(integration.slug) ?? { integration, read: [], write: [] };
    picked.set(integration.slug, entry);
    return entry;
  };
  const unknownTools: string[] = [];
  const unknownServices: string[] = [];
  for (const key of [...tools.direct, ...input.custom]) {
    const hit = byKey.get(key);
    if (!hit) {
      unknownTools.push(key);
      continue;
    }
    const entry = pick(hit.integration);
    (hit.write ? entry.write : entry.read).push(hit.name);
  }
  for (const service of tools.gateway) {
    const integrations = byService.get(service);
    if (!integrations) {
      unknownServices.push(service);
      continue;
    }
    for (const integration of integrations) pick(integration);
  }

  const needsAccount = new Set(catalog?.connections?.serverTypes ?? []);
  const connected = new Set(catalog?.connections?.connected ?? []);
  // Spaces, Dashboard and Workflows run on the user's Spaces sign-in, never a stored connection.
  const unconnected = (serverType: string | undefined): boolean =>
    Boolean(
      serverType &&
        needsAccount.has(serverType) &&
        !connected.has(serverType) &&
        !SPACES_SESSION_CREDENTIAL_SERVER_TYPES.has(serverType),
    );

  const works: string[] = [];
  const afterSave: string[] = [];
  const notConnected: string[] = [];
  const writesBlocked: string[] = [];
  for (const { integration, read, write } of picked.values()) {
    // Gateway connections live on AgentMcpConnection, which only exists once the agent is saved.
    if (integration.kind === "gateway") {
      afterSave.push(integration.label);
      continue;
    }
    // Its tools don't load without the user's account, saved or not.
    if (integration.kind === "mcp" && unconnected(integration.slug)) {
      notConnected.push(integration.label);
      continue;
    }
    if (read.length > 0) works.push(`${integration.label} (${read.join(", ")})`);
    if (write.length > 0) writesBlocked.push(`${integration.label} (${write.join(", ")})`);
  }
  if (unknownTools.length > 0) works.push(`Tools: ${unknownTools.join(", ")}`);
  afterSave.push(...unknownServices);
  const subagentInfo = new Map((catalog?.subagents ?? []).map(subagent => [subagent.name, subagent]));
  for (const name of tools.subagents) {
    const subagent = subagentInfo.get(name);
    if (unconnected(subagent?.serverType)) {
      notConnected.push(`${name} subagent`);
      continue;
    }
    const about = subagent?.description.trim();
    works.push(`${name} subagent${about ? `: ${about.slice(0, 120)}` : ""}`);
  }
  if (tools.callableAgents.length > 0) works.push(`Agents it can call: ${tools.callableAgents.join(", ")}`);
  for (const name of input.skillNames) works.push(`Skill: ${name}`);
  if (snapshot.kbScope === "USER") {
    afterSave.push("Knowledge: the user's whole knowledge base");
  } else {
    for (const grant of snapshot.knowledgeBase) {
      const label = grant.name || grant.collectionId;
      if (label) afterSave.push(`Knowledge: ${label}`);
    }
  }

  const lines = ["## What this test run can use", "Works in this test:"];
  const nothing = snapshot.systemPrompt.trim() ? "- Nothing beyond its instructions." : "- Nothing yet.";
  lines.push(...(works.length > 0 ? works.map(item => `- ${item}`) : [nothing]));
  if (notConnected.length > 0) {
    lines.push(
      "Added, but the user hasn't connected the account it needs, so its tools are not loaded in this run. Don't look for them:",
      ...notConnected.map(item => `- ${item}`),
    );
  }
  if (afterSave.length > 0) {
    lines.push("Added, but only connects after the agent is saved:", ...afterSave.map(item => `- ${item}`));
  }
  if (writesBlocked.length > 0) {
    lines.push(
      "Added, but read-only in this test (it can't send, post, create, edit or delete):",
      ...writesBlocked.map(item => `- ${item}`),
    );
  }
  if (catalog) {
    const addable = {
      integrations: catalog.integrations
        .filter(integration => integration.kind !== "builtin" && !picked.has(integration.slug))
        .map(integration => integration.label),
      subagents: catalog.subagents.map(subagent => subagent.name).filter(name => !tools.subagents.includes(name)),
      skills: catalog.skillNames.filter(name => !input.skillNames.includes(name)),
    };
    lines.push("Not on this agent, can be added (for naming a gap only; never recite this list):");
    if (addable.integrations.length > 0) lines.push(`- Integrations: ${capList(addable.integrations)}`);
    if (addable.subagents.length > 0) lines.push(`- Subagents: ${capList(addable.subagents)}`);
    if (addable.skills.length > 0) lines.push(`- Skills: ${capList(addable.skills)}`);
    lines.push("- Knowledge collections from the user's knowledge base");
  }
  lines.push(
    "",
    `Only when a request needs something missing, unconnected, not live until saved, or read-only here, call ${CAPABILITY_GAP_TOOL} once for each such capability before you write anything, so the reply doesn't narrate it: status "not_added" when the agent doesn't have it (${catalog ? "name the one from the list of what can be added that fits" : "name the product or capability it would need"}), "not_connected" when it is added but the account isn't connected, "after_save" when it is added but only connects after saving, "test_blocked" when the request would write. Use the names exactly as listed here. The user sees each call as a row under your reply, so don't list them again, and don't describe buttons, rows or anything else on screen: say in a sentence or two, in your own voice, what you can do now and what's missing. Don't call it for small talk or for questions you can answer from what you know. Never claim to have used a tool you don't have, and never make up results.`,
  );
  return lines.join("\n");
}

/**
 * Forward body for claw `/run`. No Agent row and no Spaces app identity.
 * MCP gateway ids are dropped: those connections live on AgentMcpConnection
 * and only exist after the agent is saved. The caller mints `sessionToken`
 * for `sessionId` (claw rejects runs without one).
 */
export function buildDraftRunBody(input: {
  sessionId: string;
  sessionToken: string;
  userId: string;
  userName?: string | undefined;
  userEmail?: string | undefined;
  orgId?: string | undefined;
  message: string;
  draftConversationId: string;
  snapshot: DraftChatSnapshot;
  skills?: DraftSkillPayload[] | undefined;
  attachments?: DraftAttachment[] | undefined;
  /** The composer's Web Search / Deep research switches, for this message only. */
  webSearch?: boolean | undefined;
  deepResearch?: boolean | undefined;
  /** The org's capabilities, so the model can tell missing from not-yet-connected. Optional: without it the summary uses raw ids. */
  catalog?: DraftCapabilityCatalog | null | undefined;
  /** The user's IANA time zone, for today's date and time. */
  timeZone?: string | undefined;
  now?: Date | undefined;
}): Record<string, unknown> {
  const snapshot = input.snapshot;
  const tools = snapshot.tools ?? EMPTY_TOOLS;
  const custom = [
    ...new Set([
      ...tools.custom,
      ...(input.webSearch ? ["web-search"] : []),
      ...(input.deepResearch ? ["deep-research"] : []),
    ]),
  ];
  const persona = [
    snapshot.systemPrompt.trim(),
    snapshot.name.trim() ? `Your name is ${snapshot.name.trim()}.` : "",
    snapshot.description.trim() ? `Description: ${snapshot.description.trim()}` : "",
  ].filter(part => part.length > 0).join("\n\n");

  const notes: string[] = [
    DRAFT_TEST_RUN_NOTE,
    currentTimeNote(input.timeZone, input.now),
    describeDraftCapabilities({
      snapshot,
      custom,
      skillNames: (input.skills ?? []).map(skill => skill.name),
      catalog: input.catalog,
    }),
  ];
  if (input.webSearch) {
    notes.push("The user turned on web search for this message: search the web with web-search before answering.");
  }
  if (input.deepResearch) {
    notes.push("The user turned on deep research for this message: use deep-research for a thorough, cited answer.");
  }

  return {
    sessionId: input.sessionId,
    sessionToken: input.sessionToken,
    idempotencyKey: input.sessionId,
    userId: input.userId,
    ...(input.userName ? { userName: input.userName } : {}),
    ...(input.userEmail ? { userEmail: input.userEmail } : {}),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    task: input.message.trim(),
    conversationId: input.draftConversationId,
    agentSlug: draftAgentSlug(input.userId),
    // An empty persona would make claw fall back to its Digital Twin prompt.
    systemPrompt: persona || DRAFT_BLANK_PERSONA,
    agentConfig: {
      [DRAFT_TEST_RUN_FLAG]: true,
      permissionMode: "read-only",
      tools: {
        subagents: tools.subagents,
        direct: tools.direct,
        custom,
        gateway: [],
      },
    },
    ...(tools.callableAgents.length > 0 ? { callableAgents: tools.callableAgents } : {}),
    ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    additionalInstructions: notes.join("\n"),
  };
}
