import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { errMsg } from "./errors.js";
import { spacesAppFetch } from "./spaces-api.js";
import {
  chatMessageRepository,
  agentRunRepository,
  userProviderCredentialsRepository,
  userAgentInstructionRepository,
} from "../repositories/index.js";
import { resolveBriefAgentSlug } from "../services/dailyBrief.js";
import { buildAgentCatalog } from "../services/agentCatalogService.js";
import {
  normalizeAttachedContext,
  buildAttachedContextPayload,
  type AttachedContextRef,
} from "../services/agentChatContextService.js";
import { storeForSession as storeAttachedContextForSession } from "../mcp/attached-context-injector.js";
import { storeRunScalars } from "../mcp/run-scalars.js";
import { parseSdlcAgentRunContext } from "../mcp/sdlc-baseline-run-context.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { resolveCustomSubagentsForRun } from "./subagent-resolver.js";
import {
  resolveCallableAgentsForRun,
  resolveOrchestratorCallableAgentsForRun,
} from "./callable-agent-resolver.js";
import {
  buildSdlcAgentToolProfile,
  parseToolsConfig,
  stripPlatformConfigKeys,
  isAgentInvocableBy,
} from "xyne-claw-shared";
import { tools as xyneSpacesTools } from "../mcp/servers/xyne-spaces-tools.js";
import { mintSessionToken } from "./session-tokens.js";
import { resolveClawUserIdForSpacesIdentity } from "./users-jit.js";
import {
  resolveAgentProviderConfigs,
  resolveSubagentProviderMode,
  type ProviderConfig,
} from "./agent-provider-config.js";
import { resolveFastMode } from "./fast-mode.js";
import { withAwakeningSendTool } from "../awakening/send-tool.js";
import { redisService } from "../redis.js";
import { getDmChannelForUserAndApp, getWorkspaceIdForUser } from "./spaces-db.js";
import {
  isAllowedExternalCallbackUrl,
  isInternalCallbackOrigin,
  type ExternalResultCallbackConfig,
} from "../surfaces/external-api/delivery.js";
import type { VerifiedCliToken } from "./cli-tokens.js";
import { agentScopeAllows } from "./service-tokens.js";
import { encryptSurfaceSecret } from "./surface-resolver.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { isScheduledOrAutomationEvent } from "./run-bridge.js";
import { dispatchRun } from "./dispatch-run.js";
import { createLogger } from "../logger.js";
import type { SessionContext } from "../routes/webhook.js";

const log = createLogger("run");

const SDLC_AGENT_TOOL_PROFILE = buildSdlcAgentToolProfile(
  xyneSpacesTools.map((tool) => tool.name),
);

export const RECORDING_MAX_BYTES = 1024 * 1024 * 1024;
const RECORDING_REF_TTL_SECONDS = 6 * 60 * 60;
export const RECORDING_REF_PREFIX = "run-recordings:";

export interface RunRecordingRef {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

const ASSISTANT_PROMPT = `You are a helpful AI assistant powered by Xyne Spaces. You help the user by searching their workspace data — messages, tickets, activity, and knowledge base — to give accurate, grounded answers.

## How to Build Context (do this FIRST)
You have access to the \`spaces-research\` tool — it spawns a dedicated research agent that thoroughly searches the workspace and returns structured findings. **Use it for any query that needs deep context** — it does a much better job than searching manually.

For simple queries (quick lookup, recent activity):
- Use spaces-search, spaces-activity, spaces-tickets directly

For complex queries (summarize discussions, find context across channels, understand what happened):
- Use \`spaces-research\` with a detailed topic description
- Spawn multiple \`spaces-research\` calls for different angles if needed

Available tools for direct use:
1. **Recent activity** — spaces-activity
2. **Messages & conversations** — spaces-messages
3. **Tickets & work items** — spaces-tickets
4. **Search** — spaces-search
5. **People lookup** — spaces-users
6. **Deep research** — spaces-research (delegated research agent)

## How to Respond
- Be helpful, thorough, and detailed.
- Ground every answer in data from tools. Do not guess.
- For engineering queries — use Bitbucket, Kibana, or Grafana tools.
- Acknowledge gaps honestly.
- Give detailed, thorough responses with context, reasoning, and relevant data.

## Write Actions & Approvals
Some tools (like creating tickets or scheduling calls) require user approval before executing. When you call these tools, they will return "Action queued for approval". This is NORMAL — it means:
- The action details have been sent to the user as an Approve/Decline button
- The user will see the action details and can approve or decline
- You should tell the user: "I've queued the action for your approval — check for the Approve button."
- Do NOT retry or treat this as an error. The action will execute when the user approves.

## Critical Rules
1. NEVER fabricate information. Only use data retrieved from tools.
2. ALWAYS gather context before responding.
3. When a tool returns "Action queued for approval", tell the user to approve it — do NOT retry.`;

/** Used for USER_MENTIONED — digital twin mode (respond AS the user) */
const TWIN_PROMPT = `You are the **Digital Twin** of the user. You act, think, and respond exactly as this person would.

## Identity
You ARE this user's digital representative. Someone has @mentioned this user in a channel and you are responding on their behalf. Respond the way this person would, using their knowledge, context, communication style, and expertise.

## How to Build Context (do this FIRST)
You have access to the \`spaces-research\` tool — it spawns a dedicated research agent that thoroughly searches the workspace and returns structured findings. **Use it for any query that needs deep context** — it does a much better job than searching manually.

For simple queries (quick lookup, recent activity):
- Use spaces-search, spaces-activity, spaces-tickets directly

For complex queries (summarize discussions, find context across channels, understand what happened):
- Use \`spaces-research\` with a detailed topic description
- Spawn multiple \`spaces-research\` calls for different angles if needed

Available tools for direct use:
1. **Recent activity** — spaces-activity
2. **Messages & conversations** — spaces-messages
3. **Tickets & work items** — spaces-tickets
4. **Search** — spaces-search
5. **People lookup** — spaces-users
6. **Deep research** — spaces-research (delegated research agent)

## Voice — write as the user, NOT as a bot
This is a chat reply that will be posted under the user's own name. It must read
like THEY typed it in the moment — not like an AI report.

**Before you draft, learn how this user writes.** Look at the thread and call
\`memory-search\` for how they reply (tone, length, greetings, sign-offs, emoji,
whether they use slang or stay formal). Then mirror it. When unsure, default to a
short, casual, first-person chat message.

**Hard rules on format — break these and the reply looks robotic:**
- NO markdown headings (\`#\`, \`##\`, \`###\`). This is chat, not a document.
- NO tables, NO "Analysis / Summary / Status / Reason:" report scaffolding.
- NO long bulleted dumps of tool output. Pull out what matters and say it in prose.
- Do not paste raw tool/log/build output. Read it, understand it, then say what it
  means in your own words.
- ONLY use heavier structure (a couple of bullets, etc.) if THIS user actually
  writes that way — otherwise keep it as flowing sentences.

**Substance:**
- The research/tools are for *what to say*; your voice is for *how to say it*.
- Ground every claim in data from tools. Do not guess. Acknowledge gaps honestly.
- Respond in first person ("I", "my", "we") as the user.
- Keep it **short — 2 to 6 lines**. People skim chat. Be direct and human.
- Do thorough research behind the scenes, but the final reply stays concise and conversational.

## Write Actions & Approvals
Some tools (like creating tickets or scheduling calls) require user approval before executing. When you call these tools, they will return "Action queued for approval". This is NORMAL — it means:
- The action details have been sent to the user as an Approve/Decline button
- The user will see the action details and can approve or decline
- You should tell the user: "I've queued the action for your approval — check for the Approve button."
- Do NOT retry or treat this as an error. The action will execute when the user approves.

## Critical Rules
1. NEVER fabricate information. Only use data retrieved from tools.
2. ALWAYS gather context before responding.
3. Respond as the user, not as an assistant describing the user.
4. Write a human chat message in the user's voice — never a structured report (no headings/tables/scaffolding).
5. When a tool returns "Action queued for approval", tell the user to approve it — do NOT retry.`;

/**
 * Per-ref validation, NOT atomic: one malformed ref (bad mimeType, oversized,
 * odd fileName) is SKIPPED with a log, never a 400 for the whole run — a user's
 * text task must not die because one of their clips had octet-stream metadata.
 * Returns null only when the field itself is structurally wrong (non-array),
 * which indicates a caller bug rather than bad attachment metadata.
 */
function normalizeRecordingRefs(value: unknown): RunRecordingRef[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const refs: RunRecordingRef[] = [];
  for (const item of value) {
    if (refs.length >= 4) {
      log.warn(`[recordings] ref cap reached — dropping ${value.length - 4} extra ref(s)`);
      break;
    }
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const attachmentId = typeof row["attachmentId"] === "string" ? row["attachmentId"].trim() : "";
    const fileName = typeof row["fileName"] === "string" ? row["fileName"].trim() : "";
    const mimeType = typeof row["mimeType"] === "string" ? row["mimeType"].trim().toLowerCase() : "";
    const fileSize = Number(row["fileSize"]);
    const reject = (why: string) => log.warn(`[recordings] skipping ref ${attachmentId || "<no-id>"} (${fileName || "<no-name>"}): ${why}`);
    if (!attachmentId || !/^[A-Za-z0-9_-]{8,160}$/.test(attachmentId)) { reject("bad attachmentId"); continue; }
    if (!fileName || fileName.length > 255 || /[/\\]/.test(fileName)) { reject("bad fileName"); continue; }
    if (!mimeType.startsWith("video/")) { reject(`non-video mimeType "${mimeType}"`); continue; }
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > RECORDING_MAX_BYTES) { reject(`bad fileSize ${row["fileSize"]}`); continue; }
    refs.push({ attachmentId, fileName, mimeType, fileSize });
  }
  return refs;
}

/** Loose shape check for the /experiment epoch context forwarded to the runtime. */
function isExperimentContext(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["id"] === "string" && obj["id"].trim() !== "" &&
    typeof obj["deadlineAt"] === "string" && obj["deadlineAt"].trim() !== "";
}

export type AgentRunTriggerSource = "spaces" | "scheduled" | "chat" | "api" | "automation" | "slack" | "heartbeat" | "reflex";

function triggerSourceForEventType(eventType: unknown, requested: unknown): AgentRunTriggerSource {
  if (requested === "slack") return "slack";
  if (eventType === "automation") return "automation";
  if (eventType === "scheduled_job") return "scheduled";
  return "spaces";
}

// ── Resolve identity: gateway call → Xyne Spaces userId ──

async function resolveUserId(
  body: Record<string, unknown>,
): Promise<{ userId: string; userName: string; userEmail: string; orgId?: string } | { error: string }> {
  const { userId, userName, gatewayType, externalUserId } = body as {
    userId?: string;
    userName?: string;
    gatewayType?: string;
    externalUserId?: string;
  };

  // Direct call with userId (e.g., from Xyne Spaces)
  if (userId && typeof userId === "string" && userId.trim().length > 0) {
    // The body id arrives in either representation: legacy callers (queued
    // messages, pre-migration cards) send the raw Spaces id, current callers
    // the canonical Claw id. Resolve through the identity ladder so the run
    // and every downstream row is keyed canonically.
    // Deliberate MIXED failure policy: an identity-resolution failure here is
    // FAIL-OPEN (fall back to the raw id — the request was authenticated
    // upstream and a lookup hiccup must not block runs), while the
    // body-vs-header userId pin check above is FAIL-CLOSED (403) because a
    // mismatch there is a conflicting identity claim, not an infra error.
    const clawUserId =
      (await resolveClawUserIdForSpacesIdentity(userId.trim()).catch(() => undefined)) ?? userId.trim();
    const user = await prisma.user.findUnique({
      where: { id: clawUserId },
      select: { name: true, email: true, orgId: true },
    });
    return {
      userId: clawUserId,
      userName: userName?.trim() ?? user?.name ?? "",
      userEmail: user?.email ?? "",
      ...(user?.orgId ? { orgId: user.orgId } : {}),
    };
  }

  // Gateway call — resolve externalUserId → Xyne Spaces userId
  if (gatewayType && externalUserId) {
    const gateway = await prisma.gateway.findUnique({ where: { type: gatewayType } });
    if (!gateway) {
      return { error: `Unknown gateway type: ${gatewayType}` };
    }
    if (!gateway.enabled) {
      return { error: `Gateway '${gatewayType}' is disabled` };
    }

    const identity = await prisma.gatewayIdentity.findFirst({
      where: { gatewayId: gateway.id, externalUserId: externalUserId.trim() },
      include: { user: true },
    });

    if (!identity) {
      return { error: `No linked Xyne Spaces account for ${gatewayType} user '${externalUserId}'` };
    }

    return {
      userId: identity.userId,
      userName: identity.user.name,
      userEmail: identity.user.email,
      ...(identity.user.orgId ? { orgId: identity.user.orgId } : {}),
    };
  }

  return { error: "Either userId or (gatewayType + externalUserId) is required" };
}

// ── Resolve agent config ──

async function resolveAgent(
  agentSlug: string | undefined,
  orgId: string | undefined,
): Promise<
  | {
      id: string;
      systemPrompt: string;
      modelId?: string | undefined;
      agentConfig: Record<string, unknown>;
      config?: unknown;
      orgId: string;
      delegationTier: "standard" | "orchestrator";
      spacesAppId?: string | null;
      spacesAppToken?: string | null;
      spacesAppUserId?: string | null;
      skills?: {
        slug: string;
        name: string;
        description: string;
        content: string;
        files?: Array<{ relativePath: string; content: string; contentType?: string | null }>;
      }[];
    }
  | { error: string }
> {
  // Find by slug, or fall back to default agent. Include the skill's
  // sibling files (SkillFile rows) so directory-style skills get
  // materialized in the child workspace alongside SKILL.md.
  const includeSkills = { skills: { include: { skill: { include: { files: true } } } } };
  if (agentSlug && !orgId) {
    log.error(`[run] orgId is required for agentSlug lookup agentSlug=${agentSlug}`);
    return { error: `Agent '${agentSlug}' not found` };
  }
  if (!agentSlug && !orgId) {
    log.error("[run] orgId is required; refusing global default-agent lookup agentSlug=default orgId=none");
    return { error: "orgId is required" };
  }
  const agent = agentSlug
    ? await prisma.agent.findUnique({
        where: { orgId_slug: { orgId: orgId!, slug: agentSlug } },
        include: includeSkills,
      })
    : await prisma.agent.findFirst({ where: { orgId: orgId!, isDefault: true }, include: includeSkills });

  if (!agent) {
    return { error: agentSlug ? `Agent '${agentSlug}' not found` : "No default agent configured" };
  }
  if (!agent.enabled) {
    return { error: `Agent '${agent.slug}' is disabled` };
  }

  // Skills via junction table — forward slug/name/description/content so the
  // worker can build clean YAML frontmatter regardless of what's in `content`
  // (UI-created skills are plain text; seeded skills have inline frontmatter).
  // Also forward `files[]` (relativePath/content) — extra files in the skill
  // directory beyond SKILL.md.
  const skills = agent.skills.map((as) => ({
    slug: as.skill.slug,
    name: as.skill.name,
    description: as.skill.description ?? "",
    content: as.skill.content,
    ...(as.skill.files.length > 0
      ? {
          files: as.skill.files.map((f) => ({
            relativePath: f.relativePath,
            content: f.content,
            contentType: f.contentType,
          })),
        }
      : {}),
  }));

  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    modelId: agent.modelId || undefined,
    orgId: agent.orgId,
    delegationTier: agent.delegationTier === "orchestrator" ? "orchestrator" : "standard",
    spacesAppId: agent.spacesAppId ?? null,
    spacesAppToken: agent.spacesAppToken ?? null,
    spacesAppUserId: agent.spacesAppUserId ?? null,
    agentConfig: stripPlatformConfigKeys(agent.config as Record<string, unknown>),
    config: agent.config,
    ...(skills.length > 0 ? { skills } : {}),
  };
}

export interface RunCaller {
  serviceToken?: VerifiedCliToken | undefined;
}

export interface StartRunInput {
  body: Record<string, unknown>;
  isInternalRun: boolean;
  isInternalS2SCaller: boolean;
  wantsSse: boolean;
  authenticatedUserId?: string | undefined;
  headerOrgId?: string | undefined;
  resolveSpacesAuth?: ((userId: string) => Promise<SpacesAuthContext | undefined>) | undefined;
}

export type StartRunResult =
  | { ok: true; sessionId: string; queued?: boolean; queuePosition?: number }
  | { ok: false; status: number; code?: string; error: string };

export interface PreparedRun {
  sessionId: string;
  sessionToken: string;
  forwardBody: Record<string, unknown>;
  body: Record<string, unknown>;
  detached: boolean;
  acceptHeader: string;
  progressUrl: string | undefined;
  callbackUrl: string | undefined;
  effectiveCallbackUrl: string | undefined;
  conversationId: string | undefined;
  agentSlug: string | undefined;
  eventType: string | undefined;
  task: string;
  userId: string;
  orgId: string;
  effectiveFastMode: boolean;
  defaultTriggerSource: AgentRunTriggerSource;
  effectiveChannelId: string | undefined;
  projectId: string | undefined;
  projectName: string | undefined;
  externalResultCallback: ExternalResultCallbackConfig | undefined;
  sdlcAgentRunContext: ReturnType<typeof parseSdlcAgentRunContext>;
}

export type PrepareRunResult =
  | { ok: true; prepared: PreparedRun }
  | { ok: false; status: number; code?: string; error: string };

export async function persistRunStart(prepared: PreparedRun, rowSessionId?: string): Promise<void> {
  const sessionId = rowSessionId ?? prepared.sessionId;
  const {
    body,
    conversationId,
    agentSlug,
    userId,
    orgId,
    task,
    defaultTriggerSource,
    effectiveChannelId,
    projectId,
    projectName,
    externalResultCallback,
    effectiveFastMode,
    eventType,
  } = prepared;
  const persistedByCaller = (body as { __persistedByCaller?: boolean }).__persistedByCaller;
  const skipUserMessagePersist =
    (body as { __skipUserMessagePersist?: boolean }).__skipUserMessagePersist === true;
  if (conversationId && !persistedByCaller && !skipUserMessagePersist) {
    try {
      await chatMessageRepository.create({
        conversationId,
        agentSlug: agentSlug || "assistant",
        userId,
        role: "user",
        content: task,
        orgId,
      });
    } catch (msgErr) {
      log.warn("[run] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : msgErr);
    }
  }
  if (
    (conversationId || isScheduledOrAutomationEvent(eventType) || defaultTriggerSource === "api") &&
    !persistedByCaller
  ) {
    agentRunRepository
      .start({
        sessionId,
        userId,
        agentSlug: agentSlug || "assistant",
        orgId,
        triggerSource: defaultTriggerSource,
        task,
        ...(conversationId ? { conversationId } : {}),
        ...(effectiveChannelId ? { channelId: effectiveChannelId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(projectName ? { projectName } : {}),
        ...(externalResultCallback ? { metadata: { externalResultCallback } } : {}),
        fastMode: effectiveFastMode,
      })
      .catch((e) => log.warn("[run] AgentRun.start failed:", e instanceof Error ? e.message : e));
    redisService
      .getConnection()
      .publish(
        "cc:events",
        JSON.stringify({ type: "agent_start", sessionId, agentSlug: agentSlug || "assistant" }),
      )
      .catch(() => {});
  }
}

async function persistDetachedRunStart(prepared: PreparedRun): Promise<void> {
  const detachedPersistedByCaller = (prepared.body as { __persistedByCaller?: boolean })
    .__persistedByCaller;
  if (detachedPersistedByCaller) return;
  await agentRunRepository
    .start({
      sessionId: prepared.sessionId,
      userId: prepared.userId,
      agentSlug: prepared.agentSlug || "assistant",
      orgId: prepared.orgId,
      triggerSource: prepared.defaultTriggerSource,
      task: prepared.task,
      ...(prepared.conversationId ? { conversationId: prepared.conversationId } : {}),
      ...(prepared.effectiveChannelId ? { channelId: prepared.effectiveChannelId } : {}),
      ...(prepared.projectId ? { projectId: prepared.projectId } : {}),
      ...(prepared.projectName ? { projectName: prepared.projectName } : {}),
      ...(prepared.externalResultCallback || prepared.sdlcAgentRunContext
        ? {
            metadata: {
              ...(prepared.externalResultCallback
                ? { externalResultCallback: prepared.externalResultCallback }
                : {}),
              ...(prepared.sdlcAgentRunContext ? { sdlcContext: prepared.sdlcAgentRunContext } : {}),
            },
          }
        : {}),
      fastMode: prepared.effectiveFastMode,
    })
    .catch((e) => log.warn("[run] AgentRun.start failed (detached):", e instanceof Error ? e.message : e));
  redisService
    .getConnection()
    .publish(
      "cc:events",
      JSON.stringify({ type: "agent_start", sessionId: prepared.sessionId, agentSlug: prepared.agentSlug || "assistant" }),
    )
    .catch(() => {});
}

export async function prepareRun(
  input: StartRunInput,
  caller: RunCaller,
): Promise<PrepareRunResult> {
  const body = input.body;
  const serviceToken = caller.serviceToken;
  const isServiceTokenCaller = serviceToken?.client === "service";
  {
    const { task, context, conversationId, piSessionConversationId, agentSlug, callbackUrl, callbackSecret, channelId, deliverTo, projectId, projectName, cwd, eventType, triggerSource, slackDelivery, traceId, provider, providerOrder, providerOverride, subagentProviders, subagentProviderMode, providerConfigs, progressUrl, attachments, recordingRefs, contextFiles, skills: bodySkills, attachedContext, ticketIds, canvasIds, callIds, idempotencyKey: requestedIdempotencyKey, isRegenerate, detached, fastMode, resumedFromHandoff, generateFollowUpSuggestions } = body as {
      task?: string;
      context?: string;
      conversationId?: string;
      /** Optional: PI session JSONL file id. When set, OVERRIDES conversationId
       *  for the persistent-session lookup downstream. Used by chat branching
       *  so the conversation row (DB) stays the same but the PI session lives
       *  at a branched id like `${conversationId}__branch__${assistantMsgId}`. */
      piSessionConversationId?: string;
      agentSlug?: string;
      callbackUrl?: string;
      callbackSecret?: string;
      channelId?: string;
      deliverTo?: "dm";
      projectId?: string;
      projectName?: string;
      cwd?: string;
      eventType?: string;
      triggerSource?: string;
      slackDelivery?: SessionContext["slackDelivery"];
      traceId?: string;
      provider?: string;
      providerOrder?: string[];
      /** Per-run provider/model pin. Same contract as agent-chat's chat route:
       *  the Ask AI composer's model picker sends it so a user can switch model
       *  for one turn without touching the agent's stored config. */
      providerOverride?: { provider?: string; model?: string };
      subagentProviders?: Record<string, string>;
      subagentProviderMode?: "parent" | "spaces" | "fast-model";
      providerConfigs?: Record<string, ProviderConfig>;
      progressUrl?: string;
      attachments?: Array<{
        fileName: string;
        mimeType: string;
        data?: string;
        gcsRef?: string;
        sizeBytes?: number;
      }>;
      recordingRefs?: RunRecordingRef[];
      contextFiles?: Array<{ path: string; content: string }>;
      skills?: Array<{ slug?: string; name: string; description?: string; content: string }>;
      attachedContext?: Array<{
        type: "channel" | "ticket" | "canvas" | "call";
        id: string;
        title: string;
        threadId?: string;
      }>;
      ticketIds?: string[];
      canvasIds?: string[];
      callIds?: string[];
      idempotencyKey?: string;
      detached?: boolean;
      fastMode?: boolean;
      resumedFromHandoff?: boolean;
      generateFollowUpSuggestions?: boolean;
      /** Branching: when true, claw branches the PI session at the last user
       *  entry so the new assistant turn is a sibling of the previous one. */
      isRegenerate?: boolean;
    };

    const defaultTriggerSource = triggerSourceForEventType(eventType, triggerSource);
    const explicitFastMode = typeof fastMode === "boolean" ? fastMode : undefined;

    log.info(
      `[run] Received: ticketIds=${JSON.stringify(ticketIds)}, canvasIds=${JSON.stringify(canvasIds)}, callIds=${JSON.stringify(callIds)}`,
    );
    // [AUTODBG] confirm automation forwards reach this handler (past requireStrictS2S)
    // and which dispatch path they take. Trusted internal calls preserve the
    // caller's dispatchSessionId so upstream can persist it before dispatch.
    {
      const __dispatchSid = (body as { sessionId?: string }).sessionId;
      const __wantsSse = input.wantsSse;
      log.info(
        `[run] AUTODBG entry: eventType=${eventType} dispatchSessionId=${__dispatchSid} agent=${agentSlug} hasCallbackUrl=${!!callbackUrl} wantsSse=${__wantsSse} clawSseTransport=${CONFIG.clawSseTransport}`,
      );
    }

    if (!task || typeof task !== "string" || task.trim().length === 0) {
      return { ok: false, status: 400, error: "task is required and must be a non-empty string" };
    }
    if (callbackUrl !== undefined && typeof callbackUrl !== "string") {
      return { ok: false, status: 400, error: "callbackUrl must be a string" };
    }
    if (isServiceTokenCaller && serviceToken) {
      if (!serviceToken.scopes.includes("runs:write")) {
        return { ok: false, status: 403, error: "This token does not have the runs:write scope" };
      }
      const requestedAgent =
        typeof agentSlug === "string" && agentSlug.trim() ? agentSlug.trim() : "assistant";
      if (!agentScopeAllows(serviceToken.scopes, requestedAgent)) {
        // Deny-by-default: tokens minted before agent scopes existed have no
        // agent:* entries and can invoke nothing until an admin adds them
        // (per-slug, or the explicit "agent:*" org-wide wildcard).
        return { ok: false, status: 403, error: "This token is not scoped for the requested agent" };
      }
    }
    const isInternalS2SCaller = input.isInternalS2SCaller;
    const normalizedRecordingRefs = normalizeRecordingRefs(recordingRefs);
    if (normalizedRecordingRefs === null) {
      return { ok: false, status: 400, error: "recordingRefs must contain at most four valid video references, each no larger than 1 GB" };
    }
    if (normalizedRecordingRefs.length > 0 && !isInternalS2SCaller) {
      return { ok: false, status: 403, error: "recordingRefs require internal service authentication" };
    }
    if ((triggerSource === "slack" || slackDelivery !== undefined) && !isInternalS2SCaller) {
      return { ok: false, status: 400, error: "slackDelivery requires internal service authentication" };
    }
    if (callbackUrl && !isInternalCallbackOrigin(callbackUrl) && !isAllowedExternalCallbackUrl(callbackUrl)) {
      return { ok: false, status: 400, error: "callbackUrl is not an allowed target" };
    }
    if (progressUrl !== undefined && typeof progressUrl !== "string") {
      return { ok: false, status: 400, error: "progressUrl must be a string" };
    }
    if (progressUrl && !isInternalCallbackOrigin(progressUrl) && !isAllowedExternalCallbackUrl(progressUrl)) {
      return { ok: false, status: 400, error: "progressUrl is not an allowed target" };
    }
    if (callbackSecret !== undefined && (typeof callbackSecret !== "string" || callbackSecret.length > 256)) {
      return { ok: false, status: 400, error: "callbackSecret must be a string of at most 256 characters" };
    }

    // Resolve identity. Browser and access-token auth pin x-user-id server-side;
    // body userId is accepted only when it agrees with that authenticated id.
    const authenticatedUserId = input.authenticatedUserId;
    const bodyUserIdRaw = (body as { userId?: unknown }).userId;
    const bodyUserId =
      typeof bodyUserIdRaw === "string" && bodyUserIdRaw.trim() ? bodyUserIdRaw.trim() : undefined;
    if (bodyUserId && authenticatedUserId && bodyUserId !== authenticatedUserId) {
      // The pinned header is canonical while legacy clients still send the
      // raw Spaces alias in the body — resolve before comparing, or the
      // authenticated user's own runs get falsely rejected. FAIL-CLOSED: an
      // unresolvable or mismatching body id is a 403 (see resolveUserId for
      // the complementary fail-open path).
      const resolvedBodyUserId = await resolveClawUserIdForSpacesIdentity(bodyUserId).catch(() => undefined);
      if (!resolvedBodyUserId || resolvedBodyUserId !== authenticatedUserId) {
        log.warn(`[run] userId pin mismatch: session=${authenticatedUserId} body=${bodyUserId}`);
        return { ok: false, status: 403, error: "Body userId does not match authenticated session" };
      }
    }

    const identityBody = {
      ...body,
      ...(!bodyUserId && authenticatedUserId ? { userId: authenticatedUserId } : {}),
    };
    const resolved = await resolveUserId(identityBody);
    if ("error" in resolved) {
      return { ok: false, status: 400, error: resolved.error };
    }

    const headerOrgId = input.headerOrgId;
    const runtimeOrgId = headerOrgId ?? resolved.orgId;
    if (agentSlug && !runtimeOrgId) {
      log.error(
        `[run] orgId is required for agentSlug lookup agentSlug=${agentSlug} userId=${resolved.userId}`,
      );
      return { ok: false, status: 400, error: "orgId is required" };
    }

    // Resolve agent (only if explicitly requested). Org comes from auth/user DB,
    // never from request body.
    const agent = await resolveAgent(agentSlug, runtimeOrgId);
    if ("error" in agent) {
      return { ok: false, status: 400, error: agent.error };
    }

    // Invocation whitelist — the universal chokepoint for CLI / service-token /
    // external-API runs (they all enter here). Enforced on the RESOLVED caller
    // (resolved.userId), in addition to any service-token scope gate. Refused
    // like a disabled agent so every surface behaves consistently.
    if (!isAgentInvocableBy(agent.config as Record<string, unknown> | null, resolved.userId)) {
      log.warn(`[run] invocation denied (not whitelisted) agentSlug=${agentSlug} userId=${resolved.userId}`);
      return { ok: false, status: 403, error: `agent "${agentSlug}" is restricted — you don't have access to it` };
    }

    // Per-run provider/model pin. Validate up-front (clean 400) — once the SSE
    // stream opens we can only fail mid-stream. Mirrors the agent-chat route.
    const OVERRIDABLE = new Set(["spaces", "copilot", "claude", "codex", "litellm"]);
    const runOverride =
      providerOverride?.provider && OVERRIDABLE.has(providerOverride.provider) ? providerOverride : undefined;
    if (providerOverride?.provider && !runOverride) {
      return { ok: false, status: 400, error: `Unknown provider override "${providerOverride.provider}"` };
    }
    // Personal-cred providers (copilot/claude/codex) require the USER's own key.
    // "litellm" is exempt: it rides the AGENT's shared LiteLLM credential (admin-
    // set), so any caller may switch among that key's models for a single run
    // without connecting a personal key. "spaces" is the keyless platform
    // default. The litellm agent cred is validated below (its config must exist
    // in providerConfigs, else the override no-ops).
    if (runOverride?.provider && runOverride.provider !== "spaces" && runOverride.provider !== "litellm") {
      const cred = await userProviderCredentialsRepository
        .findByUserAndProvider(resolved.userId, runOverride.provider)
        .catch(() => null);
      if (!cred?.encryptedKey) {
        return {
          ok: false,
          status: 400,
          error: `No ${runOverride.provider} credentials for this user — connect it in Settings first`,
        };
      }
    }

    let effectiveChannelId = channelId;
    if (!effectiveChannelId && deliverTo === "dm" && authenticatedUserId) {
      if (agent.spacesAppId) {
        effectiveChannelId =
          (await getDmChannelForUserAndApp(authenticatedUserId, agent.spacesAppId)) ?? undefined;
      }
      if (!effectiveChannelId) {
        log.warn(
          `[run] dm-delivery unresolved user=${authenticatedUserId} agent=${agentSlug || "assistant"}`,
        );
      }
    }

    // Fail-closed channel authorization for external (service-token) callers.
    // A CHANNELS_POST_SCOPE token may request channel delivery, but only into
    // channels the agent's Spaces app can actually reach. The agent posts
    // results and write-approval cards with THIS app token, so we validate the
    // same principal here and reject up-front — otherwise an inaccessible
    // channelId would silently drop both later (the original channelId-drop
    // pain: HITL approval cards vanishing on API-triggered runs).
    if (isServiceTokenCaller && effectiveChannelId) {
      try {
        const [ciphertext, iv, authTag] = (agent.spacesAppToken ?? "").split(":");
        const appToken = ciphertext && iv && authTag
          ? decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey)
          : "";
        if (!appToken) {
          return { ok: false, status: 403, error: "This agent has no Spaces app credential; it cannot post to a channel" };
        }
        await spacesAppFetch("/channel/info", { channelId: effectiveChannelId }, appToken);
      } catch (channelErr) {
        const msg = errMsg(channelErr);
        if (/Spaces app API 404/i.test(msg) || /CHANNEL_NOT_FOUND/i.test(msg)) {
          return { ok: false, status: 400, error: `channel ${effectiveChannelId} not found` };
        }
        if (/Spaces app API 403/i.test(msg) || /forbidden/i.test(msg)) {
          return { ok: false, status: 403, error: `agent's app is not a member of channel ${effectiveChannelId} — add the app to the channel first` };
        }
        // Unknown/transient lookup failure: fail OPEN so a Spaces hiccup doesn't
        // block runs (mirrors pendingActionTargetValidation in webhook.ts).
        log.warn(`[run] channel access precheck failed open channelId=${effectiveChannelId} err=${msg.slice(0, 200)}`);
      }
    }

    // For the default assistant agent: select prompt based on event type
    // USER_MENTIONED → digital twin prompt (respond AS the user)
    // DM / APP_MENTIONED → assistant prompt (help the user)
    let effectivePrompt = agent.systemPrompt;
    if (!agentSlug || agentSlug === "assistant") {
      effectivePrompt = eventType === "USER_MENTIONED" ? TWIN_PROMPT : ASSISTANT_PROMPT;
    }

    // Resolve attachedContext (+ the Spaces thread the assistant was opened
    // from) to actual content if Spaces auth is available. The thread arrives
    // as agentConfig.SPACES_CONVERSATION_ID — separate from the attachedContext
    // array — so we fold it into the same "# Attached context" block instead of
    // only surfacing its raw id in Session Metadata.
    const agentConfigBody = (body as { agentConfig?: Record<string, unknown> }).agentConfig;
    const readAgentConfigString = (key: string): string | undefined => {
      const raw = agentConfigBody?.[key];
      return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
    };
    const attachedThreadConversationId = readAgentConfigString("SPACES_CONVERSATION_ID");
    const attachedCanvasViewAccessId = readAgentConfigString("SPACES_CANVAS_VIEW_ACCESS_ID");
    let resolvedAttachedContext:
      | { contextFiles: Array<{ path: string; content: string }>; promptPrefix?: string }
      | undefined;
    let normalizedAttached: AttachedContextRef[] = [];
    if (attachedContext?.length) {
      const normalized = normalizeAttachedContext(attachedContext);
      if (normalized.error) log.warn(`[run] attachedContext ignored: ${normalized.error}`);
      normalizedAttached = normalized.items;
    }
    if (normalizedAttached.length > 0 || attachedThreadConversationId || attachedCanvasViewAccessId) {
      // Try to get Spaces auth from request cookies
      const spacesAuth = (await input.resolveSpacesAuth?.(resolved.userId)) ?? undefined;
      if (spacesAuth) {
        try {
          resolvedAttachedContext = await buildAttachedContextPayload(normalizedAttached, spacesAuth, {
            ...(attachedThreadConversationId ? { threadConversationId: attachedThreadConversationId } : {}),
            ...(attachedCanvasViewAccessId ? { canvasViewAccessId: attachedCanvasViewAccessId } : {}),
          });
          log.info(
            `[run] Resolved ${normalizedAttached.length} attached item(s)${attachedThreadConversationId ? " + thread" : ""}${attachedCanvasViewAccessId ? " + canvas" : ""} to ${resolvedAttachedContext.contextFiles.length} context files`,
          );
        } catch (err) {
          log.warn(
            "[run] Failed to resolve attachedContext:",
            errMsg(err),
          );
        }
      } else {
        log.warn("[run] No Spaces auth available to resolve attachedContext");
      }
    }

    // Forward to xyne-claw (returns sessionId immediately)
    // Include resolved attached context (contextFiles + promptPrefix) if available
    const mergedContextFiles = [...(contextFiles ?? []), ...(resolvedAttachedContext?.contextFiles ?? [])];

    let additionalInstructions =
      (body as { additionalInstructions?: string }).additionalInstructions ?? "";

    // Per-user, per-agent custom instructions: users can tune ANY agent's
    // behaviour for themselves (generic feature — not just the daily brief). We
    // append them to additionalInstructions, which claw renders under a
    // "## Additional Instructions" heading. Appended (not prepended) so any
    // backend housekeeping instructions still lead. Best-effort: a lookup failure
    // must never break the run.
    //
    // SKIPPED for daily_brief runs: the brief may execute on a SHARED agent
    // (default ask-ai), and its per-user instructions are keyed under the fixed
    // logical "daily-brief" slug and passed EXPLICITLY in the dispatch body — so we
    // must NOT also inject the executing agent's own instructions here (that would
    // leak e.g. the user's Ask AI chat prefs into the brief and vice-versa).
    const bodyMode = (body as { mode?: string }).mode;
    if (bodyMode !== "daily_brief") {
      const instructionAgentSlug = agentSlug ?? CONFIG.defaultAgentSlug;
      try {
        const userInstructions = await userAgentInstructionRepository.getEnabledText(
          resolved.userId,
          agent.orgId,
          instructionAgentSlug,
        );
        if (userInstructions) {
          additionalInstructions = additionalInstructions
            ? `${additionalInstructions}\n\n${userInstructions}`
            : userInstructions;
          log.info(
            `[run] injected user custom instructions for agent=${instructionAgentSlug} user=${resolved.userId}`,
          );
        }
      } catch (err) {
        log.warn(
          "[run] failed to load user agent instructions:",
          errMsg(err),
        );
      }
    }

    // Promote the attached-context prefix into `context` (NOT additionalInstructions).
    // Mirrors agent-chat.ts:918, where attached items already land in `context`.
    // Why: claw wraps additionalInstructions under a "## Additional Instructions"
    // heading — fine for backend housekeeping (web search blurb, canvas mandate),
    // but it buries user-attached items and produces a broken H1-inside-H2
    // hierarchy. Routing them through `context` keeps the attached-context H1
    // block at the top of claw's fullContext, where the agent sees it first and
    // links the user's query to it.
    let mergedContext = context;
    if (resolvedAttachedContext?.promptPrefix) {
      mergedContext = mergedContext
        ? `${resolvedAttachedContext.promptPrefix}\n\n${mergedContext}`
        : resolvedAttachedContext.promptPrefix;
    }

    // Inject live agent catalog for the Claw concierge agent so the LLM
    // always sees the current agents without any hardcoded list in the prompt.
    if (agentSlug === "claw") {
      try {
        const catalog = await buildAgentCatalog(resolved.userId, agent.orgId);
        additionalInstructions = additionalInstructions ? `${catalog}\n\n${additionalInstructions}` : catalog;
      } catch (catalogErr) {
        log.warn(
          "[run] Failed to build agent catalog for claw:",
          catalogErr instanceof Error ? catalogErr.message : catalogErr,
        );
      }
    }

    // Hydrate user-created subagents referenced by the agent's tools config
    // and forward them as part of the /run payload. Built-ins live in
    // xyne-claw's bundled code and are NOT sent across the wire.
    // Strip platform-only keys from the merged config so neither the stored
    // agent config nor a per-request `agentConfig` override can replace a
    // platform env value (secret-exfil / SSRF / GIT_SSH_COMMAND injection).
    // xyne-claw enforces this again in resolveToolConfig; this is the boundary.
    const isInternalRun = input.isInternalRun;
    let mergedAgentConfig = stripPlatformConfigKeys({
      ...agent.agentConfig,
      ...((body as { agentConfig?: Record<string, unknown> }).agentConfig ?? {}),
    });
    if (agentSlug === "sdlc-agent") {
      const configuredTools = (mergedAgentConfig["tools"] as Record<string, unknown> | undefined) ?? {};
      const configuredPermissions =
        (mergedAgentConfig["toolPermissions"] as Record<string, unknown> | undefined) ?? {};
      mergedAgentConfig = {
        ...mergedAgentConfig,
        tools: {
          ...configuredTools,
          direct: SDLC_AGENT_TOOL_PROFILE.tools.direct,
          custom: SDLC_AGENT_TOOL_PROFILE.tools.custom,
          subagents: SDLC_AGENT_TOOL_PROFILE.tools.subagents,
        },
        toolPermissions: {
          ...configuredPermissions,
          ...SDLC_AGENT_TOOL_PROFILE.toolPermissions,
        },
      };
    }
    if (!isInternalRun) {
      const {
        sdlcContext: _untrustedSdlcContext,
        sdlcRepository: _untrustedSdlcRepository,
        requireSdlcRepository: _untrustedSdlcRequirement,
        ...safeAgentConfig
      } = mergedAgentConfig;
      mergedAgentConfig = safeAgentConfig;
    }
    const sdlcAgentRunContext = parseSdlcAgentRunContext(mergedAgentConfig["sdlcContext"]);
    const effectiveFastMode =
      explicitFastMode ??
      (await resolveFastMode(conversationId, agentSlug || "assistant", mergedAgentConfig));
    const requestedSubagentNames = parseToolsConfig(mergedAgentConfig)?.subagents ?? [];
    const customSubagents =
      requestedSubagentNames.length > 0
        ? await resolveCustomSubagentsForRun(prisma, requestedSubagentNames, agent.orgId)
        : [];

    // A2A delegation. Standard-tier callers list requested callee slugs under
    // tools.callableAgents and the resolver intersects them with approved
    // grants. Orchestrator-tier callers receive a lightweight list of enabled
    // global org agents + approved non-global grant targets; full specs are
    // hydrated by claw-auth at tool-call time.
    const toolsCfg = (mergedAgentConfig as { tools?: { callableAgents?: unknown } } | null | undefined)
      ?.tools;
    const requestedCalleeSlugs = Array.isArray(toolsCfg?.callableAgents)
      ? (toolsCfg!.callableAgents as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const runningUserIsAdmin = await isClawAdmin(resolved.userId);
    const callableAgents =
      agent.delegationTier === "orchestrator"
        ? await resolveOrchestratorCallableAgentsForRun(prisma, agent.id, agent.orgId, {
            runningUserId: resolved.userId,
            isAdmin: runningUserIsAdmin,
          })
        : requestedCalleeSlugs.length > 0
          ? await resolveCallableAgentsForRun(prisma, agent.id, requestedCalleeSlugs, agent.orgId, {
              runningUserId: resolved.userId,
              isAdmin: runningUserIsAdmin,
            })
          : [];

    const requestedSessionId = (body as { sessionId?: unknown }).sessionId;
    const internalSessionId =
      isInternalRun &&
      typeof requestedSessionId === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(requestedSessionId)
        ? requestedSessionId
        : undefined;
    const sessionId = internalSessionId ?? randomUUID();
    const bodyIdempotencyKey =
      typeof requestedIdempotencyKey === "string" && requestedIdempotencyKey.trim().length > 0
        ? requestedIdempotencyKey.trim()
        : undefined;
    const idempotencyKey = isInternalRun ? (bodyIdempotencyKey ?? sessionId) : randomUUID();
    const sessionToken = mintSessionToken({
      sessionId,
      userId: resolved.userId,
      ...(agentSlug ? { agentSlug } : {}),
      ...(agent.spacesAppId ? { spacesAppId: agent.spacesAppId } : {}),
      ttlSeconds: 6 * 60 * 60,
    });
    if (normalizedRecordingRefs.length > 0) {
      try {
        await redisService.getConnection().setex(
          `${RECORDING_REF_PREFIX}${sessionId}`,
          RECORDING_REF_TTL_SECONDS,
          JSON.stringify({ userId: resolved.userId, refs: normalizedRecordingRefs }),
        );
      } catch (error) {
        log.error(`[run] Failed to bind recording references to session ${sessionId}:`, error);
        return { ok: false, status: 503, error: "Could not initialize recording transfer" };
      }
    }
    const standardCallableAgents = callableAgents as Array<{ slug: string; spacesAppId?: string | null }>;
    const callableAgentsWithSession =
      agent.delegationTier === "orchestrator"
        ? callableAgents
        : standardCallableAgents.map((spec) => ({
            ...spec,
            sessionToken: mintSessionToken({
              sessionId,
              userId: resolved.userId,
              agentSlug: spec.slug,
              ...(spec.spacesAppId ? { spacesAppId: spec.spacesAppId } : {}),
              ttlSeconds: 6 * 60 * 60,
            }),
          }));

    let effectiveProviderConfigs = providerConfigs;
    let effectiveProviderOrder = providerOrder;
    let effectiveProvider = provider;
    if (!providerConfigs) {
      try {
        const resolvedProviders = await resolveAgentProviderConfigs(
          { id: agent.id, config: agent.config },
          // Only bulk machine traffic gets the automationProvider downgrade;
          // "spaces"/"chat"/"api" dispatches keep the agent's premium order.
          { headlessBulk: defaultTriggerSource === "automation" || defaultTriggerSource === "scheduled" },
        );
        effectiveProviderConfigs = resolvedProviders.providerConfigs;
        if (!providerOrder?.length) effectiveProviderOrder = resolvedProviders.providerOrder;
        // Primary provider — the pod keys its model off `provider` (defaults
        // to the platform Spaces model when unset), NOT providerOrder[0]. Same
        // wiring as the scheduled-jobs worker and the automation webhook;
        // without it, dispatches relying on server-side resolution run on the
        // platform default regardless of the agent's configured provider.
        if (!provider && resolvedProviders.parent) effectiveProvider = resolvedProviders.parent;
      } catch (provErr) {
        log.error(
          `[run] resolveAgentProviderConfigs failed for agent=${agentSlug || "assistant"}: ${provErr instanceof Error ? provErr.stack || provErr.message : String(provErr)}`,
        );
        return { ok: false, status: 502, error: "provider config resolution failed" };
      }
    }

    // Apply the per-run provider/model pin. "spaces" rides claw's per-agent
    // modelSettings override (agent-model-settings.ts); other providers pin
    // their config's model. providerOrder is cleared so a quota fallback can't
    // silently swap providers mid-run.
    if (runOverride?.provider) {
      if (runOverride.provider === "spaces") {
        effectiveProvider = "spaces";
        if (runOverride.model?.trim()) {
          mergedAgentConfig = {
            ...mergedAgentConfig,
            modelSettings: {
              ...((mergedAgentConfig["modelSettings"] as Record<string, unknown> | undefined) ?? {}),
              model: runOverride.model.trim(),
            },
          };
        }
        effectiveProviderOrder = [];
      } else {
        // Pin the override provider only if we actually hold its credential.
        // litellm's cred is the AGENT's shared key (already in providerConfigs
        // for any user); personal providers are the user's own. Without the
        // cred, ignore the override and fall through to normal resolution
        // rather than forcing a provider claw can't serve (which would silently
        // drop to the platform default).
        const cfg = effectiveProviderConfigs?.[runOverride.provider];
        if (cfg) {
          effectiveProvider = runOverride.provider;
          if (runOverride.model?.trim()) {
            effectiveProviderConfigs = {
              ...effectiveProviderConfigs,
              [runOverride.provider]: { ...cfg, model: runOverride.model.trim() },
            };
          }
          effectiveProviderOrder = [];
        } else if (runOverride.provider === "litellm" && runOverride.model?.trim()) {
          // No agent litellm credential — the pick came off the platform
          // allowed-model list (litellm-models' claw fallback). Apply it as a
          // "spaces" pin so it still takes effect instead of silently no-oping.
          effectiveProvider = "spaces";
          mergedAgentConfig = {
            ...mergedAgentConfig,
            modelSettings: {
              ...((mergedAgentConfig["modelSettings"] as Record<string, unknown> | undefined) ?? {}),
              model: runOverride.model.trim(),
            },
          };
          effectiveProviderOrder = [];
        }
      }
    }

    const acceptHeader = input.wantsSse ? "text/event-stream" : "";
    const hasExternalCallback = Boolean(callbackUrl && !isInternalCallbackOrigin(callbackUrl));
    const externalResultCallback: ExternalResultCallbackConfig | undefined =
      hasExternalCallback && callbackUrl
        ? {
            url: callbackUrl,
            ...(callbackSecret !== undefined
              ? { encryptedSecret: encryptSurfaceSecret(callbackSecret) }
              : {}),
          }
        : undefined;
    const injectedCallbackUrl =
      hasExternalCallback || (!callbackUrl && !acceptHeader.includes("text/event-stream"))
        ? `${CONFIG.internalUrl}/claw/api/v1/webhook/result`
        : undefined;
    const effectiveCallbackUrl = hasExternalCallback
      ? injectedCallbackUrl
      : (callbackUrl ?? injectedCallbackUrl);

    // Same S2S trust rule as skills: only an internal caller (the awakening
    // dispatcher) may declare a run unattended, since the block governs the
    // run's write policy and its live-injection wiring.
    const awakeningBlock =
      input.isInternalS2SCaller &&
      (body as { awakening?: unknown }).awakening &&
      typeof (body as { awakening?: unknown }).awakening === "object"
        ? ((body as { awakening?: Record<string, unknown> }).awakening as Record<string, unknown>)
        : undefined;

    // An AWAKENED run (heartbeat / reflex) must have its SessionContext in place
    // BEFORE claw is dispatched: claw lists its MCP tools within milliseconds of
    // the POST returning, and that listing reads the context to decide app-mode
    // vs user-mode and to grant the bot-identity send tool. Writing the context
    // after the dispatch resolves is a race the run usually loses — the agent
    // then comes up with no way to speak at all.
    //
    // `awakening` is only honoured from an S2S caller (see awakeningBlock), so
    // this cannot be used to self-declare an unattended run from a browser.
    if (awakeningBlock) {
      try {
        const [ciphertext, iv, authTag] = (agent.spacesAppToken ?? "").split(":");
        const appToken =
          ciphertext && iv && authTag ? decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey) : "";
        const kind = String((awakeningBlock as Record<string, unknown>)["kind"] ?? "");
        const { setSession } = await import("../routes/webhook.js");
        await setSession(sessionId, {
          mentionedUserId: agent.spacesAppUserId ?? "",
          senderId: agent.spacesAppUserId ?? "",
          senderName: agentSlug || "assistant",
          channelId: "",
          channelName: "",
          conversationId: conversationId ?? "",
          task: task.trim(),
          agentId: agent.id,
          agentOrgId: agent.orgId,
          agentSlug: agentSlug || "assistant",
          responseMode: "conversation",
          // Read by routes/mcp.ts: app-mode Spaces tools + the send tool.
          triggerSource: kind === "reflex" ? "reflex" : "heartbeat",
          isAutomation: true,
          // The agent posts through tools, choosing thread and wording itself;
          // its final answer is an operator log line, not a channel message.
          suppressThreadReply: true,
          appToken,
          spacesAppId: agent.spacesAppId ?? "",
          spacesAppUserId: agent.spacesAppUserId ?? "",
          ...(traceId ? { traceId } : {}),
        });
      } catch (sessionErr) {
        log.warn(
          `[run] failed to store awakening session context sessionId=${sessionId}:`,
          sessionErr instanceof Error ? sessionErr.message : sessionErr,
        );
      }
    }

    // Grant the bot-identity send tool for THIS run only. claw re-applies the
    // agent's tools allowlist against the config forwarded here
    // (applyAgentToolFilter in xyne-claw/src/routes/run.ts), so listing the
    // tool at the claw-auth MCP boundary is not enough on its own — claw would
    // strip it right back out of the palette. `apps-send-message` is never in
    // the picker, so a strict allowlist always excludes it, and an awakened run
    // has no thread its final answer is posted into: without this the agent
    // decides to reply, finds no tool, and says nothing.
    //
    // Mirrors withSurfaceDefaultToolsConfig in routes/mcp.ts; both are per-run
    // and leave the stored agent config untouched. The write POLICY
    // (observe / reply / act, plus shadow) still governs whether a call is
    // permitted — see awakening/write-policy.ts, enforced at /mcp/call.
    if (awakeningBlock) {
      mergedAgentConfig = withAwakeningSendTool(mergedAgentConfig);
    }

    if (injectedCallbackUrl) {
      try {
        const [ciphertext, iv, authTag] = (agent.spacesAppToken ?? "").split(":");
        const appToken =
          ciphertext && iv && authTag ? decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey) : "";
        const sessionContext: SessionContext = {
          mentionedUserId: agent.spacesAppUserId ?? "",
          senderId: resolved.userId,
          senderName: resolved.userName || resolved.userId,
          channelId: effectiveChannelId ?? "",
          channelName: effectiveChannelId ?? "",
          conversationId: conversationId ?? "",
          task: task.trim(),
          agentId: agent.id,
          agentOrgId: agent.orgId,
          agentSlug: agentSlug || "assistant",
          responseMode: "conversation",
          appToken,
          spacesAppId: agent.spacesAppId ?? "",
          spacesAppUserId: agent.spacesAppUserId ?? "",
          rootAgentSlug: agentSlug || "assistant",
          ...(traceId ? { traceId } : {}),
          ...(externalResultCallback ? { externalResultCallback } : {}),
          ...(defaultTriggerSource === "slack" && slackDelivery ? { slackDelivery } : {}),
        };
        const { setSession } = await import("../routes/webhook.js");
        await setSession(
          sessionId,
          sessionContext,
          externalResultCallback ? { skipConversationIndex: true } : undefined,
        );
      } catch (sessionErr) {
        log.warn(
          `[run] failed to store injected callback session context sessionId=${sessionId}:`,
          sessionErr instanceof Error ? sessionErr.message : sessionErr,
        );
      }
    }

    // Persist attached items for the lifetime of this session so the MCP /call
    // boundary can default-fill missing channelId/conversationId on spaces-*
    // tool calls (see mcp/attached-context-injector.ts). Fire-and-forget — the
    // run still works without it; only auto-scoping is degraded.
    if (normalizedAttached.length > 0) {
      storeAttachedContextForSession(sessionId, normalizedAttached).catch(() => {});
    }

    // Dashboard-ai run scalars: the Spaces proxy passes the dashboard being
    // edited via agentConfig. Stored per-session so the MCP /call boundary can
    // force-inject them into xyne-dashboard tool calls. Fire-and-forget.
    {
      const ac = mergedAgentConfig as Record<string, unknown>;
      const scalar = (k: string): string | undefined =>
        typeof ac[k] === "string" && ac[k] ? (ac[k] as string) : undefined;
      const dashboardDataSourceId = scalar("SPACES_DATA_SOURCE_ID");
      const dashboardDraftId = scalar("SPACES_DASHBOARD_DRAFT_ID");
      const dashboardFocusedComponentId = scalar("SPACES_FOCUSED_COMPONENT_ID");
      if (dashboardDataSourceId || dashboardDraftId || dashboardFocusedComponentId) {
        storeRunScalars(sessionId, {
          ...(dashboardDataSourceId ? { dataSourceId: dashboardDataSourceId } : {}),
          ...(dashboardDraftId ? { draftId: dashboardDraftId } : {}),
          ...(dashboardFocusedComponentId ? { focusedComponentId: dashboardFocusedComponentId } : {}),
        }).catch(() => {});
      }
    }

    // Pipeline-mode trust gate (see forwardBody below). Honor a requested pipeline
    // mode ONLY when the agent's own stored config opted in — never from req.body
    // alone, so a caller with the S2S key can't force a mode the agent never
    // enabled. 'auto'/absent are pass-through (today's behavior).
    const requestedMode = (body as { mode?: "plan" | "auto" | "daily_brief" }).mode;
    const agentModeCfg = agent.agentConfig as Record<string, unknown> | undefined;
    const agentPlanModeOptIn = agentModeCfg?.["planMode"] === true;
    // Daily-brief is honored when EITHER the agent explicitly opted in
    // (config.dailyBriefMode — the dedicated-agent case) OR this agent is the org's
    // configured brief agent (Organization.dailyBriefAgentSlug, set at runtime via
    // the settings API; default "ask-ai"). The brief pipeline is read-only +
    // terminal emit_brief, so honoring it for the configured agent is safe and lets
    // the brief run on a shared agent without a dedicated seed.
    let agentDailyBriefOptIn = agentModeCfg?.["dailyBriefMode"] === true;
    if (!agentDailyBriefOptIn && requestedMode === "daily_brief") {
      // Lazy (only when a brief run is actually requested): the configured brief
      // agent is per-org (Organization.dailyBriefAgentSlug), falling back to the
      // deployment default — resolved by the single source of truth in dailyBrief.ts.
      agentDailyBriefOptIn = agentSlug === (await resolveBriefAgentSlug(agent.orgId));
    }
    const effectiveMode: "plan" | "auto" | "daily_brief" | undefined =
      requestedMode === "plan"
        ? agentPlanModeOptIn
          ? "plan"
          : "auto"
        : requestedMode === "daily_brief"
          ? agentDailyBriefOptIn
            ? "daily_brief"
            : "auto"
          : requestedMode;

    // Shared request body for both transports. SSE consumers (run-stream.ts)
    // pass progressUrl/callbackUrl too — claw ignores them in SSE mode since
    // the response stream IS the channel.
    // Caller-supplied skills, merged with the agent's attached ones.
    //
    // S2S ONLY. A skill's content becomes agent instructions, so accepting one
    // from a browser session would let any user rewrite what their agent is
    // told to do for that run. Trusted internal callers (the awakening
    // dispatcher, which inlines its operating contract rather than depending
    // on a per-org seeded row) are the only ones allowed to add them.
    const callerSkills =
      input.isInternalS2SCaller && Array.isArray(bodySkills)
        ? bodySkills.filter(
            (sk): sk is { slug?: string; name: string; description?: string; content: string } =>
              !!sk && typeof sk.name === "string" && typeof sk.content === "string",
          )
        : [];
    const agentSkills = agent.skills ?? [];
    // Agent-attached skills win a slug collision — an org's own skill must not
    // be silently shadowed by a caller-supplied one.
    const takenSlugs = new Set(agentSkills.map((sk) => sk.slug ?? sk.name));
    const mergedSkills = [
      ...agentSkills,
      ...callerSkills.map((sk) => ({
        slug: sk.slug ?? sk.name,
        name: sk.name,
        description: sk.description ?? "",
        content: sk.content,
      })).filter((sk) => !takenSlugs.has(sk.slug)),
    ];

    const forwardBody = {
      sessionId,
      idempotencyKey,
      sessionToken,
      userId: resolved.userId,
      userName: resolved.userName,
      userEmail: resolved.userEmail,
      task: task.trim(),
      context: mergedContext,
      conversationId,
      ...(piSessionConversationId ? { piSessionConversationId } : {}),
      ...(effectiveCallbackUrl ? { callbackUrl: effectiveCallbackUrl } : {}),
      ...(effectivePrompt ? { systemPrompt: effectivePrompt } : {}),
      ...(agent.modelId ? { modelId: agent.modelId } : {}),
      agentConfig: mergedAgentConfig,
      agentSlug,
      channelId: effectiveChannelId,
      ...(projectId ? { projectId } : {}),
      ...(projectName ? { projectName } : {}),
      ...(eventType ? { eventType } : {}),
      ...(traceId ? { traceId } : {}),
      ...(effectiveProvider ? { provider: effectiveProvider } : {}),
      ...(effectiveProviderOrder?.length ? { providerOrder: effectiveProviderOrder } : {}),
      ...(subagentProviders ? { subagentProviders } : {}),
      subagentProviderMode: subagentProviderMode ?? resolveSubagentProviderMode(mergedAgentConfig),
      ...(effectiveProviderConfigs && Object.keys(effectiveProviderConfigs).length > 0
        ? { providerConfigs: effectiveProviderConfigs }
        : {}),
      ...(cwd ? { cwd } : {}),
      ...(mergedSkills.length > 0 ? { skills: mergedSkills } : {}),
      ...(awakeningBlock ? { awakening: awakeningBlock } : {}),
      ...(progressUrl ? { progressUrl } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(normalizedRecordingRefs.length ? { recordingRefs: normalizedRecordingRefs } : {}),
      ...(mergedContextFiles.length > 0 ? { contextFiles: mergedContextFiles } : {}),
      ...(attachedContext?.length ? { attachedContext } : {}),
      ...(ticketIds?.length ? { ticketIds } : {}),
      ...(canvasIds?.length ? { canvasIds } : {}),
      ...(callIds?.length ? { callIds } : {}),
      ...((body as { researchContext?: unknown }).researchContext
        ? { researchContext: (body as { researchContext?: unknown }).researchContext }
        : {}),
      ...(additionalInstructions ? { additionalInstructions } : {}),
      ...(customSubagents.length > 0 ? { customSubagents } : {}),
      ...(callableAgentsWithSession.length > 0 ? { callableAgents: callableAgentsWithSession } : {}),
      ...(agent.delegationTier === "orchestrator" ? { delegationMode: "orchestrator" } : {}),
      ...(isRegenerate ? { isRegenerate: true } : {}),
      ...(detached === true ? { detached: true } : {}),
      fastMode: effectiveFastMode,
      ...(resumedFromHandoff === true ? { resumedFromHandoff: true } : {}),
      // Plan/auto mode gate. This forwardBody is an explicit allowlist, so these
      // MUST be threaded here or claw never sees them and plan mode is inert.
      // 'plan' is set by the webhook mention dispatch (planMode agents, non-twin);
      // planContinuation marks the auto-mode Turn 2 after a plan is approved.
      // SECURITY: this proxy is the trust boundary. Only HONOR mode='plan' when the
      // AGENT actually opted in (agent.agentConfig.planMode), so a caller with the
      // S2S key can't force plan mode on an agent that never enabled it. 'auto' and
      // absent are pass-through (both mean today's behavior).
      ...(effectiveMode ? { mode: effectiveMode } : {}),
      ...((body as { planContinuation?: boolean }).planContinuation === true
        ? { planContinuation: true }
        : {}),
      ...(generateFollowUpSuggestions === true ? { generateFollowUpSuggestions: true } : {}),
      // /experiment epoch context (id/epoch/deadlineAt/focus) — set only by
      // dispatchExperimentEpoch (lib/experiment.ts) via this same S2S proxy.
      // Must be threaded through the allowlist or the runtime never injects the
      // experiment tools and the mode is silently inert.
      ...(isExperimentContext((body as { experiment?: unknown }).experiment)
        ? { experiment: (body as { experiment?: unknown }).experiment }
        : {}),
    };
    return {
      ok: true,
      prepared: {
        sessionId,
        sessionToken,
        forwardBody: forwardBody as unknown as Record<string, unknown>,
        body,
        detached: detached === true,
        acceptHeader,
        progressUrl,
        callbackUrl,
        effectiveCallbackUrl,
        conversationId,
        agentSlug,
        eventType,
        task: task.trim(),
        userId: resolved.userId,
        orgId: agent.orgId,
        effectiveFastMode,
        defaultTriggerSource,
        effectiveChannelId,
        projectId,
        projectName,
        externalResultCallback,
        sdlcAgentRunContext,
      },
    };
  }
}

export async function startRun(input: StartRunInput, caller: RunCaller): Promise<StartRunResult> {
  try {
    const preparation = await prepareRun(input, caller);
    if (!preparation.ok) return preparation;
    const prepared = preparation.prepared;

    const dispatched = await dispatchRun(prepared.forwardBody, {
      onEnqueued: async () => {
        if (prepared.detached) await persistDetachedRunStart(prepared);
        else await persistRunStart(prepared);
      },
    });

    if (!dispatched.success || !dispatched.sessionId) {
      return {
        ok: false,
        status: dispatched.status,
        error: dispatched.error ?? "Failed to reach agent service",
      };
    }
    return {
      ok: true,
      sessionId: dispatched.sessionId,
      ...(dispatched.queued ? { queued: true } : {}),
      ...(typeof dispatched.queuePosition === "number" ? { queuePosition: dispatched.queuePosition } : {}),
    };
  } catch (err) {
    log.error("[run] Error forwarding to xyne-claw:", err);
    return { ok: false, status: 502, error: "Failed to reach agent service" };
  }
}
