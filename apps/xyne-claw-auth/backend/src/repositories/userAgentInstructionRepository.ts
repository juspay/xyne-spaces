import { prisma } from "../db.js";

/**
 * Per-user, per-agent custom instructions. Read at dispatch time and appended to
 * `additionalInstructions` for the run so the user can tune any agent's behaviour
 * for themselves. Keyed by (userId, orgId, agentSlug) — same shape as
 * userAgentConfigRepository.
 */
export const userAgentInstructionRepository = {
  findByUserAndAgent: (userId: string, orgId: string, agentSlug: string) =>
    prisma.userAgentInstruction.findUnique({
      where: { userId_orgId_agentSlug: { userId, orgId, agentSlug } },
    }),

  /** The instruction text to inject, or "" when absent/disabled/blank. */
  getEnabledText: async (userId: string, orgId: string, agentSlug: string): Promise<string> => {
    const row = await prisma.userAgentInstruction.findUnique({
      where: { userId_orgId_agentSlug: { userId, orgId, agentSlug } },
      select: { instructions: true, enabled: true },
    });
    if (!row || !row.enabled) return "";
    return (row.instructions ?? "").trim();
  },

  listByUser: (userId: string, orgId: string) =>
    prisma.userAgentInstruction.findMany({
      where: { userId, orgId },
      select: { agentSlug: true, instructions: true, enabled: true, updatedAt: true },
      orderBy: { agentSlug: "asc" },
    }),

  upsert: (
    userId: string,
    orgId: string,
    agentSlug: string,
    data: { instructions?: string; enabled?: boolean },
  ) =>
    prisma.userAgentInstruction.upsert({
      where: { userId_orgId_agentSlug: { userId, orgId, agentSlug } },
      create: { userId, orgId, agentSlug, ...data },
      update: data,
    }),

  delete: (userId: string, orgId: string, agentSlug: string) =>
    prisma.userAgentInstruction.delete({
      where: { userId_orgId_agentSlug: { userId, orgId, agentSlug } },
    }),
};
