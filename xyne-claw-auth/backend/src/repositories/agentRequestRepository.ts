import { prisma } from "../db.js";

export const agentRequestRepository = {
  findById: (id: string) =>
    prisma.agentRequest.findUnique({ where: { id } }),

  findPending: (agentId: string, requestType: string) =>
    prisma.agentRequest.findFirst({ where: { agentId, requestType, status: "pending" } }),

  findPendingSkill: (skillId: string) =>
    prisma.agentRequest.findFirst({ where: { targetType: "skill", skillId, status: "pending" } }),

  listPending: (orgId?: string) =>
    prisma.agentRequest.findMany({
      where: { status: "pending", ...(orgId ? { orgId } : {}) },
      orderBy: { createdAt: "desc" },
    }),

  create: (data: { targetType?: string; agentId?: string; agentSlug?: string; skillId?: string; skillSlug?: string; requestType: string; requesterId: string; requestedName?: string | null; orgId: string }) =>
    prisma.agentRequest.create({ data }),

  updateStatus: (id: string, status: string, reviewerId: string, reviewNote?: string | null) =>
    prisma.agentRequest.update({ where: { id }, data: { status, reviewerId, reviewNote: reviewNote ?? null } }),

  // ── Clone requests ────────────────────────────
  // A "clone" request is raised when a viewer without owner/contributor
  // rights clicks Clone. It is reviewed by the SOURCE agent's owner (or an
  // admin), unlike push_to_* requests which go to the admin queue.

  /** Existing pending clone request from this requester for this agent (dedupe). */
  findPendingClone: (agentId: string, requesterId: string) =>
    prisma.agentRequest.findFirst({
      where: { agentId, requesterId, requestType: "clone", status: "pending" },
    }),

  /** All pending clone requests (owner/admin inbox filters by agent owner). */
  listPendingClones: () =>
    prisma.agentRequest.findMany({
      where: { requestType: "clone", status: "pending" },
      orderBy: { createdAt: "desc" },
    }),

  /** Clone requests raised BY a given user (their outbox), any status. */
  listCloneRequestsByRequester: (requesterId: string) =>
    prisma.agentRequest.findMany({
      where: { requestType: "clone", requesterId },
      orderBy: { createdAt: "desc" },
    }),

  /**
   * Atomically claim a pending clone request, flipping it to `status` only if
   * it is still pending. Returns the update count: 1 = this caller won the
   * claim and owns the side effects (creating the clone); 0 = someone else
   * already resolved it (lost the race → treat as already-resolved). This is
   * the concurrency guard that prevents two simultaneous approvals from each
   * creating a duplicate clone. Scoped to requestType="clone" for safety.
   */
  claimPendingClone: (id: string, status: "approved" | "rejected", reviewerId: string, reviewNote?: string | null) =>
    prisma.agentRequest.updateMany({
      where: { id, requestType: "clone", status: "pending" },
      data: { status, reviewerId, reviewNote: reviewNote ?? null },
    }),

  /**
   * Release a claim back to pending. Used to roll back an `approved` claim when
   * clone creation subsequently fails, so the request can be retried instead of
   * being stuck "approved" with no clone.
   */
  revertClaimToPending: (id: string) =>
    prisma.agentRequest.update({
      where: { id },
      data: { status: "pending", reviewerId: null, reviewNote: null, resultAgentId: null },
    }),

  /** Approve/reject a clone request, recording the resulting agent (if any). */
  resolveClone: (
    id: string,
    status: "approved" | "rejected",
    reviewerId: string,
    opts: { resultAgentId?: string | null; reviewNote?: string | null } = {},
  ) =>
    prisma.agentRequest.update({
      where: { id },
      data: {
        status,
        reviewerId,
        reviewNote: opts.reviewNote ?? null,
        resultAgentId: opts.resultAgentId ?? null,
      },
    }),
};
