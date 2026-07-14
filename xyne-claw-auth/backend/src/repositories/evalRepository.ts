import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/** One turn of a conversation: the user input + the ground-truth answer. */
export interface EvalTurnInput {
  message: string;
  expectedResponse?: string | null;
}

/** A conversation being imported into a folder. */
export interface ImportConversationInput {
  title?: string | null;
  turns: EvalTurnInput[];
  source?: string | null;
  externalId?: string | null;
  externalUpdatedAt?: Date | null;
  lastMessageId?: string | null;
}

/** Result the browser writes back after each replayed turn. */
export interface UpsertTurnResultInput {
  runId: string;
  conversationId: string;
  turnIndex: number;
  inputMessage: string;
  expectedResponse?: string | null | undefined;
  clawAnswer?: string | null | undefined;
  reasoning?: string | null | undefined;
  toolInvocations?: unknown;
  status?: "running" | "completed" | "failed" | undefined;
  clawConversationId?: string | null | undefined;
  sessionId?: string | null | undefined;
}

/** First user message, trimmed to a readable title length. */
function deriveTitle(turns: EvalTurnInput[]): string | null {
  const first = turns[0]?.message?.trim();
  if (!first) return null;
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

/** Rubric of the seeded "Semantic Match" default judge. Kept in sync with
 *  xyne-claw's DEFAULT_JUDGE_PROMPT (eval-judge.ts), which is the fallback when
 *  a judge call arrives with no prompt. */
const DEFAULT_JUDGE_PROMPT = `You are grading how well a GENERATED answer semantically matches an EXPECTED (ground-truth) answer.

Score 0-100 based on meaning, not wording:
- 90-100: same meaning and intent; any differences are purely stylistic.
- 70-89: mostly correct; minor information missing or slightly different emphasis.
- 40-69: partially correct; misses or misstates important parts.
- 1-39: largely wrong, off-topic, or contradicts the expected answer.
- 0: empty, refuses, or completely unrelated.

Reward correct meaning even if phrasing, length, or formatting differ. Do not reward fluent text that fails to convey the expected content. Persona/identity differences (a different assistant name) should NOT lower the score unless the expected answer was specifically about identity.`;

export const evalRepository = {
  // ── Folders ───────────────────────────────────────────────────────────
  createFolder: (input: { name: string; createdBy?: string | null }) =>
    prisma.evalFolder.create({
      data: {
        name: input.name,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      },
    }),

  /** All folders with per-folder conversation counts (for the explorer). */
  listFolders: () =>
    prisma.evalFolder.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { conversations: true } } },
    }),

  getFolder: (id: string) => prisma.evalFolder.findUnique({ where: { id } }),

  deleteFolder: (id: string) => prisma.evalFolder.delete({ where: { id } }),

  // ── Conversations ─────────────────────────────────────────────────────
  /** Bulk-insert conversations into a folder. */
  importConversations: async (
    folderId: string,
    conversations: ImportConversationInput[],
    createdBy?: string | null,
  ) => {
    const data = conversations.map((c, i) => ({
      folderId,
      // Title is auto-derived: caller rarely supplies one — fall back to the
      // first user message (trimmed) so the list is readable, else an index.
      title: c.title?.trim() || deriveTitle(c.turns) || `Conversation ${i + 1}`,
      turns: c.turns as unknown as Prisma.InputJsonValue,
      ...(c.source ? { source: c.source } : {}),
      ...(c.externalId ? { externalId: c.externalId } : {}),
      ...(c.externalUpdatedAt ? { externalUpdatedAt: c.externalUpdatedAt } : {}),
      ...(c.lastMessageId ? { lastMessageId: c.lastMessageId } : {}),
      ...(createdBy ? { createdBy } : {}),
    }));
    return prisma.evalConversation.createMany({ data });
  },

  /** Find the folder bound to a Spaces channel (stable across renames), or
   *  create it. This is what makes each fetched channel own one folder. */
  findOrCreateChannelFolder: async (input: {
    channelId: string;
    name: string;
    sourceKind: string;
    createdBy?: string | null;
  }) => {
    const existing = await prisma.evalFolder.findFirst({
      where: { sourceChannelId: input.channelId },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return existing;
    return prisma.evalFolder.create({
      data: {
        name: input.name,
        source: "spaces",
        sourceKind: input.sourceKind,
        sourceChannelId: input.channelId,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      },
    });
  },

  /** Incremental-sync state for every already-imported conversation in a folder,
   *  keyed by upstream externalId. Lets a re-import skip unchanged conversations
   *  and tail-append changed ones without touching prior turns. */
  getImportedConvMeta: async (
    folderId: string,
  ): Promise<Map<string, { id: string; externalUpdatedAt: Date | null; lastMessageId: string | null }>> => {
    const rows = await prisma.evalConversation.findMany({
      where: { folderId, externalId: { not: null } },
      select: { id: true, externalId: true, externalUpdatedAt: true, lastMessageId: true },
    });
    const m = new Map<string, { id: string; externalUpdatedAt: Date | null; lastMessageId: string | null }>();
    for (const r of rows) {
      if (r.externalId) m.set(r.externalId, { id: r.id, externalUpdatedAt: r.externalUpdatedAt, lastMessageId: r.lastMessageId });
    }
    return m;
  },

  /** Append newly-extracted turns to an existing conversation and advance its
   *  watermark. Existing turns are preserved verbatim — never re-extracted. */
  appendConversationTurns: async (
    id: string,
    addTurns: EvalTurnInput[],
    watermark: { lastMessageId: string; externalUpdatedAt?: Date | null },
  ) => {
    const conv = await prisma.evalConversation.findUnique({ where: { id }, select: { turns: true } });
    const existing = (conv?.turns as unknown as EvalTurnInput[]) ?? [];
    return prisma.evalConversation.update({
      where: { id },
      data: {
        turns: [...existing, ...addTurns] as unknown as Prisma.InputJsonValue,
        lastMessageId: watermark.lastMessageId,
        ...(watermark.externalUpdatedAt ? { externalUpdatedAt: watermark.externalUpdatedAt } : {}),
      },
    });
  },

  /** Advance only the watermark/timestamp (no new turns) — e.g. when an upstream
   *  activity bump was a reaction/edit, not a new reply. */
  touchConversationWatermark: (id: string, input: { lastMessageId?: string | null; externalUpdatedAt?: Date | null }) =>
    prisma.evalConversation.update({
      where: { id },
      data: {
        ...(input.lastMessageId ? { lastMessageId: input.lastMessageId } : {}),
        ...(input.externalUpdatedAt ? { externalUpdatedAt: input.externalUpdatedAt } : {}),
      },
    }),

  /** Paginated conversation list for a folder (id/title/meta only — no turns). */
  listConversations: async (folderId: string, opts?: { skip?: number; take?: number; search?: string | undefined }) => {
    const where: Prisma.EvalConversationWhereInput = {
      folderId,
      ...(opts?.search
        ? { title: { contains: opts.search, mode: "insensitive" as const } }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.evalConversation.count({ where }),
      prisma.evalConversation.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: opts?.skip ?? 0,
        take: opts?.take ?? 100,
        select: { id: true, folderId: true, title: true, source: true, createdAt: true },
      }),
    ]);
    return { total, items };
  },

  /** Existing externalIds in a folder — used to dedup re-imports. */
  listExternalIds: async (folderId: string): Promise<Set<string>> => {
    const rows = await prisma.evalConversation.findMany({
      where: { folderId, externalId: { not: null } },
      select: { externalId: true },
    });
    return new Set(rows.map((r) => r.externalId).filter((x): x is string => !!x));
  },

  /** All conversation ids in a folder (for whole-folder batch runs). */
  listConversationIds: async (folderId: string) => {
    const rows = await prisma.evalConversation.findMany({
      where: { folderId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },

  /** Full conversation with turns (detail view). */
  getConversation: (id: string) => prisma.evalConversation.findUnique({ where: { id } }),

  /** Hydrate a set of conversations with their turns (run engine needs these). */
  getConversationsByIds: (ids: string[]) =>
    prisma.evalConversation.findMany({ where: { id: { in: ids } } }),

  deleteConversation: (id: string) => prisma.evalConversation.delete({ where: { id } }),

  // ── Runs ──────────────────────────────────────────────────────────────
  createRun: (input: {
    agentSlug: string;
    conversationIds: string[];
    folderId?: string | null;
    createdBy?: string | null;
    genProvider?: string | null;
    genModel?: string | null;
    orgId: string;
    /** Set when this run is one agent of a multi-agent comparison (see model). */
    comparisonId?: string | null;
    /** 0-based agent order within the comparison (stable primary baseline). */
    comparisonSeq?: number | null;
  }) =>
    prisma.evalGeneration.create({
      data: {
        agentSlug: input.agentSlug,
        conversationIds: input.conversationIds,
        status: "running",
        orgId: input.orgId,
        ...(input.folderId ? { folderId: input.folderId } : {}),
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
        ...(input.genProvider ? { genProvider: input.genProvider } : {}),
        ...(input.genModel ? { genModel: input.genModel } : {}),
        ...(input.comparisonId ? { comparisonId: input.comparisonId } : {}),
        ...(input.comparisonSeq != null ? { comparisonSeq: input.comparisonSeq } : {}),
      },
    }),

  /** Create every sibling run of a comparison atomically (all rows or none) so a
   *  mid-loop failure can't orphan half a comparison. Rows come back in the input
   *  order; each is stamped with its comparisonSeq. */
  createComparisonRuns: (
    inputs: Array<{
      agentSlug: string;
      conversationIds: string[];
      folderId?: string | null;
      createdBy?: string | null;
      genProvider?: string | null;
      genModel?: string | null;
      orgId: string;
      comparisonId: string;
      comparisonSeq: number;
    }>,
  ) =>
    prisma.$transaction(
      inputs.map((input) =>
        prisma.evalGeneration.create({
          data: {
            agentSlug: input.agentSlug,
            conversationIds: input.conversationIds,
            status: "running",
            orgId: input.orgId,
            comparisonId: input.comparisonId,
            comparisonSeq: input.comparisonSeq,
            ...(input.folderId ? { folderId: input.folderId } : {}),
            ...(input.createdBy ? { createdBy: input.createdBy } : {}),
            ...(input.genProvider ? { genProvider: input.genProvider } : {}),
            ...(input.genModel ? { genModel: input.genModel } : {}),
          },
        }),
      ),
    ),

  /** All sibling runs of a multi-agent comparison (one per agent), each with its
   *  turn results + judge scores. Ordered by comparisonSeq so the first-selected
   *  agent (seq 0) is a stable baseline across reloads — startedAt alone can tie
   *  for back-to-back inserts. */
  getComparison: (comparisonId: string) =>
    prisma.evalGeneration.findMany({
      where: { comparisonId },
      orderBy: [{ comparisonSeq: "asc" }, { startedAt: "asc" }, { id: "asc" }],
      include: {
        turnResults: { orderBy: [{ conversationId: "asc" }, { turnIndex: "asc" }], include: { judgeScores: true } },
      },
    }),

  /** Lightweight sibling-run list for a comparison (no turns) — used to fan a
   *  judge pass across every agent's run in one call. */
  listRunsByComparisonId: (comparisonId: string) =>
    prisma.evalGeneration.findMany({
      where: { comparisonId },
      orderBy: [{ comparisonSeq: "asc" }, { startedAt: "asc" }, { id: "asc" }],
      select: { id: true, agentSlug: true, status: true, genProvider: true, genModel: true, orgId: true },
    }),

  getRun: (id: string) =>
    prisma.evalGeneration.findUnique({
      where: { id },
      include: {
        turnResults: { orderBy: [{ conversationId: "asc" }, { turnIndex: "asc" }], include: { judgeScores: true } },
      },
    }),

  /** All runs for a folder (newest first) — for the run-comparison picker. */
  listRunsForFolder: (folderId: string) =>
    prisma.evalGeneration.findMany({
      where: { folderId },
      orderBy: { startedAt: "desc" },
      select: { id: true, agentSlug: true, status: true, startedAt: true, completedAt: true, genProvider: true, genModel: true, comparisonId: true },
      take: 50,
    }),

  /** Latest run that targeted any conversation in this folder (for overlaying
   *  results on the explorer). */
  latestRunForFolder: (folderId: string) =>
    prisma.evalGeneration.findFirst({
      where: { folderId },
      orderBy: { startedAt: "desc" },
      include: {
        turnResults: { orderBy: [{ conversationId: "asc" }, { turnIndex: "asc" }], include: { judgeScores: true } },
      },
    }),

  updateRunStatus: (id: string, status: "running" | "completed" | "failed" | "cancelled") =>
    prisma.evalGeneration.update({
      where: { id },
      data: {
        status,
        ...(status === "running" ? {} : { completedAt: new Date() }),
      },
    }),

  // ── Turn results ──────────────────────────────────────────────────────
  upsertTurnResult: (input: UpsertTurnResultInput) => {
    const data = {
      inputMessage: input.inputMessage,
      ...(input.expectedResponse !== undefined ? { expectedResponse: input.expectedResponse } : {}),
      ...(input.clawAnswer !== undefined ? { clawAnswer: input.clawAnswer } : {}),
      ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
      ...(input.toolInvocations !== undefined
        ? { toolInvocations: input.toolInvocations as Prisma.InputJsonValue }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.clawConversationId !== undefined ? { clawConversationId: input.clawConversationId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    };
    return prisma.evalGeneratedTurn.upsert({
      where: {
        runId_conversationId_turnIndex: {
          runId: input.runId,
          conversationId: input.conversationId,
          turnIndex: input.turnIndex,
        },
      },
      create: {
        runId: input.runId,
        conversationId: input.conversationId,
        turnIndex: input.turnIndex,
        ...data,
        status: input.status ?? "running",
      },
      update: data,
    });
  },

  // ── Semantic judge ────────────────────────────────────────────────────
  /** Persist a judge verdict onto one turn result (legacy single-judge fields). */
  setTurnJudgeResult: (id: string, input: { matchScore: number | null; judgeReasoning: string; judgeModel: string }) =>
    prisma.evalGeneratedTurn.update({
      where: { id },
      data: {
        matchScore: input.matchScore,
        judgeReasoning: input.judgeReasoning,
        judgeModel: input.judgeModel,
        judgedAt: new Date(),
      },
    }),

  // ── Named judges ──────────────────────────────────────────────────────
  /** All judges (default first, then newest). Seeds the built-in "Semantic
   *  Match" judge on first access so there's always at least one. */
  listJudges: async () => {
    const existing = await prisma.evalJudge.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
    if (existing.some((j) => j.isDefault)) return existing;
    await prisma.evalJudge.create({
      data: { name: "Semantic Match", prompt: DEFAULT_JUDGE_PROMPT, model: "", isDefault: true },
    });
    return prisma.evalJudge.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  },

  getJudge: (id: string) => prisma.evalJudge.findUnique({ where: { id } }),

  getJudgesByIds: (ids: string[]) => prisma.evalJudge.findMany({ where: { id: { in: ids } } }),

  createJudge: (input: { name: string; prompt: string; model?: string; createdBy?: string | null }) =>
    prisma.evalJudge.create({
      data: {
        name: input.name,
        prompt: input.prompt,
        model: input.model ?? "",
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      },
    }),

  updateJudge: (id: string, input: { name?: string; prompt?: string; model?: string }) =>
    prisma.evalJudge.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
      },
    }),

  /** Delete a judge (the built-in Default can't be deleted). */
  deleteJudge: async (id: string) => {
    const j = await prisma.evalJudge.findUnique({ where: { id } });
    if (j?.isDefault) throw new Error("The Default judge cannot be deleted");
    return prisma.evalJudge.delete({ where: { id } });
  },

  /** Upsert one judge×model verdict on one turn (one row per turn+judge+model —
   *  the same judge scored by two models keeps both verdicts). */
  setTurnJudgeScore: (
    turnResultId: string,
    input: { judgeId: string; judgeName: string; score: number | null; reasoning: string; model: string; passId?: string | null },
  ) => {
    // "error" = the judge LLM call failed (vs a real 0-100 verdict).
    const status = input.score === null ? "error" : "scored";
    return prisma.evalVerdict.upsert({
      where: { turnResultId_judgeId_model: { turnResultId, judgeId: input.judgeId, model: input.model } },
      create: {
        turnResultId,
        judgeId: input.judgeId,
        judgeName: input.judgeName,
        score: input.score,
        reasoning: input.reasoning,
        status,
        model: input.model,
        ...(input.passId ? { passId: input.passId } : {}),
      },
      update: {
        judgeName: input.judgeName,
        score: input.score,
        reasoning: input.reasoning,
        status,
        ...(input.passId ? { passId: input.passId } : {}),
      },
    });
  },
};
