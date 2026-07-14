import { createLogger } from "../logger.js";
import { spacesFetch, type SpacesAuthContext } from "./servers/xyne-spaces-client.js";
const log = createLogger("validators");

type ValidatorFn = (
  params: Record<string, unknown>,
  credentials: Record<string, unknown>,
) => Promise<string | null>;

const VALIDATORS: Record<string, ValidatorFn> = {};

function register(serverType: string, tool: string, fn: ValidatorFn): void {
  VALIDATORS[`${serverType}/${tool}`] = fn;
}

export async function validateWriteAction(
  serverType: string,
  tool: string,
  params: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<string | null> {
  const fn = VALIDATORS[`${serverType}/${tool}`];
  if (fn) {
    try {
      const error = await fn(params, credentials);
      if (error) return error;
    } catch (err) {
      log.warn(`[validator] ${serverType}/${tool} threw, allowing approval:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  return validateTargetConversationId(serverType, tool, params, credentials);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function targetConversationId(params: Record<string, unknown>): string | undefined {
  return stringField(params["conversationId"]) ?? stringField(params["targetConversationId"]);
}

function targetChannelId(params: Record<string, unknown>): string | undefined {
  return stringField(params["channelId"]);
}

async function validateTargetConversationId(
  serverType: string,
  tool: string,
  params: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<string | null> {
  if (serverType !== "xyne-spaces") return null;
  const conversationId = targetConversationId(params);
  const channelId = targetChannelId(params);

  if (tool === "user-send-message") {
    if (!!conversationId === !!channelId) {
      return "provide exactly one target: use conversationId for an existing thread or channelId to post into a channel";
    }
  }

  if (!conversationId) return null;

  try {
    const auth: SpacesAuthContext = {};
    const token = stringField(credentials["token"]);
    const sessionId = stringField(credentials["sessionId"]);
    const workspaceId = stringField(credentials["workspaceId"]);
    const baseUrl = stringField(credentials["url"]);
    if (token) auth.token = token;
    if (sessionId) auth.sessionId = sessionId;
    if (workspaceId) auth.workspaceId = workspaceId;
    if (baseUrl) auth.baseUrl = baseUrl;

    await spacesFetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=1`,
      { method: "GET" },
      auth,
    );
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Spaces API 404/i.test(msg) || (/conversation not found/i.test(msg) && /\b404\b/.test(msg))) {
      return `conversation ${conversationId} not found — use a real Spaces conversation id, e.g. from the triggering thread`;
    }
    log.warn(`[validator] ${serverType}/${tool} conversation lookup failed open conversationId=${conversationId}:`, msg);
    return null;
  }
}

register("xyne-spaces", "spaces-create-ticket", async (params) => {
  const projectId = (params["projectId"] as string | undefined)?.trim();
  const boardId = (params["boardId"] as string | undefined)?.trim();
  const channelId = (params["channelId"] as string | undefined)?.trim();
  const title = (params["title"] as string | undefined)?.trim();
  const description = (params["description"] as string | undefined)?.trim();

  if (!title) return "title is required";
  if (!description) return "description is required";
  if (!projectId) return "projectId is required";
  if (!boardId) return "boardId is required";
  if (!channelId) return "channelId is required";

  // ID existence (project / board / channel) is validated authoritatively by
  // the Spaces create-ticket API. On failure, the write-retry loop
  // (XYNE-13828) posts the real error back so the agent can self-correct. We
  // deliberately do NOT pre-check existence here: the old string-`.includes`
  // lookup ran over a paginated, workspace-wide list and produced false
  // negatives (rejecting perfectly valid boards), and because a validator
  // rejection is not a write-action failure it bypassed the retry loop
  // entirely. Required-field checks above are enough.
  return null;
});

register("xyne-spaces", "spaces-schedule-call", async (params) => {
  const title = (params["title"] as string | undefined)?.trim();
  const startsAt = (params["startsAt"] as string | undefined)?.trim();
  const endsAt = (params["endsAt"] as string | undefined)?.trim();
  const channelId = (params["channelId"] as string | undefined)?.trim();
  const targetUserIds = Array.isArray(params["targetUserIds"]) ? (params["targetUserIds"] as string[]) : [];

  if (!title) return "title is required";
  if (!startsAt) return "startsAt is required (ISO 8601)";
  if (!endsAt) return "endsAt is required (ISO 8601)";
  if (!channelId && targetUserIds.length === 0) return "either channelId or targetUserIds is required";

  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  if (Number.isNaN(startMs)) return `startsAt ${startsAt} is not a valid ISO 8601 timestamp`;
  if (Number.isNaN(endMs)) return `endsAt ${endsAt} is not a valid ISO 8601 timestamp`;
  if (endMs <= startMs) return "endsAt must be after startsAt";

  // channelId existence is validated by the Spaces API; see the create-ticket
  // note above. No pre-flight `.includes` lookup.
  return null;
});


register("xyne-spaces", "spaces-update-ticket", async (params) => {
  const ticketId = (params["ticketId"] as string | undefined)?.trim();
  const assigneeId = (params["assigneeId"] as string | undefined)?.trim();
  const stage = (params["stage"] as string | undefined)?.trim();
  const groupId = (params["groupId"] as string | undefined)?.trim();
  const title = (params["title"] as string | undefined)?.trim();
  const description = (params["description"] as string | undefined)?.trim();
  const priority = (params["priority"] as string | undefined)?.trim();
  const status = (params["status"] as string | undefined)?.trim();
  const eta = (params["eta"] as string | undefined)?.trim();

  if (!ticketId) return "ticketId is required";
  if (!assigneeId && !stage && !groupId && !title && !description && !priority && !status && !eta) {
    return "at least one update field is required (assigneeId, stage, groupId, title, description, priority, status, or eta)";
  }

  if (priority && !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priority)) {
    return `priority must be LOW, MEDIUM, HIGH, or CRITICAL — got "${priority}"`;
  }
  if (status && !["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"].includes(status)) {
    return `status must be TODO, STARTED, PAUSED, CANCELLED, or COMPLETED — got "${status}"`;
  }
  if (eta && Number.isNaN(new Date(eta).getTime())) {
    return `eta is not a valid ISO 8601 date — got "${eta}"`;
  }

  // ticketId / assigneeId existence is validated by the Spaces update-ticket
  // API; see the create-ticket note above. No pre-flight `.includes` lookup.
  return null;
});

register("xyne-spaces", "spaces-memory-create", async (params) => {
  const docType = (params["docType"] as string | undefined)?.trim();
  const content = (params["content"] as string | undefined)?.trim();

  if (!docType) return "docType is required";
  if (docType !== "fact" && docType !== "sop") return `docType must be "fact" or "sop", got "${docType}"`;
  if (!content) return "content is required";
  if (content.length < 10) return "content is too short — provide a meaningful fact or procedure (min 10 chars)";

  return null;
});

register("xyne-spaces", "spaces-create-canvas", async (params) => {
  const title = (params["title"] as string | undefined)?.trim();
  const markdown = params["markdown"] as string | undefined;
  const visibility = (params["visibility"] as string | undefined)?.trim();

  if (!title) return "title is required";
  if (!markdown) return "markdown content is required";
  if (typeof markdown === "string" && Buffer.byteLength(markdown, "utf8") > 5 * 1024 * 1024) {
    return "markdown exceeds the 5MB limit";
  }
  if (visibility && visibility !== "PUBLIC" && visibility !== "PRIVATE") {
    return `visibility must be "PUBLIC" or "PRIVATE", got "${visibility}"`;
  }

  return null;
});

register("xyne-spaces", "spaces-edit-canvas", async (params) => {
  const viewAccessId = (params["viewAccessId"] as string | undefined)?.trim();
  const content = params["content"] as string | undefined;

  if (!viewAccessId) return "viewAccessId is required";
  if (!content) return "content is required";
  if (typeof content === "string" && Buffer.byteLength(content, "utf8") > 5 * 1024 * 1024) {
    return "content exceeds the 5MB limit";
  }

  return null;
});
