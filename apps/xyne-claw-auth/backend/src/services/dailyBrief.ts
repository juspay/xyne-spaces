/**
 * Daily Brief generation — the shared core used by BOTH the scheduled cron worker
 * (queue/daily-brief-worker.ts) and the interactive regenerate route
 * (routes/daily-brief.ts).
 *
 * It drives a `mode: "daily_brief"` run through claw-auth's OWN /internal/run
 * proxy over SSE. That proxy assembles the forwardBody (systemPrompt, agentConfig,
 * the daily_brief trust gate, and the per-user custom-instructions injection),
 * forwards to the claw engine, and pipes the engine's frames back verbatim — so we
 * get all of that for free here. The engine runs the daily-brief pipeline (read-only
 * palette + subagents + terminal emit_brief) and ships the structured brief on the
 * terminal `done` frame as `dailyBrief`.
 *
 * Because we AWAIT the SSE stream to completion, a run holds its worker slot (and,
 * in the cron path, its cluster-global Redis slot — see lib/daily-brief-slot.ts)
 * for the whole run. That global slot is what actually bounds concurrent brief LLM
 * runs across ALL replicas, which is what stops a mass fan-out from rate-limiting
 * the provider (per-worker BullMQ concurrency alone would be per-pod).
 */

import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";
import { buildThreadCitationMeta } from "../lib/citations.js";
import { formatDayIST } from "../lib/ist-time.js";
import {
  agentRunRepository,
  chatMessageRepository,
  generatedContentRepository,
  userAgentInstructionRepository,
  DAILY_BRIEF_KIND,
} from "../repositories/index.js";
import {
  recordDailyBriefGenerated,
  recordScheduledDeliveryDelay,
  type DailyBriefTrigger,
} from "../otel/daily-brief-metrics.js";

const log = createLogger("daily-brief");

/**
 * Fixed logical slug for the brief's per-user config + instructions. Independent
 * of WHICH agent executes the brief (that is CONFIG.dailyBriefAgentSlug, default
 * "ask-ai") — so changing the executing agent globally never moves user config,
 * and the brief's instructions never leak into normal chats with the executing
 * agent (they are passed explicitly into the run, not via the generic per-agent
 * injection which is skipped for daily_brief runs).
 */
export const DAILY_BRIEF_SLUG = "daily-brief";
const BRIEF_TASK = "Generate my daily brief for today.";

/**
 * Resolve which agent EXECUTES the brief for an org: the org's configured override
 * (Organization.dailyBriefAgentSlug, set via the settings API) if present, else the
 * deployment default (CONFIG.dailyBriefAgentSlug / env, default "ask-ai"). Single
 * source of truth shared by the generator (which agent to dispatch) and the run.ts
 * trust gate (which agent may run in daily_brief mode). Best-effort: any lookup
 * failure falls back to the deployment default.
 */
export async function resolveBriefAgentSlug(orgId: string): Promise<string> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { dailyBriefAgentSlug: true },
    });
    const slug = org?.dailyBriefAgentSlug?.trim();
    if (slug) return slug;
  } catch {
    // fall through to the deployment default
  }
  return CONFIG.dailyBriefAgentSlug;
}

// ── Brief payload shape (mirrors xyne-claw/src/daily-brief.ts DailyBriefPayload) ──
// Each section is an array of editorial prose lines (markdown + inline [clf-…#…]
// citation tokens). snake_case keys match the emit_brief wire + stored contract.
export interface DailyBriefPayload {
  generated_for: string;
  date: string;
  what_needs_you: string[];
  overdue: string[];
  waiting_on_others: string[];
  assigned_to_you: string[];
  todays_schedule: string[];
}

/** The date bucket ("YYYY-MM-DD" IST) a brief belongs to for a given instant. */
export function briefDateBucket(instant: Date = new Date()): string {
  return formatDayIST(instant);
}

/**
 * Render the prose brief to markdown for direct display / storage. Each section's
 * lines are emitted as their own paragraphs (they already carry the agent's
 * markdown + citation tokens), so this just adds the section headers.
 */
export function renderBriefMarkdown(b: DailyBriefPayload): string {
  const out: string[] = [`# Brief // ${b.date}`];
  const section = (heading: string, body: string[]) => {
    if (!body.length) return;
    out.push("", `## ${heading}`, "", body.join("\n\n"));
  };
  section("What needs you", b.what_needs_you);
  section("Overdue", b.overdue);
  section("Waiting on others", b.waiting_on_others);
  section("Assigned to you", b.assigned_to_you);
  section("Today's schedule", b.todays_schedule);
  return out.join("\n").trim();
}

export interface GenerateBriefResult {
  brief: DailyBriefPayload;
  content: string;
  sessionId: string | undefined;
}

/**
 * Run the daily-brief pipeline for one user, persist the result to
 * GeneratedContent (kind=DAILY_BRIEF), and return it. AWAITS the run to completion.
 *
 * @param onProgress optional coarse progress callback (used by the SSE regenerate
 *   route to stream "generating…" labels to the dashboard).
 * @param trigger which path asked for this brief — only labels the OTel counter.
 */
export async function generateDailyBrief(
  userId: string,
  opts: {
    onProgress?: (label: string) => void;
    signal?: AbortSignal;
    trigger?: DailyBriefTrigger;
    attempt?: number;
  } = {},
): Promise<GenerateBriefResult | null> {
  const trigger = opts.trigger ?? "scheduled";
  const attempt = opts.attempt ?? 1;
  const startedAt = Date.now();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, name: true, email: true },
  });
  if (!user) {
    log.warn(`[daily-brief] user ${userId} not found — skipping`);
    return null;
  }
  const orgId = user.orgId;
  const dateBucket = briefDateBucket();
  // The agent that EXECUTES the brief — per-org override, else deployment default.
  const agentSlug = await resolveBriefAgentSlug(orgId);
  // conversationId is unique per run so each brief is a FRESH gather (no resume of
  // a prior brief's context). NOT prefixed "scheduled_" — the engine's isDailyBrief
  // gate already enforces read-only, we don't want the scheduled-run routing.
  const conversationId = `daily_brief_${userId}_${Date.now()}`;

  // Per-user brief instructions live under the fixed logical slug (NOT the
  // executing agent's slug) and are passed EXPLICITLY into the run — claw-auth
  // skips the generic per-agent injection for daily_brief runs so nothing leaks
  // between the brief and normal chats on the shared executing agent.
  const briefInstructions = await userAgentInstructionRepository
    .getEnabledText(userId, orgId, DAILY_BRIEF_SLUG)
    .catch(() => "");

  await generatedContentRepository.markGenerating({
    userId,
    orgId,
    kind: DAILY_BRIEF_KIND,
    dateBucket,
    agentSlug,
  });

  let sessionId: string | undefined;

  // The brief conversation has to read back as an ordinary chat session in
  // /v3/chat, which projects ONE path down the message tree: an assistant row is
  // only on that path when its parentId points at the user row. persistRunStart
  // would create the user message for us but does not hand back its id, so make
  // it here (and tell the run to skip its own) to keep the two linked.
  let userMessageId: string | null = null;
  try {
    const userMsg = await chatMessageRepository.create({
      conversationId,
      agentSlug,
      userId,
      role: "user",
      content: BRIEF_TASK,
      status: "completed",
      orgId,
    });
    userMessageId = userMsg.id;
  } catch (msgErr) {
    log.warn(`[daily-brief] failed to persist user message for ${userId}: ${errMsg(msgErr)}`);
  }

  /**
   * Close the chat turn the same way an interactive run does.
   *
   * Nothing else does this on the brief path: generateDailyBrief consumes the
   * SSE stream itself rather than registering a callbackUrl, so the /callback
   * machinery that normally writes the assistant row and finalizes the AgentRun
   * never fires. Without this the conversation holds only the user message and
   * the run sits at "running" forever.
   */
  const closeBriefTurn = async (
    status: "completed" | "failed",
    content: string,
    toolInvocations?: unknown,
  ): Promise<void> => {
    let assistantMessageId: string | undefined;
    try {
      const assistantMsg = await chatMessageRepository.create({
        conversationId,
        agentSlug,
        userId,
        role: "assistant",
        content,
        status,
        orgId,
        parentId: userMessageId,
      });
      assistantMessageId = assistantMsg.id;
    } catch (msgErr) {
      log.warn(`[daily-brief] failed to persist assistant message for ${userId}: ${errMsg(msgErr)}`);
    }
    if (!sessionId) return;
    try {
      await agentRunRepository.finalize(sessionId, {
        status,
        ...(status === "completed" ? { result: content } : { error: content }),
        ...(toolInvocations !== undefined ? { toolInvocations } : {}),
        ...(assistantMessageId ? { chatMessageId: assistantMessageId } : {}),
      });
    } catch (runErr) {
      log.warn(`[daily-brief] failed to finalize run ${sessionId}: ${errMsg(runErr)}`);
    }
  };

  try {
    const streamResult = await consumeClawStream({
      url: `${CONFIG.internalUrl}/claw/api/v1/internal/run`,
      s2sKey: CONFIG.xyneClawS2sKey,
      // /internal/run resolves identity from x-user-id (pinned for S2S callers).
      extraHeaders: { "x-user-id": userId },
      ...(opts.signal ? { signal: opts.signal } : {}),
      body: {
        task: BRIEF_TASK,
        agentSlug,
        mode: "daily_brief",
        eventType: "daily_brief",
        conversationId,
        // We already wrote the user row above, parented correctly.
        __skipUserMessagePersist: true,
        ...(briefInstructions ? { additionalInstructions: briefInstructions } : {}),
      },
      handlers: {
        onStarted: (sid) => {
          sessionId = sid;
          opts.onProgress?.("Gathering your day…");
        },
        onInvocation: (_sid, inv) => {
          const name = (inv as { toolName?: string; name?: string })?.toolName
            ?? (inv as { name?: string })?.name;
          if (name) opts.onProgress?.(`Checking ${String(name).replace(/^xyne-spaces__|^spaces-/, "")}…`);
        },
        onProgressLabel: (_sid, payload) => {
          const label = (payload as { label?: string })?.label;
          if (label) opts.onProgress?.(label);
        },
      },
    });

    // The terminal `done` payload carries the structured brief as `dailyBrief`
    // (see xyne-claw run.ts). ClawDoneStatus doesn't type our new field, so read
    // it off loosely.
    const done = streamResult.result as unknown as
      | { dailyBrief?: DailyBriefPayload; toolInvocations?: unknown }
      | undefined;
    const brief = done?.dailyBrief;
    if (!brief) {
      log.warn(
        `[daily-brief] run for ${userId} finished without a dailyBrief payload (lastEvent=${streamResult.lastEventName}, error=${streamResult.errorReason ?? "none"})`,
      );
      await generatedContentRepository.markFailed(userId, DAILY_BRIEF_KIND, dateBucket);
      await closeBriefTurn(
        "failed",
        "The brief run finished without producing a brief. Please try regenerating it.",
        done?.toolInvocations,
      );
      recordDailyBriefGenerated(trigger, "failed", Date.now() - startedAt, attempt);
      return null;
    }

    const content = renderBriefMarkdown(brief);
    const citationMeta = buildThreadCitationMeta(done?.toolInvocations, content);
    const generatedAt = new Date();
    await generatedContentRepository.saveReady({
      userId,
      orgId,
      kind: DAILY_BRIEF_KIND,
      dateBucket,
      agentSlug,
      content,
      data: {
        ...brief,
        ...(citationMeta ?? {}),
      } as unknown as import("@prisma/client").Prisma.InputJsonValue,
      sessionId: sessionId ?? null,
      generatedAt,
    });
    await closeBriefTurn("completed", content, done?.toolInvocations);
    log.info(`[daily-brief] generated + persisted for ${userId} (session=${sessionId ?? "?"})`);
    recordDailyBriefGenerated(trigger, "ready", Date.now() - startedAt, attempt);
    if (trigger === "scheduled") recordScheduledDeliveryDelay(dateBucket, generatedAt);
    return { brief, content, sessionId };
  } catch (err) {
    log.error(`[daily-brief] generation failed for ${userId}:`, errMsg(err));
    await generatedContentRepository.markFailed(userId, DAILY_BRIEF_KIND, dateBucket).catch(() => {});
    await closeBriefTurn("failed", `The brief could not be generated: ${errMsg(err)}`).catch(() => {});
    recordDailyBriefGenerated(trigger, "failed", Date.now() - startedAt, attempt);
    return null;
  }
}
