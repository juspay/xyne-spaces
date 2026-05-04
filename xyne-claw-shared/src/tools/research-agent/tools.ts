import type { ToolDefinition } from "../types.js";

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
  XYNE_SPACES_REPOSITORY_ID: {
    label: "Xyne Spaces Repository ID",
    default: "989d9105-d8f0-4549-b63b-ac2363054ec0",
    required: true as const,
    placeholder: "Repository ID of xyne-spaces for the research agent session",
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

    const apiUrl = context.config["RESEARCH_AGENT_API_URL"] ?? "http://localhost:8080";
    const apiKey = context.config["RESEARCH_AGENT_API_KEY"] ?? "";
    const repositoryId = context.config["XYNE_SPACES_REPOSITORY_ID"] ?? "";

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
          title: "Xyne Doctor Research Query",
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

        console.log("session-created successfully")

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

        console.log("stream gonna start: ", chatBody)

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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith("event:")) {
              currentEventType = trimmed.slice(6).trim();
            } else if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim();
              try {
                const data = JSON.parse(dataStr);

                if (currentEventType === "complete") {
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
    const repositoryId = context.config["XYNE_SPACES_REPOSITORY_ID"] ?? "";

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

                if (currentEventType === "complete") {
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
