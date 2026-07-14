import type { ToolDefinition, ToolExecutionContext } from "../types.js";

import { createLogger } from "../../logger.js";
const log = createLogger("tools");

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
    log.warn(`[research-agent] Tool invocation push failed: ${err instanceof Error ? err.message : String(err)}`);
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

type ResearchAgentContextSelection = { repositoryId?: string; productId?: string };

const getResearchAgentHeaders = (apiKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
});

const normalizeString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const getResearchAgentSelection = (
  params: Record<string, unknown>,
  context: ToolExecutionContext,
): ResearchAgentContextSelection | string => {
  const productId = normalizeString(params["product"])
    ?? normalizeString(params["product_id"])
    ?? normalizeString(context.config["product_id"])
    ?? normalizeString(context.config["RESEARCH_AGENT_PRODUCT_ID"]);
  const repositoryId = normalizeString(params["repository"])
    ?? normalizeString(params["repository_id"])
    ?? normalizeString(context.config["repository_id"])
    ?? normalizeString(context.config["RESEARCH_AGENT_REPOSITORY_ID"]);

  if (!productId && !repositoryId) {
    return "Error: Select a Research Agent product or repository in this agent's configuration, or pass product/repository to the tool.";
  }

  return { ...(repositoryId ? { repositoryId } : {}), ...(productId ? { productId } : {}) };
};

const getConfiguredRepositoryId = (params: Record<string, unknown>, context: ToolExecutionContext): string | undefined =>
  normalizeString(params["repository"])
    ?? normalizeString(params["repository_id"])
    ?? normalizeString(context.config["repository_id"])
    ?? normalizeString(context.config["RESEARCH_AGENT_REPOSITORY_ID"]);

const getConfiguredProductId = (params: Record<string, unknown>, context: ToolExecutionContext): string | undefined =>
  normalizeString(params["product"])
    ?? normalizeString(params["product_id"])
    ?? normalizeString(context.config["product_id"])
    ?? normalizeString(context.config["RESEARCH_AGENT_PRODUCT_ID"]);

type ResearchAgentOption = { id: string; name: string };

const getOptionName = (row: Record<string, unknown>): string | undefined => {
  const name = row["name"] ?? row["repo_name"] ?? row["repository_name"] ?? row["display_name"] ?? row["title"];
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
};

const normalizeOptions = (raw: unknown): ResearchAgentOption[] => {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown[] })?.data)
      ? (raw as { data: unknown[] }).data
      : Array.isArray((raw as { items?: unknown[] })?.items)
        ? (raw as { items: unknown[] }).items
        : [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = record["id"];
    if (typeof id !== "string" && typeof id !== "number") return [];
    const idText = String(id).trim();
    if (!idText) return [];
    return [{ id: idText, name: getOptionName(record) ?? idText }];
  });
};

const formatOptions = (label: string, options: ResearchAgentOption[]): string => {
  if (!options.length) return `No Research Agent ${label} found.`;
  return options.map((option) => `- name: ${option.name}\n  id: ${option.id}`).join("\n");
};

const formatResearchAgentTools = (label: string, raw: unknown): string => {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown[] })?.data)
      ? (raw as { data: unknown[] }).data
      : Array.isArray((raw as { items?: unknown[] })?.items)
        ? (raw as { items: unknown[] }).items
        : [];

  if (!rows.length) return `No Research Agent tools found for this ${label}.`;

  return rows.map((row) => {
    if (!row || typeof row !== "object") return `- ${String(row)}`;
    const record = row as Record<string, unknown>;
    const name = getOptionName(record) ?? normalizeString(record["slug"]) ?? normalizeString(record["tool_name"]) ?? "unknown";
    const description = normalizeString(record["description"]);
    const id = record["id"];
    return [
      `- name: ${name}`,
      ...(typeof id === "string" || typeof id === "number" ? [`  id: ${String(id)}`] : []),
      ...(description ? [`  description: ${description}`] : []),
    ].join("\n");
  }).join("\n");
};

const fetchResearchAgentTools = async (
  context: ToolExecutionContext,
  path: string,
  label: string,
): Promise<string> => {
  const apiUrl = context.config["RESEARCH_AGENT_API_URL"] ?? "<research-agent-url>";
  const apiKey = context.config["RESEARCH_AGENT_API_KEY"] ?? "";
  const response = await fetch(`${apiUrl}${path}`, {
    method: "GET",
    headers: getResearchAgentHeaders(apiKey),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return `Error fetching Research Agent tools for ${label}: ${response.status} ${await response.text()}`;
  }

  return formatResearchAgentTools(label, await response.json());
};

const fetchResearchAgentOptions = async (
  context: ToolExecutionContext,
  path: string,
  label: string,
): Promise<string> => {
  const apiUrl = context.config["RESEARCH_AGENT_API_URL"] ?? "<research-agent-url>";
  const apiKey = context.config["RESEARCH_AGENT_API_KEY"] ?? "";
  const response = await fetch(`${apiUrl}${path}`, {
    method: "GET",
    headers: getResearchAgentHeaders(apiKey),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return `Error fetching Research Agent ${label}: ${response.status} ${await response.text()}`;
  }

  return formatOptions(label, normalizeOptions(await response.json()));
};

const appendSessionId = (result: string, sessionId: string): string =>
  `${result}\n\n---\nResearch Agent session_id: ${sessionId}`;

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
};

export const listRepositories: ToolDefinition = {
  slug: "list-repositories",
  name: "List Repositories",
  description: "List all Research Agent repositories as name + id. Use this when you want to override the agent's default repository/product config or choose a different codebase. Pass the returned repository id to query-codebase, review-pull-request, or list-repository-tools.",
  source: "custom:research-agent",
  configSchema: RESEARCH_AGENT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  async execute(_params, context) {
    if (!context) {
      return "Error: No execution context available.";
    }

    try {
      return await fetchResearchAgentOptions(context, "/api/crud/repositories", "repositories");
    } catch (err) {
      return `Error fetching Research Agent repositories: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const listProducts: ToolDefinition = {
  slug: "list-products",
  name: "List Products",
  description: "List all Research Agent products as name + id. Use this when you want to override the agent's default repository/product config or choose a different product scope. Pass the returned product id to query-codebase, review-pull-request, or list-product-tools.",
  source: "custom:research-agent",
  configSchema: RESEARCH_AGENT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  async execute(_params, context) {
    if (!context) {
      return "Error: No execution context available.";
    }

    try {
      return await fetchResearchAgentOptions(context, "/api/crud/products", "products");
    } catch (err) {
      return `Error fetching Research Agent products: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const listRepositoryTools: ToolDefinition = {
  slug: "list-repository-tools",
  name: "List Repository Tools",
  description: "List tools available to the external Research Agent for a repository, so you can decide whether a task should be offloaded to query-codebase or review-pull-request. The repository parameter is optional: if omitted, this uses the agent's configured default repository_id/RESEARCH_AGENT_REPOSITORY_ID. If no default exists, call list-repositories and pass a repository id.",
  source: "custom:research-agent",
  configSchema: RESEARCH_AGENT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      repository: {
        type: "string",
        description: "Optional Research Agent repository ID. If omitted, the configured default repository_id/RESEARCH_AGENT_REPOSITORY_ID is used. Use list-repositories to find an ID when no default is set or when overriding it.",
      },
    },
    required: [],
  },

  async execute(params, context) {
    if (!context) {
      return "Error: No execution context available.";
    }

    const repositoryId = getConfiguredRepositoryId(params, context);
    if (!repositoryId) {
      return "Error: No default repository ID is configured. Pass repository, or call list-repositories to find a repository ID.";
    }

    try {
      return await fetchResearchAgentTools(context, `/api/crud/tools/repos/${encodeURIComponent(repositoryId)}`, "repository");
    } catch (err) {
      return `Error fetching Research Agent tools for repository: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const listProductTools: ToolDefinition = {
  slug: "list-product-tools",
  name: "List Product Tools",
  description: "List tools available to the external Research Agent for a product, so you can decide whether a task should be offloaded to query-codebase or review-pull-request. The product parameter is optional: if omitted, this uses the agent's configured default product_id/RESEARCH_AGENT_PRODUCT_ID. If no default exists, call list-products and pass a product id.",
  source: "custom:research-agent",
  configSchema: RESEARCH_AGENT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      product: {
        type: "string",
        description: "Optional Research Agent product ID. If omitted, the configured default product_id/RESEARCH_AGENT_PRODUCT_ID is used. Use list-products to find an ID when no default is set or when overriding it.",
      },
    },
    required: [],
  },

  async execute(params, context) {
    if (!context) {
      return "Error: No execution context available.";
    }

    const productId = getConfiguredProductId(params, context);
    if (!productId) {
      return "Error: No default product ID is configured. Pass product, or call list-products to find a product ID.";
    }

    try {
      return await fetchResearchAgentTools(context, `/api/crud/tools/products/${encodeURIComponent(productId)}`, "product");
    } catch (err) {
      return `Error fetching Research Agent tools for product: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const queryCodebase: ToolDefinition = {
  slug: "query-codebase",
  name: "Query Codebase",
  description:
    "Ask the external Research Agent a codebase/logs/architecture question. " +
    "It has repository context and can use tools available for the selected repository/product. " +
    "repository and product are optional; if omitted, the agent's configured default repository_id/product_id is used. " +
    "Use list-repositories/list-products to discover ids when you want to override the default. " +
    "Use list-repository-tools/list-product-tools first when you need to inspect whether the selected external agent scope has the right tools before offloading.",
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
      repository: {
        type: "string",
        description: "Optional Research Agent repository ID. If omitted, the agent's configured default repository_id/RESEARCH_AGENT_REPOSITORY_ID is used. Use list-repositories to find an ID when overriding the default. If product is also set, product takes precedence.",
      },
      product: {
        type: "string",
        description: "Optional Research Agent product ID. If omitted, the agent's configured default product_id/RESEARCH_AGENT_PRODUCT_ID is used. Use list-products to find an ID when overriding the default. Product takes precedence over repository.",
      },
      systemPrompt: {
        type: "string",
        description:
          "Optional custom system prompt to guide the research agent's behavior. " +
          "If not provided, the research agent will use its default behavior.",
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

    if (!prompt || !prompt.trim()) {
      return "Error: prompt is required.";
    }

    const selection = getResearchAgentSelection(params, context);
    if (typeof selection === "string") return selection;

    const apiUrl = context.config["RESEARCH_AGENT_API_URL"] ?? "<research-agent-url>";
    const apiKey = context.config["RESEARCH_AGENT_API_KEY"] ?? "";
    const repositoryId = selection.repositoryId;
    const productId = selection.productId;

    const maxIterations = 3;
    let currentIteration = 0;

    while (currentIteration < maxIterations) {
      try {
        // Step 1: Create a session
        const sessionUrl = `${apiUrl}/api/chat/sessions`;
        const sessionHeaders = getResearchAgentHeaders(apiKey);
        // Build session body - research agent API accepts either repository_id or product_id
        const sessionBody: Record<string, any> = {
          title: "Xyne Doctor Research Query",
          session_type: "api_session",
          metadata: context.meta
        };
        
        if (productId) {
          sessionBody.product_id = productId;
        } else if (repositoryId) {
          sessionBody.repository_id = repositoryId;
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
          return appendSessionId(result, sessionId);
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
    "Ask the external Research Agent to review a pull request using codebase context, logs, and tools for the selected repository/product. " +
    "Requires source and destination branch names. repository and product are optional; if omitted, the agent's configured default repository_id/product_id is used. " +
    "Use list-repositories/list-products to discover ids when you want to override the default. " +
    "Use list-repository-tools/list-product-tools first when you need to inspect whether the selected external agent scope has the right tools before offloading the review.",
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
      repository: {
        type: "string",
        description: "Optional Research Agent repository ID for this PR review. If omitted, the agent's configured default repository_id/RESEARCH_AGENT_REPOSITORY_ID is used. Use list-repositories to find an ID when overriding the default. If product is also set, product takes precedence.",
      },
      product: {
        type: "string",
        description: "Optional Research Agent product ID for this PR review. If omitted, the agent's configured default product_id/RESEARCH_AGENT_PRODUCT_ID is used. Use list-products to find an ID when overriding the default. Product takes precedence over repository.",
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

    const selection = getResearchAgentSelection(params, context);
    if (typeof selection === "string") return selection;

    const apiUrl = context.config["RESEARCH_AGENT_API_URL"] ?? "<research-agent-url>";
    const apiKey = context.config["RESEARCH_AGENT_API_KEY"] ?? "";
    const repositoryId = selection.repositoryId;
    const productId = selection.productId;

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
        const sessionHeaders = getResearchAgentHeaders(apiKey);
        // `unknown` (not `string`) because `metadata` carries the context.meta
        // object (Record<string,string> | undefined), not a string. The string
        // fields below (product_id / repository_id) remain valid assignments.
        const sessionBody: Record<string, unknown> = {
          title: `PR Review: ${sourceBranch} → ${destinationBranch}`,
          session_type: "api_session",
          metadata: context.meta,
        };

        if (productId) {
          sessionBody.product_id = productId;
        } else if (repositoryId) {
          sessionBody.repository_id = repositoryId;
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
          return appendSessionId(result, sessionId);
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
