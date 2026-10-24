/**
 * TEMPORARY admin endpoint to migrate the per-agent free-text design system
 * (`agent.config.designSystem`) into `DesignSystem` rows.
 *
 * For each agent that has non-empty `config.designSystem` and no
 * `config.designSystemId`, this creates one DesignSystem row in the agent's org
 * and points the agent at it. The original `config.designSystem` text is left
 * in place on purpose — `designSystemRepository.resolveForAgent` still reads it
 * as the last fallback, so a half-finished backfill degrades to today's
 * behaviour rather than to no design system at all.
 *
 * Mount: see `http/routes.ts` — exposed at POST /admin/backfill-design-systems.
 *
 * DELETE THIS FILE (and the import + app.use line in http/routes.ts) once every
 * agent is backfilled and `config.designSystem` has been dropped. Re-running is
 * safe: agents that already carry a `designSystemId` are skipped.
 *
 * `?dryRun=true` reports what would change and writes nothing.
 *
 * Auth: `requireAuth` on `/admin/*` validates the Spaces user JWT; isClawAdmin
 * is required on top so a non-admin can neither trigger the backfill nor
 * enumerate agents through the response.
 */
import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { designSystemRepository } from "../repositories/index.js";
import { errMsg } from "../lib/errors.js";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";

import { createLogger } from "../logger.js";
const log = createLogger("admin-backfill-design-systems");

const router = Router();

const BATCH_SIZE = 200;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

interface Outcome {
  agentId: string;
  slug: string;
  orgId: string;
  status: "created" | "skipped-already-linked" | "skipped-no-text" | "conflict" | "error";
  designSystemId?: string;
  detail?: string;
}

/**
 * Point one agent at its new row using the same optimistic retry
 * `PATCH /agents/:slug/design-system` uses: `config` is a shared JSON blob, so a
 * blind write here would silently discard a concurrent provider/tools edit.
 */
async function linkAgent(agentId: string, designSystemId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, config: true, updatedAt: true },
    });
    if (!fresh) return false;

    const nextConfig = { ...(asRecord(fresh.config) ?? {}) };
    if (typeof nextConfig["designSystemId"] === "string" && nextConfig["designSystemId"]) return true;
    nextConfig["designSystemId"] = designSystemId;

    const result = await prisma.agent.updateMany({
      where: { id: fresh.id, updatedAt: fresh.updatedAt },
      data: { config: nextConfig as Prisma.InputJsonValue },
    });
    if (result.count === 1) return true;
  }
  return false;
}

router.post("/backfill-design-systems", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }
  if (!(await isClawAdmin(requesterId))) {
    res.status(403).json({ success: false, error: "admin only" });
    return;
  }

  const dryRun = req.query["dryRun"] === "true";
  const outcomes: Outcome[] = [];
  let cursor: string | undefined;

  try {
    for (;;) {
      const agents = await prisma.agent.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, slug: true, name: true, orgId: true, ownerUserId: true, config: true },
      });
      if (agents.length === 0) break;
      cursor = agents[agents.length - 1]?.id;

      for (const agent of agents) {
        const config = asRecord(agent.config) ?? {};
        const existingId = config["designSystemId"];
        if (typeof existingId === "string" && existingId) {
          outcomes.push({ agentId: agent.id, slug: agent.slug, orgId: agent.orgId, status: "skipped-already-linked" });
          continue;
        }

        const text = config["designSystem"];
        if (typeof text !== "string" || !text.trim()) {
          outcomes.push({ agentId: agent.id, slug: agent.slug, orgId: agent.orgId, status: "skipped-no-text" });
          continue;
        }

        if (dryRun) {
          outcomes.push({ agentId: agent.id, slug: agent.slug, orgId: agent.orgId, status: "created" });
          continue;
        }

        try {
          // Through the repository, not prisma directly, so the row gets its v1
          // version snapshot like every other system (XYNE-66824). A raw create
          // here would leave a backfilled system with an empty version history.
          const created = await designSystemRepository.create(
            agent.orgId,
            agent.ownerUserId ?? requesterId,
            {
              name: `${agent.name} design system`,
              designMd: text.trim(),
              source: "manual",
              changeSummary: "Created by the agent-config backfill",
            },
          );

          const linked = await linkAgent(agent.id, created.id);
          if (!linked) {
            // The row stays; resolveForAgent still falls back to the text, and a
            // re-run will link it. Deleting here would race the same writer.
            outcomes.push({
              agentId: agent.id,
              slug: agent.slug,
              orgId: agent.orgId,
              status: "conflict",
              designSystemId: created.id,
              detail: "agent config changed during backfill; re-run to link",
            });
            continue;
          }

          outcomes.push({
            agentId: agent.id,
            slug: agent.slug,
            orgId: agent.orgId,
            status: "created",
            designSystemId: created.id,
          });
        } catch (err) {
          outcomes.push({
            agentId: agent.id,
            slug: agent.slug,
            orgId: agent.orgId,
            status: "error",
            detail: errMsg(err),
          });
        }
      }

      if (agents.length < BATCH_SIZE) break;
    }
  } catch (err) {
    log.error(`[backfill-design-systems] aborted: ${errMsg(err)}`);
    res.status(500).json({ success: false, error: errMsg(err), partial: summarize(outcomes) });
    return;
  }

  const summary = summarize(outcomes);
  log.info(`[backfill-design-systems] dryRun=${dryRun} ${JSON.stringify(summary)}`);

  if (!dryRun && summary["created"]) {
    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "DESIGN_SYSTEM_CREATED",
      targetId: "backfill",
      description: `Backfilled ${summary["created"]} design system(s) from agent config`,
      metadata: summary,
    });
  }

  res.json({ success: true, dryRun, summary, outcomes });
});

function summarize(outcomes: Outcome[]): Record<string, number> {
  return outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
}

export { router as adminBackfillDesignSystemsRouter };
