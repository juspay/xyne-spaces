/**
 * Repository for the ActiveGoal table — single active autonomous-loop goal
 * per Spaces conversation thread.
 *
 * The table is UNIQUE on conversationId, so create-or-replace semantics are
 * handled via prisma upsert. Lookups by conversationId are the hot path
 * (every result-callback checks for an active goal); status transitions
 * (active → done | cancelled | failed) flip a single row.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type GoalStatus = "active" | "done" | "cancelled" | "failed";
export type AuditState = "none" | "pending" | "done";

export const activeGoalRepository = {
  findActiveByConversation(conversationId: string) {
    return prisma.activeGoal.findFirst({
      where: { conversationId, status: "active" },
    });
  },

  /** Upsert a new goal on the conversation, replacing any prior row. */
  startOrReplace(args: {
    conversationId: string;
    channelId?: string | null;
    workspaceId?: string | null;
    userId: string;
    agentSlug: string;
    orgId: string;
    condition: string;
    maxTurns?: number;
    runPayload: Prisma.InputJsonValue;
  }) {
    const max = args.maxTurns ?? Number(process.env["GOAL_MAX_TURNS_DEFAULT"] ?? 5);
    return prisma.activeGoal.upsert({
      where: { conversationId: args.conversationId },
      update: {
        userId: args.userId,
        agentSlug: args.agentSlug,
        condition: args.condition,
        maxTurns: max,
        runPayload: args.runPayload,
        orgId: args.orgId,
        status: "active",
        turnCount: 0,
        lastTurnResult: null,
        lastReason: null,
        auditState: "none",
        channelId: args.channelId ?? null,
        workspaceId: args.workspaceId ?? null,
      },
      create: {
        conversationId: args.conversationId,
        channelId: args.channelId ?? null,
        workspaceId: args.workspaceId ?? null,
        userId: args.userId,
        agentSlug: args.agentSlug,
        orgId: args.orgId,
        condition: args.condition,
        maxTurns: max,
        runPayload: args.runPayload,
        status: "active",
      },
    });
  },

  /** Mark the goal terminated and stash the final reason. */
  terminate(conversationId: string, status: Exclude<GoalStatus, "active">, reason: string) {
    return prisma.activeGoal.updateMany({
      where: { conversationId, status: "active" },
      data: { status, lastReason: reason.slice(0, 500) },
    });
  },

  /** Bump turnCount and stash the latest worker output/session digest for the boss to see. */
  recordTurn(conversationId: string, turnOutput: string, sessionDigest?: string) {
    return prisma.activeGoal.update({
      where: { conversationId },
      data: {
        turnCount: { increment: 1 },
        lastTurnResult: sessionDigest ? sessionDigest.slice(0, 12000) : turnOutput.slice(0, 4000),
      },
    });
  },

  /** Update the audit-pass state machine. See ActiveGoal.auditState comment for semantics. */
  setAuditState(conversationId: string, auditState: AuditState) {
    return prisma.activeGoal.updateMany({
      where: { conversationId, status: "active" },
      data: { auditState },
    });
  },
};
