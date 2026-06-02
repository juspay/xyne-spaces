import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isValidServerType } from "../validation.js";
import type { CredentialField } from "../mcp/types.js";
import { getCredentialFieldsByServerType } from "../mcp/connector-definitions.js";
import { getRequesterId, isClawAdmin, requireClawAdmin } from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";

/**
 * Diff two connector-definition snapshots and return only the fields that
 * changed. Keeps audit metadata compact AND highlights exactly which knob
 * a regression rode in on (e.g. launchConfigTemplate.env going from
 * { GRAFANA_URL: "{{url}}", … } → {}).
 *
 * Skips id/createdAt/updatedAt/scoped relation fields. JSON columns are
 * shallow-compared via JSON.stringify — good enough to detect changes and
 * preserve the before/after for a human reviewer.
 */
function diffConnector(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, { before: unknown; after: unknown }> {
  const SKIP = new Set(["id", "createdAt", "updatedAt", "globalCredentials"]);
  const out: Record<string, { before: unknown; after: unknown }> = {};
  const beforeObj = before ?? {};
  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(after)]);
  for (const k of allKeys) {
    if (SKIP.has(k)) continue;
    const b = (beforeObj as Record<string, unknown>)[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out[k] = { before: b ?? null, after: a ?? null };
    }
  }
  return out;
}

const router = Router();
const mcpServerAny = prisma.mcpServer as any;

type ConnectorScope = "personal" | "global";
type PublishStatus = "draft" | "pending" | "approved" | "rejected";

type ConnectorMeta = {
  ownerType?: string;
  ownerUserId?: string;
  scope?: ConnectorScope;
  publishStatus?: PublishStatus;
  publishRequestedAt?: string;
  publishReviewedAt?: string;
  publishReviewedBy?: string;
  publishReviewNote?: string;
  mode?: string;
};

function parseConnectorMeta(value: unknown): ConnectorMeta {
  return isRecord(value) ? (value as ConnectorMeta) : {};
}

function isVisibleToUser(meta: ConnectorMeta, requesterId?: string): boolean {
  const scope = meta.scope ?? "global";
  if (scope === "global") return true;
  return Boolean(requesterId && meta.ownerUserId === requesterId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateConnectorConfig(input: {
  transport: "stdio" | "http";
  launchConfigTemplate?: Prisma.InputJsonValue | undefined;
  httpConfigTemplate?: Prisma.InputJsonValue | undefined;
}): string | null {
  if (input.transport === "stdio") {
    if (!isRecord(input.launchConfigTemplate)) return "stdio transport requires Launch Config JSON";
    const launch = input.launchConfigTemplate as Record<string, unknown>;
    const cmd = launch["cmd"];
    const args = launch["args"];
    if (typeof cmd !== "string" || cmd.trim().length === 0) return "Launch Config JSON must include non-empty cmd";
    if (!Array.isArray(args)) return "Launch Config JSON must include args array";

    // Guard common pitfall: mcp-remote target as relative path (e.g. /crm/v2)
    const usesMcpRemote = (cmd === "mcp-remote") || args.some((a) => String(a) === "mcp-remote");
    if (usesMcpRemote) {
      const maybeUrlArg = args.find((a) => typeof a === "string" && !String(a).startsWith("-") && String(a) !== "mcp-remote");
      if (typeof maybeUrlArg === "string") {
        const candidate = maybeUrlArg.trim();
        const hasTemplateToken = candidate.includes("{{");
        if (!hasTemplateToken && !isAbsoluteHttpUrl(candidate)) {
          return "Launch Config JSON for mcp-remote requires an absolute http(s) URL argument";
        }
        if (!hasTemplateToken && /zohoapis\./i.test(candidate) && /\/crm\//i.test(candidate)) {
          return "mcp-remote requires an MCP endpoint, but this looks like a Zoho REST API URL. Use a Zoho MCP server endpoint/package instead.";
        }
      }
    }
  } else {
    if (!isRecord(input.httpConfigTemplate)) return "http transport requires HTTP Config JSON";
    const http = input.httpConfigTemplate as Record<string, unknown>;
    const url = http["url"];
    if (typeof url !== "string" || url.trim().length === 0) return "HTTP Config JSON must include non-empty url";
    if (!url.includes("{{") && !isAbsoluteHttpUrl(url)) return "HTTP Config JSON url must be an absolute http(s) URL";
  }
  return null;
}

router.get("/credential-fields", async (_req: Request, res: Response) => {
  const data: Record<string, readonly CredentialField[]> = await getCredentialFieldsByServerType();
  res.json({ success: true, data });
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    const servers = await mcpServerAny.findMany({
      orderBy: { name: "asc" },
    });
    const visible = servers.filter((s: any) => isVisibleToUser(parseConnectorMeta(s.connectorMeta), requesterId));
    res.json({ success: true, data: visible });
  } catch (err) {
    console.error("[servers] list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }
    const requesterIsAdmin = await isClawAdmin(requesterId);

    const { name, type, url, description, transport, credentialForm, credentialSchema, launchConfigTemplate, httpConfigTemplate, healthcheckSpec, writeToolPolicy, connectorMeta } = req.body as {
      name?: string;
      type?: string;
      url?: string;
      description?: string;
      transport?: string;
      credentialForm?: Prisma.InputJsonValue;
      credentialSchema?: Prisma.InputJsonValue;
      launchConfigTemplate?: Prisma.InputJsonValue;
      httpConfigTemplate?: Prisma.InputJsonValue;
      healthcheckSpec?: Prisma.InputJsonValue;
      writeToolPolicy?: Prisma.InputJsonValue;
      connectorMeta?: Prisma.InputJsonValue;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ success: false, error: "name is required" });
      return;
    }

    if (!type || typeof type !== "string" || type.trim().length === 0) {
      res.status(400).json({ success: false, error: "type is required" });
      return;
    }

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      res.status(400).json({ success: false, error: "url is required" });
      return;
    }

    const existingType = await isValidServerType(type);
    const effectiveTransport = transport === "http" ? "http" : "stdio";

    if (!existingType && !launchConfigTemplate && !httpConfigTemplate) {
      res.status(400).json({ success: false, error: "New connector types require launch/http config templates" });
      return;
    }

    const validationError = validateConnectorConfig({
      transport: effectiveTransport,
      launchConfigTemplate,
      httpConfigTemplate,
    });
    if (validationError) {
      res.status(400).json({ success: false, error: validationError });
      return;
    }

    const data: {
      name: string;
      type: string;
      url: string;
      description?: string;
      transport: string;
      credentialForm?: Prisma.InputJsonValue;
      credentialSchema?: Prisma.InputJsonValue;
      launchConfigTemplate?: Prisma.InputJsonValue;
      httpConfigTemplate?: Prisma.InputJsonValue;
      healthcheckSpec?: Prisma.InputJsonValue;
      writeToolPolicy?: Prisma.InputJsonValue;
      connectorMeta?: Prisma.InputJsonValue;
    } = {
      name: name.trim(),
      type,
      url: url.trim(),
      transport: effectiveTransport,
      connectorMeta: {
        ownerType: "user",
        mode: "self-serve",
        ...(connectorMeta && typeof connectorMeta === "object" ? connectorMeta : {}),
      } as Prisma.InputJsonValue,
    };
    if (description && typeof description === "string" && description.trim().length > 0) {
      data.description = description.trim();
    }
    if (credentialForm) data.credentialForm = credentialForm;
    if (credentialSchema) data.credentialSchema = credentialSchema;
    if (launchConfigTemplate) data.launchConfigTemplate = launchConfigTemplate;
    if (httpConfigTemplate) data.httpConfigTemplate = httpConfigTemplate;
    if (healthcheckSpec) data.healthcheckSpec = healthcheckSpec;
    if (writeToolPolicy) data.writeToolPolicy = writeToolPolicy;

    const existing = await mcpServerAny.findUnique({ where: { type } });
    if (!existing) {
      const server = await mcpServerAny.create({
        data: {
          ...data,
          connectorMeta: {
            ...(isRecord(data.connectorMeta) ? data.connectorMeta : {}),
            ownerType: "user",
            ownerUserId: requesterId,
            scope: "personal",
            publishStatus: "draft",
            mode: "self-serve",
          } as Prisma.InputJsonValue,
        },
      });
      await writeAuditLog({
        actorUserId: requesterId,
        eventType: "MCP_CONNECTOR_CREATED",
        targetId: server.id,
        description: `Created MCP connector definition ${server.type} (${server.name})`,
        metadata: {
          type: server.type,
          name: server.name,
          transport: server.transport,
          // Full initial snapshot — small enough to fit, useful for "what did
          // the first version look like" forensics.
          launchConfigTemplate: server.launchConfigTemplate,
          httpConfigTemplate: server.httpConfigTemplate,
          credentialForm: server.credentialForm,
        },
      });
      res.status(201).json({ success: true, data: server });
      return;
    }

    const existingMeta = parseConnectorMeta(existing.connectorMeta);
    const canEdit = requesterIsAdmin || existingMeta.ownerUserId === requesterId;
    if (!canEdit) {
      res.status(403).json({ success: false, error: "Only connector author or CLAW_ADMIN can edit this definition" });
      return;
    }

    // Global-connector hardening: any change to a scope=global row goes
    // through the admin review queue, regardless of requester role. This
    // includes CLAW_ADMIN edits — the queue is the single audit-able
    // surface for global mutations, no exceptions. (Post-ppi-grafana-v2
    // incident: 2026-05-22.)
    if (existingMeta.scope === "global") {
      const proposedFields: Record<string, unknown> = {
        name: data.name,
        url: data.url,
        description: data.description ?? null,
        transport: effectiveTransport,
      };
      if (data.credentialForm)        proposedFields["credentialForm"]        = data.credentialForm;
      if (data.credentialSchema)      proposedFields["credentialSchema"]      = data.credentialSchema;
      if (data.launchConfigTemplate)  proposedFields["launchConfigTemplate"]  = data.launchConfigTemplate;
      if (data.httpConfigTemplate)    proposedFields["httpConfigTemplate"]    = data.httpConfigTemplate;
      if (data.healthcheckSpec)       proposedFields["healthcheckSpec"]       = data.healthcheckSpec;
      if (data.writeToolPolicy)       proposedFields["writeToolPolicy"]       = data.writeToolPolicy;

      // Supersede any existing pending request for this connector — one
      // active proposal per (mcpServerId). Prior `pending` rows flip to
      // `superseded` so we keep the audit trail without ambiguous state.
      const prior = await prisma.mcpConnectorEditRequest.findMany({
        where: { mcpServerId: existing.id, status: "pending" },
      });
      for (const p of prior) {
        await prisma.mcpConnectorEditRequest.update({
          where: { id: p.id },
          data: {
            status: "superseded",
            reviewedAt: new Date(),
            reviewNote: `Superseded by newer proposal from ${requesterId}`,
          },
        });
        await writeAuditLog({
          actorUserId: requesterId,
          eventType: "MCP_CONNECTOR_EDIT_SUPERSEDED",
          targetId: p.id,
          description: `Superseded prior pending edit on ${existing.type}`,
          metadata: { mcpServerId: existing.id, supersededRequestId: p.id },
        });
      }

      const editRequest = await prisma.mcpConnectorEditRequest.create({
        data: {
          mcpServerId: existing.id,
          proposedByUserId: requesterId,
          proposedFields: proposedFields as Prisma.InputJsonValue,
          status: "pending",
        },
      });

      await writeAuditLog({
        actorUserId: requesterId,
        eventType: "MCP_CONNECTOR_EDIT_REQUESTED",
        targetId: editRequest.id,
        description: `Proposed edit to global connector ${existing.type}`,
        metadata: {
          mcpServerId: existing.id,
          mcpServerType: existing.type,
          proposedFields,
        },
      });

      // 202 Accepted — request is queued for review, NOT applied. Frontend
      // should display "Change submitted for admin approval" rather than
      // the usual "Saved" toast.
      res.status(202).json({
        success: true,
        data: {
          editRequest: { id: editRequest.id, status: "pending" },
          message: "Global connector — change submitted for admin review.",
        },
      });
      return;
    }

    const mergedMeta: ConnectorMeta = {
      ...existingMeta,
      ...(isRecord(data.connectorMeta) ? (data.connectorMeta as ConnectorMeta) : {}),
      ownerType: existingMeta.ownerType ?? "user",
      ownerUserId: existingMeta.ownerUserId ?? requesterId,
      scope: existingMeta.scope ?? "personal",
      mode: "self-serve",
    };

    const server = await mcpServerAny.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        url: data.url,
        description: data.description ?? null,
        transport: effectiveTransport,
        ...(data.credentialForm ? { credentialForm: data.credentialForm } : {}),
        ...(data.credentialSchema ? { credentialSchema: data.credentialSchema } : {}),
        ...(effectiveTransport === "stdio"
          ? {
            launchConfigTemplate: data.launchConfigTemplate ?? null,
            httpConfigTemplate: null,
          }
          : {
            httpConfigTemplate: data.httpConfigTemplate ?? null,
            launchConfigTemplate: null,
          }),
        ...(data.healthcheckSpec ? { healthcheckSpec: data.healthcheckSpec } : {}),
        ...(data.writeToolPolicy ? { writeToolPolicy: data.writeToolPolicy } : {}),
        connectorMeta: mergedMeta as Prisma.InputJsonValue,
      } as any,
    });
    // Capture before/after diff. The `existing` snapshot was fetched at line
    // 198 — predates the update by a few ms, which is what we want. The
    // metadata.diff is the queryable forensic surface: filter by event +
    // targetId, inspect diff.launchConfigTemplate.{before,after} to see
    // exactly what changed and revert if needed.
    const diff = diffConnector(existing as unknown as Record<string, unknown>, server as Record<string, unknown>);
    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "MCP_CONNECTOR_UPDATED",
      targetId: server.id,
      description: `Updated MCP connector definition ${server.type} (${Object.keys(diff).join(", ") || "no field changes"})`,
      metadata: {
        type: server.type,
        name: server.name,
        changedFields: Object.keys(diff),
        diff,
      },
    });
    res.status(201).json({ success: true, data: server });
  } catch (err) {
    console.error("[servers] create error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:id/request-publish", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }
    const server = await mcpServerAny.findUnique({ where: { id: req.params.id } });
    if (!server) {
      res.status(404).json({ success: false, error: "Server not found" });
      return;
    }
    const meta = parseConnectorMeta(server.connectorMeta);
    if (meta.scope === "global") {
      res.status(400).json({ success: false, error: "Connector is already global" });
      return;
    }
    if (meta.ownerUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Only connector author can request publish" });
      return;
    }
    const updated = await mcpServerAny.update({
      where: { id: server.id },
      data: {
        connectorMeta: {
          ...meta,
          publishStatus: "pending",
          publishRequestedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[servers] request-publish error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/publish-requests", requireClawAdmin, async (_req: Request, res: Response) => {
  try {
    const servers = await mcpServerAny.findMany({ orderBy: { updatedAt: "desc" } });
    const pending = servers.filter((s: any) => parseConnectorMeta(s.connectorMeta).publishStatus === "pending");
    res.json({ success: true, data: pending });
  } catch (err) {
    console.error("[servers] publish-requests list error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/publish-requests/:id/approve", requireClawAdmin, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const server = await mcpServerAny.findUnique({ where: { id: req.params.id } });
    if (!server) {
      res.status(404).json({ success: false, error: "Server not found" });
      return;
    }
    const meta = parseConnectorMeta(server.connectorMeta);
    if (meta.publishStatus !== "pending") {
      res.status(400).json({ success: false, error: "No pending publish request for this connector" });
      return;
    }
    const updated = await mcpServerAny.update({
      where: { id: server.id },
      data: {
        connectorMeta: {
          ...meta,
          scope: "global",
          publishStatus: "approved",
          publishReviewedAt: new Date().toISOString(),
          publishReviewedBy: reviewerId,
        } as Prisma.InputJsonValue,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[servers] approve publish error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/publish-requests/:id/reject", requireClawAdmin, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const { note } = req.body as { note?: string };
    const server = await mcpServerAny.findUnique({ where: { id: req.params.id } });
    if (!server) {
      res.status(404).json({ success: false, error: "Server not found" });
      return;
    }
    const meta = parseConnectorMeta(server.connectorMeta);
    if (meta.publishStatus !== "pending") {
      res.status(400).json({ success: false, error: "No pending publish request for this connector" });
      return;
    }
    const updated = await mcpServerAny.update({
      where: { id: server.id },
      data: {
        connectorMeta: {
          ...meta,
          publishStatus: "rejected",
          publishReviewedAt: new Date().toISOString(),
          publishReviewedBy: reviewerId,
          publishReviewNote: note ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[servers] reject publish error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Global-connector edit-request queue ──────────────────────────────────
//
// Lifecycle for any mutation to a scope=global connector:
//   submitter (POST /servers) → pending request row
//   admin reviews              → /edit-requests (admin-only list)
//   admin approves             → /edit-requests/:id/approve (fields copied to live row)
//   admin rejects              → /edit-requests/:id/reject  (request closed, live row untouched)
//   submitter cancels own      → /edit-requests/:id/cancel  (no admin needed)

router.get("/edit-requests", requireClawAdmin, async (_req: Request, res: Response) => {
  try {
    const requests = await prisma.mcpConnectorEditRequest.findMany({
      where: { status: "pending" },
      include: { mcpServer: { select: { id: true, type: true, name: true, launchConfigTemplate: true, httpConfigTemplate: true, credentialForm: true, transport: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: requests });
  } catch (err) {
    console.error("[servers] list edit-requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/edit-requests/:id/approve", requireClawAdmin, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const editRequest = await prisma.mcpConnectorEditRequest.findUnique({
      where: { id: req.params.id },
      include: { mcpServer: true },
    });
    if (!editRequest) {
      res.status(404).json({ success: false, error: "Edit request not found" });
      return;
    }
    if (editRequest.status !== "pending") {
      res.status(400).json({ success: false, error: `Edit request is ${editRequest.status}, not pending` });
      return;
    }

    const proposed = editRequest.proposedFields as Record<string, unknown>;
    const transport = (proposed["transport"] as string) === "http" ? "http" : "stdio";

    // Apply the proposed fields to the live McpServer row. Same shape as
    // the regular update path, except transport-specific template fields
    // are mutually exclusive (stdio clears http, http clears stdio).
    const updateData: Record<string, unknown> = {
      name: proposed["name"] ?? editRequest.mcpServer.name,
      url: proposed["url"] ?? editRequest.mcpServer.url,
      description: proposed["description"] ?? null,
      transport,
    };
    if (proposed["credentialForm"])   updateData["credentialForm"]   = proposed["credentialForm"];
    if (proposed["credentialSchema"]) updateData["credentialSchema"] = proposed["credentialSchema"];
    if (transport === "stdio") {
      updateData["launchConfigTemplate"] = proposed["launchConfigTemplate"] ?? null;
      updateData["httpConfigTemplate"]   = null;
    } else {
      updateData["httpConfigTemplate"]   = proposed["httpConfigTemplate"] ?? null;
      updateData["launchConfigTemplate"] = null;
    }
    if (proposed["healthcheckSpec"]) updateData["healthcheckSpec"] = proposed["healthcheckSpec"];
    if (proposed["writeToolPolicy"]) updateData["writeToolPolicy"] = proposed["writeToolPolicy"];

    const before = editRequest.mcpServer;
    const after = await prisma.mcpServer.update({
      where: { id: editRequest.mcpServerId },
      data: updateData as Prisma.McpServerUpdateInput,
    });

    await prisma.mcpConnectorEditRequest.update({
      where: { id: editRequest.id },
      data: { status: "approved", reviewedByUserId: reviewerId, reviewedAt: new Date() },
    });

    const diff = diffConnector(before as unknown as Record<string, unknown>, after as Record<string, unknown>);
    await writeAuditLog({
      actorUserId: reviewerId,
      eventType: "MCP_CONNECTOR_EDIT_APPROVED",
      targetId: editRequest.id,
      description: `Approved edit on ${before.type} by ${editRequest.proposedByUserId}`,
      metadata: {
        mcpServerId: editRequest.mcpServerId,
        mcpServerType: before.type,
        proposedByUserId: editRequest.proposedByUserId,
        changedFields: Object.keys(diff),
        diff,
      },
    });

    res.json({ success: true, data: { editRequestId: editRequest.id, server: after } });
  } catch (err) {
    console.error("[servers] approve edit-request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/edit-requests/:id/reject", requireClawAdmin, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const { note } = req.body as { note?: string };
    const editRequest = await prisma.mcpConnectorEditRequest.findUnique({ where: { id: req.params.id } });
    if (!editRequest) {
      res.status(404).json({ success: false, error: "Edit request not found" });
      return;
    }
    if (editRequest.status !== "pending") {
      res.status(400).json({ success: false, error: `Edit request is ${editRequest.status}, not pending` });
      return;
    }

    await prisma.mcpConnectorEditRequest.update({
      where: { id: editRequest.id },
      data: { status: "rejected", reviewedByUserId: reviewerId, reviewedAt: new Date(), reviewNote: note ?? null },
    });

    await writeAuditLog({
      actorUserId: reviewerId,
      eventType: "MCP_CONNECTOR_EDIT_REJECTED",
      targetId: editRequest.id,
      description: `Rejected edit on connector by ${editRequest.proposedByUserId}`,
      metadata: {
        mcpServerId: editRequest.mcpServerId,
        proposedByUserId: editRequest.proposedByUserId,
        note: note ?? null,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[servers] reject edit-request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/edit-requests/:id/cancel", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }
    const editRequest = await prisma.mcpConnectorEditRequest.findUnique({ where: { id: req.params.id } });
    if (!editRequest) {
      res.status(404).json({ success: false, error: "Edit request not found" });
      return;
    }
    if (editRequest.status !== "pending") {
      res.status(400).json({ success: false, error: `Edit request is ${editRequest.status}, not pending` });
      return;
    }
    // Only the proposer (or an admin) can cancel.
    const requesterIsAdmin = await isClawAdmin(requesterId);
    if (!requesterIsAdmin && editRequest.proposedByUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Only the proposer or CLAW_ADMIN can cancel this request" });
      return;
    }

    await prisma.mcpConnectorEditRequest.update({
      where: { id: editRequest.id },
      data: { status: "cancelled", reviewedByUserId: requesterId, reviewedAt: new Date() },
    });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "MCP_CONNECTOR_EDIT_CANCELLED",
      targetId: editRequest.id,
      description: `Cancelled own edit request`,
      metadata: { mcpServerId: editRequest.mcpServerId },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[servers] cancel edit-request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const requesterId = getRequesterId(req);
    // Snapshot before delete so the audit row preserves the connector shape
    // for forensic restore. Without this the row vanishes with no trail.
    const existing = await prisma.mcpServer.findUnique({ where: { id } });
    await prisma.mcpServer.delete({ where: { id } });
    if (existing) {
      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "MCP_CONNECTOR_DELETED",
        targetId: existing.id,
        description: `Deleted MCP connector definition ${existing.type} (${existing.name})`,
        metadata: {
          type: existing.type,
          name: existing.name,
          transport: existing.transport,
          launchConfigTemplate: existing.launchConfigTemplate,
          httpConfigTemplate: existing.httpConfigTemplate,
          credentialForm: existing.credentialForm,
        },
      });
    }
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Server not found" });
      return;
    }
    console.error("[servers] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as serversRouter };
