import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Generic store for feature-generated content (first consumer: Daily Brief).
 * One row per (userId, kind, dateBucket) — idempotent per calendar day.
 */
export const DAILY_BRIEF_KIND = "DAILY_BRIEF" as const;

export const generatedContentRepository = {
  /** Latest content for a user + kind + specific day bucket (the "today's brief" read). */
  findForBucket: (userId: string, kind: string, dateBucket: string) =>
    prisma.generatedContent.findUnique({
      where: { userId_kind_dateBucket: { userId, kind, dateBucket } },
    }),

  /** Most recent content for a user + kind regardless of day (fallback when today's isn't ready). */
  findLatest: (userId: string, kind: string) =>
    prisma.generatedContent.findFirst({
      where: { userId, kind },
      orderBy: [{ dateBucket: "desc" }, { createdAt: "desc" }],
    }),

  /** Recent content for a user + kind, newest day first — powers the history list. */
  findHistory: (userId: string, kind: string, limit = 30) =>
    prisma.generatedContent.findMany({
      where: { userId, kind },
      orderBy: [{ dateBucket: "desc" }, { createdAt: "desc" }],
      take: limit,
    }),

  /** Day buckets + status only (no content) — powers the brief date picker. */
  findDateBuckets: (userId: string, kind: string, limit = 365) =>
    prisma.generatedContent.findMany({
      where: { userId, kind },
      orderBy: [{ dateBucket: "desc" }],
      take: limit,
      select: { dateBucket: true, status: true },
    }),

  /** Mark generation as started (idempotent per day) so a fetch can show "generating". */
  markGenerating: (params: {
    userId: string;
    orgId: string;
    kind: string;
    dateBucket: string;
    agentSlug?: string | null;
    sessionId?: string | null;
  }) =>
    prisma.generatedContent.upsert({
      where: {
        userId_kind_dateBucket: {
          userId: params.userId,
          kind: params.kind,
          dateBucket: params.dateBucket,
        },
      },
      create: {
        userId: params.userId,
        orgId: params.orgId,
        kind: params.kind,
        dateBucket: params.dateBucket,
        agentSlug: params.agentSlug ?? null,
        sessionId: params.sessionId ?? null,
        status: "generating",
      },
      update: {
        status: "generating",
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      },
    }),

  /** Persist the finished content (the emit_brief JSON + rendered markdown). */
  saveReady: (params: {
    userId: string;
    orgId: string;
    kind: string;
    dateBucket: string;
    agentSlug?: string | null;
    content: string;
    data: Prisma.InputJsonValue;
    sessionId?: string | null;
    generatedAt: Date;
  }) =>
    prisma.generatedContent.upsert({
      where: {
        userId_kind_dateBucket: {
          userId: params.userId,
          kind: params.kind,
          dateBucket: params.dateBucket,
        },
      },
      create: {
        userId: params.userId,
        orgId: params.orgId,
        kind: params.kind,
        dateBucket: params.dateBucket,
        agentSlug: params.agentSlug ?? null,
        content: params.content,
        data: params.data,
        status: "ready",
        sessionId: params.sessionId ?? null,
        generatedAt: params.generatedAt,
      },
      update: {
        content: params.content,
        data: params.data,
        status: "ready",
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        generatedAt: params.generatedAt,
      },
    }),

  /**
   * Mark a day's generation failed — but ONLY if it's still "generating", so a
   * failed regenerate can't clobber a previously-succeeded brief back to failed.
   */
  markFailed: (userId: string, kind: string, dateBucket: string) =>
    prisma.generatedContent.updateMany({
      where: { userId, kind, dateBucket, status: "generating" },
      data: { status: "failed" },
    }),
};
