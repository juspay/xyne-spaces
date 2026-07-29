/**
 * Backfill — PHASE 2 (Gap 1). Stamps `orgId` on the 12 agentSlug-keyed CHILD
 * tables, so the later slice-5 migration can flip those columns to NOT NULL.
 *
 * Separate from `backfill-phase2-agents.ts` (which stamps the PARENT rows —
 * agents/skills/subagents — and already shipped in the previous slice). This
 * one pairs with the `..._phase2_child_orgid` migration and runs AFTER it.
 *
 * Resolution per row (idempotent — only touches `orgId IS NULL`):
 *   1. via the row's agent: agentSlug → agents.slug → agents.orgId
 *   2. fallback (tables with a userId column): userId → users.orgId
 *   3. else leave null — tolerated for org-less rows (nullable-agentSlug audit
 *      rows, eval/curator rows with no resolvable agent). These are reported,
 *      not fatal; the slice-5 NOT-NULL flip must exclude/patch any residual nulls.
 *
 * Raw SQL because Prisma `updateMany` can't JOIN. Table/column names are
 * hard-coded constants (never user input) — no injection surface.
 *
 * Prerequisite: the `..._phase2_child_orgid` migration is applied AND the parent
 * backfill (`backfill-phase2-agents.ts`) has run (agents carry orgId).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-phase2-child-orgid.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// `userCol` = the column to join `users` on for the fallback pass (undefined =
// no user column, so the row stays null when no agent matches). Most tables key
// on `userId`; `agent_requests` keys on `requesterId` (round-2 review fix).
const CHILD_TABLES: Array<{ table: string; userCol?: string }> = [
  { table: "user_agent_configs", userCol: "userId" },
  { table: "agent_runs", userCol: "userId" },
  { table: "chat_messages", userCol: "userId" },
  { table: "scheduled_jobs", userCol: "userId" },
  { table: "pending_memory_reviews", userCol: "userId" },
  { table: "memory_recall_hits", userCol: "userId" },
  { table: "active_goals", userCol: "userId" },
  { table: "agent_requests", userCol: "requesterId" },
  { table: "pending_batch_reviews" },
  { table: "agent_improvement_candidates" },
  { table: "agent_curator_state" },
  { table: "eval_generations" },
];

async function main(): Promise<void> {
  console.log("[backfill:phase2-child] Starting…");

  let totalNull = 0;
  for (const { table, userCol } of CHILD_TABLES) {
    // 1) via agent (agentSlug → agents.slug → agents.orgId)
    const byAgent = await prisma.$executeRawUnsafe(
      `UPDATE "${table}" AS c SET "orgId" = a."orgId" FROM "agents" a
         WHERE c."agentSlug" = a."slug" AND c."orgId" IS NULL`,
    );
    // 2) fallback via the table's user column (userId or requesterId)
    let byUser = 0;
    if (userCol) {
      byUser = await prisma.$executeRawUnsafe(
        `UPDATE "${table}" AS c SET "orgId" = u."orgId" FROM "users" u
           WHERE c."${userCol}" = u."id" AND c."orgId" IS NULL`,
      );
    }
    const left = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "${table}" WHERE "orgId" IS NULL`,
    );
    const stillNull = Number(left[0]?.n ?? 0);
    totalNull += stillNull;
    console.log(`[backfill:phase2-child] ${table}: byAgent=${byAgent} byUser=${byUser} stillNull=${stillNull}`);
  }

  console.log(`[backfill:phase2-child] total child rows still orgId IS NULL: ${totalNull}`);
  if (totalNull > 0) {
    console.warn(
      "[backfill:phase2-child] NOTE: residual null-org child rows exist (org-less audit/eval rows). " +
        "The slice-5 NOT-NULL flip must exclude or patch these before enforcing NOT NULL.",
    );
  }
  console.log("[backfill:phase2-child] Done!");
}

main()
  .catch((err) => {
    console.error("[backfill:phase2-child] Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
