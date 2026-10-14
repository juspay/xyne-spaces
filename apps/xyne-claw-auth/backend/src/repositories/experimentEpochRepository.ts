import type { ExperimentEpoch, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type ExperimentEpochStatus = "running" | "done" | "failed" | "cancelled";

export const experimentEpochRepository = {
  create(args: { experimentId: string; epoch: number; sessionId: string }): Promise<ExperimentEpoch> {
    return prisma.experimentEpoch.upsert({
      where: { sessionId: args.sessionId },
      create: { experimentId: args.experimentId, epoch: args.epoch, sessionId: args.sessionId },
      update: {},
    });
  },

  findBySessionId(sessionId: string): Promise<ExperimentEpoch | null> {
    return prisma.experimentEpoch.findUnique({ where: { sessionId } });
  },

  update(sessionId: string, data: Prisma.ExperimentEpochUpdateInput): Promise<ExperimentEpoch> {
    return prisma.experimentEpoch.update({ where: { sessionId }, data });
  },

  listByExperiment(experimentId: string): Promise<ExperimentEpoch[]> {
    return prisma.experimentEpoch.findMany({
      where: { experimentId },
      orderBy: [{ epoch: "asc" }, { startedAt: "asc" }],
    });
  },

  listRunning(experimentId: string): Promise<ExperimentEpoch[]> {
    return prisma.experimentEpoch.findMany({ where: { experimentId, status: "running" } });
  },
};
