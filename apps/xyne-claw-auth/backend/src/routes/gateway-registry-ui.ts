/**
 * Gateway Registry UI routes
 *
 * A thin, SESSION-authenticated surface over the MCP Gateway service registry so
 * signed-in users can register / list / deregister their services from the Claw
 * UI. The underlying s2s router (`/gateway/registry/*`) requires the secret
 * `x-s2s-key` (MCP_GATEWAY_REGISTRATION_API_KEY) and an allowlisted
 * `x-tenant-id` — neither of which may ever reach the browser. These handlers
 * authenticate the user's session instead, resolve the tenant server-side, and
 * reuse the exact same `registerService`/`listServices`/`deregisterService`
 * business logic (so no validation is duplicated).
 */
import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, badRequest } from "../lib/http.js";
import { requireRequester } from "../middleware/agent-acl.js";
import {
  registerService,
  listServices,
  deregisterService,
} from "../mcpgateway/services/registration.js";
import { SECURITY } from "../mcpgateway/config/index.js";
import type { ServiceRegistration, Tool } from "../mcpgateway/types/index.js";
import { createLogger } from "../logger.js";

const log = createLogger("gateway-registry-ui");
const router = Router();

/**
 * Resolve the tenant server-side. Mirrors `DEFAULT_GATEWAY_TENANT` in
 * routes/tools.ts (the first allowlisted tenant). The client never supplies it.
 */
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

/** Validate + normalize the tools array coming from the form / pasted JSON. */
function parseTools(raw: unknown): Tool[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest("tools must be a non-empty array");
  }
  return raw.map((item, idx) => {
    if (!isPlainObject(item)) {
      throw badRequest(`tools[${idx}] must be an object`);
    }
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

/**
 * POST / — register (upsert) a service for the resolved tenant.
 */
router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const tenant = resolveTenant();

  const body = req.body as Record<string, unknown>;
  const registration: ServiceRegistration = {
    serviceName: requireNonEmptyString(body["serviceName"], "serviceName"),
    backendId: requireNonEmptyString(body["backendId"], "backendId"),
    backendUrl: requireNonEmptyString(body["backendUrl"], "backendUrl"),
    tokenEndpointUrl: requireNonEmptyString(body["tokenEndpointUrl"], "tokenEndpointUrl"),
    tools: parseTools(body["tools"]),
    ...(typeof body["xAuthHeaderName"] === "string" && body["xAuthHeaderName"].trim()
      ? { xAuthHeaderName: (body["xAuthHeaderName"] as string).trim() }
      : {}),
  };

  // registerService performs the heavy validation (backendUrl https-in-prod +
  // SSRF guard, relative tokenEndpointUrl, etc.). Surface its error message.
  let result;
  try {
    result = await registerService(tenant, registration);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Registration failed");
  }

  log.info(
    `[register] user=${userId} tenant=${tenant} service=${registration.serviceName} ` +
    `backend=${registration.backendId} tools=${registration.tools.length}`,
  );
  ok(res, result);
}));

/**
 * GET / — list services registered for the resolved tenant.
 */
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

/**
 * DELETE /:serviceName — deregister all backends for a service under the tenant.
 */
router.delete("/:serviceName", asyncHandler(async (req: Request<{ serviceName: string }>, res: Response) => {
  const userId = requireRequester(req);
  const tenant = resolveTenant();
  const serviceName = requireNonEmptyString(req.params.serviceName, "serviceName");
  const result = await deregisterService(tenant, serviceName);
  log.info(`[deregister] user=${userId} tenant=${tenant} service=${serviceName}`);
  ok(res, result);
}));

export { router as gatewayRegistryUiRouter };
