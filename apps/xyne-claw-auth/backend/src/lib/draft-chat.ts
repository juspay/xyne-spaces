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

/** Test runs of an unsaved draft have no approval surface, so writes are blocked. */
export const DRAFT_TEST_RUN_NOTE =
  "This is a test run of an unsaved agent draft. Write actions (sending, posting, creating, editing, deleting) are blocked; describe what you would do instead.";

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

  const notes: string[] = [DRAFT_TEST_RUN_NOTE];
  if (tools.gateway.length > 0) {
    notes.push(
      `Selected MCP connections are not available until this agent is saved: ${tools.gateway.join(", ")}.`,
    );
  }
  if (snapshot.kbScope === "USER") {
    notes.push("The user selected their whole knowledge base for this agent.");
  } else if (snapshot.knowledgeBase.length > 0) {
    const labels = snapshot.knowledgeBase.map(grant => grant.name || grant.collectionId).filter(Boolean);
    if (labels.length > 0) {
      notes.push(`Selected knowledge collections (not mounted on a draft run): ${labels.join(", ")}.`);
    }
  }
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
    systemPrompt: persona,
    agentConfig: {
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
