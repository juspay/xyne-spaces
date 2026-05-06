import type { ToolDefinition, ToolExecutionContext } from "../types.js";

/**
 * Push a tool invocation to the progress endpoint for streaming to frontend.
 * Mirrors the pushInvocation function in xyne-claw/src/agent.ts
 */
function pushToolInvocation(
  progressUrl: string | undefined,
  sessionId: string | undefined,
  s2sKey: string | undefined,
  invocation: unknown,
): void {
  if (!progressUrl || !sessionId) return;
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(s2sKey ? { "x-s2s-key": s2sKey } : {}),
    },
    body: JSON.stringify({ sessionId, toolInvocation: invocation }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    console.warn(`[research-agent] Tool invocation push failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

interface ResearchAgentToolEvent {
  event_type: "tool_execution_started" | "tool_execution_complete" | "tool_execution_error";
  tool_name?: string;
  tool_call_id?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration_ms?: number;
}

export const RESEARCH_AGENT_CONFIG_SCHEMA = {
  RESEARCH_AGENT_API_URL: {
    label: "Research Agent API URL",
    default: "<research-agent-url>",
    required: true as const,
    placeholder: "<research-agent-url>",
  },
  RESEARCH_AGENT_API_KEY: {
    label: "Research Agent API Key",
    default: "",
    required: false as const,
    placeholder: "Optional API key for authentication (falls back to RESEARCH_AGENT_API_KEY env var)",
  },
  DEFAULT_REPOSITORY_ID: {
    label: "Default Repository ID",
    default: "989d9105-d8f0-4549-b63b-ac2363054ec0",
    required: false as const,
    placeholder: "Default repository ID when none specified (for backward compatibility)",
  },
};

export const queryCodebase: ToolDefinition = {
  slug: "query-codebase",
  name: "Query Codebase",
  description:
    "Query the external research agent system for codebase knowledge. " +
    "Use this when you need to: review PRs, plan implementations, " +
    "debug issues without coding, understand code patterns, or get " +
    "architecture guidance. The external system has full repository knowledge.",
  source: "custom:research-agent",
  configSchema: RESEARCH_AGENT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Your question or request for the research agent. " +
          "Be specific: file paths, error messages, " +
          "branch names, or any context needed for accurate results.",
      },
      systemPrompt: {
        type: "string",
        description:
          "Optional custom system prompt to guide the research agent's behavior. " +
          "If not provided, the research agent will use its default behavior.",
      },
      repository: {
        type: "string",
        description: "Optional: Repository ID to query (overrides default context)",
      },
      product: {
        type: "string",
        description: "Optional: Product ID to query (overrides default context)",
      },
    },
    required: ["prompt"],
  },

  async execute(params, context) {
    if (!context) {
      return "Error: No execution context available.";
    }

    const prompt = params["prompt"] as string; 
    const systemPrompt = (params["systemPrompt"] as string) || "";
    const explicitRepository = params["repository"] as string | undefined;
    const explicitProduct = params["product"] as string | undefined;

    if (!prompt || !prompt.trim()) {
      return "Error: prompt is required.";
    }

    const apiUrl = context.config["RESEARCH_AGENT_API_URL"] ?? "http://localhost:8080";
    const apiKey = context.config["RESEARCH_AGENT_API_KEY"] ?? "";

    const defaultRepositoryId = context.config["DEFAULT_REPOSITORY_ID"] ?? "";

    // Determine repository/product from multiple sources (priority order):
    // 1. Explicit tool parameters (LLM-provided)
    // 2. Runtime researchContext from agent execution (frontend-selected)
    // 3. Default repository ID from config
    const runtimeContext = (context as unknown as { researchContext?: { type?: string; id?: string; name?: string; repositoryId?: string; productId?: string } }).researchContext;
    
    let repositoryId: string | undefined;
    let productId: string | undefined;

    // If explicit parameters are provided, validate they look like UUIDs (not names)
    // This prevents the LLM from passing "My Product" instead of the actual ID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (explicitRepository && UUID_REGEX.test(explicitRepository)) {
      repositoryId = explicitRepository;
    } else if (explicitRepository) {
      // Ignoring explicit repository (not a UUID)
    }
    
    if (explicitProduct && UUID_REGEX.test(explicitProduct)) {
      productId = explicitProduct;
    } else if (explicitProduct) {
      // Ignoring explicit product (not a UUID)
    }

    // If no valid explicit params, use runtime context from frontend
    if (!repositoryId && !productId && runtimeContext) {
      if (runtimeContext.type === "repository") {
        // Use repositoryId if available, otherwise fallback to id
        repositoryId = runtimeContext.repositoryId || runtimeContext.id;
      } else if (runtimeContext.type === "product") {
        // Use productId if available, otherwise fallback to id
        productId = runtimeContext.productId || runtimeContext.id;
      }
    }

    // Fall back to default if nothing specified
    if (!repositoryId && !productId) {
      repositoryId = defaultRepositoryId;
    }

    const maxIterations = 3;
    let currentIteration = 0;

    while (currentIteration < maxIterations) {
      try {
        // Step 1: Create a session
        const sessionUrl = `${apiUrl}/api/chat/sessions`;
        const sessionHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
        };
        // Build session body - research agent API accepts either repository_id or product_id
        const sessionBody: Record<string, string> = {
          title: "Xyne Doctor Research Query",
          session_type: "api_session",
        };
        
        if (repositoryId) {
          sessionBody.repository_id = repositoryId;
        } else if (productId) {
          sessionBody.product_id = productId;
        }
        
        const sessionRes = await fetch(sessionUrl, {
          method: "POST",
          headers: sessionHeaders,
          body: JSON.stringify(sessionBody),
          signal: AbortSignal.timeout(60_000), // 1 minute for session creation
        });

        if (!sessionRes.ok) {
          throw new Error(`Session creation failed: ${sessionRes.status} ${await sessionRes.text()}`);
        }

        const sessionData = await sessionRes.json() as { id?: string };
        const sessionId = sessionData.id;

        if (!sessionId) {
          throw new Error("No session ID returned from session creation");
        }

        // Step 2: Stream chat request
        const chatUrl = `${apiUrl}/api/chat/sessions/${sessionId}/stream`;
        const chatBody = {
          content: prompt.trim(),
          system_prompt: systemPrompt || undefined,
        };

        const streamRes = await fetch(chatUrl, {
          method: "POST",
          headers: sessionHeaders,
          body: JSON.stringify(chatBody),
          signal: AbortSignal.timeout(900_000), // 15 minutes for streaming response
        });

        if (!streamRes.ok) {
          throw new Error(`Stream request failed: ${streamRes.status} ${await streamRes.text()}`);
        }

        // Step 3: Process SSE stream
        const reader = streamRes.body?.getReader();
        if (!reader) {
          throw new Error("No response body available for streaming");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEventType = "unknown";
        let currentEventName = "";
        let result: string | null = null;
        
        // Track in-flight tool calls for streaming to frontend
        const inFlightTools = new Map<string, { toolName: string; args: unknown; startedAt: number }>();
        
        // Get the parent tool call ID from context (assigned by claw framework)
        // This is the ID of the query-codebase tool invocation itself
        const parentToolCallId = (context as ToolExecutionContext | undefined)?.toolCallId;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              // Empty line indicates end of event, process it
              currentEventName = "";
              continue;
            }

            if (trimmed.startsWith("event:")) {
              currentEventType = trimmed.slice(6).trim();
            } else if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim();
              try {
                const data = JSON.parse(dataStr);
                
                // Handle tool_call events for streaming to frontend
                if (currentEventType === "tool_call" && data) {
                  // Try multiple possible field name formats
                  const toolEvent = data as Record<string, unknown>;
                  const eventType = (toolEvent.event_type || toolEvent.type || toolEvent.eventType) as string | undefined;
                  const toolName = (toolEvent.tool_name || toolEvent.toolName || toolEvent.name || toolEvent.tool) as string | undefined;
                  const toolCallId = (toolEvent.tool_call_id || toolEvent.toolCallId || toolEvent.id || toolEvent.callId) as string | undefined;
                  const args = (toolEvent.args || toolEvent.arguments || toolEvent.parameters || toolEvent.params) as Record<string, unknown> | undefined;
                  // Research agent uses "results" (plural), not "result"
                  const toolResult = toolEvent.results || toolEvent.result;
                  const error = toolEvent.error;
                  const durationMs = (toolEvent.duration_ms || toolEvent.durationMs || toolEvent.duration) as number | undefined;
                  
                  if (eventType === "tool_execution_started" && toolCallId) {
                    // Track the started tool
                    inFlightTools.set(toolCallId, {
                      toolName: toolName || "unknown",
                      args: args || {},
                      startedAt: Date.now(),
                    });
                    
                    const progressUrl = (context as ToolExecutionContext | undefined)?.progressUrl;
                    const parentSessionId = (context as ToolExecutionContext | undefined)?.sessionId;
                    const s2sKey = (context as ToolExecutionContext | undefined)?.s2sKey;
                    
                    // Push child tool with parentToolCallId pointing to the framework's tool call ID
                    pushToolInvocation(progressUrl, parentSessionId, s2sKey, {
                      toolName: toolName || "research-agent-tool",
                      args: args || {},
                      result: "",
                      isError: false,
                      startedAt: new Date().toISOString(),
                      durationMs: 0,
                      status: "running",
                      toolCallId: toolCallId,
                      ...(parentToolCallId ? { parentToolCallId } : {}),
                    });
                  } else if ((eventType === "tool_execution_complete" || eventType === "tool_execution_error") && toolCallId) {
                    // Get the started tool info
                    const started = inFlightTools.get(toolCallId);
                    if (started) {
                      const resultStr = toolResult 
                        ? (typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult))
                        : (error || "No result");
                      const truncated = typeof resultStr === "string" && resultStr.length > 10_000
                        ? `${resultStr.slice(0, 10_000)}\n…[truncated ${resultStr.length - 10_000} chars]`
                        : resultStr;
                      
                      // Push completed tool invocation to frontend
                      const progressUrl = (context as ToolExecutionContext | undefined)?.progressUrl;
                      const parentSessionId = (context as ToolExecutionContext | undefined)?.sessionId;
                      const s2sKey = (context as ToolExecutionContext | undefined)?.s2sKey;
                      pushToolInvocation(progressUrl, parentSessionId, s2sKey, {
                        toolName: toolName || started.toolName,
                        args: started.args,
                        result: truncated,
                        isError: eventType === "tool_execution_error",
                        startedAt: new Date(started.startedAt).toISOString(),
                        durationMs: durationMs ?? (Date.now() - started.startedAt),
                        status: "completed",
                        toolCallId: toolCallId,
                        ...(parentToolCallId ? { parentToolCallId } : {}),
                      });
                      
                      inFlightTools.delete(toolCallId);
                    }
                  }
                } else if (currentEventType === "complete") {
                  if (typeof data === "object" && data !== null && "response" in data) {
                    result = data.response as string;
                  } else if (typeof data === "string") {
                    result = data;
                  }
                } else if (currentEventType === "assistant_message") {
                  if (typeof data === "object" && data !== null && "content" in data) {
                    result = data.content as string;
                  }
                } else if (currentEventType === "error") {
                  throw new Error(`SSE Error: ${JSON.stringify(data)}`);
                }
                // Ignore "chunk" events - just accumulating
              } catch (e) {
                // JSON parse error, skip this line
                continue;
              }
            }
          }
        }

        // Process any remaining data in buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith("data:")) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const data = JSON.parse(dataStr);
              if (currentEventType === "complete" || currentEventType === "assistant_message") {
                if (typeof data === "object" && data !== null && "response" in data) {
                  result = data.response as string;
                } else if (typeof data === "object" && data !== null && "content" in data) {
                  result = data.content as string;
                } else if (typeof data === "string") {
                  result = data;
                }
              }
            } catch {
              // Ignore parse error
            }
          }
        }

        if (result) {
          return result;
        }

        // No result in this iteration, retry
        currentIteration++;
        if (currentIteration < maxIterations) {
          await new Promise(r => setTimeout(r, 5000)); // 5 second delay before retry
        }

      } catch (err) {
        currentIteration++;
        if (currentIteration >= maxIterations) {
          return `Error calling research agent after ${maxIterations} attempts: ${err instanceof Error ? err.message : String(err)}`;
        }
        // Wait before retry
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    return "Error: No response received from research agent streaming API after all retries";
  },
};

export const reviewPullRequest: ToolDefinition = {
  slug: "review-pull-request",
  name: "Review Pull Request",
  description:
    "Review a Pull Request using the external research agent system. " +
    "Performs deep code review: analyzing diff, checking patterns, " +
    "finding potential bugs, security issues, and performance concerns. " +
    "Requires source and destination branch names.",
  source: "custom:research-agent",
  configSchema: RESEARCH_AGENT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sourceBranch: {
        type: "string",
        description: "The source branch containing the changes (e.g., 'feature/new-login')",
      },
      destinationBranch: {
        type: "string",
        description: "The destination/target branch to merge into (e.g., 'main', 'develop')",
      },
      focusAreas: {
        type: "array",
        items: { type: "string" },
        description: "Optional areas to focus on: ['security', 'performance', 'api-compatibility', 'tests', 'documentation']",
      },
      systemPrompt: {
        type: "string",
        description: "Optional custom system prompt to guide the PR review behavior",
      },
    },
    required: ["sourceBranch", "destinationBranch"],
  },

  async execute(params, context) {
    if (!context) {
      return "Error: No execution context available.";
    }

    const sourceBranch = params["sourceBranch"] as string;
    const destinationBranch = params["destinationBranch"] as string;
    const focusAreas = (params["focusAreas"] as string[]) || [];
    const customSystemPrompt = (params["systemPrompt"] as string) || "";

    if (!sourceBranch?.trim()) {
      return "Error: sourceBranch is required.";
    }
    if (!destinationBranch?.trim()) {
      return "Error: destinationBranch is required.";
    }
    const apiUrl = context.config["RESEARCH_AGENT_API_URL"] ?? "http://localhost:8080";
    const apiKey = context.config["RESEARCH_AGENT_API_KEY"] ?? "";
    
    const defaultRepositoryId = context.config["DEFAULT_REPOSITORY_ID"] ?? "";

    // Get repository from runtime context or default
    const runtimeContext = (context as unknown as { researchContext?: { type?: string; id?: string; repositoryId?: string } }).researchContext;
    const repositoryId = runtimeContext?.type === "repository" 
      ? (runtimeContext.repositoryId || runtimeContext.id) 
      : defaultRepositoryId;

    // Build PR review specific prompt
    const focusAreasText = focusAreas.length > 0
      ? `\n\nFocus Areas: ${focusAreas.join(", ")}`
      : "";

    const prReviewPrompt = `Review the Pull Request from branch "${sourceBranch}" to "${destinationBranch}".${focusAreasText}

Please provide a comprehensive code review including:
1. **Summary** - What changes does this PR introduce?
2. **Code Quality** - Are there code smells, anti-patterns, or style issues?
3. **Potential Bugs** - Any logic errors, edge cases, or null pointer risks?
4. **Security** - SQL injection, XSS, auth bypass, secrets exposure?
5. **Performance** - N+1 queries, memory leaks, inefficient algorithms?
6. **Testing** - Are tests adequate? Edge cases covered?
7. **API Compatibility** - Breaking changes? Version compatibility?
8. **Documentation** - Comments, README updates, API docs?
9. **Recommendations** - Specific suggestions for improvement

Format your review as markdown with clear sections.`;

    const systemPrompt = customSystemPrompt || `You are an expert code reviewer with deep knowledge of software engineering best practices. Your job is to thoroughly review pull requests and provide actionable feedback.

Review Guidelines:
- Be constructive but critical - catch real issues
- Cite specific code patterns or lines when possible
- Balance thoroughness with pragmatism
- Flag security and correctness issues as blockers
- Suggest improvements even for minor issues`;

    const maxIterations = 3;
    let currentIteration = 0;

    while (currentIteration < maxIterations) {
      try {
        // Step 1: Create a session
        const sessionUrl = `${apiUrl}/api/chat/sessions`;
        const sessionHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
        };
        const sessionBody = {
          title: `PR Review: ${sourceBranch} → ${destinationBranch}`,
          repository_id: repositoryId,
          session_type: "api_session",
        };

        const sessionRes = await fetch(sessionUrl, {
          method: "POST",
          headers: sessionHeaders,
          body: JSON.stringify(sessionBody),
          signal: AbortSignal.timeout(60_000), // 1 minute for session creation
        });

        if (!sessionRes.ok) {
          throw new Error(`Session creation failed: ${sessionRes.status} ${await sessionRes.text()}`);
        }

        const sessionData = await sessionRes.json() as { id?: string };
        const sessionId = sessionData.id;

        if (!sessionId) {
          throw new Error("No session ID returned from session creation");
        }

        // Step 2: Stream chat request with PR review prompt
        const chatUrl = `${apiUrl}/api/chat/sessions/${sessionId}/stream`;
        const chatBody = {
          content: prReviewPrompt,
          system_prompt: systemPrompt,
        };

        const streamRes = await fetch(chatUrl, {
          method: "POST",
          headers: sessionHeaders,
          body: JSON.stringify(chatBody),
          signal: AbortSignal.timeout(900_000), // 15 minutes for streaming response
        });

        if (!streamRes.ok) {
          throw new Error(`Stream request failed: ${streamRes.status} ${await streamRes.text()}`);
        }

        // Step 3: Process SSE stream
        const reader = streamRes.body?.getReader();
        if (!reader) {
          throw new Error("No response body available for streaming");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEventType = "unknown";
        let result: string | null = null;
        
        // Track in-flight tool calls for streaming to frontend
        const inFlightTools = new Map<string, { toolName: string; args: unknown; startedAt: number }>();
        
        // Get the parent tool call ID from context (assigned by claw framework)
        const parentToolCallId = (context as ToolExecutionContext | undefined)?.toolCallId;
        const progressUrl = (context as ToolExecutionContext | undefined)?.progressUrl;
        const parentSessionId = (context as ToolExecutionContext | undefined)?.sessionId;
        const s2sKey = (context as ToolExecutionContext | undefined)?.s2sKey;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith("event:")) {
              currentEventType = trimmed.slice(6).trim();
            } else if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim();
              try {
                const data = JSON.parse(dataStr);

                // Handle tool_call events for streaming to frontend
                if (currentEventType === "tool_call" && data) {
                  const toolEvent = data as ResearchAgentToolEvent;
                  
                  if (toolEvent.event_type === "tool_execution_started" && toolEvent.tool_call_id) {
                    // Track the started tool
                    inFlightTools.set(toolEvent.tool_call_id, {
                      toolName: toolEvent.tool_name || "unknown",
                      args: toolEvent.args || {},
                      startedAt: Date.now(),
                    });
                    
                    // Push "running" placeholder to frontend
                    const progressUrl = (context as ToolExecutionContext | undefined)?.progressUrl;
                    const parentSessionId = (context as ToolExecutionContext | undefined)?.sessionId;
                    const s2sKey = (context as ToolExecutionContext | undefined)?.s2sKey;
                    pushToolInvocation(progressUrl, parentSessionId, s2sKey, {
                      toolName: toolEvent.tool_name || "research-agent-tool",
                      args: toolEvent.args || {},
                      result: "",
                      isError: false,
                      startedAt: new Date().toISOString(),
                      durationMs: 0,
                      status: "running",
                      toolCallId: toolEvent.tool_call_id,
                      ...(parentToolCallId ? { parentToolCallId } : {}),
                    });
                  } else if ((toolEvent.event_type === "tool_execution_complete" || toolEvent.event_type === "tool_execution_error") && toolEvent.tool_call_id) {
                    // Get the started tool info
                    const started = inFlightTools.get(toolEvent.tool_call_id);
                    if (started) {
                      const resultStr = toolEvent.result 
                        ? (typeof toolEvent.result === "string" ? toolEvent.result : JSON.stringify(toolEvent.result))
                        : (toolEvent.error || "No result");
                      const truncated = resultStr.length > 10_000
                        ? `${resultStr.slice(0, 10_000)}\n…[truncated ${resultStr.length - 10_000} chars]`
                        : resultStr;
                      
                      // Push completed tool invocation to frontend
                      const progressUrl = (context as ToolExecutionContext | undefined)?.progressUrl;
                      const parentSessionId = (context as ToolExecutionContext | undefined)?.sessionId;
                      const s2sKey = (context as ToolExecutionContext | undefined)?.s2sKey;
                      pushToolInvocation(progressUrl, parentSessionId, s2sKey, {
                        toolName: toolEvent.tool_name || started.toolName,
                        args: started.args,
                        result: truncated,
                        isError: toolEvent.event_type === "tool_execution_error",
                        startedAt: new Date(started.startedAt).toISOString(),
                        durationMs: toolEvent.duration_ms ?? (Date.now() - started.startedAt),
                        status: "completed",
                        toolCallId: toolEvent.tool_call_id,
                        ...(parentToolCallId ? { parentToolCallId } : {}),
                      });
                      
                      inFlightTools.delete(toolEvent.tool_call_id);
                    }
                  }
                } else if (currentEventType === "complete") {
                  if (typeof data === "object" && data !== null && "response" in data) {
                    result = data.response as string;
                  } else if (typeof data === "string") {
                    result = data;
                  }
                } else if (currentEventType === "assistant_message") {
                  if (typeof data === "object" && data !== null && "content" in data) {
                    result = data.content as string;
                  }
                } else if (currentEventType === "error") {
                  throw new Error(`SSE Error: ${JSON.stringify(data)}`);
                }
              } catch (e) {
                continue;
              }
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith("data:")) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const data = JSON.parse(dataStr);
              if (currentEventType === "complete" || currentEventType === "assistant_message") {
                if (typeof data === "object" && data !== null && "response" in data) {
                  result = data.response as string;
                } else if (typeof data === "object" && data !== null && "content" in data) {
                  result = data.content as string;
                } else if (typeof data === "string") {
                  result = data;
                }
              }
            } catch {
              // Ignore parse error
            }
          }
        }

        if (result) {
          return result;
        }

        currentIteration++;
        if (currentIteration < maxIterations) {
          await new Promise(r => setTimeout(r, 5000));
        }

      } catch (err) {
        currentIteration++;
        if (currentIteration >= maxIterations) {
          return `Error calling research agent for PR review after ${maxIterations} attempts: ${err instanceof Error ? err.message : String(err)}`;
        }
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    return "Error: No response received from research agent PR review API after all retries";
  },
};
