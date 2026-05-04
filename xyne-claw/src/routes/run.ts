import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Router, type Response } from "express";
import { runTask, pushAttachment, applyCopilotProxyIfNeeded, RunCancelledError, type ImageContent } from "../agent.js";
import { validateS2SKey } from "../middleware/auth.js";
import { loadMcpToolsForUser } from "../mcp.js";
import { loadCustomTools } from "../custom-tools.js";
import { buildCopilotTool } from "../copilot.js";
import { buildSubagentTools, loadDeepwikiTools, loadContext7Tools, loadPlaywrightTools, type SkillTrigger } from "../subagent-tools.js";
import { parseToolsConfig, COPILOT_SYSTEM_INSTRUCTION } from "xyne-claw-shared";
import { SERVER, PATHS, LITELLM } from "../config.js";
import { judgeChainContinuation } from "../chain-judge.js";
import { createWorkspace, deleteWorkspace, ensureRepoWorktree, deleteRepoWorktree, writeWorkspaceTextFiles } from "../workspace.js";

const router = Router();

interface ActiveRunControl {
  abortController: AbortController;
}

const activeRuns = new Map<string, ActiveRunControl>();

router.post("/run", validateS2SKey, (req, res: Response) => {
  const { userId, userName, userEmail, task, context, conversationId, callbackUrl, systemPrompt, agentConfig, agentSlug, channelId, cwd: requestCwd, repoUrl, eventType, traceId, skills, provider, subagentProviders, providerConfigs, progressUrl, attachments, contextFiles } = req.body as {
    userId?: string;
    userName?: string;
    userEmail?: string;
    task?: string;
    context?: string;
    conversationId?: string;
    callbackUrl?: string;
    systemPrompt?: string;
    agentConfig?: Record<string, unknown>;
    agentSlug?: string;
    channelId?: string;
    cwd?: string;
    repoUrl?: string;
    eventType?: string;
    traceId?: string;
    skills?: { slug?: string; name: string; description?: string; content: string }[];
    provider?: string;
    subagentProviders?: Record<string, string>;
    providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }>;
    progressUrl?: string;
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
    contextFiles?: Array<{ path: string; content: string }>;
  };

  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    res.status(400).json({ success: false, error: "userId is required" });
    return;
  }

  if (!task || typeof task !== "string" || task.trim().length === 0) {
    res.status(400).json({ success: false, error: "task is required and must be a non-empty string" });
    return;
  }

  const sessionId = randomUUID();

  // Return sessionId immediately
  res.json({ success: true, sessionId });

  console.log(`[skill-debug] /run received: sessionId=${sessionId} agentSlug=${agentSlug ?? "(none)"} skills.length=${skills?.length ?? 0}`);
  if (skills && skills.length > 0) {
    console.log(`[skill-debug] /run skill names: ${JSON.stringify(skills.map((s) => s.name))}`);
  }

  const abortController = new AbortController();
  activeRuns.set(sessionId, { abortController });

  // Process in background
  processTask(sessionId, userId.trim(), task.trim(), context, userName, userEmail, conversationId, callbackUrl, systemPrompt, agentConfig, agentSlug, channelId, requestCwd, repoUrl, eventType, traceId, skills, provider, subagentProviders, providerConfigs, progressUrl, attachments, contextFiles, abortController.signal)
    .finally(() => {
      activeRuns.delete(sessionId);
    });
});

router.post("/run/:sessionId/cancel", validateS2SKey, (req, res: Response) => {
  const { sessionId } = req.params as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const active = activeRuns.get(sessionId);
  if (!active) {
    res.json({ success: true, sessionId, status: "not_running" });
    return;
  }

  active.abortController.abort();
  res.json({ success: true, sessionId, status: "cancelled" });
});

async function processTask(
  sessionId: string,
  userId: string,
  task: string,
  context: string | undefined,
  userName: string | undefined,
  userEmail: string | undefined,
  conversationId: string | undefined,
  callbackUrl: string | undefined,
  systemPrompt: string | undefined,
  agentConfig: Record<string, unknown> | undefined,
  agentSlug: string | undefined,
  channelId: string | undefined,
  requestCwd: string | undefined,
  repoUrl: string | undefined,
  eventType: string | undefined,
  traceId: string | undefined,
  skills: { slug?: string; name: string; description?: string; content: string }[] | undefined,
  provider: string | undefined,
  subagentProviders: Record<string, string> | undefined,
  providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }> | undefined,
  progressUrl: string | undefined,
  attachments: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
  contextFiles: Array<{ path: string; content: string }> | undefined,
  abortSignal?: AbortSignal,
): Promise<void> {
  let mcpCleanup: (() => Promise<void>) | undefined;
  let repoCwd: string | undefined;
  const tid = traceId ?? sessionId.slice(0, 8);
  const log = (msg: string) => console.log(`[run] [${tid}] ${msg}`);
  const logErr = (msg: string, err?: unknown) => console.error(`[run] [${tid}] ${msg}`, err ?? "");

  try {
    log(`Session ${sessionId}: starting for user ${userId}, progressUrl=${progressUrl ?? "none"}`);

    // Set up repo worktree if repoUrl provided.
    // Retry up to 3 times with backoff — git fetch/clone can fail transiently
    // under contention or with flaky bitbucket. Without retry, a single failed
    // attempt drops the agent into a tool-less workspace and the LLM gives up
    // (we hit this on session 333b813a in prod — empty result, 7 wasted tokens).
    if (repoUrl && !requestCwd) {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          repoCwd = await ensureRepoWorktree(repoUrl, sessionId, agentSlug);
          log(`Repo worktree ready at ${repoCwd}`);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < maxAttempts) {
            const delayMs = 2000 * attempt; // 2s, 4s
            logErr(`Worktree setup attempt ${attempt}/${maxAttempts} failed (${msg}); retrying in ${delayMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            logErr(`Worktree setup failed after ${maxAttempts} attempts:`, err);
          }
        }
      }
    }

    // Use provided cwd, repo workspace, or create an ephemeral workspace
    const workspaceDir = requestCwd ?? repoCwd ?? await createWorkspace(sessionId);
    if (contextFiles?.length) {
      const written = await writeWorkspaceTextFiles(workspaceDir, contextFiles);
      log(`Attached context files written: ${written.length}`);
    }

    const toolPermissions = (agentConfig?.["toolPermissions"] as Record<string, string> | undefined) ?? {};
    const { groups: mcpGroups, cleanup, getPendingActions } = await loadMcpToolsForUser(userId, toolPermissions, agentSlug);
    mcpCleanup = cleanup;

    const meta: Record<string, string> = { userId };
    if (agentSlug) meta["agentSlug"] = agentSlug;
    if (channelId) meta["channelId"] = channelId;
    if (conversationId) meta["conversationId"] = conversationId;

    // For google-agent: fetch the user's Google OAuth token from xyne-claw-auth
    const effectiveConfig = { ...(agentConfig ?? {}) };
    // Parent agent's provider config — looked up from user's provider credentials.
    // We also reuse it to drive custom:create-ppt so PPT generation uses the
    // same user credential/model instead of shared env keys.
    const parentProviderConfig = (provider === "copilot" || provider === "claude" || provider === "codex")
      ? providerConfigs?.[provider]
      : undefined;

    if (provider && parentProviderConfig?.apiKey) {
      const resolvedForPpt = provider === "copilot"
        ? await applyCopilotProxyIfNeeded(provider, parentProviderConfig)
        : parentProviderConfig;
      const pptBaseUrl = resolvedForPpt?.baseUrl
        ?? (provider === "claude" ? "https://api.anthropic.com" : "https://api.openai.com/v1");
      effectiveConfig["PPT_PROVIDER"] = provider;
      effectiveConfig["PPT_BASE_URL"] = pptBaseUrl;
      effectiveConfig["PPT_API_KEY"] = resolvedForPpt?.apiKey ?? parentProviderConfig.apiKey;
      effectiveConfig["PPT_MODEL"] = resolvedForPpt?.model ?? parentProviderConfig.model;
      if (provider === "claude") {
        effectiveConfig["PPT_AUTH_TYPE"] = resolvedForPpt?.authType ?? parentProviderConfig.authType ?? "api_key";
      }
      log(`PPT tool configured from user provider=${provider} model=${effectiveConfig["PPT_MODEL"] as string}`);
    }

    if (agentSlug === "google-agent" && SERVER.authServiceUrl) {
      try {
        const tokenRes = await fetch(`${SERVER.authServiceUrl}/claw/api/v1/users/${userId}/oauth/google/token`);
        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as { success: boolean; data?: { accessToken: string } };
          if (tokenData.success && tokenData.data?.accessToken) {
            effectiveConfig["GOOGLE_ACCESS_TOKEN"] = tokenData.data.accessToken;
            log("Google OAuth token injected");
          } else {
            log("Google token fetch failed — no token returned");
          }
        } else {
          log(`Google token fetch failed — HTTP ${tokenRes.status}`);
        }
      } catch (err) {
        logErr("Google token fetch error:", err);
      }
    }

    // For microsoft-agent: fetch the user's Microsoft OAuth token from xyne-claw-auth
    if (agentSlug === "microsoft-agent" && SERVER.authServiceUrl) {
      try {
        const tokenRes = await fetch(`${SERVER.authServiceUrl}/claw/api/v1/users/${userId}/oauth/microsoft/token`);
        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as { success: boolean; data?: { accessToken: string } };
          if (tokenData.success && tokenData.data?.accessToken) {
            effectiveConfig["MICROSOFT_ACCESS_TOKEN"] = tokenData.data.accessToken;
            log("Microsoft OAuth token injected");
          } else {
            log("Microsoft token fetch failed — no token returned");
          }
        } else {
          log(`Microsoft token fetch failed — HTTP ${tokenRes.status}`);
        }
      } catch (err) {
        logErr("Microsoft token fetch error:", err);
      }
    }

    const { tools: customToolDefs, getAttachments, getPendingQuestions, getPendingActions: getCustomPendingActions, getPendingResponses } = loadCustomTools(
      effectiveConfig,
      meta,
      (att) => pushAttachment(progressUrl, sessionId, att),
    );

    // Load deepwiki/context7/playwright MCP tool groups (stdio transport, cached).
    // Playwright doesn't get its own subagent — its tools are spliced into the
    // sandbox subagent's palette via bonusToolsBySubagent below.
    const [deepwikiGroup, context7Group, playwrightGroup] = await Promise.all([
      loadDeepwikiTools(),
      loadContext7Tools(),
      loadPlaywrightTools(),
    ]);

    // Extract skill triggers from agent config (needed by both subagent tools and runTask)
    const rawTriggers = (agentConfig?.["skillTriggers"] as Array<{ toolName: string; skillSlug: string; when: string; prompt?: string }>) ?? [];
    const resolvedTriggers = rawTriggers
      .filter((t) => t.toolName && t.skillSlug)
      .map((t) => {
        const skill = skills?.find((s) => s.name === t.skillSlug);
        return skill ? { toolName: t.toolName, skillSlug: t.skillSlug, skillContent: skill.content, when: t.when as "before" | "after", prompt: t.prompt } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    // Extract prompt injections (per-turn system reminders)
    const rawInjections = (agentConfig?.["promptInjections"] as Array<{ id: string; label: string; content: string; enabled: boolean }>) ?? [];
    const activeInjections = rawInjections
      .filter((p) => p.enabled && typeof p.content === "string" && p.content.trim().length > 0)
      .map((p) => ({ id: p.id, label: p.label || "Reminder", content: p.content }));

    // Resolve subagent-level skills: all parent skills by default, config.subagentSkills overrides per subagent
    // If config.subagentSkills.spaces = ["skill-a"] → only skill-a for spaces subagent
    // If config.subagentSkills.spaces = [] → no skills for spaces subagent
    // If config.subagentSkills.spaces is not set → all parent skills (default)
    const allSkills = skills ?? [];
    const rawSubagentSkills = (agentConfig?.["subagentSkills"] as Record<string, string[]> | undefined);
    const defaultSkills = allSkills.length > 0 ? allSkills : undefined;

    let resolvedSubagentSkills: Record<string, Array<{ slug?: string; name: string; description?: string; content: string }>> | undefined;
    if (rawSubagentSkills) {
      // User has customized — resolve per-subagent overrides, default to all skills for unspecified subagents
      resolvedSubagentSkills = {};
      // We'll pass a special "__default" key for subagents not explicitly configured
      if (defaultSkills) resolvedSubagentSkills["__default"] = defaultSkills;
      for (const [subagentName, skillNames] of Object.entries(rawSubagentSkills)) {
        const resolved = skillNames
          .map((name) => allSkills.find((s) => s.name === name))
          .filter((s): s is NonNullable<typeof s> => s != null);
        resolvedSubagentSkills[subagentName] = resolved; // empty array = no skills
      }
    } else if (defaultSkills) {
      // No overrides — inject all parent skills into every subagent
      resolvedSubagentSkills = { "__default": defaultSkills };
    }

    // Combine all MCP groups and build subagent wrappers (also wraps matching custom tools like pgm)
    const allGroups = [...mcpGroups, ...(deepwikiGroup ? [deepwikiGroup] : []), ...(context7Group ? [context7Group] : [])];
    // Parent agent's provider — used as default for subagents that don't have an override
    const parentProvider = provider === "copilot" ? "copilot" : provider === "claude" ? "claude" : provider === "codex" ? "codex" : "spaces";
    // Shared ref: subagents append their inner MCP tool names here so chain
    // `toolsMustInclude`/`toolsMustExclude` conditions can target specific
    // nested tools (e.g. Bitbucket__create_pull_request), not just the
    // subagent wrapper names returned by the parent agent.
    const subagentInnerTools: string[] = [];
    // Splice playwright MCP tools into the sandbox subagent palette so the
    // child LLM can drive a browser via typed tools instead of bootstrapping
    // chromium inside the VM via `sandbox-run`. Browser runs in xyne-claw pod
    // — see loadPlaywrightTools for the reachability/concurrency caveats.
    const bonusToolsBySubagent: Record<string, typeof customToolDefs> = {};
    if (playwrightGroup && playwrightGroup.tools.length > 0) {
      bonusToolsBySubagent["sandbox"] = playwrightGroup.tools;
    }

    const { subagentTools, directTools, remainingCustomTools } = buildSubagentTools(
      allGroups, customToolDefs,
      resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
      resolvedSubagentSkills,
      { parentProvider, subagentProviders, providerConfigs },
      {
        ...(progressUrl ? { progressUrl } : {}),
        parentSessionId: sessionId,
        parentToolsUsed: subagentInnerTools,
        parentMeta: {
          ...(conversationId ? { conversationId } : {}),
          ...(agentSlug ? { agentSlug } : {}),
        },
        // Propagate the cancel signal so any in-flight subagent session
        // (sandbox, spaces, bitbucket, ...) disposes itself when the user
        // hits Stop, instead of running for its full duration and orphaning
        // the result back to a parent that's already thrown RunCancelledError.
        ...(abortSignal ? { abortSignal } : {}),
      },
      bonusToolsBySubagent,
    );

    let allTools = [
      ...subagentTools,          // spaces, bitbucket, grafana, deepwiki, context7, pgm
      ...directTools,            // write tools (create-ticket, send-message)
      ...remainingCustomTools,   // custom tools not wrapped in a subagent
    ];

    log(`Tools: ${subagentTools.length} subagents, ${directTools.length} direct, ${customToolDefs.length} custom`);

    // Apply agent-level tool config from DB (agent.config.tools)
    const toolsConfig = parseToolsConfig(effectiveConfig);
    if (toolsConfig) {
      const allowedSubagents = new Set(toolsConfig.subagents ?? []);
      const allowedDirect = toolsConfig.direct ?? [];
      const allowedCustom = new Set(toolsConfig.custom ?? []);

      allTools = allTools.filter((t) => {
        if (subagentTools.some((s) => s.name === t.name)) return allowedSubagents.has(t.name);
        if (directTools.some((d) => d.name === t.name)) return allowedDirect.some((d: string) => t.name.endsWith(d));
        if (customToolDefs.some((c) => c.name === t.name)) return allowedCustom.has(t.name);
        return true;
      });

      log(`Agent tools config applied: ${allTools.length} tools after filtering`);
    }

    // Inject copilot respond-to-user tool if provider is copilot
    const isCopilot = provider === "copilot";
    const effectiveModel = parentProviderConfig?.model ?? LITELLM.model;
    log(`provider=${provider ?? "spaces"} isCopilot=${isCopilot} model=${effectiveModel}`);
    if (isCopilot) {
      const copilotTool = buildCopilotTool(getPendingResponses);
      allTools.push(copilotTool);
      log("Copilot mode — injected respond-to-user tool");
    }

    const tools = allTools.length > 0 ? allTools : undefined;

    // Inject event type into context so the agent knows how it was invoked
    let fullContext = context;
    if (eventType) {
      const eventNote = `## Event Type: ${eventType}`;
      fullContext = fullContext ? `${eventNote}\n\n${fullContext}` : eventNote;
    }
    // Inject metadata so agents can reference channelId/conversationId in tool calls
    const metaLines = [
      "## Session Metadata",
      ...(channelId ? [`- channelId: ${channelId}`] : []),
      ...(conversationId ? [`- conversationId: ${conversationId}`] : []),
    ];
    if (metaLines.length > 1) {
      fullContext = fullContext ? `${fullContext}\n\n${metaLines.join("\n")}` : metaLines.join("\n");
    }

    // Inject copilot system instructions
    if (isCopilot) {
      // COPILOT_SYSTEM_INSTRUCTION imported at top
      const copilotNote = `\n\n${COPILOT_SYSTEM_INSTRUCTION}`;
      fullContext = fullContext ? `${fullContext}${copilotNote}` : copilotNote;
    }

    // Key sessions by conversationId + agentSlug so each agent has its own session per thread
    const sessionKey = conversationId && agentSlug ? `${conversationId}_${agentSlug}` : conversationId;
    const runtimeProvider = parentProviderConfig ? provider : undefined;
    const providerConfig = parentProviderConfig;
    // Convert attachments to ImageContent format for the LLM
    const imageContents: ImageContent[] | undefined = attachments
      ?.filter((a) => a.mimeType.startsWith("image/"))
      .map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType }));

    const result = await runTask(
      userId,
      task,
      fullContext,
      userName,
      userEmail,
      tools,
      systemPrompt,
      workspaceDir,
      sessionKey,
      runtimeProvider,
      providerConfig,
      progressUrl,
      sessionId,
      imageContents?.length ? imageContents : undefined,
      skills,
      resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
      activeInjections.length > 0 ? activeInjections : undefined,
      abortSignal,
    );

    const resultAttachments = getAttachments();
    const pendingQuestions = getPendingQuestions();
    const pendingActions = [...getPendingActions(), ...getCustomPendingActions()];
    const pendingResponses = getPendingResponses();

    // Flatten: parent's top-level tools + nested MCP tools run inside subagents.
    // Chain conditions evaluate against this combined list so users can match
    // on specific inner tools (Bitbucket__create_pull_request) in addition to
    // subagent wrappers (bitbucket).
    const combinedToolsUsed = [...result.toolsUsed, ...subagentInnerTools];

    log(`Completed: ${combinedToolsUsed.length} tools used (${result.toolsUsed.length} top-level + ${subagentInnerTools.length} nested), ${resultAttachments.length} attachment(s), ${pendingQuestions.length} question(s), ${pendingActions.length} pending action(s), ${pendingResponses.length} copilot response(s), resultLength=${result.text.length}`);

    await sendCallback(callbackUrl, {
      sessionId,
      userId,
      conversationId: conversationId ?? null,
      status: "completed",
      result: result.text,
      toolsUsed: combinedToolsUsed,
      tokenUsage: result.tokenUsage,
      ...(result.toolInvocations.length > 0 ? { toolInvocations: result.toolInvocations } : {}),
      ...(resultAttachments.length > 0 ? { attachments: resultAttachments } : {}),
      ...(pendingQuestions.length > 0 ? { pendingQuestions } : {}),
      ...(pendingActions.length > 0 ? { pendingActions } : {}),
      ...(pendingResponses.length > 0 ? { pendingResponses } : {}),
      ...(provider === "copilot" || provider === "claude" || provider === "codex" ? { provider } : {}),
    });
  } catch (err) {
    if (err instanceof RunCancelledError || abortSignal?.aborted) {
      log(`Session cancelled: ${sessionId}`);
      await sendCallback(callbackUrl, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        status: "cancelled",
        ...(err instanceof RunCancelledError && err.partialText ? { result: err.partialText } : {}),
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
      });
    } else {
      logErr(`Session failed: ${err instanceof Error ? err.message : String(err)}`);

      await sendCallback(callbackUrl, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        status: "failed",
        error: err instanceof Error ? err.message : "Internal error",
      });
    }
  } finally {
    if (mcpCleanup) {
      await mcpCleanup().catch(() => {});
    }
    if (!requestCwd && repoCwd && repoUrl) {
      // Clean up git worktree
      await deleteRepoWorktree(repoUrl, sessionId, agentSlug).catch((err) => {
        console.warn(`[run] [${tid}] Worktree cleanup failed:`, err);
      });
    } else if (!requestCwd) {
      // Clean up ephemeral workspace (non-repo case)
      await deleteWorkspace(sessionId).catch(() => {});
    }
  }
}

async function sendCallback(callbackUrl: string | undefined, payload: Record<string, unknown>): Promise<void> {
  const url = callbackUrl ?? `${SERVER.authServiceUrl}/claw/api/v1/sessions/${payload["sessionId"] as string}/result`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`[run] Failed to send callback to ${url}:`, err); // no traceId available here
  }
}

// ── Chain judge endpoint (called by xyne-claw-auth webhook) ──────────────

router.post("/chain-judge", validateS2SKey, async (req, res: Response) => {
  const { agentResult, sourceAgent, targetAgent, taskTemplate, userQuery, judgeContext } = req.body as {
    agentResult?: string;
    sourceAgent?: string;
    targetAgent?: string;
    taskTemplate?: string;
    userQuery?: string;
    judgeContext?: string;
  };

  if (!agentResult || !sourceAgent || !targetAgent) {
    res.status(400).json({ success: false, error: "agentResult, sourceAgent, targetAgent required" });
    return;
  }

  const decision = await judgeChainContinuation(agentResult, sourceAgent, targetAgent, taskTemplate, userQuery, judgeContext);
  res.json({ success: true, data: decision });
});

// ── Generate agent prompt (called by xyne-claw-auth) ──────────────────────

router.post("/generate-prompt", validateS2SKey, async (req, res: Response) => {
  const { intent, agentName, existingPrompt } = req.body as { intent?: string; agentName?: string; existingPrompt?: string };

  if (!intent || typeof intent !== "string") {
    res.status(400).json({ success: false, error: "intent is required" });
    return;
  }

  const isUpdate = existingPrompt && typeof existingPrompt === "string" && existingPrompt.trim().length > 0;

  const userMessage = isUpdate
    ? `Here is the current system prompt for an agent${agentName ? ` called "${agentName}"` : ""}:\n\n---\n${existingPrompt}\n---\n\nThe user wants to update it with the following instructions:\n\n"${intent}"\n\nApply the requested changes to the existing prompt. Keep the parts that are not affected by the update. Return the full updated prompt.`
    : `Generate a system prompt for an agent${agentName ? ` called "${agentName}"` : ""}. The user described it as:\n\n"${intent}"\n\nThe prompt should:\n- Define the agent's role and personality\n- List what the agent can and cannot do\n- Include guidelines for response style\n- Be concise but thorough (200-400 words)`;

  try {
    const llmRes = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content: "You generate and update system prompts for AI agents. Return ONLY the system prompt text, no explanation or markdown wrapping.",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!llmRes.ok) {
      res.status(500).json({ success: false, error: `LLM returned ${llmRes.status}` });
      return;
    }

    const data = (await llmRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const prompt = data.choices?.[0]?.message?.content?.trim() ?? "";

    res.json({ success: true, data: { prompt } });
  } catch (err) {
    console.error("[generate-prompt] Failed:", err);
    res.status(500).json({ success: false, error: "Failed to generate prompt" });
  }
});

export { router as runRouter };
