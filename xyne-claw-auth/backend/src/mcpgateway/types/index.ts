/**
 * MCP Gateway Types
 * All TypeScript interfaces and type definitions
 */

// ============================================================================
// Tool & Service Definitions
// ============================================================================

export interface Tool {
  name: string;
  description: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface Service {
  serviceName: string;
  backendId: string;
  backendUrl: string;
  tools: Tool[];
  tenantId: string;
  serviceRegistryTenantId?: string;
  xAuthHeaderName?: string;
  tokenEndpointUrl?: string;
}

// ============================================================================
// Crypto & Security
// ============================================================================

export interface EncryptedSecretPayload {
  encryptedSecret: string;
  iv: string;
  authTag: string;
}

// ============================================================================
// Token & Auth
// ============================================================================

export interface FetchedToken {
  authToken: string;
  fromCache: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  tenantId?: string;
}

// ============================================================================
// API Requests & Responses
// ============================================================================

export interface ExecuteToolRequest {
  serviceName: string;
  toolName: string;
  arguments: Record<string, unknown>;
  backendId?: string;
}

export interface ExecuteToolResult {
  success: boolean;
  toolName: string;
  backendId: string;
  result?: unknown;
  error?: string;
  errorDetail?: unknown;
  duration: number;
  backendStatus?: number;
}

export interface ServiceRegistration {
  serviceName: string;
  backendId: string;
  backendUrl: string;
  tools: Tool[];
  xAuthHeaderName?: string;
  tokenEndpointUrl?: string;
}

// ============================================================================
// Discovery Types
// ============================================================================

export interface ServiceWithTools extends Service {
  tools: Tool[];
}

export interface BackendInfo {
  backendId: string;
  backendUrl: string;
  tools: Tool[];
  tenantId: string;
}

// ============================================================================
// Database Row Types (from Prisma)
// ============================================================================

export interface ServiceRegistryRow {
  id: string;
  tenantId: string;
  tenantUniqueId: string;
  serviceName: string;
  backendId: string;
  backendUrl: string;
  tools: unknown;
  xAuthHeaderName: string | null;
  tokenEndpointUrl: string | null;
  registeredAt: Date;
}

export interface ClientSecretRow {
  id: string;
  tenantUniqueId: string;
  serviceName: string;
  encryptedSecret: string;
  iv: string;
  authTag: string;
  encryptionAlgorithm: string;
}
