import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";
import { appFetch, interact, spacesFetch, SpacesApiError, type SpacesAuthContext } from "./servers/xyne-spaces-client.js";
import { SDLC_TOOL_NAMES } from "xyne-claw-shared";
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

/**
 * App-MEMBERSHIP check for a write target channel, AT QUEUE TIME. Existence
 * (`interact` findMany) is not enough: a real channel the agent's Spaces app is
 * not a member of passes existence but 403s at card-post time in webhook.ts
 * (`pendingActionTargetValidation` → `/channel/info`), so the action queued,
 * the model said "queued, approve it", and the approval card was silently
 * dropped (prod 2026-08-24, Arya Doctor spaces-create-ticket into a HyperCredit
 * channel). Hitting the SAME `/api/apps/channel/info` endpoint here — with the
 * same app token that will later try to post the card — makes tool-time and
 * card-time agree, so the model narrates the failure instead of a false queue.
 *
 * Fails OPEN on anything other than a definitive 403/404: the authoritative
 * Spaces API stays the final judge, matching the delivery-boundary semantics.
 */
async function validateChannelAppAccess(
  channelId: string,
  auth: SpacesAuthContext,
): Promise<string | null> {
  try {
    await appFetch("/channel/info", { method: "POST", body: JSON.stringify({ channelId }) }, auth);
    return null;
  } catch (err) {
    // Branch on the typed HTTP status, not the message text. Only a definitive
    // 403 (app not a member) or 404 (gone) rejects; anything else fails open so
    // the authoritative Spaces API stays the final judge.
    const status = err instanceof SpacesApiError ? err.status : undefined;
    if (status === 403) {
      return `channel ${channelId} is not accessible — add the app to the channel or choose a channel it can access`;
    }
    if (status === 404) {
      return `channel ${channelId} not found — use a real Spaces channel id`;
    }
    log.warn(
      `[validator] channel access check failed open channelId=${channelId} status=${status ?? "n/a"}:`,
      errMsg(err),
    );
    return null;
  }
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

  const auth: SpacesAuthContext = {};
  const token = stringField(credentials["token"]);
  const sessionId = stringField(credentials["sessionId"]);
  const workspaceId = stringField(credentials["workspaceId"]);
  const baseUrl = stringField(credentials["url"]);
  if (token) auth.token = token;
  if (sessionId) auth.sessionId = sessionId;
  if (workspaceId) auth.workspaceId = workspaceId;
  if (baseUrl) auth.baseUrl = baseUrl;

  if (conversationId) {
    try {
      await spacesFetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=1`,
        { method: "GET" },
        auth,
      );
      return null;
    } catch (err) {
      const msg = errMsg(err);
      if (/Spaces API 404/i.test(msg) || (/conversation not found/i.test(msg) && /\b404\b/.test(msg))) {
        return `conversation ${conversationId} not found — use a real Spaces conversation id, e.g. from the triggering thread`;
      }
      log.warn(`[validator] ${serverType}/${tool} conversation lookup failed open conversationId=${conversationId}:`, msg);
      return null;
    }
  }

  if (!channelId) return null;

  // Reject a hallucinated channelId AT QUEUE TIME, while the model can still
  // self-correct in the same run. Without this, the action queues ("Action
  // queued for approval: ..."), and the card-time target validation in
  // webhook.ts then skips the approval card with only a server log — the user
  // was promised an approval that never arrives, and retrying repeats the
  // identical dead end (prod 2026-08-07, fe-autocoder spaces-create-ticket).
  //
  // This is an EXACT-id findMany, not the paginated workspace list whose
  // `.includes` false-negatives got pre-checks removed here before (see the
  // create-ticket note below): only a definitive empty result rejects; any
  // lookup failure fails open so the authoritative Spaces API stays the
  // final judge.
  try {
    const rows = (await interact(
      { model: "channel", operation: "findMany", where: { id: { equals: channelId } }, take: 1 },
      auth,
    )) as unknown[];
    if (Array.isArray(rows) && rows.length === 0) {
      // Did-you-mean recovery: ids that reach us corrupted are almost always
      // near-misses of a real id the model re-typed from its own prose
      // (prod 2026-08-10: fe-autocoder dropped 2 chars mid-cuid). Cuids share
      // long time-ordered prefixes, so a prefix lookup names the intended
      // channel and lets the agent self-correct in ONE step instead of
      // guessing. Suggestions only — never silently substitute a write target.
      let suggestion = "";
      try {
        const prefix = channelId.slice(0, 12);
        if (prefix.length >= 8) {
          const near = (await interact(
            {
              model: "channel",
              operation: "findMany",
              where: { id: { startsWith: prefix } },
              select: { id: true, name: true },
              take: 3,
            },
            auth,
          )) as Array<{ id?: string; name?: string }>;
          if (Array.isArray(near) && near.length > 0) {
            suggestion =
              " Close id matches: " +
              near.map((c) => `${c.name ?? "(unnamed)"} = ${c.id}`).join("; ") +
              ". If one of these is the intended channel, retry with that EXACT id (copy it verbatim).";
          }
        }
      } catch {
        // best-effort — the not-found error below stands on its own
      }
      return `channel ${channelId} not found — use a real Spaces channel id (resolve it with the spaces-channels tool by exact name, or from the triggering thread).${suggestion}`;
    }
    // The channel exists — now confirm the agent's app can actually reach it, so
    // a write into a channel the app isn't a member of fails HERE (model can
    // retry a reachable channel) instead of queuing and then losing its approval
    // card at delivery time. Same app token, same endpoint as the card path.
    return await validateChannelAppAccess(channelId, auth);
  } catch (err) {
    const msg = errMsg(err);
    log.warn(`[validator] ${serverType}/${tool} channel lookup failed open channelId=${channelId}:`, msg);
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

register("xyne-spaces", SDLC_TOOL_NAMES.mutateArtifact, async (params) => {
  const artifactType = String(params["artifactType"] ?? "");
  const action = String(params["action"] ?? "");
  const folderId = String(params["folderId"] ?? "").trim();
  if (folderId && action === "create") {
    if (!String(params["repoId"] ?? "").trim()) return "repoId is required";
    for (const key of ["title", "markdown", "trackId"]) {
      if (!String(params[key] ?? "").trim()) return `${key} is required for create`;
    }
    return null;
  }
  if (!artifactType && action === "update") {
    if (!String(params["repoId"] ?? "").trim()) return "repoId is required";
    for (const key of ["canvasId", "markdown"]) {
      if (!String(params[key] ?? "").trim()) return `${key} is required for update`;
    }
    return null;
  }
  if (!["WIKI", "BASELINE"].includes(artifactType)) {
    return "artifactType must be WIKI or BASELINE (artifact creates use folderId; updates use canvasId)";
  }
  if (!String(params["repoId"] ?? "").trim()) return "repoId is required";
  if (artifactType === "BASELINE") {
    if (!["begin", "upsert_section", "finalize"].includes(action)) {
      return "BASELINE action must be begin, upsert_section, or finalize";
    }
    for (const key of ["baselineKind", "setupExecutionId", "workflowExecutionId", "title"]) {
      if (!String(params[key] ?? "").trim()) return `${key} is required`;
    }
    if (action === "upsert_section") {
      for (const key of ["sectionKey", "sectionTitle", "markdown"]) {
        if (!String(params[key] ?? "").trim()) return `${key} is required for upsert_section`;
      }
    }
    return null;
  }
  for (const key of ["executionId", "sessionId", "commitSha"]) {
    if (!String(params[key] ?? "").trim()) return `${key} is required for WIKI`;
  }
  if (!/^(?:[0-9a-f]{9,40}|ROOT_BOOTSTRAP)$/i.test(String(params["commitSha"] ?? ""))) {
    return "commitSha must be an assigned commit ref (minimum 9 characters) or ROOT_BOOTSTRAP";
  }
  if (!["create", "update", "replace_section", "insert_section", "remove_section", "move", "archive", "restore"].includes(action)) {
    return "unsupported WIKI action";
  }
  const path = String(params["path"] ?? "").trim();
  if (!path) return "path is required for WIKI";
  if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^/\\]+(?:\/[^/\\]+)*\.md$/i.test(path)) {
    return "path must be a normalized relative Markdown path";
  }
  const requireString = (key: string): string | null =>
    String(params[key] ?? "").trim() ? null : `${key} is required for ${action}`;
  const requireSourcePaths = (allowEmpty = false): string | null => {
    const value = params["sourcePaths"];
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      return `sourcePaths is required for ${action}`;
    }
    if (value.length > 500 || value.some(item => typeof item !== "string" || !item.trim() || item.length > 1024)) {
      return "sourcePaths must contain at most 500 non-empty repository-relative paths";
    }
    return null;
  };
  if (action === "move") {
    for (const key of ["destinationPath", "expectedContentHash"]) {
      if (!String(params[key] ?? "").trim()) return `${key} is required for move`;
    }
    if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^/\\]+(?:\/[^/\\]+)*\.md$/i.test(String(params["destinationPath"]))) {
      return "destinationPath must be a normalized relative Markdown path";
    }
    return null;
  }
  const requiredStringsByAction: Record<string, string[]> = {
    create: ["title", "markdown"],
    update: ["expectedContentHash", "title", "markdown"],
    restore: ["expectedContentHash", "title", "markdown"],
    archive: ["expectedContentHash"],
    replace_section: ["expectedContentHash", "heading", "markdown"],
    insert_section: ["expectedContentHash", "heading", "markdown"],
    remove_section: ["expectedContentHash", "heading"],
  };
  for (const key of requiredStringsByAction[action] ?? []) {
    const error = requireString(key);
    if (error) return error;
  }
  const sourcePathsError = requireSourcePaths(action === "archive");
  if (sourcePathsError) return sourcePathsError;
  const references = params["sourceReferences"];
  if (references !== undefined) {
    if (!Array.isArray(references) || references.length > 500) {
      return "sourceReferences must be an array with at most 500 entries";
    }
    for (const reference of references) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        return "sourceReferences entries must be objects";
      }
      const item = reference as Record<string, unknown>;
      if (!String(item["path"] ?? "").trim()) return "sourceReferences.path is required";
    }
  }
  return null;
});

register("xyne-spaces", SDLC_TOOL_NAMES.createPullRequest, async (params) => {
  for (const key of ["executionId", "sessionId", "repoId", "title", "head", "base", "commitHash"]) {
    if (!String(params[key] ?? "").trim()) return `${key} is required`;
  }
  if (!/^[0-9a-f]{40}$/i.test(String(params["commitHash"]))) {
    return "commitHash must be a full 40-character Git commit SHA";
  }
  if (String(params["title"]).trim().length > 256) return "title must be at most 256 characters";
  if (String(params["body"] ?? "").length > 65_536) return "body must be at most 65536 characters";
  if (String(params["head"]).trim().length > 255) return "head must be at most 255 characters";
  if (String(params["base"]).trim().length > 255) return "base must be at most 255 characters";
  if (params["head"] === params["base"]) return "head must differ from base";
  return null;
});

for (const tool of [
  SDLC_TOOL_NAMES.beginWikiCheckpoint,
  SDLC_TOOL_NAMES.verifyWikiSources,
  SDLC_TOOL_NAMES.finalizeWikiCommit,
]) {
  register("xyne-spaces", tool, async (params) => {
    for (const key of ["executionId", "sessionId", "repoId"]) {
      if (!String(params[key] ?? "").trim()) return `${key} is required`;
    }
    if (
      tool === SDLC_TOOL_NAMES.beginWikiCheckpoint ||
      tool === SDLC_TOOL_NAMES.verifyWikiSources ||
      tool === SDLC_TOOL_NAMES.finalizeWikiCommit
    ) {
      if (!/^(?:[0-9a-f]{9,40}|ROOT_BOOTSTRAP)$/i.test(String(params["commitSha"] ?? ""))) {
        return "commitSha must be an assigned commit ref (minimum 9 characters) or ROOT_BOOTSTRAP";
      }
    }
    if (tool === SDLC_TOOL_NAMES.verifyWikiSources) {
      if (!Array.isArray(params["paths"]) || params["paths"].length === 0) return "paths is required";
      if (params["paths"].length > 500) return "paths must contain at most 500 entries";
      if (params["paths"].some(path => typeof path !== "string" || !path.trim() || path.length > 1024)) {
        return "paths must contain non-empty repository-relative paths";
      }
    }
    if (tool === SDLC_TOOL_NAMES.finalizeWikiCommit) {
      const summary = String(params["summary"] ?? "").trim();
      if (!summary) return "summary is required";
      if (summary.length > 4_000) return "summary must be at most 4000 characters";
      if (!['changes', 'noop'].includes(String(params["outcome"] ?? ''))) {
        return "outcome must be changes or noop";
      }
    }
    return null;
  });
}

for (const tool of [
  SDLC_TOOL_NAMES.listArtifacts,
  SDLC_TOOL_NAMES.readArtifact,
  SDLC_TOOL_NAMES.listArtifactVersions,
  SDLC_TOOL_NAMES.readArtifactVersion,
]) {
  register("xyne-spaces", tool, async (params) => {
    for (const key of ["repoId", "workspaceId", "actorUserId"]) {
      if (!String(params[key] ?? "").trim()) return `${key} is required`;
    }
    if (tool === SDLC_TOOL_NAMES.listArtifacts) return null;
    const selector = params["selector"];
    if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
      return "selector is required";
    }
    const selected = selector as Record<string, unknown>;
    if (selected["type"] === "WIKI_PAGE") {
      const path = String(selected["path"] ?? "").trim();
      if (!path) return "selector.path is required";
      if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^/\\]+(?:\/[^/\\]+)*\.md$/i.test(path)) {
        return "selector.path must be a normalized relative Markdown path";
      }
    } else if (selected["type"] === "SDLC_CANVAS") {
      const canvasId = String(selected["canvasId"] ?? "").trim();
      if (!canvasId) return "selector.canvasId is required";
      if (canvasId.length > 256) return "selector.canvasId must be at most 256 characters";
    } else {
      return "selector.type must be WIKI_PAGE or SDLC_CANVAS";
    }
    if (tool === SDLC_TOOL_NAMES.readArtifactVersion && !String(params["versionId"] ?? "").trim()) {
      return "versionId is required";
    }
    if (tool === SDLC_TOOL_NAMES.listArtifactVersions && params["limit"] !== undefined) {
      const limit = Number(params["limit"]);
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
        return "limit must be an integer between 1 and 25";
      }
    }
    if (tool === SDLC_TOOL_NAMES.listArtifactVersions && params["cursor"] !== undefined) {
      if (!String(params["cursor"] ?? "").trim()) return "cursor must not be empty";
    }
    return null;
  });
}
