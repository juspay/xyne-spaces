import { randomUUID } from "node:crypto";

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

export function draftAgentSlug(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return `draft-${safe || "user"}`;
}

/**
 * Forward body for claw `/run`. No Agent row and no Spaces app identity.
 * MCP gateway ids are dropped: those connections live on AgentMcpConnection
 * and only exist after the agent is saved.
 */
export function buildDraftRunBody(input: {
  userId: string;
  userName?: string | undefined;
  userEmail?: string | undefined;
  orgId?: string | undefined;
  message: string;
  draftConversationId: string;
  snapshot: DraftChatSnapshot;
  skills?: DraftSkillPayload[] | undefined;
}): Record<string, unknown> {
  const snapshot = input.snapshot;
  const tools = snapshot.tools ?? EMPTY_TOOLS;
  const persona = [
    snapshot.systemPrompt.trim(),
    snapshot.name.trim() ? `Your name is ${snapshot.name.trim()}.` : "",
    snapshot.description.trim() ? `Description: ${snapshot.description.trim()}` : "",
  ].filter(part => part.length > 0).join("\n\n");

  const notes: string[] = [];
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

  return {
    sessionId: randomUUID(),
    userId: input.userId,
    ...(input.userName ? { userName: input.userName } : {}),
    ...(input.userEmail ? { userEmail: input.userEmail } : {}),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    task: input.message.trim(),
    conversationId: input.draftConversationId,
    agentSlug: draftAgentSlug(input.userId),
    systemPrompt: persona,
    agentConfig: {
      tools: {
        subagents: tools.subagents,
        direct: tools.direct,
        custom: tools.custom,
        gateway: [],
      },
    },
    ...(tools.callableAgents.length > 0 ? { callableAgents: tools.callableAgents } : {}),
    ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
    ...(notes.length > 0 ? { additionalInstructions: notes.join("\n") } : {}),
  };
}
