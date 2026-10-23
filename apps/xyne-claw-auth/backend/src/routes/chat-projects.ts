/**
 * Chat projects: folders that group a user's Xyne AI chats and carry shared
 * instructions.
 *
 * Mounted INTO `agentChatRouter` (see agent-chat.ts) rather than onto the app,
 * so every path here is served under `/agent-chat` exactly as if it were
 * declared in that file. It lives in its own module only because agent-chat.ts
 * cannot be imported without its whole dependency graph, which makes the
 * handlers untestable in isolation.
 *
 * The mount happens AHEAD of agent-chat's `/:slug/...` routes. None of those
 * can match a `/chat/projects*` path — they all require the literal "chat" in
 * their second segment, where these have "projects" — but ordering it first
 * removes the question for whoever adds the next `/:slug` route.
 *
 * Access is owner-only through `chatProjectRepository.findOwned`, which returns
 * null for "not yours" and "does not exist" alike so a caller can never tell
 * the two apart. That is why every miss below is 404 and never 403.
 */

import { Router, type Request, type Response } from "express";
import {
  chatProjectRepository,
  chatProjectKnowledgeRepository,
  chatAttachmentRepository,
  isChatProjectKnowledgeType,
  DuplicateKnowledgeError,
} from "../repositories/index.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import { getRequesterAliases } from "../middleware/pin-user-id-param.js";
import { orgIdForSpacesUser, resolveClawUserIdForSpacesIdentity } from "../lib/users-jit.js";

import { createLogger } from "../logger.js";
const log = createLogger("chat-projects");

export const chatProjectsRouter: Router = Router();

/**
 * Filing a chat into a project, and the `?projectId=` list scope, are project
 * operations that the conversation routes in agent-chat.ts drive. They live
 * here with the rest of the project domain — and, practically, because
 * agent-chat.ts cannot be imported in a test without its whole dependency
 * graph, while this module can.
 */

export type PreparedProjectMove =
  | { status: "ok"; projectId: string | null; apply: () => Promise<void> }
  | { status: "project-not-found" };

/**
 * Validate a move and hand back the write, without performing it.
 *
 * Split in two on purpose. The conversation PATCH can carry a title and a pin
 * alongside `projectId`, and it used to write those first — so a bad project
 * id saved the title and THEN answered 404. The dashboard's optimistic update
 * rolls back on that 404, reverting a title the server had actually kept.
 * Resolving everything before the first write removes the half-applied state.
 *
 * `ownerUserId` must be the id the conversation's own chat rows use, so the
 * membership is found again on read; `aliases` lets the repository sweep a row
 * filed earlier under the caller's other verified id.
 */
export async function prepareProjectMove(args: {
  conversationId: string;
  ownerUserId: string;
  ownerOrgId: string;
  aliases: string[];
  projectId: string | null;
}): Promise<PreparedProjectMove> {
  if (args.projectId === null) {
    return {
      status: "ok",
      projectId: null,
      apply: async () => {
        await chatProjectRepository.removeConversation(args.conversationId, args.aliases);
      },
    };
  }

  const project = await chatProjectRepository.findOwned(
    args.projectId.trim(),
    args.aliases,
    args.ownerOrgId,
  );
  // Owner-only, and same org as the chat. Null covers "not yours" and "no such
  // project" alike, so the caller answers 404 either way.
  if (!project) return { status: "project-not-found" };

  return {
    status: "ok",
    projectId: project.id,
    apply: async () => {
      await chatProjectRepository.moveConversation(
        {
          conversationId: args.conversationId,
          userId: args.ownerUserId,
          projectId: project.id,
          // Taken from the project row, never the request: nothing in the
          // schema enforces item.orgId == project.orgId.
          orgId: project.orgId,
        },
        args.aliases,
      );
    },
  };
}

/** conversationId sets for `?projectId=`. `only` narrows to a project (and
 *  stays empty for an empty one); `exclude` powers `?projectId=none`. */
export interface ProjectListScope {
  only?: string[];
  exclude?: string[];
}

export type ProjectScopeResult =
  | { status: "ok"; scope: ProjectListScope | undefined }
  | { status: "project-not-found" };

/**
 * Turn `?projectId=` into a conversationId set for the list aggregate.
 *
 * Returns `scope: undefined` when the param is absent — no filtering. An empty
 * `only` is NOT the same thing and must survive: it means a project with no
 * chats, which lists nothing.
 */
export async function resolveProjectScope(args: {
  projectParam: string | undefined;
  userIds: string[];
  orgId: string | undefined;
}): Promise<ProjectScopeResult> {
  if (!args.projectParam) return { status: "ok", scope: undefined };

  if (args.projectParam === "none") {
    return {
      status: "ok",
      scope: { exclude: await chatProjectRepository.filedConversationIds(args.userIds) },
    };
  }

  const project = args.orgId
    ? await chatProjectRepository.findOwned(args.projectParam, args.userIds, args.orgId)
    : null;
  if (!project) return { status: "project-not-found" };

  return {
    status: "ok",
    scope: { only: await chatProjectRepository.conversationIdsInProject(project.id, args.userIds) },
  };
}

const MAX_PROJECT_NAME_CHARS = 120;
const MAX_PROJECT_ICON_CHARS = 64;
const MAX_PROJECT_INSTRUCTIONS_CHARS = 10_000;
const MAX_PROJECT_REF_CHARS = 128;
const MAX_REORDER_IDS = 500;

interface ProjectCaller {
  /** Every id this caller is verified under; reads match any of them. */
  aliases: string[];
  /** The single id new rows are written under. */
  primaryUserId: string;
  orgId: string;
}

/**
 * The Spaces proxy sends only the workspace-scoped SPACES id and no `x-org-id`,
 * so the org must be resolved through the Spaces identity rather than matched
 * against `users.id`, which holds CLAW ids.
 *
 * Writes the error response itself and returns null when it cannot resolve.
 */
async function requireProjectCaller(req: Request, res: Response): Promise<ProjectCaller | null> {
  const aliases = getRequesterAliases(req);
  if (aliases.length === 0) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return null;
  }
  const spacesUserId = getRequesterId(req) ?? aliases[0]!;
  const headerOrgId = getOrgId(req);
  const orgId =
    headerOrgId ?? (await orgIdForSpacesUser(spacesUserId, "agent-chat").catch(() => undefined));
  if (!orgId) {
    res.status(400).json({
      success: false,
      error: "Could not resolve your organization for this workspace",
    });
    return null;
  }
  // Reads match either id form; writes keep using the id on the wire.
  const canonicalId = await resolveClawUserIdForSpacesIdentity(spacesUserId).catch(() => undefined);
  const lookupAliases = [...new Set([...aliases, ...(canonicalId ? [canonicalId] : [])])];
  return { aliases: lookupAliases, primaryUserId: spacesUserId, orgId };
}

interface ProjectFields {
  name?: string | undefined;
  icon?: string | null | undefined;
  instructions?: string | undefined;
  instructionsEnabled?: boolean | undefined;
  spacesProjectId?: string | null | undefined;
  defaultAgentSlug?: string | null | undefined;
}

/** Absent fields stay absent so a PATCH writes only what was sent; an empty
 *  string on a nullable field clears it. */
function parseProjectBody(
  raw: unknown,
  requireName: boolean,
): { error: string } | { value: ProjectFields } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const value: ProjectFields = {};

  if (body["name"] !== undefined) {
    const name = body["name"];
    if (typeof name !== "string" || !name.trim()) {
      return { error: "name must be a non-empty string" };
    }
    if (name.trim().length > MAX_PROJECT_NAME_CHARS) {
      return { error: `name must be at most ${MAX_PROJECT_NAME_CHARS} characters` };
    }
    value.name = name.trim();
  } else if (requireName) {
    return { error: "name is required" };
  }

  if (body["icon"] !== undefined) {
    const icon = body["icon"];
    if (icon !== null && typeof icon !== "string") {
      return { error: "icon must be a string or null" };
    }
    const trimmed = typeof icon === "string" ? icon.trim() : "";
    if (trimmed.length > MAX_PROJECT_ICON_CHARS) {
      return { error: `icon must be at most ${MAX_PROJECT_ICON_CHARS} characters` };
    }
    value.icon = trimmed || null;
  }

  if (body["instructions"] !== undefined) {
    const instructions = body["instructions"];
    if (typeof instructions !== "string") {
      return { error: "instructions must be a string" };
    }
    if (instructions.length > MAX_PROJECT_INSTRUCTIONS_CHARS) {
      return { error: `instructions must be at most ${MAX_PROJECT_INSTRUCTIONS_CHARS} characters` };
    }
    value.instructions = instructions;
  }

  if (body["instructionsEnabled"] !== undefined) {
    if (typeof body["instructionsEnabled"] !== "boolean") {
      return { error: "instructionsEnabled must be a boolean" };
    }
    value.instructionsEnabled = body["instructionsEnabled"];
  }

  for (const key of ["spacesProjectId", "defaultAgentSlug"] as const) {
    const supplied = body[key];
    if (supplied === undefined) continue;
    if (supplied !== null && typeof supplied !== "string") {
      return { error: `${key} must be a string or null` };
    }
    const trimmed = typeof supplied === "string" ? supplied.trim() : "";
    if (trimmed.length > MAX_PROJECT_REF_CHARS) {
      return { error: `${key} must be at most ${MAX_PROJECT_REF_CHARS} characters` };
    }
    value[key] = trimmed || null;
  }

  return { value };
}

// GET /agent-chat/chat/projects — the caller's projects, with chat counts
chatProjectsRouter.get("/chat/projects", async (req: Request, res: Response): Promise<void> => {
  try {
    const caller = await requireProjectCaller(req, res);
    if (!caller) return;

    const [projects, counts] = await Promise.all([
      chatProjectRepository.listForOwner(caller.aliases, caller.orgId),
      chatProjectRepository.countsByProject(caller.aliases, caller.orgId),
    ]);

    res.json({
      success: true,
      data: projects.map((project) => ({ ...project, chatCount: counts.get(project.id) ?? 0 })),
    });
  } catch (err) {
    log.error("[chat-projects] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agent-chat/chat/projects — create
chatProjectsRouter.post("/chat/projects", async (req: Request, res: Response): Promise<void> => {
  try {
    const caller = await requireProjectCaller(req, res);
    if (!caller) return;

    const parsed = parseProjectBody(req.body, true);
    if ("error" in parsed) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }

    // Aliases go in so the sort-order lookup spans projects stored under the
    // caller's other verified id; the row itself is still written under one.
    const created = await chatProjectRepository.create(
      caller.primaryUserId,
      caller.orgId,
      { ...parsed.value, name: parsed.value.name as string },
      caller.aliases,
    );

    res.status(201).json({ success: true, data: { ...created, chatCount: 0 } });
  } catch (err) {
    log.error("[chat-projects] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// PUT /agent-chat/chat/projects/reorder
// Declared before `/chat/projects/:projectId` so "reorder" is never read as an id.
chatProjectsRouter.put("/chat/projects/reorder", async (req: Request, res: Response): Promise<void> => {
  try {
    const caller = await requireProjectCaller(req, res);
    if (!caller) return;

    const projectIds = (req.body as { projectIds?: unknown } | undefined)?.projectIds;
    if (!Array.isArray(projectIds) || projectIds.some((id) => typeof id !== "string" || !id.trim())) {
      res.status(400).json({ success: false, error: "projectIds must be an array of non-empty strings" });
      return;
    }
    if (projectIds.length > MAX_REORDER_IDS) {
      res.status(400).json({ success: false, error: `projectIds must hold at most ${MAX_REORDER_IDS} ids` });
      return;
    }

    // Ids the caller does not own match nothing and are skipped, so a stale
    // client list renumbers what it legitimately can instead of failing whole.
    const reordered = await chatProjectRepository.reorder(
      caller.aliases,
      caller.orgId,
      projectIds as string[],
    );

    res.json({ success: true, data: { reordered } });
  } catch (err) {
    log.error("[chat-projects] reorder error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

const KNOWLEDGE_TITLE_MAX_CHARS = 200;
const KNOWLEDGE_REF_MAX_CHARS = 256;
/** A run injects a handful of items; past ~20 normalizeAttachedContext starts
 *  dropping them, so a project holding hundreds helps nobody. */
const MAX_KNOWLEDGE_ITEMS_PER_PROJECT = 50;

interface ParsedKnowledge {
  type: string;
  refId: string;
  title: string;
}

/**
 * Only `type`, `refId` and `title` are read from the request.
 *
 * `storagePath`, `mimeType` and `size` are deliberately NOT accepted: a client
 * that can name its own storage path can name anyone's. The bucket also holds
 * local-harness session logs under a guessable
 * `local-harness-sessions/<userId>/<conversationId>/<provider>.jsonl`, so a
 * path taken on trust would let a user attach another user's run transcript and
 * have XYNE-66810 read it out with claw-auth's own credentials. For a file the
 * server resolves those three fields from the attachment row instead.
 */
function parseKnowledgeBody(body: unknown): { value: ParsedKnowledge } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be an object" };
  }
  const raw = body as Record<string, unknown>;

  if (!isChatProjectKnowledgeType(raw["type"])) {
    return { error: "type must be one of file, kb_collection, channel, ticket, canvas" };
  }
  const refId = typeof raw["refId"] === "string" ? raw["refId"].trim() : "";
  if (!refId) return { error: "refId is required" };
  if (refId.length > KNOWLEDGE_REF_MAX_CHARS) {
    return { error: `refId must be ${KNOWLEDGE_REF_MAX_CHARS} characters or less` };
  }

  const title = typeof raw["title"] === "string" ? raw["title"].trim() : "";
  if (!title) return { error: "title is required" };
  if (title.length > KNOWLEDGE_TITLE_MAX_CHARS) {
    return { error: `title must be ${KNOWLEDGE_TITLE_MAX_CHARS} characters or less` };
  }

  return {
    value: {
      type: raw["type"],
      refId,
      title,
    },
  };
}

// GET /agent-chat/chat/projects/:projectId/knowledge
chatProjectsRouter.get(
  "/chat/projects/:projectId/knowledge",
  async (req: Request<{ projectId: string }>, res: Response): Promise<void> => {
    try {
      const caller = await requireProjectCaller(req, res);
      if (!caller) return;

      const project = await chatProjectRepository.findOwned(
        req.params.projectId,
        caller.aliases,
        caller.orgId,
      );
      if (!project) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      const items = await chatProjectKnowledgeRepository.listForProject(project.id, project.orgId);
      res.json({ success: true, data: items });
    } catch (err) {
      log.error("[chat-projects] knowledge list error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// POST /agent-chat/chat/projects/:projectId/knowledge
chatProjectsRouter.post(
  "/chat/projects/:projectId/knowledge",
  async (req: Request<{ projectId: string }>, res: Response): Promise<void> => {
    try {
      const caller = await requireProjectCaller(req, res);
      if (!caller) return;

      const project = await chatProjectRepository.findOwned(
        req.params.projectId,
        caller.aliases,
        caller.orgId,
      );
      if (!project) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      const parsed = parseKnowledgeBody(req.body);
      if ("error" in parsed) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }

      const existing = await chatProjectKnowledgeRepository.listForProject(
        project.id,
        project.orgId,
      );
      if (existing.length >= MAX_KNOWLEDGE_ITEMS_PER_PROJECT) {
        res.status(400).json({
          success: false,
          error: `A project can hold at most ${MAX_KNOWLEDGE_ITEMS_PER_PROJECT} knowledge items`,
        });
        return;
      }

      // For a file every storage detail comes from the attachment row, found
      // only under the caller's own ids. An id they do not own is a 404, so a
      // path they chose can never be stored.
      let fileFields: { storagePath: string; mimeType: string; size: number } | undefined;
      if (parsed.value.type === "file") {
        const attachment = await chatAttachmentRepository.findOwnedById(
          parsed.value.refId,
          caller.aliases,
        );
        if (!attachment) {
          res.status(404).json({ success: false, error: "Attachment not found" });
          return;
        }
        fileFields = {
          storagePath: attachment.url,
          mimeType: attachment.mimeType,
          size: attachment.size,
        };
      }

      const created = await chatProjectKnowledgeRepository.create(
        project.id,
        // The parent row's org, never the request's.
        project.orgId,
        caller.primaryUserId,
        { ...parsed.value, type: parsed.value.type as never, ...fileFields },
      );
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      if (err instanceof DuplicateKnowledgeError) {
        res.status(409).json({ success: false, error: err.message });
        return;
      }
      log.error("[chat-projects] knowledge create error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// DELETE /agent-chat/chat/projects/:projectId/knowledge/:knowledgeId
chatProjectsRouter.delete(
  "/chat/projects/:projectId/knowledge/:knowledgeId",
  async (
    req: Request<{ projectId: string; knowledgeId: string }>,
    res: Response,
  ): Promise<void> => {
    try {
      const caller = await requireProjectCaller(req, res);
      if (!caller) return;

      const project = await chatProjectRepository.findOwned(
        req.params.projectId,
        caller.aliases,
        caller.orgId,
      );
      if (!project) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      const removed = await chatProjectKnowledgeRepository.deleteOwned(
        req.params.knowledgeId,
        project.id,
        project.orgId,
      );
      if (!removed) {
        res.status(404).json({ success: false, error: "Knowledge item not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      log.error("[chat-projects] knowledge delete error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// GET /agent-chat/chat/projects/:projectId — owner-only
chatProjectsRouter.get(
  "/chat/projects/:projectId",
  async (req: Request<{ projectId: string }>, res: Response): Promise<void> => {
    try {
      const caller = await requireProjectCaller(req, res);
      if (!caller) return;

      const project = await chatProjectRepository.findOwned(
        req.params.projectId,
        caller.aliases,
        caller.orgId,
      );
      if (!project) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      const conversationIds = await chatProjectRepository.conversationIdsInProject(
        project.id,
        caller.aliases,
      );
      res.json({
        success: true,
        data: { ...project, conversationIds, chatCount: conversationIds.length },
      });
    } catch (err) {
      log.error("[chat-projects] get error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// PATCH /agent-chat/chat/projects/:projectId — owner-only field updates
chatProjectsRouter.patch(
  "/chat/projects/:projectId",
  async (req: Request<{ projectId: string }>, res: Response): Promise<void> => {
    try {
      const caller = await requireProjectCaller(req, res);
      if (!caller) return;

      const parsed = parseProjectBody(req.body, false);
      if ("error" in parsed) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      if (Object.keys(parsed.value).length === 0) {
        res.status(400).json({ success: false, error: "No updatable fields supplied" });
        return;
      }

      const updated = await chatProjectRepository.update(
        req.params.projectId,
        caller.aliases,
        caller.orgId,
        parsed.value,
      );
      if (!updated) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      log.error("[chat-projects] update error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// DELETE /agent-chat/chat/projects/:projectId — owner-only.
// Cascades its membership rows; the chats themselves return to the main list.
chatProjectsRouter.delete(
  "/chat/projects/:projectId",
  async (req: Request<{ projectId: string }>, res: Response): Promise<void> => {
    try {
      const caller = await requireProjectCaller(req, res);
      if (!caller) return;

      const removed = await chatProjectRepository.remove(
        req.params.projectId,
        caller.aliases,
        caller.orgId,
      );
      if (!removed) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
      }

      res.json({ success: true, data: { id: req.params.projectId, deleted: true } });
    } catch (err) {
      log.error("[chat-projects] delete error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);
