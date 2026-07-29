import type { ToolDefinition } from "../types.js";

const MAX_KEYPOINTS_PER_SESSION = 20;
const MAX_KEYPOINTS_PER_CALL = 8;
const MAX_POINT_LENGTH = 500;
const MAX_LABEL_LENGTH = 120;
const CITATION_TTL_MS = 30 * 60 * 1000;
const MAX_CITATION_SESSIONS = 1_000;

export interface KeyPointCitation {
  /** Human-readable label for this citation (e.g., "Fetched messages", "Ticket JIRA-123") */
  label: string;
  /** What kind of resource this citation points to */
  kind: "thread" | "canvas" | "ticket" | "external";
  /** For kind="thread": channel ID */
  channelId?: string;
  /** For kind="thread": conversation ID */
  conversationId?: string;
  /** For kind="thread": display name of the channel (e.g., "testing-claw") */
  channelName?: string;
  /** For kind="thread": channel scope type: DEFAULT | DM | GROUP_DM | TICKET | DOCUMENT */
  channelType?: string;
  /** For kind="canvas": shareable view ID */
  viewAccessId?: string;
  /** For kind="ticket": display ID like "FOO-123" */
  ticketId?: string;
  /** For kind="external": absolute URL */
  url?: string;
}

export interface KeyPoint {
  /** The key point or claim that is being cited */
  point: string;
  /** Citation metadata for this key point */
  citation: KeyPointCitation;
}

/**
 * Storage for citations provided by the LLM via add_citations tool.
 * Key: sessionId, Value: array of keypoints with citations.
 */
interface CitationStoreEntry {
  keypoints: KeyPoint[];
  expiresAt: number;
}

const citationsBySessionId = new Map<string, CitationStoreEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function pruneExpiredCitations(now = Date.now()): void {
  for (const [sessionId, entry] of citationsBySessionId) {
    if (entry.expiresAt <= now) citationsBySessionId.delete(sessionId);
  }
  while (citationsBySessionId.size > MAX_CITATION_SESSIONS) {
    const oldestSessionId = citationsBySessionId.keys().next().value as
      | string
      | undefined;
    if (!oldestSessionId) break;
    citationsBySessionId.delete(oldestSessionId);
  }
}

function validateKeyPoint(value: unknown): KeyPoint | undefined {
  if (!isRecord(value)) return undefined;
  const point = asNonEmptyString(value["point"], MAX_POINT_LENGTH);
  const citation = isRecord(value["citation"]) ? value["citation"] : undefined;
  const label = asNonEmptyString(citation?.["label"], MAX_LABEL_LENGTH);
  const kind = citation?.["kind"];
  if (!point || !citation || !label) return undefined;
  if (
    kind !== "thread" &&
    kind !== "canvas" &&
    kind !== "ticket" &&
    kind !== "external"
  )
    return undefined;

  const normalized: KeyPoint = { point, citation: { label, kind } };
  const channelId = asNonEmptyString(citation["channelId"], MAX_LABEL_LENGTH);
  const conversationId = asNonEmptyString(
    citation["conversationId"],
    MAX_LABEL_LENGTH,
  );
  const channelName = asNonEmptyString(
    citation["channelName"],
    MAX_LABEL_LENGTH,
  );
  const channelType = asNonEmptyString(
    citation["channelType"],
    MAX_LABEL_LENGTH,
  );
  const viewAccessId = asNonEmptyString(
    citation["viewAccessId"],
    MAX_LABEL_LENGTH,
  );
  const ticketId = asNonEmptyString(citation["ticketId"], MAX_LABEL_LENGTH);
  const url = asNonEmptyString(citation["url"], 2_048);

  if (channelId) normalized.citation.channelId = channelId;
  if (conversationId) normalized.citation.conversationId = conversationId;
  if (channelName) normalized.citation.channelName = channelName;
  if (channelType) normalized.citation.channelType = channelType;
  if (viewAccessId) normalized.citation.viewAccessId = viewAccessId;
  if (ticketId) normalized.citation.ticketId = ticketId;
  if (url) normalized.citation.url = url;

  if (kind === "thread" && (!channelId || !conversationId)) return undefined;
  if (kind === "canvas" && !viewAccessId) return undefined;
  if (kind === "ticket" && (!ticketId || !channelId || !conversationId))
    return undefined;
  if (kind === "external" && (!url || !isSafeHttpUrl(url))) return undefined;

  return normalized;
}

function validateKeyPoints(value: unknown): KeyPoint[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_KEYPOINTS_PER_CALL
  )
    return undefined;
  const validated = value.map(validateKeyPoint);
  if (validated.some((item) => !item)) return undefined;
  return validated as KeyPoint[];
}

/**
 * Records citations for a session. Called by the add_citations tool execution.
 */
export function recordLlmCitations(
  sessionId: string,
  keypoints: KeyPoint[],
): void {
  if (!sessionId || !keypoints || keypoints.length === 0) return;

  pruneExpiredCitations();

  const existing = citationsBySessionId.get(sessionId)?.keypoints ?? [];
  citationsBySessionId.set(sessionId, {
    keypoints: [...existing, ...keypoints].slice(0, MAX_KEYPOINTS_PER_SESSION),
    expiresAt: Date.now() + CITATION_TTL_MS,
  });
}

/**
 * Retrieves and clears citations for a session.
 * Called by claw-auth after the agent run completes.
 */
export function takeLlmCitations(sessionId: string): KeyPoint[] | undefined {
  if (!sessionId) return undefined;

  pruneExpiredCitations();

  const found = citationsBySessionId.get(sessionId);
  if (!found) return undefined;

  citationsBySessionId.delete(sessionId);
  return found.keypoints.length > 0 ? found.keypoints : undefined;
}

/**
 * Gets citations without clearing them (for debugging/inspection).
 */
export function peekLlmCitations(sessionId: string): KeyPoint[] | undefined {
  pruneExpiredCitations();
  return citationsBySessionId.get(sessionId)?.keypoints;
}

export const addCitationsTool: ToolDefinition = {
  slug: "add-citations",
  name: "Add Citations",
  description:
    "Attach citations to key points in your response. Use this tool when you make claims " +
    "or statements that are backed by information from tool results. Each citation links " +
    "a specific claim to the relevant tool output. Call this tool ONCE at the end of your " +
    "response with all the key points and their corresponding citations.\n\n" +
    "IMPORTANT:\n" +
    "- Only cite sources that are ACTUALLY relevant to your claims\n" +
    "- Do NOT cite every tool result — only cite the ones that support specific claims\n" +
    "- Each keypoint should have exactly one citation (the most relevant source)\n" +
    "- The citation label should describe what was found, not just the tool name\n" +
    '- Be specific in labels: "Messages from #general channel" not just "messages"',
  source: "custom:add-citations",
  inputSchema: {
    type: "object",
    properties: {
      keypoints: {
        type: "array",
        minItems: 1,
        maxItems: MAX_KEYPOINTS_PER_CALL,
        description:
          "Array of key points with their citations. Each keypoint is a claim " +
          "from your response that is backed by a tool result.",
        items: {
          type: "object",
          properties: {
            point: {
              type: "string",
              minLength: 1,
              maxLength: MAX_POINT_LENGTH,
              description:
                "The key point or claim being cited (should be concise, 1-2 sentences max)",
            },
            citation: {
              type: "object",
              description: "Citation metadata for this key point",
              properties: {
                label: {
                  type: "string",
                  minLength: 1,
                  maxLength: MAX_LABEL_LENGTH,
                  description:
                    'Human-readable label (e.g., "Messages from #engineering", "Ticket JIRA-456")',
                },
                kind: {
                  type: "string",
                  enum: ["thread", "canvas", "ticket", "external"],
                  description: "Type of resource being cited",
                },
                channelId: {
                  type: "string",
                  description:
                    "Channel ID (for kind='thread' or kind='ticket') — REQUIRED for ticket links",
                },
                conversationId: {
                  type: "string",
                  description:
                    "Conversation ID (for kind='thread' or kind='ticket') — REQUIRED for ticket links",
                },
                channelName: {
                  type: "string",
                  description:
                    "Display name of the channel (for kind='thread')",
                },
                channelType: {
                  type: "string",
                  description:
                    "Channel type: DEFAULT | DM | GROUP_DM | TICKET | DOCUMENT (for kind='thread')",
                },
                viewAccessId: {
                  type: "string",
                  description: "Canvas view ID (for kind='canvas')",
                },
                ticketId: {
                  type: "string",
                  description:
                    "Ticket ID like \"JIRA-123\" (for kind='ticket'). MUST also include channelId + conversationId to make the link clickable",
                },
                url: {
                  type: "string",
                  format: "uri",
                  maxLength: 2048,
                  description: "Full URL (for kind='external')",
                },
              },
              required: ["label", "kind"],
            },
          },
          required: ["point", "citation"],
        },
      },
    },
    required: ["keypoints"],
  },
  async execute(params, context) {
    const sessionId = context?.sessionId;
    const keypoints = validateKeyPoints(params["keypoints"]);

    if (!keypoints) {
      return "Invalid citations. Provide 1-8 key points with valid resource identifiers and http(s) external URLs.";
    }

    if (!sessionId) {
      return "Error: No session ID available. Cannot record citations.";
    }

    // Record the citations
    recordLlmCitations(sessionId, keypoints);

    const count = keypoints.length;
    const labels = keypoints.map((kp) => kp.citation.label).slice(0, 3);
    const moreLabel = count > 3 ? ` and ${count - 3} more` : "";

    return `Citations recorded: ${count} key point(s) cited. Labels: ${labels.join(", ")}${moreLabel}. These will appear in the Citations section of the response.`;
  },
};
