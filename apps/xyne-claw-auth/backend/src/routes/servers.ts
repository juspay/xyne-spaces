import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, HttpError } from "../lib/http.js";
import { prisma } from "../db.js";
import { isValidServerType } from "../validation.js";
import type { CredentialField } from "../mcp/types.js";
import { getCredentialFieldsByServerType } from "../mcp/connector-definitions.js";
import { getRequesterId, isClawAdmin, requireClawAdmin } from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";
import { isOAuthConnector } from "./oauth-token.js";
import { evictSession } from "../mcp/runner.js";

import { createLogger } from "../logger.js";
const log = createLogger("servers");

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

// A stdio connector's `cmd` is spawned by the gateway. Restrict it to a vetted
// set of package launchers so a registered connector can't be a direct shell
// (the prior gap: cmd="bash", args=["-c","<reverse shell>"] was accepted and
// spawned verbatim). Shells, interpreters invoked as a bare command, and any
// absolute/relative path are rejected. NOTE: this is a launcher allow-list, not
// a full per-binary registry — `node -e` / `python -c` style payloads are still
// expressible by an authenticated registrant, so /servers also requires a real
// session (requireUserAuth) and connector publishing stays admin-gated.
const ALLOWED_STDIO_CMDS = new Set<string>([
  "npx", "node", "npm", "pnpm", "bunx", "bun",
  "uvx", "uv", "python", "python3",
  "deno", "mcp-remote", "docker",
]);

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

    // Reject anything outside the vetted launcher allow-list, and any cmd that
    // carries a path separator (e.g. /bin/bash, ./run.sh) — only a bare,
    // allow-listed launcher name is permitted.
    const cmdName = cmd.trim();
    if (cmdName.includes("/") || cmdName.includes("\\")) {
      return `Launch Config cmd must be a bare launcher name, not a path: "${cmdName}"`;
    }
    if (!ALLOWED_STDIO_CMDS.has(cmdName)) {
      return `Launch Config cmd "${cmdName}" is not an allowed launcher. Allowed: ${[...ALLOWED_STDIO_CMDS].join(", ")}`;
    }

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

router.get("/credential-fields", asyncHandler(async (_req: Request, res: Response) => {
  const data: Record<string, readonly CredentialField[]> = await getCredentialFieldsByServerType();
  ok(res, data);
}));

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  const servers = await mcpServerAny.findMany({
    orderBy: { name: "asc" },
  });
  const visible = servers.filter((s: any) => isVisibleToUser(parseConnectorMeta(s.connectorMeta), requesterId));
  // Decorate with `oauth` so the UI can tell OAuth connectors apart (they
  // need the browser flow, can't be pinned credential-less) without
  // hardcoding a google/microsoft list in the frontend. isOAuthConnector is
  // registry-derived (true for any connector with a registered
  // OAuthTokenProvider) OR'd with the DB-declared isOauth flag, so a future
  // admin-defined connector with no code can also opt in.
  const decorated = visible.map((s: any) => ({ ...s, oauth: isOAuthConnector(s.type, s.connectorMeta, Boolean(s.isOauth)) }));
  ok(res, decorated);
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
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
    throw badRequest("name is required");
  }

  if (!type || typeof type !== "string" || type.trim().length === 0) {
    throw badRequest("type is required");
  }

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    throw badRequest("url is required");
  }

  const existingType = await isValidServerType(type);
  const effectiveTransport = transport === "http" ? "http" : "stdio";

  // HARD BLOCK: stdio connectors are code-only. A stdio launchConfigTemplate
  // becomes a child process spawned INSIDE the claw-auth gateway (the trusted
  // tier holding the platform's secrets — see mcp/runner.ts). Allow-listing
  // `cmd` to npx/node/python/docker is NOT a boundary: `npx <evil-pkg>`,
  // `node -e`, `python -c`, `docker run` all execute arbitrary code. So no
  // stdio launch command may be registered via the API at all — new stdio
  // connectors must be added as a code-reviewed static adapter under
  // src/mcp/adapters/. (The resolver also ignores any DB-stored stdio launch
  // command at spawn time, so a pre-existing or injected row can't run either.)
  // Self-serve users may still register `http` (remote) MCP connectors, which
  // never spawn a local process.
  if (effectiveTransport === "stdio" && launchConfigTemplate) {
    throw forbidden("stdio connectors cannot be registered via the API. Add a code-reviewed static adapter under src/mcp/adapters/, or register an http (remote) MCP connector instead.");
  }

  if (!existingType && !launchConfigTemplate && !httpConfigTemplate) {
    throw badRequest("New connector types require launch/http config templates");
  }

  const validationError = validateConnectorConfig({
    transport: effectiveTransport,
    launchConfigTemplate,
    httpConfigTemplate,
  });
  if (validationError) {
    throw badRequest(validationError);
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
    throw forbidden("Only connector author or CLAW_ADMIN can edit this definition");
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
}));

router.post("/:id/request-publish", asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const server = await mcpServerAny.findUnique({ where: { id } });
  if (!server) {
    throw notFound("Server not found");
  }
  const meta = parseConnectorMeta(server.connectorMeta);
  if (meta.scope === "global") {
    throw badRequest("Connector is already global");
  }
  if (meta.ownerUserId !== requesterId) {
    throw forbidden("Only connector author can request publish");
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
  ok(res, updated);
}));

router.get("/publish-requests", requireClawAdmin, asyncHandler(async (_req, res) => {
  // Platform-global by design: MCP Publish reviews promote connector definitions for all orgs.
  const servers = await mcpServerAny.findMany({ orderBy: { updatedAt: "desc" } });
  const pending = servers.filter((s: any) => parseConnectorMeta(s.connectorMeta).publishStatus === "pending");
  ok(res, pending);
}));

router.post("/publish-requests/:id/approve", requireClawAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const reviewerId = getRequesterId(req)!;
  const server = await mcpServerAny.findUnique({ where: { id } });
  if (!server) {
    throw notFound("Server not found");
  }
  const meta = parseConnectorMeta(server.connectorMeta);
  if (meta.publishStatus !== "pending") {
    throw badRequest("No pending publish request for this connector");
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
  ok(res, updated);
}));

router.post("/publish-requests/:id/reject", requireClawAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const reviewerId = getRequesterId(req)!;
  const { note } = req.body as { note?: string };
  const server = await mcpServerAny.findUnique({ where: { id } });
  if (!server) {
    throw notFound("Server not found");
  }
  const meta = parseConnectorMeta(server.connectorMeta);
  if (meta.publishStatus !== "pending") {
    throw badRequest("No pending publish request for this connector");
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
  ok(res, updated);
}));

// ── Global-connector edit-request queue ──────────────────────────────────
//
// Lifecycle for any mutation to a scope=global connector:
//   submitter (POST /servers) → pending request row
//   admin reviews              → /edit-requests (admin-only list)
//   admin approves             → /edit-requests/:id/approve (fields copied to live row)
//   admin rejects              → /edit-requests/:id/reject  (request closed, live row untouched)
//   submitter cancels own      → /edit-requests/:id/cancel  (no admin needed)

router.get("/edit-requests", requireClawAdmin, asyncHandler(async (_req: Request, res: Response) => {
  // Platform-global by design: global MCP connector edits mutate shared registry rows.
  const requests = await prisma.mcpConnectorEditRequest.findMany({
    where: { status: "pending" },
    include: { mcpServer: { select: { id: true, type: true, name: true, launchConfigTemplate: true, httpConfigTemplate: true, credentialForm: true, transport: true } } },
    orderBy: { createdAt: "desc" },
  });
  ok(res, requests);
}));

router.post("/edit-requests/:id/approve", requireClawAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const reviewerId = getRequesterId(req)!;
  const editRequest = await prisma.mcpConnectorEditRequest.findUnique({
    where: { id },
    include: { mcpServer: true },
  });
  if (!editRequest) {
    throw notFound("Edit request not found");
  }
  if (editRequest.status !== "pending") {
    throw badRequest(`Edit request is ${editRequest.status}, not pending`);
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

  ok(res, { editRequestId: editRequest.id, server: after });
}));

router.post("/edit-requests/:id/reject", requireClawAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const reviewerId = getRequesterId(req)!;
  const { note } = req.body as { note?: string };
  const editRequest = await prisma.mcpConnectorEditRequest.findUnique({ where: { id } });
  if (!editRequest) {
    throw notFound("Edit request not found");
  }
  if (editRequest.status !== "pending") {
    throw badRequest(`Edit request is ${editRequest.status}, not pending`);
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

  ok(res);
}));

router.post("/edit-requests/:id/cancel", asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    throw unauthorized("x-user-id header is required");
  }
  const editRequest = await prisma.mcpConnectorEditRequest.findUnique({ where: { id } });
  if (!editRequest) {
    throw notFound("Edit request not found");
  }
  if (editRequest.status !== "pending") {
    throw badRequest(`Edit request is ${editRequest.status}, not pending`);
  }
  // Only the proposer (or an admin) can cancel.
  const requesterIsAdmin = await isClawAdmin(requesterId);
  if (!requesterIsAdmin && editRequest.proposedByUserId !== requesterId) {
    throw forbidden("Only the proposer or CLAW_ADMIN can cancel this request");
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

  ok(res);
}));

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }
    // Snapshot before delete so the audit row preserves the connector shape
    // for forensic restore. Without this the row vanishes with no trail.
    const existing = await prisma.mcpServer.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: "Server not found" });
      return;
    }
    // Authorization: only the connector's owner or a CLAW_ADMIN may delete it.
    // Without this any authenticated user could delete global/shared
    // connectors (slack, grafana, …) and then re-register the type as their
    // own with an attacker-chosen config.
    const existingMeta = parseConnectorMeta(existing.connectorMeta);
    const requesterIsAdmin = await isClawAdmin(requesterId);
    if (!requesterIsAdmin && existingMeta.ownerUserId !== requesterId) {
      res.status(403).json({ success: false, error: "Only the connector owner or a CLAW_ADMIN can delete it" });
      return;
    }
    // Snapshot connection owners before deleting the McpServer: the DB relation
    // cascades UserMcpConnection rows, so this is the last point where we can
    // identify cached MCP runner sessions to evict. Without this, a spawned
    // stdio/http MCP client can remain callable until the normal idle eviction.
    const connections = await prisma.userMcpConnection.findMany({
      where: { mcpServerId: id },
      select: { userId: true },
    });

    for (const connection of connections) {
      await evictSession(connection.userId, existing.type).catch((err) => {
        log.error(`[servers] evictSession failed for ${existing.type}:`, err);
      });
    }

    await prisma.mcpServer.delete({ where: { id } });

    // Tools synced from MCPs are keyed by a plain string source (not an FK to
    // McpServer), so the cascade above cannot remove them. Delete them
    // explicitly; AgentTool links cascade through Tool -> AgentTool.
    const deletedTools = await prisma.tool.deleteMany({
      where: { source: `mcp:${existing.type}` },
    });

    await writeAuditLog({
      actorUserId: requesterId,
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
        deletedToolsCount: deletedTools.count,
      },
    });
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Server not found" });
      return;
    }
    log.error("[servers] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as serversRouter };
