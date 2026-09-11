# MCP Gateway Service Integration Guide

This guide describes how a backend service registers tools with Xyne Claw MCP Gateway and receives tool execution calls.

It intentionally contains no keys, secrets, tenant IDs, or environment-specific URLs.

## Current Contract

The current MCP Gateway implementation uses a token-exchange flow:

1. Your service registers metadata and tool definitions with the gateway.
2. During tool execution, the gateway signs a short-lived JWT and calls your service's token endpoint.
3. Your token endpoint verifies the gateway JWT and returns a service auth token.
4. The gateway calls the requested tool endpoint and forwards the returned service auth token in the configured auth header.

Important: In the current implementation, tool endpoints do not receive the gateway JWT directly. They receive the token returned by your token endpoint.

## Values You Need Privately

Ask the Xyne Claw owner for these values through a private channel:

`CLAW_AUTH_BASE_URL`: base URL of the Xyne Claw Auth service.

`X-TENANT-ID`: tenant identifier allowed by the gateway.

`MCP_GATEWAY_REGISTRATION_API_KEY`: static registration key for `x-s2s-key`.

`MCP_GATEWAY_JWT_PUBLIC_KEY`: public key used by your service to verify gateway JWTs.

Expected JWT issuer. Default: `xyne-mcp-gateway`.

Do not put these values in shared docs, tickets, examples, screenshots, or commits.

## Gateway Endpoints

Gateway routes are mounted under:

```text
/claw/api/v1/gateway
```

Registration:

```text
POST /claw/api/v1/gateway/registry/register
```

Deregistration:

```text
DELETE /claw/api/v1/gateway/registry/:serviceName
```

There is no public HTTP execution endpoint. Tool execution is invoked internally by Xyne Claw after an agent selects a registered gateway tool.

## Registration Headers

Every registration and deregistration request must include:

```http
Content-Type: application/json
X-Tenant-ID: <tenant-id>
x-s2s-key: <registration-api-key>
```

Header notes:

`X-Tenant-ID` must be in the gateway allowlist.

`x-s2s-key` must match the gateway registration API key.

Header names are case-insensitive over HTTP, but use the spelling above for consistency.

## Registration Body

Use the canonical field names below.

```json
{
  "serviceName": "example-service",
  "backendId": "example-service-primary",
  "backendUrl": "https://example-service.company.com",
  "xAuthHeaderName": "X-Backend-Auth",
  "tokenEndpointUrl": "/mcp-gateway/token",
  "tools": [
    {
      "name": "get_record",
      "description": "Fetch a record by ID.",
      "method": "GET",
      "path": "/api/records/{recordId}",
      "requiresApproval": false,
      "isWriteTool": false,
      "inputSchema": {
        "type": "object",
        "properties": {
          "recordId": { "type": "string" }
        },
        "required": ["recordId"]
      }
    }
  ]
}
```

The gateway currently accepts a few legacy aliases for token endpoint and auth header fields, but new integrations should use only `tokenEndpointUrl` and `xAuthHeaderName`.

Required fields:

`serviceName`: stable logical service name.

`backendId`: stable backend instance ID.

`backendUrl`: absolute base URL for your backend.

`tools`: array of tool definitions.

Execution-required field:

`tokenEndpointUrl`: relative path for token exchange.

This field is stored as optional by the registry, but current tool execution fails if it is missing. Treat it as required for any executable service.

Optional field:

`xAuthHeaderName`: header used when forwarding your service auth token to tool endpoints.

Default:

```text
X-Backend-Auth
```

## URL Rules

`backendUrl` rules:

Must be an absolute URL.

Production allows `https` only.

Non-production allows `http` and `https`.

Do not include credentials in the URL.

Trailing slashes are normalized away.

`tokenEndpointUrl` rules:

Must be a relative path starting with `/`.

Must not be an absolute URL.

May include a query string if needed.

Examples:

```text
Valid:   /mcp-gateway/token
Valid:   /auth/token?source=mcp
Invalid: mcp-gateway/token
Invalid: https://example-service.company.com/mcp-gateway/token
```

Outbound safety rules:

In production, private and loopback destinations are blocked.

In non-production, `localhost`, `127.x.x.x`, and `::1` are allowed for local development.

Redirects are followed up to 5 times.

Sensitive auth headers are stripped on cross-origin redirects.

## Tool Definition Format

Each tool item supports:

```json
{
  "name": "tool_name",
  "description": "Short description.",
  "method": "GET",
  "requiresApproval": false,
  "isWriteTool": false,
  "path": "/api/items/{itemId}",
  "inputSchema": {
    "type": "object",
    "properties": {
      "itemId": { "type": "string" }
    },
    "required": ["itemId"]
  },
  "outputSchema": {
    "type": "object"
  }
}
```

Field rules:

`name` is required and must be stable.

`description` is strongly recommended.

`method` may be `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.

If `method` is omitted, execution defaults to `POST`.

`path` may include path params using `{paramName}`.

`inputSchema` and `outputSchema` are optional JSON Schema-like objects.

Path parameter behavior:

Values are taken from tool arguments.

Values are URL-encoded.

Path params are removed from query/body payloads.

Always include required path params in `inputSchema.required`.

Argument forwarding:

`GET` and `DELETE`: non-path arguments are sent as query params.

`POST`, `PUT`, and `PATCH`: non-path arguments are sent as a JSON body.

## Token Endpoint Contract

Your service must expose the registered `tokenEndpointUrl`.

Request:

```http
POST <backendUrl><tokenEndpointUrl>
Content-Type: application/json
Authorization: Bearer <gateway-jwt>
```

Body:

```json
{
  "email": "user@example.com",
  "tenantId": "<tenant-id>",
  "serviceName": "example-service"
}
```

Your token endpoint must:

1. Extract the Bearer token from `Authorization`.
2. Verify the JWT signature using `MCP_GATEWAY_JWT_PUBLIC_KEY`.
3. Verify issuer. Default: `xyne-mcp-gateway`.
4. Verify audience. Current gateway behavior sets `aud` to your `serviceName`.
5. Validate `tenantId` against your allowed tenants.
6. Validate `serviceName` equals your registered service name.
7. Validate `backendId` if your service uses backend-specific authorization.
8. Validate `sub` and `email` are present and match the end user.
9. Reject expired tokens.
10. Return a service auth token that the gateway can forward to tool endpoints.

Gateway JWT claims:

```json
{
  "sub": "user@example.com",
  "email": "user@example.com",
  "tenantId": "<tenant-id>",
  "serviceName": "example-service",
  "backendId": "example-service-primary",
  "iss": "xyne-mcp-gateway",
  "aud": "example-service",
  "iat": 1234567890,
  "exp": 1234568490
}
```

Token endpoint response:

Return JSON containing one of these string fields:

```json
{ "token": "<service-auth-token>" }
```

Also accepted:

```json
{ "auth": "<service-auth-token>" }
```

```json
{ "authToken": "<service-auth-token>" }
```

The gateway also accepts a single-key JSON object whose only value is a non-empty string.

Token caching:

The gateway caches the returned service auth token by tenant, service, and user email.

Current cache duration is 15 minutes.

If your service revokes a token, deregistering the service invalidates gateway-side cached tokens for that service.

## Tool Endpoint Contract

When the gateway calls a tool endpoint, it sends:

```http
Content-Type: application/json
X-Backend-Auth: <service-auth-token>
```

If registration used a custom `xAuthHeaderName`, that header replaces `X-Backend-Auth`.

Current implementation note:

The tool endpoint receives the service auth token returned by your token endpoint.

The tool endpoint does not receive the gateway JWT directly.

The tool endpoint does not currently receive `x-auth-email` or `x-tenant-id` headers from the gateway.

If your tool endpoint needs user or tenant context, encode it in your service auth token or store it server-side when issuing the token.

## Example Registration Request

```bash
curl -X POST "<CLAW_AUTH_BASE_URL>/claw/api/v1/gateway/registry/register" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: <TENANT_ID>" \
  -H "x-s2s-key: <REGISTRATION_API_KEY>" \
  -d '{
    "serviceName": "example-service",
    "backendId": "example-service-primary",
    "backendUrl": "https://example-service.company.com",
    "xAuthHeaderName": "X-Backend-Auth",
    "tokenEndpointUrl": "/mcp-gateway/token",
    "tools": [
      {
        "name": "get_record",
        "description": "Fetch a record by ID.",
        "method": "GET",
        "path": "/api/records/{recordId}",
        "requiresApproval": false,
        "isWriteTool": false,
        "inputSchema": {
          "type": "object",
          "properties": {
            "recordId": { "type": "string" }
          },
          "required": ["recordId"]
        }
      },
      {
        "name": "create_record",
        "description": "Create a record.",
        "method": "POST",
        "path": "/api/records",
        "inputSchema": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "description": { "type": "string" }
          },
          "required": ["title"]
        }
      }
    ]
  }'
```

Success response:

```json
{
  "success": true,
  "message": "Service example-service-primary registered with 2 tools"
}
```

Registration is an upsert. Re-registering the same `tenantId`, `serviceName`, and `backendId` updates the stored URL, tool list, auth header name, and token endpoint URL.

## Example Deregistration Request

```bash
curl -X DELETE "<CLAW_AUTH_BASE_URL>/claw/api/v1/gateway/registry/example-service" \
  -H "X-Tenant-ID: <TENANT_ID>" \
  -H "x-s2s-key: <REGISTRATION_API_KEY>"
```

Success response:

```json
{
  "success": true,
  "message": "Service example-service deregistered (<n> backends removed, auth cache invalidated)"
}
```

Deregistration removes all backend registrations for the given `serviceName` under the tenant.

## Service-Side Verification Example

Example only. Keep your actual keys and tenant values outside shared code snippets.

```ts
import { importSPKI, jwtVerify } from "jose";

const GATEWAY_PUBLIC_KEY = process.env.MCP_GATEWAY_JWT_PUBLIC_KEY!;

const EXPECTED_ISSUER = process.env.MCP_GATEWAY_JWT_ISSUER ?? "xyne-mcp-gateway";

const EXPECTED_SERVICE_NAME = "example-service";

const ALLOWED_TENANTS = new Set((process.env.ALLOWED_TENANTS ?? "").split(",").filter(Boolean));

export async function verifyGatewayJwt(token: string) {
  const publicKey = await importSPKI(GATEWAY_PUBLIC_KEY.replace(/\\n/g, "\n"), "RS256");

  const { payload } = await jwtVerify(token, publicKey, {
    issuer: EXPECTED_ISSUER,
    audience: EXPECTED_SERVICE_NAME,
  });

  if (payload.serviceName !== EXPECTED_SERVICE_NAME) {
    throw new Error("Invalid serviceName");
  }

  if (typeof payload.tenantId !== "string" || !ALLOWED_TENANTS.has(payload.tenantId)) {
    throw new Error("Invalid tenantId");
  }

  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new Error("Missing email");
  }

  if (payload.sub !== payload.email) {
    throw new Error("Invalid subject");
  }

  return {
    email: payload.email,
    tenantId: payload.tenantId,
    serviceName: payload.serviceName,
    backendId: payload.backendId,
  };
}
```

Token endpoint sketch:

```ts
app.post("/mcp-gateway/token", async (req, res) => {
  const auth = req.header("authorization") ?? "";

  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

  if (!token) {
    res.status(401).json({ error: "Missing gateway token" });
    return;
  }

  const claims = await verifyGatewayJwt(token);

  // Create or look up a short-lived service token for this user and tenant.
  const serviceToken = await issueServiceToken({
    email: claims.email,
    tenantId: claims.tenantId,
    backendId: claims.backendId,
  });

  res.json({ token: serviceToken });
});
```

Tool endpoint sketch:

```ts
app.get("/api/records/:recordId", async (req, res) => {
  const serviceToken = req.header("x-backend-auth");

  const authContext = await verifyServiceToken(serviceToken);

  const record = await getRecordForUser({
    recordId: req.params.recordId,
    email: authContext.email,
    tenantId: authContext.tenantId,
  });

  res.json(record);
});
```

## Common Failure Cases

Registration failures:

Missing `X-Tenant-ID`.

Tenant is not allowlisted.

Missing `x-s2s-key`.

Invalid `x-s2s-key`.

Invalid `backendUrl`.

`backendUrl` uses `http` in production.

`backendUrl` resolves to a blocked private/reserved address.

Invalid `tokenEndpointUrl`.

`tools` is missing or is not an array.

Treat any non-2xx registration response as a failure. Some validation failures may be returned as a generic registration error by the gateway route.

Execution failures:

Service is not registered for the tenant.

Multiple backends are registered and no backend ID is selected.

Tool name is not registered.

`tokenEndpointUrl` is missing.

Token endpoint rejects the gateway JWT.

Token endpoint returns no recognized token field.

Backend service is unreachable.

Tool endpoint returns non-2xx.

Tool endpoint request times out.

## Testing Checklist

Before asking the Xyne Claw team to enable the service for agents, verify:

Registration succeeds with real private tenant/key values.

Registration fails without `X-Tenant-ID`.

Registration fails with an invalid `x-s2s-key`.

Registration fails if `tokenEndpointUrl` is absolute.

Your token endpoint accepts a valid gateway JWT.

Your token endpoint rejects an invalid signature.

Your token endpoint rejects the wrong issuer.

Your token endpoint rejects the wrong audience.

Your token endpoint rejects an unauthorized tenant.

Your token endpoint rejects an expired JWT.

A registered `GET` tool receives non-path arguments as query params.

A registered `POST` tool receives non-path arguments as JSON body.

Path params are substituted and URL-encoded correctly.

Tool endpoints authorize using the forwarded service token.

Deregistration removes stale service backends.

Re-registration updates changed tools and URLs.

## Operational Checklist

For gateway operators:

Configure `ALLOWED_TENANTS`.

Configure `MCP_GATEWAY_REGISTRATION_API_KEY`.

Configure `MCP_GATEWAY_JWT_PRIVATE_KEY`.

Configure `MCP_GATEWAY_JWT_PUBLIC_KEY`.

Configure `MCP_GATEWAY_JWT_ISSUER` if not using the default.

Configure `MCP_GATEWAY_JWT_TTL_SECONDS` if not using the default.

Keep `MCP_GATEWAY_JWT_PUBLIC_KEY` synchronized with service teams during key rotation.

Never publish private keys or registration keys in docs.

Note: `MCP_GATEWAY_JWT_AUDIENCE` exists in config, but current execution code signs gateway JWTs with `aud` set to the registered `serviceName`. Service teams should verify audience against their own `serviceName`.

For service teams:

Store all private values in secret management.

Keep `serviceName` stable.

Keep `backendId` stable per deployment target.

Use HTTPS in production.

Implement token endpoint verification before registering production tools.

Return short-lived service tokens from the token endpoint.

Validate authorization again inside tool endpoints.

Log request IDs and service/tool names, but never log tokens.

## Version Note

This guide documents the current Xyne Claw MCP Gateway behavior in this repository. It differs from older handoff notes that described direct gateway-JWT forwarding to tool endpoints. Under the current implementation, gateway JWTs are sent to the registered token endpoint, and tool endpoints receive the service token returned by that endpoint.
