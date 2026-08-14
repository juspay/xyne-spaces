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

  // ── Skill-update requests ─────────────────────────────
  // A "skill_update" request is raised by the update-skill tool. It is reviewed
  // by the skill's OWNER (or, for global skills, an admin) via a DM card that
  // shows only the diff. Mirrors the clone-request lifecycle (dedupe → create →
  // atomic claim → resolve) but persists the proposed content + base hash so the
  // approver applies exactly what was reviewed, and only if the skill has not
  // drifted since.

  /** Existing pending skill-update from this proposer for this skill (dedupe). */
  findPendingSkillUpdate: (skillId: string, requesterId: string) =>
    prisma.agentRequest.findFirst({
      where: { skillId, requesterId, requestType: "skill_update", status: "pending" },
    }),

  /**
   * A proposer's NEW proposal replaces their existing pending one for the same
   * skill. Agents cannot withdraw a stale proposal themselves, and reverting
   * the skill content does not clear the queue — with a plain 409 the
   * one-pending-per-(skill, proposer) slot deadlocks them until the owner
   * hunts down the old card (2026-07-16). The old row is closed as rejected
   * with a supersede note, so its DM card resolves to "already handled"
   * (claimPendingSkillUpdate only claims pending rows). Transactional so the
   * partial unique index never sees two pending rows from this path.
   */
  supersedeAndCreateSkillUpdate: (data: {
    skillId: string;
    skillSlug: string;
    requesterId: string;
    orgId: string;
    proposedContent: string;
    baseContentHash: string;
    proposedContentHash: string;
    requestNote?: string | null;
  }) =>
    prisma.$transaction(async (tx) => {
      const superseded = await tx.agentRequest.updateMany({
        where: {
          skillId: data.skillId,
          requesterId: data.requesterId,
          requestType: "skill_update",
          status: "pending",
        },
        data: {
          status: "rejected",
          reviewerId: data.requesterId,
          reviewNote: "Superseded by a newer proposal from the same proposer",
        },
      });
      const request = await tx.agentRequest.create({
        data: {
          targetType: "skill",
          requestType: "skill_update",
          skillId: data.skillId,
          skillSlug: data.skillSlug,
          requesterId: data.requesterId,
          orgId: data.orgId,
          proposedContent: data.proposedContent,
          baseContentHash: data.baseContentHash,
          proposedContentHash: data.proposedContentHash,
          requestNote: data.requestNote ?? null,
        },
      });
      return { request, supersededCount: superseded.count };
    }),

  /**
   * Atomically claim a pending skill-update, flipping pending→status only if it
   * is still pending. count===1 → this caller won and owns applying the update;
   * count===0 → already resolved by someone else. Scoped to
   * requestType="skill_update" so it can never claim a clone/push row.
   */
  claimPendingSkillUpdate: (id: string, status: "approved" | "rejected", reviewerId: string, reviewNote?: string | null) =>
    prisma.agentRequest.updateMany({
      where: { id, requestType: "skill_update", status: "pending" },
      data: { status, reviewerId, reviewNote: reviewNote ?? null },
    }),

  /** Roll a claimed skill-update back to pending if applying the update fails. */
  revertSkillUpdateToPending: (id: string) =>
    prisma.agentRequest.update({
      where: { id },
      data: { status: "pending", reviewerId: null, reviewNote: null },
    }),
};
