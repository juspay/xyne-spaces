/**
 * Tool adapter that wraps MCP tools to work with the framework tool system
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import type { ToolExecutionResult, ToolExecutionContext } from '../../../tools/core/types/tool.js';
import type { JSONSchema } from '../../core/types/framework.js';

// Extended context that includes original input for metadata calculation
interface ExtendedToolExecutionContext extends ToolExecutionContext {
  originalInput?: unknown;
}
import type { 
  MCPToolCatalogEntry, 
  MCPFrameworkToolAdapter,
  MCPToolExecutionOptions,
  MCPToolExecutionResult,
  MCPToolExecutionError
} from '../types/index.js';
import { ParameterMapper } from './parameter-mapper.js';
import { logger } from '../../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Adapter that makes MCP tools compatible with the framework tool interface
 */
export class MCPToolAdapter<TInput = unknown, TOutput = unknown, TLLMOutput = unknown> 
  implements MCPFrameworkToolAdapter<TInput, TOutput, TLLMOutput> {
  
  private readonly parameterMapper: ParameterMapper;
  
  constructor(
    private readonly mcpClient: MCPClient,
    public readonly catalogEntry: MCPToolCatalogEntry,
    private readonly options: MCPToolExecutionOptions = {}
  ) {
    this.parameterMapper = new ParameterMapper();
  }

  /**
   * Get the MCP tool name
   */
  public get mcpToolName(): string {
    return this.catalogEntry.tool.name;
  }

  /**
   * Get the server name
   */
  public get serverName(): string {
    return this.catalogEntry.serverName;
  }

  /**
   * Execute the MCP tool with framework-compatible interface
   */
  public async execute(input: TInput): Promise<ToolExecutionResult<TOutput>> {
    const executionId = uuidv4();
    const startTime = new Date();
    
    const context: ExtendedToolExecutionContext = {
      executionId,
      toolName: this.catalogEntry.frameworkName,
      startTime,
      metadata: {
        mcpToolName: this.mcpToolName,
        serverName: this.serverName,
        isAvailable: this.catalogEntry.isAvailable
      },
      originalInput: input
    };

    logger.debug(`Executing MCP tool: ${this.mcpToolName} on server: ${this.serverName}`, {
      executionId,
      input: this.sanitizeInputForLogging(input)
    });

    try {
      // Check if tool is available
      if (!this.catalogEntry.isAvailable) {
        throw new Error(`Tool '${this.mcpToolName}' is not available on server '${this.serverName}'`);
      }

      // Map framework input to MCP parameters
      const mappingResult = this.parameterMapper.mapParameters(
        input as Record<string, unknown>,
        this.catalogEntry.tool.inputSchema as JSONSchema | undefined
      );

      if (!mappingResult.success) {
        throw new Error(`Parameter mapping failed: ${mappingResult.errors.join(', ')}`);
      }

      // Log parameter mapping warnings
      for (const warning of mappingResult.warnings) {
        logger.warn(`Parameter mapping warning for ${this.mcpToolName}: ${warning}`);
      }

      // Execute the MCP tool
      const mcpResult = await this.executeMCPTool(
        mappingResult.mappedParameters,
        context
      );

      // Convert MCP result to framework result
      const frameworkResult = this.convertMCPResult(mcpResult, context);
      
      logger.debug(`MCP tool execution completed: ${this.mcpToolName}`, {
        executionId,
        success: frameworkResult.success,
        duration: frameworkResult.metadata.duration
      });

      return frameworkResult;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      logger.error(`MCP tool execution failed: ${this.mcpToolName}`, error as Error, {
        executionId,
        duration
      });

      return {
        success: false,
        error: {
          name: 'ToolExecutionError',
          code: 'TOOL_EXECUTION_ERROR',
          message: (error as Error).message,
          timestamp: endTime.toDateString(),
          details: {
            mcpToolName: this.mcpToolName,
            serverName: this.serverName,
            executionId
          }
        },
        metadata: {
          toolName: this.catalogEntry.frameworkName,
          executionId,
          startTime,
          endTime,
          duration
        }
      };
    }
  }

  /**
   * Execute the actual MCP tool call
   */
  private async executeMCPTool(
    parameters: Record<string, unknown>,
    context: ExtendedToolExecutionContext
  ): Promise<MCPToolExecutionResult<TOutput>> {
    const startTime = Date.now();
    const timeout = this.options.timeout || 30000; // 30 seconds default
    const retryCount = this.options.retryCount ?? 3; // Use nullish coalescing to allow 0
    const retryDelay = this.options.retryDelay || 1000;
    
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= Math.max(1, retryCount); attempt++) {
      try {
        logger.debug(`MCP tool call attempt ${attempt}/${retryCount}`, {
          executionId: context.executionId,
          toolName: this.mcpToolName,
          serverName: this.serverName
        });

        // Create timeout promise with cleanup
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Tool execution timeout after ${timeout}ms`)), timeout);
        });

        try {
          // Execute with timeout
          const mcpCallResult = await Promise.race([
            this.mcpClient.callTool(this.serverName, this.mcpToolName, parameters),
            timeoutPromise
          ]);

          // Clear timeout on successful completion
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          const executionTime = Date.now() - startTime;

          // Extract text content properly
          let extractedData: TOutput;
          if (mcpCallResult.content && mcpCallResult.content.length > 0) {
            // Get text from first content item if it exists
            extractedData = (mcpCallResult.content[0]?.text || '') as TOutput;
          } else {
            // Return empty string for empty content arrays
            extractedData = '' as TOutput;
          }

          return {
            success: true,
            data: extractedData,
            serverName: this.serverName,
            toolName: this.mcpToolName,
            executionTime,
            executedAt: new Date()
          };
        } catch (error) {
          // Clear timeout on error as well
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          throw error;
        }
      } catch (error) {
        lastError = error as Error;
        
        const isRetryableError = this.isRetryableError(error as Error);
        
        if (attempt < Math.max(1, retryCount) && isRetryableError) {
          logger.warn(`MCP tool call failed, retrying in ${retryDelay}ms`, {
            executionId: context.executionId,
            attempt,
            error: (error as Error).message
          });
          
          await this.delay(retryDelay);
        } else {
          break;
        }
      }
    }

    // All attempts failed
    const executionTime = Date.now() - startTime;
    const mcpError: MCPToolExecutionError = {
      code: 'MCP_CALL_FAILED',
      message: lastError?.message || 'Unknown error during MCP tool execution',
      details: {
        attempts: retryCount,
        lastError: lastError?.message
      },
      isRetryable: lastError ? this.isRetryableError(lastError) : false
    };

    return {
      success: false,
      error: mcpError,
      serverName: this.serverName,
      toolName: this.mcpToolName,
      executionTime,
      executedAt: new Date()
    };
  }

  /**
   * Convert MCP execution result to framework result
   */
  private convertMCPResult(
    mcpResult: MCPToolExecutionResult<TOutput>,
    context: ExtendedToolExecutionContext
  ): ToolExecutionResult<TOutput> {
    const endTime = new Date();
    const duration = Math.max(1, endTime.getTime() - context.startTime.getTime()); // Ensure at least 1ms
    
    if (mcpResult.success) {
      return {
        success: true,
        data: mcpResult.data as TOutput,
        metadata: {
          toolName: this.catalogEntry.frameworkName,
          executionId: context.executionId,
          startTime: context.startTime,
          endTime,
          duration,
          inputSize: this.calculateSize(context.originalInput ?? context.metadata),
          outputSize: this.calculateSize(mcpResult.data)
        }
      };
    }
    return {
        success: false,
        error: {
          name: 'ToolExecutionError',
          code: 'TOOL_EXECUTION_ERROR',
          message: mcpResult.error?.message || 'MCP tool execution failed',
          timestamp: endTime.toDateString(),
          details: {
            ...mcpResult.error?.details,
            mcpToolName: this.mcpToolName,
            serverName: this.serverName,
            executionTime: mcpResult.executionTime
          }
        },
        metadata: {
          toolName: this.catalogEntry.frameworkName,
          executionId: context.executionId,
          startTime: context.startTime,
          endTime,
          duration
        }
      };
    
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /timeout/i,
      /connection/i,
      /network/i,
      /temporary/i,
      /busy/i,
      /rate limit/i
    ];
    
    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Add delay between retries
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate approximate size of data for metadata
   */
  private calculateSize(data: unknown): number {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  /**
   * Sanitize input for logging (remove sensitive data)
   */
  private sanitizeInputForLogging(input: unknown): unknown {
    if (typeof input !== 'object' || input === null) {
      return input;
    }

    const sanitized = { ...input as Record<string, unknown> };
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'credential'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  /**
   * Get LLM output from tool execution result
   * For MCP tools, we return the data as-is since MCP tools should already provide clean output
   */
  public getLLMOutput(result: ToolExecutionResult<TOutput>): TLLMOutput {
    if (!result.success) {
      return {
        error: result.error?.message || 'MCP tool execution failed'
      } as TLLMOutput;
    }

    // For MCP tools, assume the data is already clean and suitable for LLM consumption
    // MCP tools are external and should already provide minimal, clean output
    return result.data as unknown as TLLMOutput;
  }
}