/**
 * MCP Gateway Configuration
 * Constants, timeouts, and environment-based settings
 */

// ============================================================================
// Timeouts (milliseconds)
// ============================================================================

export const TIMEOUTS = {
  /** Tool execution timeout */
  REQUEST: parseInt(process.env.MCP_GATEWAY_TIMEOUT || "30000", 10),
  /** Maximum token cache TTL in seconds (15 minutes) - tokens cached at most 15 min */
  MAX_TOKEN_CACHE_TTL: 900,
  /** Default token cache TTL in minutes */
  DEFAULT_TOKEN_TTL_MINUTES: 10,
} as const;

// ============================================================================
// Redis Cache Configuration
// ============================================================================

export const CACHE = {
  /** Redis key prefix for auth tokens */
  TOKEN_PREFIX: "mcp:auth_token",
} as const;

// ============================================================================
// Encryption Settings
// ============================================================================

export const ENCRYPTION = {
  /** AES algorithm */
  ALGORITHM: "aes-256-gcm",
  /** IV length in bytes */
  IV_LENGTH: 12,
  /** Default auth header name */
  DEFAULT_AUTH_HEADER: "X-Backend-Auth",
} as const;

// ============================================================================
// Security
// ============================================================================

function getOptionalEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.warn(`[mcpgateway/config] Missing optional environment variable: ${name}. MCP Gateway will be disabled.`);
    return "";
  }
  return value;
}

const ALLOWED_TENANTS_RAW = getOptionalEnvVar("ALLOWED_TENANTS");

export const SECURITY = {
  /** Allowed tenants (comma-separated). Empty when MCP Gateway is disabled. */
  ALLOWED_TENANTS: ALLOWED_TENANTS_RAW
    ? ALLOWED_TENANTS_RAW.split(",").map((t) => t.trim()).filter(Boolean)
    : [],
  /** Static API key backends must send to register/deregister (x-s2s-key header) */
  REGISTRATION_API_KEY: getOptionalEnvVar("MCP_GATEWAY_REGISTRATION_API_KEY"),
  /** JWT issuer used when gateway signs tokens for backends (execution path) */
  JWT_ISSUER: process.env.MCP_GATEWAY_JWT_ISSUER || "xyne-mcp-gateway",
  /** JWT audience used when gateway signs tokens for backends (execution path) */
  JWT_AUDIENCE: process.env.MCP_GATEWAY_JWT_AUDIENCE || "xyne-mcp-gateway",
  /** PEM private key for signing JWTs forwarded to backends */
  JWT_PRIVATE_KEY: getOptionalEnvVar("MCP_GATEWAY_JWT_PRIVATE_KEY"),
  /** PEM public key — shared with backends so they can verify gateway-issued JWTs */
  JWT_PUBLIC_KEY: getOptionalEnvVar("MCP_GATEWAY_JWT_PUBLIC_KEY"),
  /** Optional key id for JWT header */
  JWT_PRIVATE_KEY_ID: process.env.MCP_GATEWAY_JWT_PRIVATE_KEY_ID,
  /** JWT lifetime in seconds */
  JWT_TTL_SECONDS: parseInt(process.env.MCP_GATEWAY_JWT_TTL_SECONDS || "600", 10),
} as const;

/**
 * True only when all required MCP Gateway secrets/config are present.
 * Includes the encryption key because crypto/index.ts needs it for backend
 * secret encrypt/decrypt; without it the gateway would start but fail at runtime.
 */
const hasEncryptionKey = Boolean(
  process.env.BACKEND_CLIENT_SECRET_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY
);

export const isGatewayEnabled =
  hasEncryptionKey &&
  SECURITY.ALLOWED_TENANTS.length > 0 &&
  SECURITY.REGISTRATION_API_KEY.length > 0 &&
  SECURITY.JWT_PRIVATE_KEY.length > 0 &&
  SECURITY.JWT_PUBLIC_KEY.length > 0;

if (!isGatewayEnabled) {
  if (!hasEncryptionKey) {
    console.warn("[mcpgateway/config] MCP Gateway is DISABLED: BACKEND_CLIENT_SECRET_ENCRYPTION_KEY or ENCRYPTION_KEY is required to encrypt backend secrets.");
  } else {
    console.warn("[mcpgateway/config] MCP Gateway is DISABLED due to missing environment variables. Gateway tool calls will return an error.");
  }
}

// ============================================================================
// HTTP Methods
// ============================================================================

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
