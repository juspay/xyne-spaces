/**
 * Execution Service
 * Tool execution on backend services with authentication
 */

import { TIMEOUTS, ENCRYPTION, SECURITY, isGatewayEnabled } from "../config/index.js";
import * as registryDb from "../db/registry.js";
import * as tokenCache from "../cache/token-cache.js";
import { signGatewayJwt } from "../crypto/jwt.js";
import { httpRequest, HttpRequestError } from "./http-client.js";
import type {
  Service,
  Tool,
  ExecuteToolRequest,
  ExecuteToolResult,
  FetchedToken,
} from "../types/index.js";

function encodePathSegment(value: unknown): string {
  return encodeURIComponent(String(value));
}

/**
 * Extract auth token from backend response
 */
function extractAuthToken(responseBody: unknown): { token: string; sourceKey: string } {
  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
    throw new Error("Unexpected token response shape");
  }

  const payload = responseBody as Record<string, unknown>;

  if (typeof payload.auth === "string" && payload.auth.trim().length > 0) {
    return { token: payload.auth, sourceKey: "auth" };
  }

  if (typeof payload.token === "string" && payload.token.trim().length > 0) {
    return { token: payload.token, sourceKey: "token" };
  }

  if (typeof payload.authToken === "string" && payload.authToken.trim().length > 0) {
    return { token: payload.authToken, sourceKey: "authToken" };
  }

  if (typeof payload.mettle_token === "string" && payload.mettle_token.trim().length > 0) {
    return { token: payload.mettle_token, sourceKey: "mettle_token" };
  }

  // Fallback: single key-value object (skip known non-token fields like 'email')
  const entries = Object.entries(payload);
  if (entries.length === 1) {
    const [key, value] = entries[0]!;
    if (typeof value === "string" && value.trim().length > 0) {
      return { token: value, sourceKey: key };
    }
  }

  throw new Error("Cannot extract token from response payload");
}

/**
 * Fetch auth token from backend (with caching)
 */
async function fetchAuthToken(
  tenantId: string,
  serviceName: string,
  backendUrl: string,
  tokenEndpointUrl: string,
  authEmail: string,
  gatewayS2SToken: string
): Promise<FetchedToken> {
  // Check cache first
  const cached = await tokenCache.getToken(tenantId, serviceName, authEmail);
  if (cached) {
    return cached;
  }

  // Call token endpoint with JWT for verification
  const tokenUrl = `${backendUrl}${tokenEndpointUrl}`;
  
  console.log(`[auth] Fetching new token from ${tokenUrl} for service=${serviceName}`);

  const tokenRequestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${gatewayS2SToken}`,
  };

  try {
    const response = await httpRequest<Record<string, unknown>>({
      method: "POST",
      url: tokenUrl,
      headers: tokenRequestHeaders,
        body: {
          email: authEmail,
          tenantId,
          serviceName,
        },
        timeoutMs: TIMEOUTS.REQUEST,
    });

    const { token } = extractAuthToken(response.data);
    console.log(`[auth] Token fetched from backend for service=${serviceName}`);

    // Cache token
    // Cache token for 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await tokenCache.setToken(tenantId, serviceName, authEmail, token, expiresAt);
    console.log(`[auth] Token cached for 15 minutes for service=${serviceName}`);

    return { authToken: token, fromCache: false };
  } catch (error) {
    if (error instanceof HttpRequestError) {
      const status = error.status ?? "no-response";
      throw new Error(
        `Token endpoint request failed status=${status} service=${serviceName}`
      );
    }
    throw error;
  }
}

/**
 * Execute a tool on a backend service
 */
export async function executeTool(
  tenantId: string,
  authEmail: string,
  request: ExecuteToolRequest
): Promise<ExecuteToolResult> {
  const startTime = Date.now();
  const { serviceName, toolName, arguments: toolArgs, backendId } = request;
  console.log(`[execute] START service=${serviceName} tool=${toolName} backend=${backendId ?? "auto"}`);

  if (!isGatewayEnabled) {
    return {
      success: false,
      toolName,
      backendId: backendId ?? "",
      error: "MCP Gateway is not configured",
      duration: Date.now() - startTime,
    };
  }

  try {
    // Get backends for service
    const backends = await registryDb.getServiceBackends(tenantId, serviceName);

    if (backends.length === 0) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    // Select backend
    let selectedBackend: Service;
    if (backendId) {
      const found = backends.find((b) => b.backendId === backendId);
      if (!found) {
        throw new Error(
          `Backend ${backendId} not found. Available: ${backends.map((b) => b.backendId).join(", ")}`
        );
      }
      selectedBackend = found;
    } else if (backends.length === 1) {
      selectedBackend = backends[0]!;
    } else {
      throw new Error(`Service "${serviceName}" has multiple backends. Specify backendId.`);
    }

    // Find tool
    const tools: Tool[] = selectedBackend.tools || [];
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    // Use service_registry values for token exchange context.
    const serviceTenantId = selectedBackend.serviceRegistryTenantId || selectedBackend.tenantId;
    const serviceNameFromRegistry = selectedBackend.serviceName;

    const { token: gatewayS2SToken } = await signGatewayJwt(
      {
        sub: authEmail,
        tenantId: serviceTenantId,
        serviceName: serviceNameFromRegistry,
        backendId: selectedBackend.backendId,
        email: authEmail,
      },
      {
        issuer: SECURITY.JWT_ISSUER,
        // Scope the audience to the specific backend service so a token minted
        // for one backend cannot be replayed to another backend's token-exchange
        // endpoint. Backends verify aud against their own service name.
        audience: serviceNameFromRegistry,
        privateKeyPem: SECURITY.JWT_PRIVATE_KEY,
        publicKeyPem: SECURITY.JWT_PUBLIC_KEY,
        ttlSeconds: SECURITY.JWT_TTL_SECONDS,
        ...(SECURITY.JWT_PRIVATE_KEY_ID ? { privateKeyId: SECURITY.JWT_PRIVATE_KEY_ID } : {}),
      }
    );

    // Get token endpoint URL from the selected backend row
    const tokenEndpointUrl = selectedBackend.tokenEndpointUrl;
    if (!tokenEndpointUrl) {
      throw new Error(`No tokenEndpointUrl configured for service ${serviceName}`);
    }

    // Get auth token for all tool calls
    const tokenResult = await fetchAuthToken(
      serviceTenantId,
      serviceNameFromRegistry,
      selectedBackend.backendUrl,
      tokenEndpointUrl,
      authEmail,
      gatewayS2SToken
    );
    const authToken = tokenResult.authToken;

    // Build URL with path params
    const pathParamNames = new Set<string>();
    const toolPath = tool.path ?? "";
    const pathParamRegex = /\{([^}]+)\}/g;
    let match;
    while ((match = pathParamRegex.exec(toolPath)) !== null) {
      pathParamNames.add(match[1]!);
    }

    const pathWithParams = toolPath.replace(/\{([^}]+)\}/g, (_, paramName: string) => {
      const value = toolArgs[paramName];
      return value !== undefined && value !== null ? encodePathSegment(value) : _;
    });

    const fullUrl = `${selectedBackend.backendUrl}${pathWithParams}`;
    console.log(`[execute] Calling service=${serviceName} tool=${toolName} method=${tool.method || "POST"}`);

    // Strip path params from body
    const requestArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(toolArgs)) {
      if (!pathParamNames.has(key)) {
        requestArgs[key] = value;
      }
    }

    // Build request-bound signature context before forwarding.
    const httpMethod = (tool.method || "POST").toUpperCase();
    const xAuthHeaderName = selectedBackend.xAuthHeaderName || ENCRYPTION.DEFAULT_AUTH_HEADER;

    const forwardHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      [xAuthHeaderName]: authToken,
    };
    console.log(`[execute] Forward request prepared service=${serviceName} tool=${toolName} method=${httpMethod}`);

    // Execute request
    let backendResponse: { status: number; data: unknown };

    switch (httpMethod) {
      case "GET":
        backendResponse = await httpRequest({
          method: "GET",
          url: fullUrl,
          headers: forwardHeaders,
          query: requestArgs,
          timeoutMs: TIMEOUTS.REQUEST,
        });
        break;
      case "POST":
        backendResponse = await httpRequest({
          method: "POST",
          url: fullUrl,
          headers: forwardHeaders,
          body: requestArgs,
          timeoutMs: TIMEOUTS.REQUEST,
        });
        break;
      case "PUT":
        backendResponse = await httpRequest({
          method: "PUT",
          url: fullUrl,
          headers: forwardHeaders,
          body: requestArgs,
          timeoutMs: TIMEOUTS.REQUEST,
        });
        break;
      case "PATCH":
        backendResponse = await httpRequest({
          method: "PATCH",
          url: fullUrl,
          headers: forwardHeaders,
          body: requestArgs,
          timeoutMs: TIMEOUTS.REQUEST,
        });
        break;
      case "DELETE":
        backendResponse = await httpRequest({
          method: "DELETE",
          url: fullUrl,
          headers: forwardHeaders,
          query: requestArgs,
          timeoutMs: TIMEOUTS.REQUEST,
        });
        break;
      default:
        throw new Error(`Unsupported HTTP method: ${tool.method}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[execute] SUCCESS service=${serviceName} tool=${toolName} backend=${selectedBackend.backendId} status=${backendResponse.status} duration=${duration}ms`);

    return {
      success: true,
      toolName: `${serviceName}.${toolName}`,
      backendId: selectedBackend.backendId,
      result: backendResponse.data,
      duration,
      backendStatus: backendResponse.status,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`[execute] FAILED service=${serviceName} tool=${toolName} duration=${duration}ms error=${error instanceof Error ? error.message : "unknown"}`);

    if (error instanceof HttpRequestError) {
      if (error.code === "http") {
        const responseError = `HTTP ${error.status}`;

        return {
          success: false,
          toolName: `${serviceName}.${toolName}`,
          backendId: backendId || "unknown",
          error: responseError,
          duration,
          ...(error.status !== undefined ? { backendStatus: error.status } : {}),
        };
      }

      if (error.code === "network") {
        return {
          success: false,
          toolName: `${serviceName}.${toolName}`,
          backendId: backendId || "unknown",
          error: "Backend service unreachable",
          duration,
        };
      }

      if (error.code === "timeout") {
        return {
          success: false,
          toolName: `${serviceName}.${toolName}`,
          backendId: backendId || "unknown",
          error: `Request timeout after ${TIMEOUTS.REQUEST / 1000}s`,
          duration,
        };
      }
    }

    return {
      success: false,
      toolName: `${serviceName}.${toolName}`,
      backendId: backendId || "unknown",
      error: "Request failed",
      duration,
    };
  }
}
