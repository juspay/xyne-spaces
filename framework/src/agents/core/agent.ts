/**
 * Main Agent Class
 * 
 * Single entry point for creating and managing agents.
 * Implements factory pattern to eliminate configuration duplication.
 */

import type { AgentConfig } from './config.js';
import { validateAndThrow } from './config.js';
import { createModelClient, createToolManager, resolveTools, createExecutionConfig, safeFactory } from './factory.js';
import { resolveToolDefinitions } from '../tools/resolver.js';
import { DefaultAgentOrchestrator } from '../orchestrator/agent-orchestrator.js';
import type { LLMClient } from '../../llm/client/llm-client.js';
import type { ToolExecutor } from '../../tools/core/tool-executor.js';
import type { Message } from '../../llm/core/types/index.js';
import type { ToolDefinition } from '../../llm/core/types/tools.js';
import type { OrchestratorEventHandler } from '../orchestrator/types.js';
import type { AgentExecutionResult } from './types.js';
import type { 
  MCPServerDetails, 
  MCPToolDescription, 
  MCPServerStatus 
} from './mcp-types.js';
// MCP manager will be loaded dynamically to avoid breaking tests
import { logger, LogLevel } from '../../utils/logger.js';

// Type-only import for MCP manager (will be dynamically imported when needed)
type AgentMCPManager = import('./mcp-manager.js').AgentMCPManager;

// ============================================================================
// Request/Response Types (Simplified)
// ============================================================================

/**
 * Simplified conversation request
 * All configuration comes from agent config - no duplication
 */
export interface ConversationRequest {
  /** Conversation messages to process */
  readonly messages: readonly Message[];
  /** Optional system prompt for this specific conversation */
  readonly systemPrompt?: string;
  /** Optional abort signal for interrupting execution */
  readonly abortSignal?: AbortSignal;
  /** Optional features to override for this conversation */
  readonly features?: {
    readonly thinkingMode?: boolean;
  };
}

/**
 * Conversation execution result
 */
export interface ConversationResult {
  /** Complete conversation history including agent responses */
  readonly messages: readonly Message[];
  /** Details of all tool executions performed */
  readonly toolExecutions: readonly ToolExecution[];
  /** Performance metrics for this conversation */
  readonly metrics: ConversationMetrics;
  /** Execution status */
  readonly status: 'completed' | 'max_turns' | 'interrupted' | 'error';
  /** Error details if status is 'error' */
  readonly error?: string;
}

/**
 * Tool execution details
 */
export interface ToolExecution {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly output: unknown;
  readonly duration: number;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Conversation performance metrics
 */
export interface ConversationMetrics {
  readonly totalDuration: number;
  readonly llmCalls: number;
  readonly totalTokens: number;
  readonly toolExecutions: number;
  readonly averageToolDuration: number;
  readonly conversationTurns: number;
  readonly startTime: Date;
  readonly endTime: Date;
}

/**
 * Agent status information
 */
export interface AgentStatus {
  readonly id: string;
  readonly state: 'idle' | 'processing' | 'error' | 'disposed';
  readonly config: AgentConfig;
  readonly components: {
    readonly modelClient: string;
    readonly toolManager: string;
    readonly orchestrator: string;
  };
  readonly statistics: {
    readonly totalConversations: number;
    readonly totalTokens: number;
    readonly averageDuration: number;
    readonly lastActivity?: Date;
  };
}

// ============================================================================
// Main Agent Class
// ============================================================================

/**
 * Main Agent class - single entry point for all agent operations
 * 
 * Features:
 * - Factory pattern creation from single config
 * - Automatic component management
 * - Clean lifecycle management
 * - Simplified API
 */
export class Agent {
  private readonly id: string;
  private readonly config: AgentConfig;
  private readonly modelClient: LLMClient;
  private readonly toolManager: ToolExecutor;
  private readonly orchestrator: DefaultAgentOrchestrator;
  private readonly resolvedTools: ToolDefinition[];
  private mcpManager: AgentMCPManager | undefined;
  private readonly mcpConfig: import('./mcp-types.js').AgentMCPConfig | undefined;
  
  private state: 'idle' | 'processing' | 'error' | 'disposed' = 'idle';
  private disposed = false;
  
  // Event handling
  private eventHandlers = new Map<string, OrchestratorEventHandler>();
  private handlerCounter = 0;
  
  // Statistics tracking
  private statistics = {
    totalConversations: 0,
    totalTokens: 0,
    totalDuration: 0,
    lastActivity: undefined as Date | undefined,
  };

  private constructor(
    config: AgentConfig,
    modelClient: LLMClient,
    toolManager: ToolExecutor,
    orchestrator: DefaultAgentOrchestrator,
    resolvedTools: ToolDefinition[],
    mcpConfig?: import('./mcp-types.js').AgentMCPConfig
  ) {
    this.id = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    this.config = config;
    this.modelClient = modelClient;
    this.toolManager = toolManager;
    this.orchestrator = orchestrator;
    this.resolvedTools = resolvedTools;
    this.mcpConfig = mcpConfig;
    this.mcpManager = undefined;

        // Set up event proxying from orchestrator
    this.setupEventProxying();
  }

  // ============================================================================
  // Factory Method - Main Entry Point
  // ============================================================================

  /**
   * Create a new agent from configuration
   * 
   * This is the main entry point - replaces all manual component creation
   */
  public static create(config: AgentConfig): Agent {
    // Validate configuration
    const validatedConfig = validateAndThrow(config);
    
    // Set logger level based on configuration
    const logLevel = validatedConfig.events.logging;
    switch (logLevel) {
      case 'debug':
        logger.setLevel(LogLevel.DEBUG);
        break;
      case 'info':
        logger.setLevel(LogLevel.INFO);
        break;
      case 'warn':
        logger.setLevel(LogLevel.WARN);
        break;
      case 'error':
        logger.setLevel(LogLevel.ERROR);
        break;
      case 'off':
        logger.setLevel(LogLevel.OFF); // Properly turn off all logging
        break;
    }
    
    // Create components using factory functions
    const modelClient = safeFactory(
      () => createModelClient(validatedConfig),
      'ModelClient'
    );
    
    const toolManager = safeFactory(
      () => createToolManager(validatedConfig),
      'ToolManager'
    );
    
    // Store MCP config but don't initialize yet
    // Application will call initializeMCP() when ready
    
    const resolvedTools = safeFactory(
      () => resolveTools(validatedConfig),
      'ToolResolution'
    );
    
    const executionConfig = safeFactory(
      () => createExecutionConfig(validatedConfig),
      'ExecutionConfig'
    );
    
    // Create orchestrator with dependencies
    const orchestrator = safeFactory(
      () => new DefaultAgentOrchestrator(
        modelClient,
        toolManager,
        executionConfig,
        resolvedTools
      ),
      'Orchestrator'
    );
    
    return new Agent(
      validatedConfig,
      modelClient,
      toolManager,
      orchestrator,
      resolvedTools,
      validatedConfig.tools.mcp
    );
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Execute a conversation
   */
  public async execute(request: ConversationRequest): Promise<ConversationResult> {
    this.checkDisposed();
    
    if (this.state === 'processing') {
      throw new AgentError('Agent is already processing a conversation', 'BUSY');
    }
    
    this.state = 'processing';
    const startTime = Date.now();
    
    try {
      // Agent lifecycle events removed - orchestrator events are proxied to applications
      
      // Use the originally resolved tools based on config.tools.enabled
      // This ensures we only use tools that were explicitly enabled in the configuration
      let currentTools = [...this.resolvedTools];
      
      // Add MCP tools if initialized (these are additional to the configured tools)
      if (this.mcpManager) {
        const registry = this.toolManager.getRegistry();
        const mcpToolNames = registry.getToolNames().filter(name => 
          !this.resolvedTools.some(tool => tool.name === name) && name.includes("mcp")
        );
        
        if (mcpToolNames.length > 0) {
          const mcpTools = resolveToolDefinitions(
            mcpToolNames.map(toolName => ({
              name: toolName,
              enabled: true,
              config: this.config.tools.config,
              ...(this.config.tools.execution.timeout !== undefined && { 
                timeout: this.config.tools.execution.timeout 
              }),
              ...(this.config.tools.execution.metadata && { 
                metadata: this.config.tools.execution.metadata 
              }),
            })),
            { registry }
          );
          currentTools = [...currentTools, ...mcpTools];
        }
      }
      logger.debug('Tools resolved for conversation', {
        configuredToolCount: this.resolvedTools.length,
        configuredToolNames: this.resolvedTools.map(t => t.name),
        totalToolCount: currentTools.length,
        allToolNames: currentTools.map(t => t.name),
        mcpInitialized: Boolean(this.mcpManager)
      });
      this.orchestrator.updateResolvedTools(currentTools);
      
      // Execute conversation using orchestrator
      const result = await this.orchestrator.executeConversation({
        messages: Array.from(request.messages),
        ...(request.systemPrompt && { systemPrompt: request.systemPrompt }),
        ...(request.features && { features: request.features }),
      }, request.abortSignal);
      
      // Update statistics
      this.updateStatistics(result, Date.now() - startTime);
      
      this.state = 'idle';
      return this.convertResult(result);
      
    } catch (error) {
      this.state = 'error';
      throw new AgentError(
        `Conversation execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EXECUTION_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get agent status and statistics
   */
  public getStatus(): AgentStatus {
    this.checkDisposed();
    
    return {
      id: this.id,
      state: this.state,
      config: this.config,
      components: {
        modelClient: this.modelClient.constructor.name,
        toolManager: this.toolManager.constructor.name,
        orchestrator: this.orchestrator.constructor.name,
      },
      statistics: {
        totalConversations: this.statistics.totalConversations,
        totalTokens: this.statistics.totalTokens,
        averageDuration: this.statistics.totalConversations > 0 
          ? this.statistics.totalDuration / this.statistics.totalConversations 
          : 0,
        ...(this.statistics.lastActivity && { lastActivity: this.statistics.lastActivity }),
      },
    };
  }

  /**
   * Get agent configuration
   */
  public getConfig(): AgentConfig {
    this.checkDisposed();
    return this.config;
  }

  /**
   * Get resolved tools
   */
  public getTools(): readonly ToolDefinition[] {
    this.checkDisposed();
    return this.resolvedTools;
  }

  /**
   * Check if agent is ready for execution
   */
  public isReady(): boolean {
    return !this.disposed && this.state !== 'error';
  }

  /**
   * Add event listener for orchestrator events
   */
  public addEventListener(handler: OrchestratorEventHandler): string {
    this.checkDisposed();
    
    const id = `handler_${++this.handlerCounter}`;
    this.eventHandlers.set(id, handler);
    return id;
  }

  /**
   * Remove event listener
   */
  public removeEventListener(id: string): boolean {
    this.checkDisposed();
    return this.eventHandlers.delete(id);
  }

  // ============================================================================
  // MCP Integration Methods
  // ============================================================================

  /**
   * Get all MCP server status information
   */
  public getAllMCPStatus(): MCPServerStatus[] {
    this.checkDisposed();
    if (!this.mcpManager) {
      return [];
    }
    return this.mcpManager.getAllMCPStatus();
  }

  /**
   * Get detailed information about a specific MCP server
   */
  public getMCPDetails(mcpName: string): MCPServerDetails | undefined {
    this.checkDisposed();
    if (!this.mcpManager) {
      return undefined;
    }
    return this.mcpManager.getMCPDetails(mcpName);
  }

  /**
   * Get detailed tool description for a specific MCP tool
   */
  public getMCPToolDescription(mcpName: string, toolName: string): MCPToolDescription | undefined {
    this.checkDisposed();
    if (!this.mcpManager) {
      return undefined;
    }
    return this.mcpManager.getMCPToolDescription(mcpName, toolName);
  }

  /**
   * Check if any MCP tools are available
   */
  public hasMCPTools(): boolean {
    this.checkDisposed();
    if (!this.mcpManager) {
      return false;
    }
    return this.mcpManager.hasMCPTools();
  }

  /**
   * Initialize MCP connections
   * 
   * Application controls when to call this and whether to await it:
   * - await agent.initializeMCP(): Wait for all servers to connect/fail (sync behavior)
   * - agent.initializeMCP(): Start connections in background (async behavior)
   */
  public async initializeMCP(): Promise<void> {
    this.checkDisposed();
    
    if (!this.mcpConfig) {
      logger.info('No MCP configuration found, skipping MCP initialization');
      return;
    }

    if (this.mcpManager) {
      logger.warn('MCP manager already initialized');
      return;
    }

    try {
      // Import MCP manager only when needed
      const { AgentMCPManager } = await import('./mcp-manager.js');
      this.mcpManager = new AgentMCPManager(this.toolManager.getRegistry(), this.mcpConfig);

      logger.info('Initializing MCP - connecting to servers');
      await this.mcpManager.initialize();
      logger.info('MCP initialization complete');
    } catch (error) {
      logger.error('Failed to initialize MCP manager', error as Error);
      throw error;
    }
  }

  /**
   * Wait for all pending MCP connections to complete (useful in async mode)
   */
  public async waitForMCPConnections(): Promise<void> {
    this.checkDisposed();
    if (this.mcpManager) {
      await this.mcpManager.waitForConnections();
    }
  }

  /**
   * Check if MCP is configured (regardless of initialization state)
   */
  public hasMCPConfig(): boolean {
    return Boolean(this.mcpConfig);
  }

  /**
   * Check if MCP manager is initialized
   */
  public isMCPInitialized(): boolean {
    this.checkDisposed();
    if (!this.mcpManager) {
      return false;
    }
    return this.mcpManager.isInitialized();
  }

  /**
   * Dispose agent and clean up resources
   */
  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    
    try {
      // Agent lifecycle events removed - orchestrator events are proxied to applications
      
      // Shutdown MCP manager first
      if (this.mcpManager) {
        await this.mcpManager.shutdown();
      }
      
      // Stop orchestrator
      if (this.orchestrator) {
        await this.orchestrator.dispose();
      }
      
      // Dispose model client
      if (this.modelClient) {
        this.modelClient.dispose();
      }
      
      // Clear event handlers
      this.eventHandlers.clear();
      
      // Mark as disposed
      this.disposed = true;
      this.state = 'disposed';
      
    } catch (error) {
      logger.error('Error during agent disposal', error instanceof Error ? error : new Error(String(error)), {
        agentId: this.id
      });
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private checkDisposed(): void {
    if (this.disposed) {
      throw new AgentError('Agent has been disposed', 'DISPOSED');
    }
  }

  private updateStatistics(result: AgentExecutionResult, duration: number): void {
    this.statistics.totalConversations++;
    this.statistics.totalTokens += result.metrics?.totalTokens || 0;
    this.statistics.totalDuration += duration;
    this.statistics.lastActivity = new Date();
  }

  private setupEventProxying(): void {
    // Create comprehensive event proxy that automatically handles ALL orchestrator events
    const eventProxy: OrchestratorEventHandler = {};
    
    // Create type-safe proxy handlers for all events
    eventProxy.onStateChange = (...args: unknown[]): void => { void this.proxyEventToHandlers('onStateChange', args); };
    eventProxy.onError = (...args: unknown[]): void => { void this.proxyEventToHandlers('onError', args); };
    eventProxy.onTurnStart = (...args: unknown[]): void => { void this.proxyEventToHandlers('onTurnStart', args); };
    eventProxy.onTurnComplete = (...args: unknown[]): void => { void this.proxyEventToHandlers('onTurnComplete', args); };
    eventProxy.onLLMRequest = (...args: unknown[]): void => { void this.proxyEventToHandlers('onLLMRequest', args); };
    eventProxy.onLLMResponse = (...args: unknown[]): void => { void this.proxyEventToHandlers('onLLMResponse', args); };
    eventProxy.onToolCallsRequested = (...args: unknown[]): void => { void this.proxyEventToHandlers('onToolCallsRequested', args); };
    eventProxy.onToolAuthorizationRequested = (...args: unknown[]): void => { void this.proxyEventToHandlers('onToolAuthorizationRequested', args); };
    eventProxy.onToolDenied = (...args: unknown[]): void => { void this.proxyEventToHandlers('onToolDenied', args); };
    eventProxy.onToolResult = (...args: unknown[]): void => { void this.proxyEventToHandlers('onToolResult', args); };
    eventProxy.onToolsComplete = (...args: unknown[]): void => { void this.proxyEventToHandlers('onToolsComplete', args); };
    eventProxy.onMessageAdded = (...args: unknown[]): void => { void this.proxyEventToHandlers('onMessageAdded', args); };
    eventProxy.onContextUsageUpdate = (...args: unknown[]): void => { void this.proxyEventToHandlers('onContextUsageUpdate', args); };
    eventProxy.onCompactingStarted = (...args: unknown[]): void => { void this.proxyEventToHandlers('onCompactingStarted', args); };
    eventProxy.onCompactingCompleted = (...args: unknown[]): void => { void this.proxyEventToHandlers('onCompactingCompleted', args); };
    eventProxy.onInterrupted = (...args: unknown[]): void => { void this.proxyEventToHandlers('onInterrupted', args); };
    
    // Register the comprehensive proxy with orchestrator
    this.orchestrator.addEventListener(eventProxy);
  }

  /**
   * Generic event proxy method that enriches events with agent context
   * and safely notifies all registered handlers
   */
  private async proxyEventToHandlers(
    eventMethod: keyof OrchestratorEventHandler, 
    args: unknown[]
  ): Promise<void> {
    if (this.eventHandlers.size === 0) {
      return; // Early return if no handlers
    }

    // Enrich event with agent context for better debugging/monitoring
    const enrichedContext = {
      agentId: this.id,
      agentState: this.state,
      timestamp: new Date(),
      eventSource: 'orchestrator'
    };

    // Process handlers in parallel for better performance
    const handlerPromises: Promise<void>[] = [];
    
    for (const [handlerId, handler] of Array.from(this.eventHandlers.entries())) {
      const handlerMethod = handler[eventMethod];
      
      if (handlerMethod) {
        // Create isolated promise for each handler to prevent cross-contamination
        const handlerPromise = this.executeHandlerSafely(
          handlerId,
          eventMethod,
          handlerMethod,
          args,
          enrichedContext
        );
        
        handlerPromises.push(handlerPromise);
      }
    }
    
    // Wait for all handlers to complete (but don't fail if some handlers fail)
    if (handlerPromises.length > 0) {
      await Promise.allSettled(handlerPromises);
    }
  }

  /**
   * Safely execute a single event handler with proper error isolation
   */
  private async executeHandlerSafely(
    handlerId: string,
    eventMethod: keyof OrchestratorEventHandler,
    handlerMethod: unknown,
    args: unknown[],
    enrichedContext: Record<string, unknown>
  ): Promise<void> {
    try {
      // Add enriched context as last argument for handlers that want it
      const enhancedArgs = [...args, enrichedContext];
      
      // Execute handler and handle both sync and async responses
      const result = (handlerMethod as (...args: unknown[]) => void | Promise<void>)(...enhancedArgs);
      
      if (result instanceof Promise) {
        await result;
      }
      
    } catch (error) {
      // Isolated error handling - one handler failure doesn't affect others
      this.handleEventHandlerError(handlerId, eventMethod, error, enrichedContext);
    }
  }

  /**
   * Handle errors from event handlers without disrupting other handlers
   */
  private handleEventHandlerError(
    handlerId: string,
    eventMethod: keyof OrchestratorEventHandler,
    error: unknown,
    context: Record<string, unknown>
  ): void {
    const errorDetails = {
      handlerId,
      eventMethod,
      agentId: this.id,
      error: error instanceof Error ? error.message : String(error),
      context
    };

    logger.error('Agent event handler failed', error instanceof Error ? error : new Error(String(error)), errorDetails);
  }

  private convertResult(orchestratorResult: AgentExecutionResult): ConversationResult {
    return {
      messages: orchestratorResult.messages || [],
      toolExecutions: (orchestratorResult.toolExecutions || []).map(exec => ({
        id: exec.id,
        name: exec.toolName || 'unknown',
        input: exec.arguments || {},
        output: exec.result?.data || null,
        duration: exec.duration || 0,
        success: exec.result?.success ?? false,
        error: exec.error,
      })) as readonly ToolExecution[],
      metrics: {
        totalDuration: orchestratorResult.metrics?.totalDuration || 0,
        llmCalls: orchestratorResult.metrics?.llmCalls || 0,
        totalTokens: orchestratorResult.metrics?.totalTokens || 0,
        toolExecutions: orchestratorResult.metrics?.toolExecutions || 0,
        averageToolDuration: orchestratorResult.metrics?.averageToolDuration || 0,
        conversationTurns: orchestratorResult.metrics?.conversationTurns || 0,
        startTime: orchestratorResult.metrics?.startTime || new Date(),
        endTime: orchestratorResult.metrics?.endTime || new Date(),
      },
      status: orchestratorResult.status === 'max_iterations' ? 'max_turns' : 
              orchestratorResult.status === 'interrupted' ? 'interrupted' :
              (orchestratorResult.status || 'completed'),
      ...(orchestratorResult.error && { error: orchestratorResult.error }),
    };
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Agent-specific error class
 */
export class AgentError extends Error {
  public readonly code: string;
  public readonly cause?: Error;
  
  constructor(
    message: string,
    code: string,
    cause?: Error
  ) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Check if an object is a valid conversation request
 */
export function isConversationRequest(obj: unknown): obj is ConversationRequest {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'messages' in obj &&
    Array.isArray((obj as Record<string, unknown>)['messages'])
  );
}

/**
 * Create a simple conversation request
 */
export function createConversationRequest(
  messages: readonly Message[],
  systemPrompt?: string,
  abortSignal?: AbortSignal
): ConversationRequest {
  return {
    messages,
    ...(systemPrompt && { systemPrompt }),
    ...(abortSignal && { abortSignal }),
  };
}
