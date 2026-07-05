/**
 * MCP Gateway Module
 *
 * Service registry, discovery, and execution for backend MCP services.
 *
 * @example
 * ```typescript
 * import { mcpGatewayRouter } from './mcpgateway/index.js';
 * app.use('/gateway', mcpGatewayRouter);
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  Tool,
  Service,
  ServiceWithTools,
  BackendInfo,
  EncryptedSecretPayload,
  FetchedToken,
  ValidationResult,
  ExecuteToolRequest,
  ExecuteToolResult,
  ServiceRegistration,
} from "./types/index.js";

// ============================================================================
// Configuration
// ============================================================================

export { TIMEOUTS, CACHE, ENCRYPTION, SECURITY } from "./config/index.js";

// ============================================================================
// Crypto
// ============================================================================

export {
  encryptSecret,
  decryptSecret,
} from "./crypto/index.js";

export { signGatewayJwt, verifyGatewayJwt } from "./crypto/jwt.js";

// ============================================================================
// Cache
// ============================================================================

export {
  setToken as setAuthToken,
  getToken as getAuthToken,
  deleteToken as deleteAuthToken,
  invalidateServiceTokens,
} from "./cache/token-cache.js";

// ============================================================================
// Database (low-level, used internally)
// ============================================================================

export {
  upsertService,
  deleteService,
} from "./db/index.js";

// ============================================================================
// Services (high-level business logic)
// ============================================================================

export * from "./services/index.js";

// ============================================================================
// Middleware
// ============================================================================

export { validateTenant, validateRegistrationApiKey, getAuthEmail } from "./middleware/validation.js";

// ============================================================================
// Routes
// ============================================================================

export { mcpGatewayRouter } from "./routes/index.js";
