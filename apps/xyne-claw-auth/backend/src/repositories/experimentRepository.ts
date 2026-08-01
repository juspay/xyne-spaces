import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type ExperimentStatus = "running" | "finishing" | "done" | "aborted";
export type ExperimentFindingStatus = "conjecture" | "proved" | "refuted";

export const experimentRepository = {
  createRun(args: {
    conversationId: string;
    channelId: string;
    agentSlug: string;
    userId: string;
    orgId?: string | null;
    focus?: string | null;
    provider?: string | null;
    modelId?: string | null;
    deadlineAt: Date;
  }) {
    return prisma.experimentRun.create({
      data: {
        conversationId: args.conversationId,
        channelId: args.channelId,
        agentSlug: args.agentSlug,
        userId: args.userId,
        orgId: args.orgId ?? null,
        focus: args.focus ?? null,
        provider: args.provider ?? null,
        modelId: args.modelId ?? null,
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

  findById(id: string) {
    return prisma.experimentRun.findUnique({ where: { id } });
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
    const existing = await prisma.experimentFinding.findFirst({
      where: { experimentId: args.experimentId, title: args.title },
      orderBy: { createdAt: "asc" },
    });
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
