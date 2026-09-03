import type { ExperimentRun, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type ExperimentStatus = "running" | "finishing" | "done" | "aborted";
export type ExperimentFindingStatus = "conjecture" | "proved" | "refuted";
export type ExperimentRunWithFindingCount = ExperimentRun & { _count: { findings: number } };

/** Collapse the cosmetic variations agents apply when re-recording a finding:
 *  an "F22:" / "3." index prefix, parenthetical qualifiers ("(re-verified in
 *  epoch 2)"), punctuation and case. Keeps enough of the title that genuinely
 *  distinct findings stay distinct. */
export function normalizeFindingTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\s*f?\d+[.:)\]]\s*/, "")
    .replace(/\([^)]*\)/g, " ")
    // Drop every number and unit. The same finding is routinely re-recorded
    // with a fresh measurement ("2.1-3.0x waste" -> "2.0-3.5x waste"), and the
    // identifiers that make findings distinct are words, not digits.
    .replace(/[\d.,]*\d+\s*(?:[a-z]{1,3}\b|[×x%])?/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}

/** A proofArtifactPath counts as durable only if the file behind it was
 *  actually delivered to the thread. Compare basenames — the agent records an
 *  in-sandbox path while delivery reports the attachment filename. */
export function proofWasDelivered(proofArtifactPath: string | null | undefined, delivered: string[]): boolean {
  const raw = proofArtifactPath?.trim();
  if (!raw) return false;
  const base = raw.split("/").pop()?.toLowerCase();
  if (!base) return false;
  return delivered.some((name) => name.trim().toLowerCase() === base);
}

export const experimentRepository = {
  createRun(args: {
    conversationId: string;
    channelId: string;
    agentSlug: string;
    userId: string;
    orgId: string;
    focus?: string | null;
    provider?: string | null;
    modelId?: string | null;
    kind?: string | null;
    deadlineAt: Date;
  }) {
    return prisma.experimentRun.create({
      data: {
        conversationId: args.conversationId,
        channelId: args.channelId,
        agentSlug: args.agentSlug,
        userId: args.userId,
        orgId: args.orgId,
        focus: args.focus ?? null,
        provider: args.provider ?? null,
        modelId: args.modelId ?? null,
        ...(args.kind ? { kind: args.kind } : {}),
        deadlineAt: args.deadlineAt,
      },
    });
  },

  findActiveByConversation(conversationId: string) {
    return prisma.experimentRun.findFirst({
      where: { conversationId, status: { in: ["running", "finishing"] } },
      orderBy: { createdAt: "desc" },
    });
  },

  findLatestByConversation(conversationId: string) {
    return prisma.experimentRun.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });
  },

  async findBestForFindings(conversationId: string): Promise<ExperimentRun | null> {
    const rows = await prisma.$queryRaw<ExperimentRun[]>`
      SELECT run.*
      FROM "experiment_runs" AS run
      WHERE run."conversationId" = ${conversationId}
      ORDER BY
        CASE
          WHEN run."status" IN ('running', 'finishing') THEN 0
          WHEN EXISTS (
            SELECT 1
            FROM "experiment_findings" AS finding
            WHERE finding."experimentId" = run."id"
          ) THEN 1
          ELSE 2
        END,
        run."createdAt" DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  },

  async listRecentByConversationWithFindingCounts(
    conversationId: string,
    limit = 6,
  ): Promise<ExperimentRunWithFindingCount[]> {
    return prisma.experimentRun.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { _count: { select: { findings: true } } },
    });
  },

  findById(id: string) {
    return prisma.experimentRun.findUnique({ where: { id } });
  },

  /** Union the newly-delivered basenames into the run's registry. Idempotent —
   *  the same file delivered twice adds nothing. */
  async recordDeliveredArtifacts(id: string, filenames: string[]): Promise<string[]> {
    const run = await prisma.experimentRun.findUnique({ where: { id }, select: { deliveredArtifacts: true } });
    if (!run) return [];
    const merged = Array.from(new Set([
      ...run.deliveredArtifacts,
      ...filenames.map((name) => name.trim()).filter(Boolean),
    ])).slice(0, 500);
    await prisma.experimentRun.update({ where: { id }, data: { deliveredArtifacts: merged } });
    return merged;
  },

  update(id: string, data: Prisma.ExperimentRunUpdateInput) {
    return prisma.experimentRun.update({ where: { id }, data });
  },

  addFinding(args: {
    experimentId: string;
    epoch: number;
    status: ExperimentFindingStatus;
    title: string;
    hypothesis: string;
    note?: string | null;
    proofArtifactPath?: string | null;
  }) {
    return prisma.experimentFinding.create({
      data: {
        experimentId: args.experimentId,
        epoch: args.epoch,
        status: args.status,
        title: args.title,
        hypothesis: args.hypothesis,
        note: args.note ?? null,
        proofArtifactPath: args.proofArtifactPath ?? null,
      },
    });
  },

  async upsertFindingByTitle(args: {
    experimentId: string;
    epoch: number;
    status: ExperimentFindingStatus;
    title: string;
    hypothesis: string;
    note?: string | null;
    proofArtifactPath?: string | null;
  }) {
    // Match on the NORMALISED title, not the raw one. Agents re-record the
    // same finding across epochs with a re-worded or "F22:"-prefixed title;
    // exact-match upsert treated each as new and inflated the ledger ~5%
    // (observed live: 4 duplicate groups in a 68-entry run).
    const candidates = await prisma.experimentFinding.findMany({
      where: { experimentId: args.experimentId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true },
    });
    const wanted = normalizeFindingTitle(args.title);
    const existing = candidates.find((row) => normalizeFindingTitle(row.title) === wanted);
    if (existing) {
      return prisma.experimentFinding.update({
        where: { id: existing.id },
        data: {
          epoch: args.epoch,
          status: args.status,
          hypothesis: args.hypothesis,
          note: args.note ?? null,
          proofArtifactPath: args.proofArtifactPath ?? null,
        },
      });
    }
    return this.addFinding(args);
  },

  findFindingById(id: string) {
    return prisma.experimentFinding.findUnique({ where: { id } });
  },

  /** Track an in-flight checker session so `/experiment stop` can cancel it. */
  async addCheckerSession(id: string, sessionId: string): Promise<void> {
    const run = await prisma.experimentRun.findUnique({ where: { id }, select: { checkerSessionIds: true } });
    if (!run) return;
    if (run.checkerSessionIds.includes(sessionId)) return;
    // Bounded: only recent checkers can still be in flight, and an unbounded
    // array would grow once per epoch for the life of the run.
    const merged = [...run.checkerSessionIds, sessionId].slice(-20);
    await prisma.experimentRun.update({ where: { id }, data: { checkerSessionIds: merged } });
  },

  listFindingsByEpoch(experimentId: string, epoch: number) {
    return prisma.experimentFinding.findMany({
      where: { experimentId, epoch },
      orderBy: { createdAt: "asc" },
    });
  },

  /** Idempotent per (finding, epoch) so a retried checker run overwrites its
   *  own verdict instead of stacking duplicates. */
  upsertReview(args: {
    experimentId: string;
    findingId: string;
    epoch: number;
    verdict: string;
    reason: string;
    duplicateOf?: string | null;
  }) {
    const data = {
      verdict: args.verdict,
      reason: args.reason.slice(0, 2000),
      duplicateOf: args.duplicateOf ?? null,
    };
    return prisma.experimentReview.upsert({
      where: { findingId_epoch: { findingId: args.findingId, epoch: args.epoch } },
      create: { experimentId: args.experimentId, findingId: args.findingId, epoch: args.epoch, ...data },
      update: data,
    });
  },

  listReviews(experimentId: string) {
    return prisma.experimentReview.findMany({
      where: { experimentId },
      orderBy: { createdAt: "asc" },
    });
  },

  async updateFindingStatus(args: {
    id?: string;
    experimentId?: string;
    title?: string;
    status: ExperimentFindingStatus;
    note?: string | null;
    proofArtifactPath?: string | null;
  }) {
    const where = args.id
      ? { id: args.id }
      : args.experimentId && args.title
        ? { experimentId: args.experimentId, title: args.title }
        : null;
    if (!where) throw new Error("updateFindingStatus requires id or experimentId+title");
    const existing = await prisma.experimentFinding.findFirst({ where });
    if (!existing) return null;
    return prisma.experimentFinding.update({
      where: { id: existing.id },
      data: {
        status: args.status,
        ...(args.note !== undefined ? { note: args.note } : {}),
        ...(args.proofArtifactPath !== undefined ? { proofArtifactPath: args.proofArtifactPath } : {}),
      },
    });
  },

  listFindings(experimentId: string) {
    return prisma.experimentFinding.findMany({
      where: { experimentId },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });
  },

  listActive() {
    return prisma.experimentRun.findMany({
      where: { status: { in: ["running", "finishing"] } },
      orderBy: { updatedAt: "asc" },
    });
  },
};
