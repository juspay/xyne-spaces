import type { Prisma } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { agentChainWorkflowRepository } from "../repositories/index.js";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { prisma } from "../db.js";

interface WorkflowNode {
  id: string;
  agentSlug: string;
  taskTemplate?: string;
}

interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  mode?: "always" | "tools" | "judge";
  toolsMustInclude?: string[];
  toolsMustExclude?: string[];
  judgeContext?: string;
  taskTemplate?: string;
}

interface WorkflowDefinition {
  version?: number;
  maxDepth?: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const router = Router();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parseWorkflowDefinition(definition: unknown): WorkflowDefinition | null {
  if (!definition || typeof definition !== "object") return null;

  const raw = definition as Record<string, unknown>;
  if (!Array.isArray(raw["nodes"]) || !Array.isArray(raw["edges"])) return null;

  const nodes = raw["nodes"]
    .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    .filter((n) => typeof n["id"] === "string" && typeof n["agentSlug"] === "string")
    .map((n) => ({
      id: n["id"] as string,
      agentSlug: n["agentSlug"] as string,
      ...(typeof n["taskTemplate"] === "string" ? { taskTemplate: n["taskTemplate"] } : {}),
    }));

  const edges = raw["edges"]
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .filter((e) => typeof e["id"] === "string" && typeof e["fromNodeId"] === "string" && typeof e["toNodeId"] === "string")
    .map((e) => {
      const edge: WorkflowEdge = {
        id: e["id"] as string,
        fromNodeId: e["fromNodeId"] as string,
        toNodeId: e["toNodeId"] as string,
      };

      const mode = e["mode"];
      if (mode === "always" || mode === "tools" || mode === "judge") edge.mode = mode;
      if (isStringArray(e["toolsMustInclude"])) edge.toolsMustInclude = e["toolsMustInclude"];
      if (isStringArray(e["toolsMustExclude"])) edge.toolsMustExclude = e["toolsMustExclude"];
      if (typeof e["judgeContext"] === "string") edge.judgeContext = e["judgeContext"];
      if (typeof e["taskTemplate"] === "string") edge.taskTemplate = e["taskTemplate"];

      return edge;
    });

  if (nodes.length === 0) return null;

  const parsed: WorkflowDefinition = {
    nodes,
    edges,
    ...(typeof raw["version"] === "number" ? { version: raw["version"] } : {}),
    ...(typeof raw["maxDepth"] === "number" ? { maxDepth: raw["maxDepth"] } : {}),
  };

  return parsed;
}

function validateWorkflowDefinition(definition: WorkflowDefinition): string | null {
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
  }

  if (definition.maxDepth !== undefined && (definition.maxDepth < 1 || definition.maxDepth > 50)) {
    return "maxDepth must be between 1 and 50";
  }

  return null;
}

async function canAccessWorkflow(requesterId: string, createdByUserId: string): Promise<boolean> {
  if (requesterId === createdByUserId) return true;
  return isClawAdmin(requesterId);
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const channelId = typeof req.query["channelId"] === "string" ? req.query["channelId"] : undefined;
    if (channelId) {
      const rows = await agentChainWorkflowRepository.listByChannel(channelId);
      const admin = await isClawAdmin(requesterId);
      const visible = admin
        ? rows
        : rows.filter((row) => row.createdByUserId === requesterId || row.workflow.createdByUserId === requesterId);
      res.json({ success: true, data: visible });
      return;
    }

    const rows = await agentChainWorkflowRepository.listByUser(requesterId);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[chain-workflows] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const { name, definition, isPublished } = req.body as {
      name?: string;
      definition?: unknown;
      isPublished?: boolean;
    };

    if (!name?.trim()) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }

    const parsed = parseWorkflowDefinition(definition);
    if (!parsed) {
      res.status(400).json({ success: false, error: "definition is invalid" });
      return;
    }

    const validationError = validateWorkflowDefinition(parsed);
    if (validationError) {
      res.status(400).json({ success: false, error: validationError });
      return;
    }

    const definitionJson = JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue;

    const workflow = await agentChainWorkflowRepository.createWorkflow({
      name: name.trim(),
      definition: definitionJson,
      ...(typeof isPublished === "boolean" ? { isPublished } : {}),
      createdByUser: { connect: { id: requesterId } },
    });

    res.status(201).json({ success: true, data: workflow });
  } catch (err) {
    console.error("[chain-workflows] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/bindings/upsert", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const { channelId, channelIds, entryAgentSlug, workflowId, enabled, userId } = req.body as {
      // Single channel (legacy). Either this or `channelIds` is required.
      channelId?: string;
      // Multiple channels. Pass the reserved sentinel "*" (alone or as an
      // entry) to bind across ALL channels.
      channelIds?: string[];
      entryAgentSlug?: string;
      workflowId?: string;
      enabled?: boolean;
      // User this binding applies to. Omit to bind for yourself (the default,
      // per-user). Pass the reserved sentinel "*" to bind for any user.
      // Anything else must be a real user id.
      userId?: string;
    };

    // Normalize to a deduped channel list — supports the legacy single
    // `channelId`, the new `channelIds[]`, and the "*" = all-channels sentinel.
    const channels = Array.from(
      new Set(
        (Array.isArray(channelIds) ? channelIds : channelId ? [channelId] : [])
          .map((c) => (typeof c === "string" ? c.trim() : ""))
          .filter(Boolean),
      ),
    );

    if (channels.length === 0 || !entryAgentSlug?.trim() || !workflowId?.trim()) {
      res.status(400).json({ success: false, error: "channelId(s), entryAgentSlug, workflowId are required" });
      return;
    }

    // Default to the requester so a binding is per-user unless explicitly
    // scoped (e.g. an admin binding for another user, or "*" for any user).
    const targetUserId = userId?.trim() || requesterId;

    const workflow = await agentChainWorkflowRepository.findWorkflowById(workflowId.trim());
    if (!workflow) {
      res.status(404).json({ success: false, error: "Workflow not found" });
      return;
    }

    const allowed = await canAccessWorkflow(requesterId, workflow.createdByUserId);
    if (!allowed) {
      res.status(403).json({ success: false, error: "Not allowed to bind this workflow" });
      return;
    }

    const rows = await Promise.all(
      channels.map((c) =>
        agentChainWorkflowRepository.upsertBinding(
          c,
          entryAgentSlug.trim(),
          workflowId.trim(),
          requesterId,
          enabled ?? true,
          targetUserId,
        ),
      ),
    );

    // Back-compat: legacy single-channel callers get a single object; the new
    // multi-channel shape returns the array.
    res.json({ success: true, data: Array.isArray(channelIds) ? rows : rows[0] });
  } catch (err) {
    console.error("[chain-workflows] upsert binding error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PATCH /bindings/:id — toggle a binding's `enabled` flag.
 *
 * Used by the workflow list UI to deactivate a binding without removing it.
 * A disabled binding is invisible to `findActiveWorkflowForChannel` so the
 * chain stops firing immediately, but the row is preserved for easy reactivate.
 */
router.patch("/bindings/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const binding = await agentChainWorkflowRepository.findBindingById(req.params.id);
    if (!binding) {
      res.status(404).json({ success: false, error: "Binding not found" });
      return;
    }

    const allowed = await canAccessWorkflow(requesterId, binding.workflow.createdByUserId);
    if (!allowed) {
      res.status(403).json({ success: false, error: "Not allowed to update this binding" });
      return;
    }

    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ success: false, error: "enabled (boolean) is required" });
      return;
    }

    const row = await agentChainWorkflowRepository.setBindingEnabled(req.params.id, enabled);
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("[chain-workflows] patch binding error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * DELETE /bindings/:id — remove a binding entirely.
 * Useful when the user wants to fully unwire a workflow from a channel rather
 * than just pause it.
 */
router.delete("/bindings/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const binding = await agentChainWorkflowRepository.findBindingById(req.params.id);
    if (!binding) {
      res.status(404).json({ success: false, error: "Binding not found" });
      return;
    }

    const allowed = await canAccessWorkflow(requesterId, binding.workflow.createdByUserId);
    if (!allowed) {
      res.status(403).json({ success: false, error: "Not allowed to delete this binding" });
      return;
    }

    await agentChainWorkflowRepository.deleteBinding(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("[chain-workflows] delete binding error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/bindings/resolve", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const channelId = typeof req.query["channelId"] === "string" ? req.query["channelId"].trim() : "";
    const entryAgentSlug = typeof req.query["entryAgentSlug"] === "string" ? req.query["entryAgentSlug"].trim() : "";
    // Which user's binding to resolve — defaults to the requester (self).
    const userId = typeof req.query["userId"] === "string" && req.query["userId"].trim()
      ? req.query["userId"].trim()
      : requesterId;

    if (!channelId || !entryAgentSlug) {
      res.status(400).json({ success: false, error: "channelId and entryAgentSlug are required" });
      return;
    }

    const row = await agentChainWorkflowRepository.getBinding(channelId, entryAgentSlug, userId);
    if (!row) {
      res.json({ success: true, data: null });
      return;
    }

    const admin = await isClawAdmin(requesterId);
    if (!admin && row.createdByUserId !== requesterId && row.workflow.createdByUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Not allowed to read this binding" });
      return;
    }

    res.json({ success: true, data: row });
  } catch (err) {
    console.error("[chain-workflows] get binding error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── "Push to global" request queue ────────────────────────────────────────
//   owner requests                → POST /:id/request-global
//   admin lists pending           → GET  /global-requests        (admin-only)
//   admin approves                → POST /global-requests/:id/approve (admin)
//   admin rejects                 → POST /global-requests/:id/reject  (admin)
//   owner cancels own pending     → POST /global-requests/:id/cancel
// NOTE: these are declared BEFORE the "/:id" routes so the literal
// "global-requests" path isn't captured as a workflow id.

router.post("/:id/request-global", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }
    const workflow = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
    if (!workflow) {
      res.status(404).json({ success: false, error: "Workflow not found" });
      return;
    }
    if (!(await canAccessWorkflow(requesterId, workflow.createdByUserId))) {
      res.status(403).json({ success: false, error: "Not allowed to request promotion for this workflow" });
      return;
    }
    if (workflow.global) {
      res.json({ success: true, data: { alreadyGlobal: true } });
      return;
    }
    const request = await agentChainWorkflowRepository.createGlobalRequest(workflow.id, requesterId);
    res.json({ success: true, data: request });
  } catch (err) {
    console.error("[chain-workflows] request-global error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/global-requests", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId || !(await isClawAdmin(requesterId))) {
      res.status(403).json({ success: false, error: "Admin access required" });
      return;
    }
    const rows = await agentChainWorkflowRepository.listPendingGlobalRequests();
    // Attach requester display info (plain id → name/email).
    const userIds = Array.from(new Set(rows.map((r) => r.requestedByUserId)));
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, requestedByUser: userMap.get(r.requestedByUserId) ?? null })),
    });
  } catch (err) {
    console.error("[chain-workflows] list global-requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/global-requests/:id/approve", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId || !(await isClawAdmin(requesterId))) {
      res.status(403).json({ success: false, error: "Admin access required" });
      return;
    }
    const result = await agentChainWorkflowRepository.approveGlobalRequest(req.params.id, requesterId);
    if (!result) {
      res.status(409).json({ success: false, error: "Request not found or no longer pending" });
      return;
    }
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[chain-workflows] approve global-request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/global-requests/:id/reject", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId || !(await isClawAdmin(requesterId))) {
      res.status(403).json({ success: false, error: "Admin access required" });
      return;
    }
    const note = typeof (req.body as { note?: unknown })?.note === "string" ? (req.body as { note: string }).note : undefined;
    const result = await agentChainWorkflowRepository.rejectGlobalRequest(req.params.id, requesterId, note);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[chain-workflows] reject global-request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/global-requests/:id/cancel", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }
    const reqRow = await agentChainWorkflowRepository.findGlobalRequestById(req.params.id);
    if (!reqRow) {
      res.status(404).json({ success: false, error: "Request not found" });
      return;
    }
    const isAdmin = await isClawAdmin(requesterId);
    if (!isAdmin && reqRow.requestedByUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Not allowed to cancel this request" });
      return;
    }
    const result = await agentChainWorkflowRepository.cancelGlobalRequest(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[chain-workflows] cancel global-request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const row = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
    if (!row) {
      res.status(404).json({ success: false, error: "Workflow not found" });
      return;
    }

    const allowed = await canAccessWorkflow(requesterId, row.createdByUserId);
    if (!allowed) {
      res.status(403).json({ success: false, error: "Not allowed to read this workflow" });
      return;
    }

    res.json({ success: true, data: row });
  } catch (err) {
    console.error("[chain-workflows] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const existing = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, error: "Workflow not found" });
      return;
    }

    const allowed = await canAccessWorkflow(requesterId, existing.createdByUserId);
    if (!allowed) {
      res.status(403).json({ success: false, error: "Not allowed to update this workflow" });
      return;
    }

    const { name, definition, isPublished } = req.body as {
      name?: string;
      definition?: unknown;
      isPublished?: boolean;
    };

    let parsedDefinition: WorkflowDefinition | undefined;
    if (definition !== undefined) {
      parsedDefinition = parseWorkflowDefinition(definition) ?? undefined;
      if (!parsedDefinition) {
        res.status(400).json({ success: false, error: "definition is invalid" });
        return;
      }
      const validationError = validateWorkflowDefinition(parsedDefinition);
      if (validationError) {
        res.status(400).json({ success: false, error: validationError });
        return;
      }
    }

    const definitionJson = parsedDefinition !== undefined
      ? JSON.parse(JSON.stringify(parsedDefinition)) as Prisma.InputJsonValue
      : undefined;

    const row = await agentChainWorkflowRepository.updateWorkflow(req.params.id, {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(definitionJson !== undefined ? { definition: definitionJson } : {}),
      ...(typeof isPublished === "boolean" ? { isPublished } : {}),
    });

    res.json({ success: true, data: row });
  } catch (err) {
    console.error("[chain-workflows] update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id required" });
      return;
    }

    const existing = await agentChainWorkflowRepository.findWorkflowById(req.params.id);
    if (!existing) {
      res.status(404).json({ success: false, error: "Workflow not found" });
      return;
    }

    const allowed = await canAccessWorkflow(requesterId, existing.createdByUserId);
    if (!allowed) {
      res.status(403).json({ success: false, error: "Not allowed to delete this workflow" });
      return;
    }

    await agentChainWorkflowRepository.deleteWorkflow(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Workflow not found" });
      return;
    }
    console.error("[chain-workflows] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as chainWorkflowsRouter };
