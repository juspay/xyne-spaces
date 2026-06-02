import type { Request, Response, NextFunction } from "express";
import { userRoleRepository, agentShareRepository } from "../repositories/index.js";
import { agentRepository } from "../repositories/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Check whether a user has CLAW_ADMIN role.
 */
export async function isClawAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const role = await userRoleRepository.findByUserAndRole(userId, "CLAW_ADMIN");
  return Boolean(role);
}

/**
 * Resolve the requesting user ID from the request.
 * Reads `x-user-id` header (set by the caller — Spaces backend or internal service).
 */
export function getRequesterId(req: Request): string | undefined {
  const id = req.headers["x-user-id"];
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

// ── Middleware ─────────────────────────────────────────────────────────────────

/**
 * Require the requester to have CLAW_ADMIN role.
 */
export async function requireClawAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id header is required" });
    return;
  }

  const admin = await isClawAdmin(requesterId);
  if (!admin) {
    res.status(403).json({ success: false, error: "CLAW_ADMIN role required" });
    return;
  }

  next();
}

/**
 * Require the requester to be the agent's owner OR a CLAW_ADMIN.
 */
export async function requireAgentOwnerOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id header is required" });
    return;
  }

  const slug = req.params["slug"] as string | undefined;
  const agent = slug ? await agentRepository.findBySlug(slug) : null;
  if (!agent) {
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }

  const admin = await isClawAdmin(requesterId);
  const isOwner = agent.ownerUserId === requesterId;

  if (!admin && !isOwner) {
    res.status(403).json({
      success: false,
      error: "Only the agent owner or a CLAW_ADMIN can perform this action",
    });
    return;
  }

  (req as Request & { agentContext: AgentContext }).agentContext = {
    agent,
    isAdmin: admin,
    isOwner,
    isContributor: false,
  };

  next();
}

/**
 * Like requireAgentOwnerOrAdmin, but also accepts contributors (users with an
 * AgentShare row of role EDITOR or CONTRIBUTOR). Used for routes where
 * contributors should be able to act (e.g. agent-pinned MCP credentials,
 * agent-level skill attachments) but where SHARE MANAGEMENT itself should
 * stay owner-only to prevent privilege escalation between contributors.
 */
export async function requireAgentOwnerContributorOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id header is required" });
    return;
  }

  const slug = req.params["slug"] as string | undefined;
  const agent = slug ? await agentRepository.findBySlug(slug) : null;
  if (!agent) {
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }

  const admin = await isClawAdmin(requesterId);
  const isOwner = agent.ownerUserId === requesterId;
  let isContributor = false;
  if (!admin && !isOwner) {
    const share = await agentShareRepository.findByAgentAndUser(agent.id, requesterId);
    isContributor = share?.role === "EDITOR" || share?.role === "CONTRIBUTOR";
  }

  if (!admin && !isOwner && !isContributor) {
    res.status(403).json({
      success: false,
      error: "Only the agent owner, contributors, or a CLAW_ADMIN can perform this action",
    });
    return;
  }

  (req as Request & { agentContext: AgentContext }).agentContext = {
    agent,
    isAdmin: admin,
    isOwner,
    isContributor,
  };

  next();
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentContext {
  agent: NonNullable<Awaited<ReturnType<typeof agentRepository.findBySlug>>>;
  isAdmin: boolean;
  isOwner: boolean;
  /** True if the requester has an EDITOR/CONTRIBUTOR share row. Always false
   *  when isOwner or isAdmin is true (short-circuit). */
  isContributor: boolean;
}

declare global {
  namespace Express {
    interface Request {
      agentContext?: AgentContext;
    }
  }
}
