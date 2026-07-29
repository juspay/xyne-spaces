import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const agentChainWorkflowRepository = {
  listByUser: (userId: string) =>
    prisma.agentChainWorkflow.findMany({
      // agentTriggerSlug=null excludes the auto-managed single-node backing
      // workflows for agent-page triggers — those are edited from the agent page.
      where: { createdByUserId: userId, agentTriggerSlug: null },
      orderBy: { updatedAt: "desc" },
      include: { bindings: true },
    }),

  listByChannel: (channelId: string) =>
    prisma.channelAgentChainBinding.findMany({
      where: { channelId, workflow: { agentTriggerSlug: null } },
      // Include the workflow owner so the (admin) cross-user channel view can
      // disambiguate same-named global workflows from different creators —
      // names are unique only WITHIN a creator, not globally.
      include: { workflow: { include: { createdByUser: { select: { id: true, name: true, email: true } } } } },
      orderBy: { updatedAt: "desc" },
    }),

  findWorkflowById: (id: string) =>
    prisma.agentChainWorkflow.findUnique({
      where: { id },
      include: { bindings: true },
    }),

  /**
   * Whether `userId` already owns a workflow named `name` (optionally excluding
   * one workflow id, for rename checks). Names are unique per creator.
   */
  nameTaken: async (userId: string, name: string, excludeId?: string): Promise<boolean> => {
    const row = await prisma.agentChainWorkflow.findFirst({
      where: {
        createdByUserId: userId,
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  },

  /**
   * Return `desired` if free for this user, else the first available
   * "desired (2)", "desired (3)", … — used so the hardcoded default name never
   * collides on create. Single query: scans the user's same-prefixed names.
   */
  resolveUniqueName: async (userId: string, desired: string): Promise<string> => {
    const base = desired.trim();
    const rows = await prisma.agentChainWorkflow.findMany({
      where: { createdByUserId: userId, name: { startsWith: base } },
      select: { name: true },
    });
    const taken = new Set(rows.map((r) => r.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  },

  createWorkflow: (data: Prisma.AgentChainWorkflowCreateInput) =>
    prisma.agentChainWorkflow.create({ data }),

  updateWorkflow: (id: string, data: Prisma.AgentChainWorkflowUpdateInput) =>
    prisma.agentChainWorkflow.update({ where: { id }, data }),

  deleteWorkflow: (id: string) =>
    prisma.agentChainWorkflow.delete({ where: { id } }),

  upsertBinding: (
    channelId: string,
    entryAgentSlug: string,
    workflowId: string,
    createdByUserId: string,
    enabled: boolean,
    userId: string,
  ) =>
    prisma.channelAgentChainBinding.upsert({
      where: { channelId_entryAgentSlug_userId: { channelId, entryAgentSlug, userId } },
      create: { channelId, entryAgentSlug, workflowId, createdByUserId, enabled, userId },
      update: { workflowId, enabled },
      include: { workflow: true },
    }),

  getBinding: (channelId: string, entryAgentSlug: string, userId: string) =>
    prisma.channelAgentChainBinding.findUnique({
      where: { channelId_entryAgentSlug_userId: { channelId, entryAgentSlug, userId } },
      include: { workflow: true },
    }),

  findBindingById: (id: string) =>
    prisma.channelAgentChainBinding.findUnique({
      where: { id },
      include: { workflow: true },
    }),

  setBindingEnabled: (id: string, enabled: boolean) =>
    prisma.channelAgentChainBinding.update({
      where: { id },
      data: { enabled },
      include: { workflow: true },
    }),

  deleteBinding: (id: string) =>
    prisma.channelAgentChainBinding.delete({ where: { id } }),

  deleteBindingByChannelAndWorkflow: (channelId: string, workflowId: string) =>
    prisma.channelAgentChainBinding.deleteMany({ where: { channelId, workflowId } }),

  deleteStaleBindingsForWorkflow: (
    workflowId: string,
    channelIds: string[],
    entryAgentSlug: string,
    userId: string,
  ) =>
    prisma.channelAgentChainBinding.deleteMany({
      where: {
        workflowId,
        userId,
        OR: [
          { channelId: { notIn: channelIds } },
          {
            channelId: { in: channelIds },
            entryAgentSlug: { not: entryAgentSlug },
          },
        ],
      },
    }),

  findBindingsByWorkflowId: (workflowId: string) =>
    prisma.channelAgentChainBinding.findMany({
      where: { workflowId },
      orderBy: { updatedAt: "desc" },
    }),

  findActiveWorkflowForChannel: async (
    channelId: string,
    entryAgentSlug: string,
    userId: string,
  ) => {
    // A binding can be scoped on two axes, each of which accepts the reserved
    // "*" sentinel meaning "any":
    //   • channelId — a specific channel, or "*" = all channels
    //   • userId    — a specific user, or "*" = any user
    // We fetch every binding that could match this (channel, user) trigger and
    // pick the MOST SPECIFIC. Channel specificity dominates user specificity:
    //   (channel, user) > (channel, *) > (*, user) > (*, *)
    // Disabled / unpublished bindings are filtered out BEFORE picking, so a
    // disabled exact match never shadows a valid wildcard fallback.
    const rows = await prisma.channelAgentChainBinding.findMany({
      where: {
        entryAgentSlug,
        channelId: { in: [channelId, "*"] },
        userId: { in: [userId, "*"] },
      },
      include: { workflow: true },
    });

    const rank = (r: { channelId: string; userId: string }): number =>
      (r.channelId === channelId ? 0 : 2) + (r.userId === userId ? 0 : 1);

    const binding = rows
      .filter((r) => r.enabled && r.workflow.isPublished)
      .sort((a, b) => rank(a) - rank(b))[0];

    return binding ?? null;
  },

  // ── "Push to global" request queue ──────────────────────────────────────

  /** Create a pending promotion request, or return the existing pending one. */
  createGlobalRequest: async (workflowId: string, requestedByUserId: string) => {
    const existing = await prisma.workflowGlobalRequest.findFirst({
      where: { workflowId, status: "pending" },
    });
    if (existing) return existing;
    return prisma.workflowGlobalRequest.create({ data: { workflowId, requestedByUserId } });
  },

  listPendingGlobalRequests: (requestedByUserIds?: string[]) =>
    prisma.workflowGlobalRequest.findMany({
      where: {
        status: "pending",
        ...(requestedByUserIds ? { requestedByUserId: { in: requestedByUserIds } } : {}),
      },
      include: { workflow: true },
      orderBy: { createdAt: "asc" },
    }),

  findGlobalRequestById: (id: string) =>
    prisma.workflowGlobalRequest.findUnique({ where: { id }, include: { workflow: true } }),

  /**
   * Approve a promotion request: set the workflow global and rewire it so ALL
   * users get it — for each distinct (channel, entry agent) the workflow is
   * already bound to, upsert a userId="*" binding pointing at this workflow.
   * Returns null if the request is missing or no longer pending.
   */
  approveGlobalRequest: async (id: string, reviewerId: string) => {
    const reqRow = await prisma.workflowGlobalRequest.findUnique({
      where: { id },
      include: { workflow: { include: { bindings: true } } },
    });
    if (!reqRow || reqRow.status !== "pending") return null;

    const workflowId = reqRow.workflowId;
    const seen = new Set<string>();
    const pairs: Array<{ channelId: string; entryAgentSlug: string }> = [];
    for (const b of reqRow.workflow.bindings) {
      const key = `${b.channelId}\u0000${b.entryAgentSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ channelId: b.channelId, entryAgentSlug: b.entryAgentSlug });
    }

    await prisma.$transaction([
      prisma.agentChainWorkflow.update({ where: { id: workflowId }, data: { global: true } }),
      ...pairs.map((p) =>
        prisma.channelAgentChainBinding.upsert({
          where: {
            channelId_entryAgentSlug_userId: {
              channelId: p.channelId,
              entryAgentSlug: p.entryAgentSlug,
              userId: "*",
            },
          },
          create: {
            channelId: p.channelId,
            entryAgentSlug: p.entryAgentSlug,
            userId: "*",
            workflowId,
            createdByUserId: reviewerId,
            enabled: true,
          },
          update: { workflowId, enabled: true },
        }),
      ),
      prisma.workflowGlobalRequest.update({
        where: { id },
        data: { status: "approved", reviewedByUserId: reviewerId, reviewedAt: new Date() },
      }),
    ]);

    return prisma.workflowGlobalRequest.findUnique({ where: { id }, include: { workflow: true } });
  },

  rejectGlobalRequest: (id: string, reviewerId: string, note?: string) =>
    prisma.workflowGlobalRequest.update({
      where: { id },
      data: {
        status: "rejected",
        reviewedByUserId: reviewerId,
        reviewedAt: new Date(),
        ...(note ? { reviewNote: note } : {}),
      },
    }),

  cancelGlobalRequest: (id: string) =>
    prisma.workflowGlobalRequest.update({ where: { id }, data: { status: "cancelled" } }),
};
