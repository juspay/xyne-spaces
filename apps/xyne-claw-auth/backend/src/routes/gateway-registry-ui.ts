/**
 * Gateway Registry UI routes
 *
 * A thin, SESSION-authenticated surface over the MCP Gateway service registry so
 * signed-in users can propose / list / deregister services from the Claw UI. The
 * underlying s2s router (`/gateway/registry/*`) requires the secret `x-s2s-key`
 * and an allowlisted `x-tenant-id` — neither of which may ever reach the browser.
 *
 * Approval flow (mirrors the MCP "publish request" flow): a UI registration does
 * NOT go live directly — it is stored as a pending `GatewayServiceRequest`. A
 * Claw admin approves it, which writes it to `service_registry` (so that table is
 * always "approved and live", and tool discovery/execution need no changes).
 */
import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { asyncHandler, ok, badRequest, notFound } from "../lib/http.js";
import { requireRequester, requireClawAdmin, getRequesterId, getOrgId } from "../middleware/agent-acl.js";
import {
  registerService,
  listServices,
  getService,
  deregisterService,
} from "../mcpgateway/services/registration.js";
import { SECURITY } from "../mcpgateway/config/index.js";
import type { ServiceRegistration, Tool } from "../mcpgateway/types/index.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("gateway-registry-ui");
const router = Router();

/** Resolve the tenant server-side (first allowlisted tenant). Never from client. */
function resolveTenant(): string {
  const tenant = SECURITY.ALLOWED_TENANTS[0];
  if (!tenant) {
    throw badRequest("MCP Gateway is not configured (ALLOWED_TENANTS is empty)");
  }
  return tenant;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTools(raw: unknown): Tool[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("tools must be a non-empty array");
  }
  return raw.map((item, idx) => {
    if (!isPlainObject(item)) throw badRequest(`tools[${idx}] must be an object`);
    const name = item["name"];
    if (typeof name !== "string" || name.trim().length === 0) {
      throw badRequest(`tools[${idx}].name is required`);
    }
    if (item["inputSchema"] !== undefined && !isPlainObject(item["inputSchema"])) {
      throw badRequest(`tools[${idx}].inputSchema must be a JSON object`);
    }
    if (item["outputSchema"] !== undefined && !isPlainObject(item["outputSchema"])) {
      throw badRequest(`tools[${idx}].outputSchema must be a JSON object`);
    }
    const tool: Tool = {
      name: name.trim(),
      description: typeof item["description"] === "string" ? item["description"] : "",
    };
    if (typeof item["method"] === "string") tool.method = item["method"] as NonNullable<Tool["method"]>;
    if (typeof item["path"] === "string") tool.path = item["path"];
    if (typeof item["requiresApproval"] === "boolean") tool.requiresApproval = item["requiresApproval"];
    if (typeof item["isWriteTool"] === "boolean") tool.isWriteTool = item["isWriteTool"];
    if (isPlainObject(item["inputSchema"])) tool.inputSchema = item["inputSchema"];
    if (isPlainObject(item["outputSchema"])) tool.outputSchema = item["outputSchema"];
    return tool;
  });
}

function buildRegistration(body: Record<string, unknown>): ServiceRegistration {
  return {
    serviceName: requireNonEmptyString(body["serviceName"], "serviceName"),
    backendId: requireNonEmptyString(body["backendId"], "backendId"),
    backendUrl: requireNonEmptyString(body["backendUrl"], "backendUrl"),
    tokenEndpointUrl: requireNonEmptyString(body["tokenEndpointUrl"], "tokenEndpointUrl"),
    tools: parseTools(body["tools"]),
    ...(typeof body["xAuthHeaderName"] === "string" && body["xAuthHeaderName"].trim()
      ? { xAuthHeaderName: (body["xAuthHeaderName"] as string).trim() }
      : {}),
  };
}

interface RequestRow {
  id: string;
  serviceName: string;
  backendId: string;
  backendUrl: string;
  tokenEndpointUrl: string | null;
  xAuthHeaderName: string | null;
  tools: Prisma.JsonValue;
  status: string;
  requestedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

function serializeRequest(r: RequestRow) {
  return {
    id: r.id,
    serviceName: r.serviceName,
    backendId: r.backendId,
    backendUrl: r.backendUrl,
    tokenEndpointUrl: r.tokenEndpointUrl,
    xAuthHeaderName: r.xAuthHeaderName,
    toolCount: Array.isArray(r.tools) ? r.tools.length : 0,
    status: r.status,
    requestedByUserId: r.requestedByUserId,
    reviewedByUserId: r.reviewedByUserId,
    reviewedAt: r.reviewedAt,
    createdAt: r.createdAt,
  };
}

// ── POST / — submit a registration for admin approval (does NOT go live) ──────
router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const tenant = resolveTenant();
  const registration = buildRegistration(req.body as Record<string, unknown>);

  // Replace any existing pending request for the same service+backend so the
  // admin queue never has duplicates for one target.
  await prisma.gatewayServiceRequest.deleteMany({
    where: { tenantUniqueId: tenant, serviceName: registration.serviceName, backendId: registration.backendId, status: "pending" },
  });

  const request = await prisma.gatewayServiceRequest.create({
    data: {
      tenantUniqueId: tenant,
      orgId: getOrgId(req) ?? null,
      serviceName: registration.serviceName,
      backendId: registration.backendId,
      backendUrl: registration.backendUrl,
      tokenEndpointUrl: registration.tokenEndpointUrl ?? null,
      xAuthHeaderName: registration.xAuthHeaderName ?? null,
      tools: registration.tools as unknown as Prisma.InputJsonValue,
      status: "pending",
      requestedByUserId: userId,
    },
  });

  log.info(`[request] user=${userId} tenant=${tenant} service=${registration.serviceName} → pending id=${request.id}`);
  ok(res, {
    success: true,
    status: "pending",
    requestId: request.id,
    message: `Registration for "${registration.serviceName}" submitted for admin approval`,
  });
}));

// ── GET / — list LIVE (approved) services ─────────────────────────────────────
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  requireRequester(req);
  const tenant = resolveTenant();
  const services = await listServices(tenant);
  ok(res, services.map((s) => ({
    serviceName: s.serviceName,
    backendId: s.backendId,
    backendUrl: s.backendUrl,
    xAuthHeaderName: s.xAuthHeaderName ?? null,
    tokenEndpointUrl: s.tokenEndpointUrl ?? null,
    toolCount: Array.isArray(s.tools) ? s.tools.length : 0,
  })));
}));

// ── GET /my-requests — the caller's own submissions (pending/approved/rejected) ─
router.get("/my-requests", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const tenant = resolveTenant();
  const requests = await prisma.gatewayServiceRequest.findMany({
    where: { tenantUniqueId: tenant, requestedByUserId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  ok(res, requests.map(serializeRequest));
}));

// ── GET /requests — pending queue (admin only) ────────────────────────────────
router.get("/requests", requireClawAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const tenant = resolveTenant();
  const requests = await prisma.gatewayServiceRequest.findMany({
    where: { tenantUniqueId: tenant, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  ok(res, requests.map(serializeRequest));
}));

// ── POST /requests/:id/approve — admin: write it live ─────────────────────────
router.post("/requests/:id/approve", requireClawAdmin, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const reviewerId = requireRequester(req);
  const tenant = resolveTenant();
  const request = await prisma.gatewayServiceRequest.findUnique({ where: { id: req.params.id } });
  if (!request || request.tenantUniqueId !== tenant) throw notFound("Request not found");
  if (request.status !== "pending") throw badRequest(`Request is ${request.status}, not pending`);

  const registration: ServiceRegistration = {
    serviceName: request.serviceName,
    backendId: request.backendId,
    backendUrl: request.backendUrl,
    tools: request.tools as unknown as Tool[],
    ...(request.tokenEndpointUrl ? { tokenEndpointUrl: request.tokenEndpointUrl } : {}),
    ...(request.xAuthHeaderName ? { xAuthHeaderName: request.xAuthHeaderName } : {}),
  };

  let result;
  try {
    result = await registerService(tenant, registration); // runs url/SSRF validation
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Registration failed");
  }

  await prisma.gatewayServiceRequest.update({
    where: { id: request.id },
    data: { status: "approved", reviewedByUserId: reviewerId, reviewedAt: new Date() },
  });
  log.info(`[approve] admin=${reviewerId} service=${request.serviceName} backend=${request.backendId}`);
  ok(res, { approved: true, message: result.message });
}));

// ── POST /requests/:id/reject — admin ─────────────────────────────────────────
router.post("/requests/:id/reject", requireClawAdmin, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const reviewerId = requireRequester(req);
  const tenant = resolveTenant();
  const request = await prisma.gatewayServiceRequest.findUnique({ where: { id: req.params.id } });
  if (!request || request.tenantUniqueId !== tenant) throw notFound("Request not found");
  if (request.status !== "pending") throw badRequest(`Request is ${request.status}, not pending`);

  await prisma.gatewayServiceRequest.update({
    where: { id: request.id },
    data: { status: "rejected", reviewedByUserId: reviewerId, reviewedAt: new Date() },
  });
  log.info(`[reject] admin=${reviewerId} service=${request.serviceName} backend=${request.backendId}`);
  ok(res, { rejected: true });
}));

// ── GET /:serviceName — full record for the Edit flow ─────────────────────────
router.get("/:serviceName", asyncHandler(async (req: Request<{ serviceName: string }>, res: Response) => {
  requireRequester(req);
  const tenant = resolveTenant();
  const serviceName = requireNonEmptyString(req.params.serviceName, "serviceName");
  const backendId = typeof req.query["backendId"] === "string" ? (req.query["backendId"] as string) : undefined;
  const service = await getService(tenant, serviceName, backendId);
  if (!service) throw notFound("Service not found");
  ok(res, {
    serviceName: service.serviceName,
    backendId: service.backendId,
    backendUrl: service.backendUrl,
    xAuthHeaderName: service.xAuthHeaderName ?? null,
    tokenEndpointUrl: service.tokenEndpointUrl ?? null,
    tools: Array.isArray(service.tools) ? service.tools : [],
  });
}));

// ── DELETE /:serviceName — deregister a live service (admin only) ─────────────
router.delete("/:serviceName", requireClawAdmin, asyncHandler(async (req: Request<{ serviceName: string }>, res: Response) => {
  const userId = requireRequester(req);
  const tenant = resolveTenant();
  const serviceName = requireNonEmptyString(req.params.serviceName, "serviceName");
  const result = await deregisterService(tenant, serviceName);
  log.info(`[deregister] admin=${userId} tenant=${tenant} service=${serviceName}`);
  ok(res, result);
}));

export { router as gatewayRegistryUiRouter };
