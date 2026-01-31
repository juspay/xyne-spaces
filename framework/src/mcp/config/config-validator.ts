import { z } from 'zod';
import type {
  MCPConfig,
  MCPLocalServerConfig,
  MCPRemoteServerConfig
} from '../core/types/config.js';

/**
 * Schema for local server configuration
 */
const MCPLocalServerConfigSchema = z.object({
  command: z.string().min(1, 'Command cannot be empty'),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  timeout: z.number().positive().optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
  retryDelay: z.number().positive().optional()
});

/**
 * Schema for remote server transport configuration
 */
const MCPRemoteTransportSchema = z.object({
  type: z.enum(['http', 'websocket']),
  url: z.string().url('Invalid URL format'),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().positive().optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
  retryDelay: z.number().positive().optional()
});

/**
 * Schema for remote server authentication configuration
 */
const MCPRemoteAuthSchema = z.object({
  type: z.enum(['bearer', 'basic', 'api-key']),
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  apiKey: z.string().optional(),
  header: z.string().optional()
}).refine((data) => {
  // Validate that required fields are present based on auth type
  if (data.type === 'bearer' && !data.token) {
    return false;
  }
  if (data.type === 'basic' && (!data.username || !data.password)) {
    return false;
  }
  if (data.type === 'api-key' && !data.apiKey) {
    return false;
  }
  return true;
}, {
  message: 'Missing required authentication fields for the specified auth type'
});

/**
 * Schema for remote server configuration
 */
const MCPRemoteServerConfigSchema = z.object({
  transport: MCPRemoteTransportSchema,
  auth: MCPRemoteAuthSchema.optional()
});

/**
 * Union schema for server configuration
 */
const MCPServerConfigSchema = z.union([
  MCPLocalServerConfigSchema,
  MCPRemoteServerConfigSchema
]);

/**
 * Schema for security configuration
 */
const MCPSecurityConfigSchema = z.object({
  allowedHosts: z.array(z.string()).optional(),
  maxResourceSize: z.string().optional(),
  timeout: z.number().positive().optional(),
  enableSandbox: z.boolean().optional(),
  trustedServers: z.array(z.string()).optional()
});

/**
 * Schema for performance configuration
 */
const MCPPerformanceConfigSchema = z.object({
  maxConcurrentConnections: z.number().int().positive().optional(),
  connectionPoolSize: z.number().int().positive().optional(),
  requestTimeout: z.number().positive().optional(),
  retryAttempts: z.number().int().min(0).max(10).optional(),
  retryDelay: z.number().positive().optional(),
  enableRequestBatching: z.boolean().optional()
});

/**
 * Schema for feature configuration
 */
const MCPFeatureConfigSchema = z.object({
  enableResourceCaching: z.boolean().optional(),
  enableToolIntegration: z.boolean().optional(),
  enablePromptTemplates: z.boolean().optional(),
  enableHealthMonitoring: z.boolean().optional(),
  enableMetrics: z.boolean().optional(),
  enableLogging: z.boolean().optional()
});

/**
 * Main MCP configuration schema
 */
export const MCPConfigSchema = z.object({
  mcpServers: z.record(z.string(), MCPServerConfigSchema)
    .optional()
    .default({}),
  security: MCPSecurityConfigSchema.optional(),
  performance: MCPPerformanceConfigSchema.optional(),
  features: MCPFeatureConfigSchema.optional()
});

/**
 * Validation result type
 */
export interface MCPConfigValidationResult {
  readonly success: boolean;
  readonly data?: MCPConfig;
  readonly errors?: readonly string[];
}

/**
 * Validate MCP configuration against schema
 */
export function validateMCPConfig(config: unknown): MCPConfigValidationResult {
  try {
    const result = MCPConfigSchema.safeParse(config);
    
    if (result.success) {
      return {
        success: true,
        data: result.data as MCPConfig
      };
    }
    
    const errors = result.error.errors.map(error => {
      const path = error.path.length > 0 ? error.path.join('.') : 'root';
      return `${path}: ${error.message}`;
    });
    
    return {
      success: false,
      errors
    };
  } catch (error) {
    return {
      success: false,
      errors: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
    };
  }
}

/**
 * Validate a specific server configuration
 */
export function validateServerConfig(
  serverName: string, 
  config: unknown
): MCPConfigValidationResult {
  try {
    const result = MCPServerConfigSchema.safeParse(config);
    
    if (result.success) {
      return {
        success: true,
        data: { mcpServers: { [serverName]: result.data } } as MCPConfig
      };
    }
    
    const errors = result.error.errors.map(error => {
      const path = error.path.length > 0 ? error.path.join('.') : 'root';
      return `${serverName}.${path}: ${error.message}`;
    });
    
    return {
      success: false,
      errors
    };
  } catch (error) {
    return {
      success: false,
      errors: [`Server validation error for ${serverName}: ${error instanceof Error ? error.message : 'Unknown error'}`]
    };
  }
}

/**
 * Type guard to check if server config is valid
 */
export function isValidServerConfig(config: unknown): config is MCPLocalServerConfig | MCPRemoteServerConfig {
  return MCPServerConfigSchema.safeParse(config).success;
}

/**
 * Type guard to check if server config is a local server config
 */
export function isLocalServerConfig(config: unknown): config is MCPLocalServerConfig {
  return MCPLocalServerConfigSchema.safeParse(config).success;
}

/**
 * Type guard to check if server config is a remote server config
 */
export function isRemoteServerConfig(config: unknown): config is MCPRemoteServerConfig {
  return MCPRemoteServerConfigSchema.safeParse(config).success;
}

/**
 * Get default MCP configuration
 */
export function getDefaultMCPConfig(): Partial<MCPConfig> {
  return {
    security: {
      maxResourceSize: '10MB',
      timeout: 30000,
      enableSandbox: true,
      allowedHosts: ['localhost', '127.0.0.1'],
      trustedServers: []
    },
    performance: {
      maxConcurrentConnections: 10,
      connectionPoolSize: 5,
      requestTimeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      enableRequestBatching: false
    },
    features: {
      enableResourceCaching: true,
      enableToolIntegration: true,
      enablePromptTemplates: true,
      enableHealthMonitoring: true,
      enableMetrics: false,
      enableLogging: true
    }
  };
}

// Export schemas for use in tests or other modules
export {
  MCPLocalServerConfigSchema,
  MCPRemoteServerConfigSchema,
  MCPServerConfigSchema,
  MCPSecurityConfigSchema,
  MCPPerformanceConfigSchema,
  MCPFeatureConfigSchema
};