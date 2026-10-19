import { Router, type Request, type Response } from "express";
import { isAgentInvocableBy } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import { redisService } from "../redis.js";
import { agentRepository } from "../repositories/index.js";
import { warmMcpToolLists } from "./mcp.js";

const log = createLogger("agent-warm");

const MCP_WARM_INTERVAL_SECONDS = Number(process.env["MCP_WARM_INTERVAL_SECONDS"] ?? 300);
export const CLAW_USER_HEADER = "x-claw-user";
const AGENT_SLUG = /^[\w-]{1,128}$/;

const router = Router();
const internalRouter = Router();

router.post("/:slug", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "x-user-id header required" });
    return;
  }
  const agent = await agentRepository.findBySlugVisibleTo(req.params.slug, getOrgId(req), userId);
  if (!agent || !isAgentInvocableBy(agent.config as Record<string, unknown> | null, userId)) {
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }
  res.status(202).json({ success: true });
  const claimed = await redisService
    .getConnection()
    .set(`claw:mcp-warm:${userId}:${agent.slug}`, "1", "EX", MCP_WARM_INTERVAL_SECONDS, "NX")
    .catch(() => null);
  if (claimed !== "OK") return;
  await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/agent-warm/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-s2s-key": CONFIG.xyneClawS2sKey,
      [CLAW_USER_HEADER]: userId,
    },
    body: JSON.stringify({ userId, agentSlug: agent.slug }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => log.warn(`[agent-warm] internal warm request failed slug=${agent.slug}: ${errMsg(err)}`));
});

internalRouter.post("/mcp", async (req: Request, res: Response): Promise<void> => {
  const { userId, agentSlug } = (req.body ?? {}) as { userId?: unknown; agentSlug?: unknown };
  if (typeof userId !== "string" || !userId || typeof agentSlug !== "string" || !AGENT_SLUG.test(agentSlug)) {
    res.status(400).json({ success: false, error: "userId and agentSlug are required" });
    return;
  }
  res.status(202).json({ success: true });
  const slug = agentSlug.replace(/[^\w-]/g, "");
  const startedAt = Date.now();
  await warmMcpToolLists(userId, agentSlug)
    .then((servers) => log.info(`[agent-warm] warmed ${servers} MCP server(s) slug=${slug} in ${Date.now() - startedAt}ms`))
    .catch((err) => log.warn(`[agent-warm] warm failed slug=${slug}: ${errMsg(err)}`));
});

export { router as agentWarmRouter, internalRouter as agentWarmInternalRouter };
