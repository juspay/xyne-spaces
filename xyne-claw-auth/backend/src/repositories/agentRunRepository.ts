import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export interface StartRunInput {
  sessionId: string;
  userId: string;
  agentSlug: string;
  triggerSource: "spaces" | "scheduled" | "chat" | "api";
  task: string;
  conversationId?: string | null;
  scheduledJobId?: string | null;
  channelId?: string | null;
}

export interface FinalizeRunInput {
  status: "completed" | "failed" | "cancelled";
  result?: string | null;
  error?: string | null;
  toolsUsed?: string[];
  toolInvocations?: unknown;    // Prisma JSON — array of tool call details
  tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

export const agentRunRepository = {
  start: (input: StartRunInput) =>
    prisma.agentRun.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        agentSlug: input.agentSlug,
        triggerSource: input.triggerSource,
        task: input.task,
        status: "running",
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.scheduledJobId ? { scheduledJobId: input.scheduledJobId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
      },
    }),

  updateProgress: (sessionId: string, currentToolLabel: string) =>
    prisma.agentRun.updateMany({
      where: { sessionId },
      data: { currentToolLabel },
    }),

  finalize: async (sessionId: string, input: FinalizeRunInput) => {
    // Merge toolInvocations instead of overwriting: the live-streamed array
    // (built via appendToolInvocation on every progress event) includes
    // nested subagent children. The callback's input.toolInvocations contains
    // only the parent agent's own calls. A naive overwrite would drop all
    // child rows on completion, making a just-reloaded chat look different
    // from what the user saw while streaming.
    let finalInvocations: unknown[] | undefined;
    // Always merge once the run is finalizing, even if the callback didn't
    // include its own toolInvocations — we still need to sweep stale
    // "running" placeholders (see below).
    const existingRow = await prisma.agentRun.findUnique({
      where: { sessionId },
      select: { toolInvocations: true },
    });
    const existing = Array.isArray(existingRow?.toolInvocations)
      ? (existingRow!.toolInvocations as Array<Record<string, unknown>>)
      : [];
    const incoming = Array.isArray(input.toolInvocations)
      ? (input.toolInvocations as Array<Record<string, unknown>>)
      : [];
    // Dedupe union keyed by toolCallId (falls back to name+startedAt when the
    // provider didn't include a toolCallId). Preserve insertion order from the
    // existing (streamed) list — that's the temporal order the user saw.
    const keyFor = (inv: Record<string, unknown>): string =>
      String(inv["toolCallId"] ?? `${inv["toolName"] ?? ""}-${inv["startedAt"] ?? ""}`);
    const seen = new Set<string>();
    const merged: Array<Record<string, unknown>> = [];
    for (const inv of existing) {
      const k = keyFor(inv);
      if (!seen.has(k)) { seen.add(k); merged.push(inv); }
    }
    for (const inv of incoming) {
      const k = keyFor(inv);
      if (!seen.has(k)) { seen.add(k); merged.push(inv); }
    }
    // Sweep stale "running" placeholders: by the time finalize fires the run
    // is terminal, so nothing can still be in flight. A lingering "running"
    // row is proof of a dropped tool_execution_end push (network blip, proc
    // restart). Mark it completed with an explanatory result so the UI stops
    // showing a spinner and the child counts ("N done · M running") are honest.
    if (merged.length > 0) {
      for (const inv of merged) {
        if (inv["status"] === "running") {
          inv["status"] = "completed";
          if (!inv["result"]) inv["result"] = "(no result — tool end event was not received)";
        }
      }
      finalInvocations = merged;
    } else if (input.toolInvocations !== undefined) {
      finalInvocations = merged;
    }

    return prisma.agentRun.updateMany({
      where: { sessionId },
      data: {
        status: input.status,
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
        ...(input.toolsUsed ? { toolsUsed: input.toolsUsed } : {}),
        ...(finalInvocations !== undefined ? { toolInvocations: finalInvocations as Prisma.InputJsonValue } : {}),
        ...(input.tokenUsage ? {
          tokensIn: input.tokenUsage.input ?? null,
          tokensOut: input.tokenUsage.output ?? null,
          tokensCacheRead: input.tokenUsage.cacheRead ?? null,
          tokensCacheWrite: input.tokenUsage.cacheWrite ?? null,
        } : {}),
        completedAt: new Date(),
        currentToolLabel: null,
      },
    });
  },

  rate: (sessionId: string, userId: string, rating: "up" | "down", comment?: string | null) =>
    prisma.agentRun.updateMany({
      where: { sessionId, userId },
      data: { rating, ratingComment: comment ?? null, ratedAt: new Date() },
    }),

  appendToolInvocation: async (sessionId: string, invocation: unknown) => {
    // Read-modify-write with merge-by-toolCallId semantics:
    //   - A "running" placeholder is pushed on tool_execution_start
    //   - A "completed" row is pushed on tool_execution_end with the SAME toolCallId
    // We replace the placeholder in place so the JSON column mirrors the live
    // frontend state (single row per tool call, not duplicated).
    const run = await prisma.agentRun.findUnique({ where: { sessionId }, select: { toolInvocations: true } });
    const existing = Array.isArray(run?.toolInvocations) ? (run!.toolInvocations as Array<Record<string, unknown>>) : [];
    const inv = invocation as Record<string, unknown>;
    const incomingId = inv["toolCallId"];
    let next: unknown[];
    if (incomingId && existing.some((p) => p["toolCallId"] === incomingId)) {
      next = existing.map((p) => p["toolCallId"] === incomingId ? inv : p);
    } else {
      next = [...existing, inv];
    }
    await prisma.agentRun.update({
      where: { sessionId },
      data: { toolInvocations: next as Prisma.InputJsonValue },
    });
  },

  listByUser: (userId: string, opts?: { status?: string; limit?: number; conversationId?: string; agentSlug?: string }) =>
    prisma.agentRun.findMany({
      where: {
        userId,
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
        ...(opts?.agentSlug ? { agentSlug: opts.agentSlug } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: opts?.limit ?? 50,
    }),

  findBySessionId: (sessionId: string) =>
    prisma.agentRun.findUnique({ where: { sessionId } }),

  /**
   * Aggregate rating stats per agent within a window. Null cutoff = all time.
   * Returns totalRuns, ratedCount, upCount, downCount per agentSlug, sorted by downCount DESC.
   */
  ratingStatsByAgent: async (cutoff: Date | null) => {
    const where = cutoff ? { startedAt: { gte: cutoff } } : {};
    const rows = await prisma.agentRun.groupBy({
      by: ["agentSlug", "rating"],
      where,
      _count: { _all: true },
    });
    const map = new Map<string, { agentSlug: string; totalRuns: number; upCount: number; downCount: number; ratedCount: number }>();
    for (const r of rows) {
      const entry = map.get(r.agentSlug) ?? { agentSlug: r.agentSlug, totalRuns: 0, upCount: 0, downCount: 0, ratedCount: 0 };
      entry.totalRuns += r._count._all;
      if (r.rating === "up") { entry.upCount += r._count._all; entry.ratedCount += r._count._all; }
      if (r.rating === "down") { entry.downCount += r._count._all; entry.ratedCount += r._count._all; }
      map.set(r.agentSlug, entry);
    }
    return [...map.values()]
      .map((e) => ({ ...e, negativeRate: e.ratedCount > 0 ? e.downCount / e.ratedCount : 0 }))
      .sort((a, b) => b.downCount - a.downCount || b.ratedCount - a.ratedCount);
  },

  /** Most recent thumbs-down runs with user email joined. */
  recentDownRuns: async (cutoff: Date | null, limit: number) => {
    const rows = await prisma.agentRun.findMany({
      where: {
        rating: "down",
        ...(cutoff ? { ratedAt: { gte: cutoff } } : {}),
      },
      orderBy: { ratedAt: "desc" },
      take: limit,
      select: {
        sessionId: true,
        agentSlug: true,
        userId: true,
        task: true,
        ratingComment: true,
        ratedAt: true,
        conversationId: true,
      },
    });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : [];
    const emailById = new Map(users.map((u) => [u.id, u.email] as const));
    return rows.map((r) => ({
      sessionId: r.sessionId,
      agentSlug: r.agentSlug,
      userId: r.userId,
      userEmail: emailById.get(r.userId) ?? null,
      task: r.task.length > 200 ? r.task.slice(0, 200) + "…" : r.task,
      ratingComment: r.ratingComment,
      ratedAt: r.ratedAt,
      conversationId: r.conversationId,
    }));
  },
};
