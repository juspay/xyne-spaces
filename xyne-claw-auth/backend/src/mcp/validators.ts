import { callTool } from "./runner.js";

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
  if (!fn) return null;
  try {
    return await fn(params, credentials);
  } catch (err) {
    console.warn(`[validator] ${serverType}/${tool} threw, allowing approval:`, err instanceof Error ? err.message : err);
    return null;
  }
}

register("xyne-spaces", "spaces-create-ticket", async (params, credentials) => {
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

  const userId = (credentials["userId"] as string | undefined) ?? "";
  if (!userId) return null;

  const projRes = await callTool(userId, "xyne-spaces", credentials, "spaces-projects", { limit: 100 });
  const projText = typeof projRes.content === "string" ? projRes.content : "";
  if (projText && !projText.includes(projectId)) {
    return `projectId ${projectId} not found in your workspace — run spaces-projects to list valid ids`;
  }

  const boardRes = await callTool(userId, "xyne-spaces", credentials, "spaces-boards", { limit: 100 });
  const boardText = typeof boardRes.content === "string" ? boardRes.content : "";
  if (boardText && !boardText.includes(boardId)) {
    return `boardId ${boardId} not found — run spaces-boards to list valid ids for projectId ${projectId}`;
  }

  return null;
});

register("xyne-spaces", "spaces-schedule-call", async (params, credentials) => {
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

  const userId = (credentials["userId"] as string | undefined) ?? "";
  if (!userId) return null;

  if (channelId) {
    const chRes = await callTool(userId, "xyne-spaces", credentials, "spaces-channels", { limit: 100 });
    const chText = typeof chRes.content === "string" ? chRes.content : "";
    if (chText && !chText.includes(channelId)) {
      return `channelId ${channelId} not found — run spaces-channels to list valid ids`;
    }
  }

  return null;
});


register("xyne-spaces", "spaces-update-ticket", async (params, credentials) => {
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

  const userId = (credentials["userId"] as string | undefined) ?? "";
  if (!userId) return null;

  // Verify the ticket exists
  const ticketRes = await callTool(userId, "xyne-spaces", credentials, "spaces-tickets", { limit: 100 });
  const ticketText = typeof ticketRes.content === "string" ? ticketRes.content : "";
  if (ticketText && !ticketText.includes(ticketId)) {
    return `ticketId ${ticketId} not found — run spaces-tickets to list valid tickets`;
  }

  // Verify assigneeId exists if provided
  if (assigneeId) {
    const userRes = await callTool(userId, "xyne-spaces", credentials, "spaces-users", { nameOrEmail: assigneeId, limit: 10 });
    const userText = typeof userRes.content === "string" ? userRes.content : "";
    if (userText && !userText.includes(assigneeId)) {
      return `assigneeId ${assigneeId} not found — run spaces-users to find valid user IDs`;
    }
  }

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
