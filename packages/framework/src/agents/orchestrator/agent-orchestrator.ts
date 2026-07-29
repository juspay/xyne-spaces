/**
 * Lean Agent Orchestrator Implementation
 * 
 * Simple, focused orchestration engine that coordinates LLM interactions
 * and tool execution. No state management, no statistics - pure execution.
 */

import type {
  AgentOrchestrator,
  OrchestratorEventHandler,
  OrchestratorState,
  AbortError,
  ToolAuthorizationHook,
  ToolAuthorizationContext,
} from './types.js';

import type {
  AgentExecutionRequest,
  AgentExecutionResult,
  ToolExecution,
} from '../core/types.js';

// Framework integrations
import { LLMClient } from '../../llm/client/llm-client.js';
import { ToolExecutor } from '../../tools/core/tool-executor.js';
import { toolRegistry } from '../../tools/core/tool-registry.js';
import { createSystemMessage, type LLMResponse, type Message, type ToolDefinition } from '../../llm/index.js';
import type { ToolExecutionError as ToolErrorType, ToolAuthorizationError } from '../../types/errors.js';

import type { ExecutionConfig } from '../core/config.js';
import {
  OrchestratorError,
} from './types.js';
import { ConversationCompactor } from '../../llm/features/compact/index.js';
import { logger } from '../../utils/logger.js';
import { 
  emit,
  createErrorEvent,
  createDebugEvent,
  createTokenUsageEvent,
} from '../events/index.js';

// ============================================================================
// Agent Orchestrator Implementation
// ============================================================================

export class DefaultAgentOrchestrator implements AgentOrchestrator {
  private readonly id: string;
  private disposed = false;
  private state: OrchestratorState = 'idle';

  // Event handling
  private eventHandlers = new Map<string, OrchestratorEventHandler>();
  private handlerCounter = 0;

  // Compacting
  private compactor?: ConversationCompactor;

  // Tool authorization
  private authorizationHook: ToolAuthorizationHook | undefined;

  constructor(
    private llmClient: LLMClient,
    private toolExecutor: ToolExecutor,
    private executionConfig: ExecutionConfig,
    private resolvedTools: ToolDefinition[]
  ) {
    this.id = `orchestrator_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    // Initialize compactor if compacting is enabled
    if (this.executionConfig.compacting?.enabled) {
      const llmConfig = this.llmClient.getConfig();
      this.compactor = new ConversationCompactor(llmConfig, llmConfig.defaultModel);
    }
    
    // Initialize tool authorization hook if provided
    this.authorizationHook = this.executionConfig.toolAuthorization;
    this.debug(`Orchestrator initialized`, {
      hasAuthHook: !!this.authorizationHook,
      authHookType: typeof this.executionConfig.toolAuthorization,
      authHookValue: this.executionConfig.toolAuthorization ? 'function' : 'undefined'
    });

    // Set up user input handler for tools that require it (e.g., ask_question)
    this.setupUserInputHandler();
  }

  /**
   * Set up handler for tools that require user input
   */
  private setupUserInputHandler(): void {
    this.toolExecutor.setUserInputHandler((details) => {
      // Emit event to frontend
      void this.notifyEventHandlers('onUserInputRequired', {
        toolName: details.toolName,
        toolCallId: details.toolCallId,
        data: details.data,
      });
    });
  }

  /**
   * Update the resolved tools (e.g., after MCP initialization)
   */
  public updateResolvedTools(tools: ToolDefinition[]): void {
    this.resolvedTools = tools;
    logger.debug('Orchestrator tools updated', {
      id: this.id,
      newToolCount: tools.length,
      toolNames: tools.map(t => t.name)
    });
  }

  // ============================================================================
  // Core Execution Interface
  // ============================================================================


  async executeConversation(request: AgentExecutionRequest, abortSignal?: AbortSignal): Promise<AgentExecutionResult> {
    this.checkDisposed();
    
    const startTime = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    // Set processing state
    this.setState('processing');
    
    // Emit conversation start event
    this.debug('Starting conversation execution', { executionId, messageCount: request.messages.length });
    
    try {
      const result = await this.executeConversationLoop(request, executionId, startTime, abortSignal);
      
      // Set back to idle after successful completion
      this.setState('idle');
      
      return result;
    } catch (error) {
      // Handle abort error specially (either AbortError or LLM abort error)
      const isAbortError = (error instanceof Error && error.name === 'AbortError');
      
      if (isAbortError) {
        this.setState('interrupted');
        const abortError = error as AbortError;
        const interruptedResult = this.createInterruptedResult(request, executionId, startTime, abortError.partialState);
        
        // Emit interruption event
        await this.notifyEventHandlers('onInterrupted', {
          executionId,
          completedTurns: abortError.partialState.conversationTurns,
          duration: Date.now() - startTime
        });
        
        return interruptedResult;
      }
      
      // Set error state for regular errors
      this.setState('error');
      
      // Emit error event
      this.handleError(error instanceof Error ? error : new Error(String(error)), { operation: 'executeConversation', executionId });
      return {
        success: false,
        ...(request.systemPrompt && { systemPrompt: request.systemPrompt }),
        messages: request.messages,
        toolExecutions: [],
        finalResponse: '',
        metrics: {
          totalDuration: Date.now() - startTime,
          llmCalls: 0,
          totalTokens: 0,
          toolExecutions: 0,
          averageToolDuration: 0,
          conversationTurns: 0,
          startTime: new Date(startTime),
          endTime: new Date(),
        },
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          executionId,
          configHash: this.createConfigHash(),
          context: {},
          environment: {
            nodeVersion: process.version,
            platform: process.platform,
            timestamp: new Date(),
          },
        },
      };
    }
  }

  addEventListener(handler: OrchestratorEventHandler): string {
    this.checkDisposed();
    
    const id = `handler_${++this.handlerCounter}`;
    this.eventHandlers.set(id, handler);
    return id;
  }

  removeEventListener(id: string): boolean {
    this.checkDisposed();
    return this.eventHandlers.delete(id);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.setState('disposed');
    this.eventHandlers.clear();
    
    // Dispose compactor if it exists
    if (this.compactor) {
      this.compactor.dispose();
    }
    
    this.disposed = true;
    
    // Allow any pending async operations to complete
    await Promise.resolve();
  }

  private checkDisposed(): void {
    if (this.disposed) {
      throw new OrchestratorError('Orchestrator has been disposed', 'DISPOSED');
    }
  }

  private setState(newState: OrchestratorState): void {
    const previousState = this.state;
    this.state = newState;
    
    // Notify event handlers
    void this.notifyEventHandlers('onStateChange', newState, previousState);
    
    // Also emit debug event for logging
    this.debug(`State changed: ${previousState} -> ${newState}`);
  }

  private async notifyEventHandlers(
    method: keyof OrchestratorEventHandler,
    ...args: unknown[]
  ): Promise<void> {
    const promises: Array<Promise<void>> = [];
    
    for (const handler of Array.from(this.eventHandlers.values())) {
      const handlerMethod = handler[method];
      if (handlerMethod) {
        try {
          const result = (handlerMethod as (...args: unknown[]) => void | Promise<void>)(...args);
          if (result instanceof Promise) {
            promises.push(result);
          }
        } catch (error) {
          // Log but don't throw handler errors
          this.debug('Event handler error', { method, error });
        }
      }
    }
    
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  private handleError(error: Error, context: Record<string, unknown> = {}): void {
    // Notify event handlers
    void this.notifyEventHandlers('onError', error, context);
    
    // Also emit debug event for logging
    emit(createErrorEvent(
      this.id,
      error,
      'error',
      context,
      true
    ));
  }

  private debug(message: string, context: Record<string, unknown> = {}): void {
    emit(createDebugEvent(
      this.id,
      message,
      context
    ));
  }



  private async executeConversationLoop(
    request: AgentExecutionRequest,
    executionId: string,
    startTime: number,
    abortSignal?: AbortSignal
  ): Promise<AgentExecutionResult> {
    const messages = [...request.messages];
    const toolExecutions: ToolExecution[] = [];
    let llmCalls = 0;
    let totalTokens = 0;
    let conversationTurns = 0;
    let executionError: Error | null = null;
    
    // Use pre-resolved tools from dependency injection
    const resolvedTools: ToolDefinition[] = this.resolvedTools;
    
    // Get execution settings from execution config
    const baseMaxIterations = this.executionConfig.maxTurns || 10;
    const maxToolsPerTurn = this.executionConfig.limits.toolsPerTurn || 5;
    const maxRequestsPerTurn = this.executionConfig.limits.requestsPerTurn || 3;
    const continueOnToolError = this.executionConfig.errorHandling.continueOnToolError ?? true;
    
    // Check execution mode and determine actual max iterations
    const maxIterations = this.executionConfig.mode === 'single' 
      ? Math.min(baseMaxIterations, 1)
      : baseMaxIterations;
    
    // Main LLM-tool loop with timeout
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Check for interruption at start of each turn
      if (abortSignal?.aborted) {
        throw this.createAbortError(messages, toolExecutions, llmCalls, totalTokens, conversationTurns);
      }
      
      conversationTurns++;
      
      // Emit turn start event
      await this.notifyEventHandlers('onTurnStart', conversationTurns, { 
        messageCount: messages.length, 
        iteration 
      });
      this.debug(`Starting conversation turn ${conversationTurns}`, { iteration, messageCount: messages.length });
      
      try {
        // Check request limit
        if (llmCalls >= maxRequestsPerTurn * conversationTurns) {
          throw new OrchestratorError(
            `Exceeded LLM request limit (${maxRequestsPerTurn} per turn)`,
            'REQUEST_LIMIT_EXCEEDED'
          );
        }
        
        // Check for interruption before LLM call
        if (abortSignal?.aborted) {
          throw this.createAbortError(messages, toolExecutions, llmCalls, totalTokens, conversationTurns);
        }
        
        // Check compacting and context monitoring
        const wasCompacted = await this.handleCompactingAndContextMonitoring(messages, conversationTurns, resolvedTools, request.systemPrompt);
        
        if (wasCompacted) {
          // Restart turn completely - discard any pending state
          continue;
        }
        
        // Emit LLM request event
        const llmRequest = {
          messages,
          ...(request.systemPrompt && { systemPrompt: request.systemPrompt }),
          tools: resolvedTools,
        };
        await this.notifyEventHandlers('onLLMRequest', llmRequest);
        
        // Call LLM with resolved tools and abort signal support
        const llmResponse = await this.llmClient.generate({
          ...llmRequest,
          ...(abortSignal && { abortSignal }),
          ...(request.features && { features: request.features })
        });
        llmCalls++;
        totalTokens += llmResponse.usage?.totalTokens || 0;
        
        // Emit LLM response event
        await this.notifyEventHandlers('onLLMResponse', {
          content: llmResponse.content || '',
          thinking: llmResponse.thinking,
          toolCalls: llmResponse.toolCalls || [],
          tokens: llmResponse.usage?.totalTokens || 0
        });
        this.debug('LLM response received', { 
          tokens: llmResponse.usage?.totalTokens || 0,
          hasToolCalls: (llmResponse.toolCalls?.length || 0) > 0
        });
      
        // Add assistant response to messages
        const assistantMessage = this.convertLLMResponseToMessage(llmResponse);
        messages.push(assistantMessage);
        
        // Emit message added event
        await this.notifyEventHandlers('onMessageAdded', assistantMessage);
      
        // Check if LLM wants to use tools
        const toolCalls = this.extractToolCalls(llmResponse);
        if (toolCalls.length === 0) {
          // No tools requested, conversation complete
          break;
        }
        
        // Check tool limit
        if (toolCalls.length > maxToolsPerTurn) {
          throw new OrchestratorError(
            `Too many tool calls requested (${toolCalls.length} > ${maxToolsPerTurn})`,
            'TOOL_LIMIT_EXCEEDED'
          );
        }
        
        // Check for interruption before tool execution
        if (abortSignal?.aborted) {
          throw this.createAbortError(messages, toolExecutions, llmCalls, totalTokens, conversationTurns);
        }
        
        // Emit tool calls requested event
        await this.notifyEventHandlers('onToolCallsRequested', toolCalls);
        
        // Execute tools with individual events
        this.debug(`Executing ${toolCalls.length} tool calls`, { toolNames: toolCalls.map(t => t.name) });
        const { results: toolResults, authorizationDenied } = await this.executeToolsWithEvents(toolCalls, continueOnToolError, abortSignal, {
          executionId,
          conversationTurns,
          messageCount: messages.length
        });
        toolExecutions.push(...toolResults);
        
        // Emit tools complete event
        await this.notifyEventHandlers('onToolsComplete', toolResults.map(r => ({
          id: r.id,
          name: r.toolName,
          success: r.result.success
        })));
        
        this.debug(`Tool execution completed`, { 
          toolCount: toolResults.length,
          successCount: toolResults.filter(t => t.result.success).length
        });
        
        // Add tool results to messages
        for (const result of toolResults) {
          const toolResultMessage = this.createToolResultMessage(result);
          messages.push(toolResultMessage);
          
          // Emit message added event for each tool result
          await this.notifyEventHandlers('onMessageAdded', toolResultMessage);
        }

        // Check if authorization was denied
        if (authorizationDenied) {
          // Tool authorization failed - abort conversation with current state
          throw this.createToolDeneidError(messages, toolExecutions, llmCalls, totalTokens, conversationTurns);
        }
        
      } catch (error) {
        // Check if this is an abort error that should be re-thrown

        const isToolDeniedError = (error instanceof Error && 
          (error.message.includes('Tell agent') || error.message.includes('Tell agent')));

        if (isToolDeniedError) {
          throw this.createToolDeneidError(messages, toolExecutions, llmCalls, totalTokens, conversationTurns);
        }



        const isLLMAbortError = (error instanceof Error && 
          (error.message.includes('was aborted') || error.message.includes('Request was aborted')));
        
        if (isLLMAbortError) {
          // Create proper abort error with current execution state
          throw this.createAbortError(messages, toolExecutions, llmCalls, totalTokens, conversationTurns);
        }
        
        // Capture the error for result status
        executionError = error instanceof Error ? error : new Error(String(error));
        
        // Handle turn-level errors
        if (this.executionConfig.errorHandling.maxRetries && this.executionConfig.errorHandling.maxRetries > 0) {
          // Could implement retry logic here
          this.debug('Turn failed, but not implementing retries yet', { error: executionError.message });
        }
        
        // For now, break on errors (could be configurable)
        this.handleError(executionError, { turn: conversationTurns, operation: 'executeTurn' });
        break;
      }
      
      // Continue loop for LLM to process tool results
    }
    
    const duration = Date.now() - startTime;
    const finalMessage = messages[messages.length - 1];
    const finalResponse = finalMessage ? this.extractTextContent(finalMessage) || 'No response generated' : 'No response generated';
    
    // Determine result status based on execution state
    const hasError = executionError !== null;
    const reachedMaxIterations = conversationTurns >= maxIterations;
    
    // Create result object first
    const result: AgentExecutionResult = {
      success: !hasError,
      ...(request.systemPrompt && { systemPrompt: request.systemPrompt }),
      messages,
      toolExecutions,
      finalResponse,
      metrics: {
        totalDuration: duration,
        llmCalls,
        totalTokens,
        toolExecutions: toolExecutions.length,
        averageToolDuration: toolExecutions.length > 0 
          ? toolExecutions.reduce((sum, t) => sum + t.duration, 0) / toolExecutions.length 
          : 0,
        conversationTurns,
        startTime: new Date(startTime),
        endTime: new Date(),
      },
      status: hasError ? 'error' : (reachedMaxIterations ? 'max_iterations' : 'completed'),
      ...(hasError && executionError && { error: executionError.message }),
      metadata: {
        executionId,
        configHash: this.createConfigHash(),
        context: { iterations: conversationTurns },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          timestamp: new Date(),
        },
      },
    };
    
    // Emit turn completion event (with the final turn number and result)
    await this.notifyEventHandlers('onTurnComplete', conversationTurns, result);
    
    // Emit conversation completion event
    this.debug('Conversation completed', {
      duration,
      turns: conversationTurns,
      llmCalls,
      toolExecutions: toolExecutions.length,
      totalTokens
    });
    
    return result;
  }

  
  private convertLLMResponseToMessage(response: LLMResponse): Message {
    // Create assistant message with content and tool calls
    return {
      id: response.id,
      type: 'assistant',
      content: response.content,
      timestamp: new Date().toDateString(),
      ...(response.toolCalls && { toolCalls: response.toolCalls }),
      ...(response.thinking && { thinking: response.thinking }),
      ...(response.thinkingSignature && { thinkingSignature: response.thinkingSignature }),
    };
  }
  
  
  private extractToolCalls(response: LLMResponse): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
    // Extract tool calls from LLM response
    if (!response.toolCalls || response.toolCalls.length === 0) return [];
    
    return response.toolCalls.map(toolCall => ({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments || {},
    }));
  }
  
  
  private async executeToolsWithEvents(
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
    continueOnError: boolean = true,
    abortSignal?: AbortSignal,
    authContext?: {
      executionId: string;
      conversationTurns: number;
      messageCount: number;
    }
  ): Promise<{ results: ToolExecution[]; authorizationDenied: boolean }> {
    const results: ToolExecution[] = [];
    let authorizationDenied = false;
    
    this.debug(`Starting tool execution loop with ${toolCalls.length} tools`, {
      hasAuthHook: !!this.authorizationHook,
      hasAuthContext: !!authContext
    });
    
    for (const toolCall of toolCalls) {
      // Check for interruption before each tool execution
      if (abortSignal?.aborted) {
        break; // Return partial results
      }
      
      // Check tool authorization if hook is configured
      this.debug(`Checking authorization for tool: ${toolCall.name}`, {
        hasAuthHook: !!this.authorizationHook,
        hasAuthContext: !!authContext
      });
      
      if (this.authorizationHook && authContext) {
        const authorizationContext: ToolAuthorizationContext = {
          executionId: authContext.executionId,
          agentId: this.id,
          conversationTurns: authContext.conversationTurns,
          toolCallId: toolCall.id,
          timestamp: new Date(),
          messageCount: authContext.messageCount,
        };
        
        // Emit authorization request event
        await this.notifyEventHandlers('onToolAuthorizationRequested', {
          toolName: toolCall.name,
          parameters: toolCall.arguments,
          context: authorizationContext,
        });
        
        try {
          // Call authorization hook with cloned parameters to prevent modification
          const clonedArguments = JSON.parse(JSON.stringify(toolCall.arguments)) as Record<string, unknown>;
          const authResult = await this.authorizationHook(
            toolCall.name,
            clonedArguments,
            authorizationContext
          );
          
          if (authResult?.denied) {
            // Tool was denied
            await this.notifyEventHandlers('onToolDenied', {
              toolName: toolCall.name,
              parameters: toolCall.arguments,
              reason: authResult.reason,
              shouldTerminate: authResult.shouldTerminate,
              context: authorizationContext,
            });
            
            // Create a denial result message
            const denialExecution: ToolExecution = {
              id: toolCall.id,
              toolName: toolCall.name,
              arguments: toolCall.arguments,
              result: {
                success: false,
                data: null,
                error: {
                  name: 'ToolAuthorizationError',
                  message: authResult.reason,
                  code: 'TOOL_AUTHORIZATION_DENIED',
                  timestamp: new Date().toDateString(),
                } as ToolAuthorizationError,
                metadata: {
                  toolName: toolCall.name,
                  executionId: toolCall.id,
                  startTime: new Date(),
                  endTime: new Date(),
                  duration: 0,
                },
              },
              startTime: new Date(),
              endTime: new Date(),
              duration: 0,
              error: authResult.reason,
              metadata: {
                source: 'authorization',
                category: 'denied',
                denied: true,
                shouldTerminate: authResult.shouldTerminate,
                ...authResult.metadata,
              },
            };
            
            results.push(denialExecution);
            
            // Create and emit tool result message for denial
            const denialMessage = this.createToolResultMessage(denialExecution);
            await this.notifyEventHandlers('onToolResult', {
              ...denialMessage,
              duration: 0
            });
            
            // Handle termination behavior
            if (authResult.shouldTerminate) {
              // Tool denial with termination - set flag and return results
              authorizationDenied = true;
              return { results, authorizationDenied };
            }
            // Tool denial without termination - continue with next tool
            continue;
            
          }
          
          // Authorization passed, continue with normal execution
        } catch (authError) {
          // Authorization hook failed - log error and default to denying (fail-safe)
          this.debug('Authorization hook failed', { 
            error: authError instanceof Error ? authError.message : String(authError),
            toolName: toolCall.name
          });
          
          // Create denial result due to hook failure
          const hookFailureExecution: ToolExecution = {
            id: toolCall.id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            result: {
              success: false,
              data: null,
              error: {
                name: 'ToolAuthorizationError',
                message: 'Authorization hook failed',
                code: 'AUTHORIZATION_HOOK_ERROR',
                timestamp: new Date().toDateString(),
                originalError: authError instanceof Error ? authError : undefined,
              } as ToolAuthorizationError,
              metadata: {
                toolName: toolCall.name,
                executionId: toolCall.id,
                startTime: new Date(),
                endTime: new Date(),
                duration: 0,
              },
            },
            startTime: new Date(),
            endTime: new Date(),
            duration: 0,
            error: 'Authorization hook failed',
            metadata: {
              source: 'authorization',
              category: 'hook_failure',
              hookFailure: true,
            },
          };
          
          results.push(hookFailureExecution);
          
          // Create and emit tool result message for hook failure
          const hookFailureMessage = this.createToolResultMessage(hookFailureExecution);
          await this.notifyEventHandlers('onToolResult', {
            ...hookFailureMessage,
            duration: 0
          });
          
          // Authorization hook failed - set flag and return results
          authorizationDenied = true;
          return { results, authorizationDenied };
        }
      }
      
      const startTime = Date.now();
      
      try {
        // Execute tool using framework tool executor with abort signal and timeout from config
        const result = await this.toolExecutor.executeToolByName(
          toolCall.name, 
          toolCall.arguments, 
          {
            ...(abortSignal && { abortSignal }),
            ...(this.executionConfig.timeouts.tool && { timeout: this.executionConfig.timeouts.tool })
          },
          toolCall.id
        );
        
        const duration = Date.now() - startTime;
        
        const toolExecution: ToolExecution = {
          id: toolCall.id,
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          result,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration,
          metadata: {
            source: 'framework',
            category: 'execution',
          },
        };
        
        results.push(toolExecution);
        
        
        // Create the same ToolResultMessage that will be stored
        const toolResultMessage = this.createToolResultMessage(toolExecution);
        
        // Emit individual tool result event with actual message + duration + full result
        await this.notifyEventHandlers('onToolResult', {
          ...toolResultMessage,
          duration,
          fullToolResult: toolExecution.result.data
        });
        
      } catch (error) {
        const duration = Date.now() - startTime;
        
        const toolExecution: ToolExecution = {
          id: toolCall.id,
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          result: { 
            success: false, 
            data: null, 
            error: {
              name: 'ToolExecutionError',
              message: error instanceof Error ? error.message : 'Unknown error',
              code: 'TOOL_EXECUTION_ERROR',
              timestamp: new Date().toDateString(),
              originalError: error instanceof Error ? error : undefined
            } as ToolErrorType,
            metadata: {
              toolName: toolCall.name,
              executionId: toolCall.id,
              startTime: new Date(startTime),
              endTime: new Date(),
              duration
            }
          },
          startTime: new Date(startTime),
          endTime: new Date(),
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
          metadata: {
            source: 'framework',
            category: 'execution',
          },
        };
        
        results.push(toolExecution);
        
        // Create the same ToolResultMessage that will be stored  
        const toolResultMessage = this.createToolResultMessage(toolExecution);
        
        // Emit individual tool result event with actual message + duration + full result
        await this.notifyEventHandlers('onToolResult', {
          ...toolResultMessage,
          duration,
          fullToolResult: toolExecution.result.data
        });
        
        // Handle error based on configuration
        if (!continueOnError) {
          throw error;
        }
      }
    }
    
    return { results, authorizationDenied };
  }
  
  private createToolResultMessage(toolExecution: ToolExecution): Message {
    let content: string;
    
    try {
      // Get tool instance to access getLLMOutput method
      const toolInstance = toolRegistry.createToolInstance(toolExecution.toolName);
      
      // Use the tool's getLLMOutput method to get clean output for LLM
      const llmOutput = toolInstance.getLLMOutput(toolExecution.result);
      content = JSON.stringify(llmOutput);
    } catch {
      // Fallback to original behavior if getLLMOutput fails
      content = toolExecution.result.success 
        ? JSON.stringify(toolExecution.result.data)
        : (toolExecution.error || 'Tool execution failed');
    }
    
    return {
      id: `tool_result_${toolExecution.id}`,
      type: 'tool_result',
      content,
      timestamp: new Date().toDateString(),
      toolCallId: toolExecution.id,
      success: toolExecution.result.success,
      ...(toolExecution.error && { error: toolExecution.error }),
    };
  }
  
  private extractTextContent(message: Message): string {
    // LLM module messages already have content as string
    return message.content || '';
  }
  
  private createConfigHash(): string {
    return `config_${Date.now()}`;
  }

  /**
   * Get max tokens for context window calculation
   */
  private getMaxTokens(): number {
    const maxTokens = this.llmClient.getConfig().maxTokens;
    if (!maxTokens) {
      throw new Error('maxTokens must be configured in the LLM client config for accurate context window management');
    }
    return maxTokens;
  }

  /**
   * Create abort error with partial execution state
   */
  private createToolDeneidError(
    messages: Message[],
    toolExecutions: ToolExecution[],
    llmCalls: number,
    totalTokens: number,
    conversationTurns: number
  ): AbortError {
    const error = new Error('Tell agent what to do alternatively') as AbortError;
    error.name = 'AbortError';
    error.partialState = {
      messages,
      toolExecutions,
      llmCalls,
      totalTokens,
      conversationTurns
    };
    return error;
  }

  /**
   * Create abort error with partial execution state
   */
  private createAbortError(
    messages: Message[],
    toolExecutions: ToolExecution[],
    llmCalls: number,
    totalTokens: number,
    conversationTurns: number
  ): AbortError {
    const error = new Error('Execution aborted') as AbortError;
    error.name = 'AbortError';
    error.partialState = {
      messages,
      toolExecutions,
      llmCalls,
      totalTokens,
      conversationTurns
    };
    return error;
  }

  /**
   * Create interrupted result from partial state
   */
  private createInterruptedResult(
    request: AgentExecutionRequest,
    executionId: string,
    startTime: number,
    partialState: {
      messages: Message[];
      toolExecutions: ToolExecution[];
      llmCalls: number;
      totalTokens: number;
      conversationTurns: number;
    }
  ): AgentExecutionResult {
    const duration = Date.now() - startTime;
    const finalMessage = partialState.messages[partialState.messages.length - 1];
    const finalResponse = finalMessage && finalMessage.type === 'assistant' 
      ? this.extractTextContent(finalMessage) || 'Execution interrupted' 
      : 'Execution interrupted';
    
    return {
      success: false,
      ...(request.systemPrompt && { systemPrompt: request.systemPrompt }),
      messages: partialState.messages,
      toolExecutions: partialState.toolExecutions,
      finalResponse,
      metrics: {
        totalDuration: duration,
        llmCalls: partialState.llmCalls,
        totalTokens: partialState.totalTokens,
        toolExecutions: partialState.toolExecutions.length,
        averageToolDuration: partialState.toolExecutions.length > 0 
          ? partialState.toolExecutions.reduce((sum, t) => sum + t.duration, 0) / partialState.toolExecutions.length 
          : 0,
        conversationTurns: partialState.conversationTurns,
        startTime: new Date(startTime),
        endTime: new Date(),
      },
      status: 'interrupted',
      metadata: {
        executionId,
        configHash: this.createConfigHash(),
        context: { 
          iterations: partialState.conversationTurns,
          interruptedAt: new Date(),
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          timestamp: new Date(),
        },
      },
    };
  }

  /**
   * Handle conversation compacting and context monitoring
   */
  private async handleCompactingAndContextMonitoring(
    messages: Message[],
    conversationTurns: number,
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<boolean> {
    if (!this.compactor || !this.executionConfig.compacting?.enabled) {
      return false;
    }

    const compactingConfig = this.executionConfig.compacting;
    
    try {
      // Get current token usage
      const systemMessages : Message = createSystemMessage(systemPrompt || '');
      const allMessages = systemMessages ? [systemMessages, ...messages] : messages;
      const maxTokens = this.getMaxTokens();
      const [usagePercentage, currentTokens] = await this.compactor.getTokenUsagePercentage(allMessages, tools, maxTokens);
      const tokenInfo = this.compactor.getTokenCountingInfo();

      // Emit token usage event
      emit(createTokenUsageEvent(
        this.id,
        currentTokens,
        tokenInfo.contextWindow,
        usagePercentage
      ));

      // Emit context usage update if monitoring is enabled and above minimum threshold
      if (compactingConfig.contextMonitoring?.enabled && 
          usagePercentage >= (compactingConfig.contextMonitoring.minThreshold ?? 70)) {
        await this.notifyEventHandlers('onContextUsageUpdate', {
          currentTokens,
          contextWindow: tokenInfo.contextWindow,
          usagePercentage,
          conversationTurns,
        });
      }

      // Check if compacting is needed
      const shouldCompact = usagePercentage >= compactingConfig.threshold;
      
      if (shouldCompact) {
        // Emit compacting started event
        await this.notifyEventHandlers('onCompactingStarted', {
          currentMessageCount: messages.length,
          estimatedTokens: currentTokens,
          contextWindowLimit: tokenInfo.contextWindow,
          thresholdPercentage: compactingConfig.threshold,
        });

        this.debug('Starting conversation compacting', {
          messageCount: messages.length,
          currentTokens,
          usagePercentage,
          threshold: compactingConfig.threshold
        });

        // Perform compacting
        const originalTokenCount = currentTokens;
        const compactedMessages = await this.compactor.compact(
          messages, 
          compactingConfig.systemPrompt
        );

        // Convert compacted assistant message to user message for restart
        const userMessage = compactedMessages[compactedMessages.length - 1]; // Should be single assistant message
        
        if (userMessage === undefined) {
          throw new Error('Compacting failed');
        }

        // Replace all messages with the single user message
        messages.splice(0, messages.length, userMessage);

        // Calculate token reduction
        // const newTokenCount = await this.compactor.getTokenCount(messages, tools, maxTokens);
        // const tokensReduced = originalTokenCount - newTokenCount;

        // Emit compacting completed event
        await this.notifyEventHandlers('onCompactingCompleted', {
          originalMessageCount: messages.length + (messages.length - 1), // Approximate original count
          compactedMessageCount: 1,
          // tokensReduced,
          compactSummary: userMessage,
          restartedTurn: true
        });

        this.debug('Conversation compacting completed with turn restart', {
          originalTokens: originalTokenCount,
          messageCount: 1
        });
        
        return true; // Signal that turn should restart
      }

    } catch (error) {
      // Log compacting errors but don't fail the conversation
      this.debug('Compacting failed, continuing without compacting', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
    
    return false; // No compacting happened, continue normal execution
  }

}
