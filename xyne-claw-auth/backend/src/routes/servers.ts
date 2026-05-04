import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isValidServerType } from "../validation.js";
import type { CredentialField } from "../mcp/types.js";
import { getCredentialFieldsByServerType } from "../mcp/connector-definitions.js";
import { getRequesterId, isClawAdmin, requireClawAdmin } from "../middleware/agent-acl.js";

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
      res.status(201).json({ success: true, data: server });
      return;
    }

    const existingMeta = parseConnectorMeta(existing.connectorMeta);
    const canEdit = requesterIsAdmin || existingMeta.ownerUserId === requesterId;
    if (!canEdit) {
      res.status(403).json({ success: false, error: "Only connector author or CLAW_ADMIN can edit this definition" });
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

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    await prisma.mcpServer.delete({ where: { id } });
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
