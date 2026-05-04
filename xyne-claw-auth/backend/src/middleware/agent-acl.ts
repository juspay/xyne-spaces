import type { Request, Response, NextFunction } from "express";
import { userRoleRepository } from "../repositories/index.js";
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
  };

  next();
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentContext {
  agent: NonNullable<Awaited<ReturnType<typeof agentRepository.findBySlug>>>;
  isAdmin: boolean;
  isOwner: boolean;
}

declare global {
  namespace Express {
    interface Request {
      agentContext?: AgentContext;
    }
  }
}
