import type { Request, Response, NextFunction } from "express";
import { userRoleRepository, agentShareRepository } from "../repositories/index.js";
import { agentRepository } from "../repositories/index.js";
import { prisma } from "../db.js";
import { unauthorized } from "../lib/http.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-acl");

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
 * Check whether a user can use Search Evals — a narrower grant than full
 * CLAW_ADMIN, since the feature's "without permission" mode runs an
 * ACL-bypassing search. CLAW_ADMINs always qualify (they can already grant
 * themselves this role); SEARCH_EVAL_ACCESS lets an admin extend access to
 * specific individuals without making them a full CLAW_ADMIN.
 */
export async function hasSearchEvalAccess(userId: string): Promise<boolean> {
  if (!userId) return false;
  if (await isClawAdmin(userId)) return true;
  const role = await userRoleRepository.findByUserAndRole(userId, "SEARCH_EVAL_ACCESS");
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

export function requireRequester(req: Request, message?: string): string {
  const id = getRequesterId(req);
  if (!id) throw unauthorized(message);
  return id;
}

/**
 * Resolve the requesting org ID from the request.
 * Reads `x-org-id` header (set by `requireAuth` — see require-auth.ts).
 */
export function getOrgId(req: Request): string | undefined {
  const id = req.headers["x-org-id"];
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/**
 * Phase-1 org roles. `isOrgOwner` is true only for OWNER; `isOrgAdmin` is true
 * for OWNER or ADMIN (admins share day-to-day powers with owners — see
 * completeplan §9). Both are scoped to a specific org via the OrgMember row.
 */
export async function isOrgOwner(userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false;
  const member = await prisma.orgMember.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { role: true, leftAt: true },
  });
  return Boolean(member && member.leftAt === null && member.role === "OWNER");
}

export async function isOrgAdmin(userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false;
  const member = await prisma.orgMember.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { role: true, leftAt: true },
  });
  return Boolean(member && member.leftAt === null && (member.role === "OWNER" || member.role === "ADMIN"));
}

type AgentRecord = NonNullable<Awaited<ReturnType<typeof agentRepository.findBySlug>>>;

export interface AgentEditAccess {
  agent: AgentRecord;
  isOwner: boolean;
  /** True only for explicit EDITOR/CONTRIBUTOR AgentShare rows. Owners are represented by isOwner. */
  isContributor: boolean;
  /** Existing contributor/edit model: owner OR EDITOR/CONTRIBUTOR share. */
  canEdit: boolean;
}

/**
 * Existing agent contributor/edit ACL: the owner, or a user with an AgentShare
 * role of EDITOR or CONTRIBUTOR. The lookup is org-scoped by the caller's orgId.
 */
export async function getAgentEditAccess(
  userId: string,
  slug: string,
  orgId?: string | null,
): Promise<AgentEditAccess | null> {
  const agent = await agentRepository.findBySlug(slug, orgId);
  if (!agent) return null;

  const isOwner = agent.ownerUserId === userId;
  let isContributor = false;
  if (!isOwner) {
    const share = await agentShareRepository.findByAgentAndUser(agent.id, userId);
    isContributor = share?.role === "EDITOR" || share?.role === "CONTRIBUTOR";
  }

  return {
    agent,
    isOwner,
    isContributor,
    canEdit: isOwner || isContributor,
  };
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
 * Require the requester to have Search Eval access (CLAW_ADMIN or the
 * narrower SEARCH_EVAL_ACCESS role — see hasSearchEvalAccess()).
 */
export async function requireSearchEvalAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id header is required" });
    return;
  }

  const allowed = await hasSearchEvalAccess(requesterId);
  if (!allowed) {
    res.status(403).json({ success: false, error: "Search Eval access required" });
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
  // Phase-2: scope the lookup to the caller's org so an agent in another org is
  // a 404 here (cross-org guard). Falls back to the global lookup when org
  // context is absent (non-requireAuth callers), which is safe while slug is
  // still globally unique.
  const agent = slug ? await agentRepository.findBySlug(slug, getOrgId(req)) : null;
  if (!agent) {
    log.warn(`[agent-acl/owner-or-admin] agent org-scoped miss slug=${slug ?? "none"} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
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
  // Phase-2: org-scoped lookup (cross-org 404); falls back to global when org
  // context is absent. See requireAgentOwnerOrAdmin for the rationale.
  const access = slug ? await getAgentEditAccess(requesterId, slug, getOrgId(req)) : null;
  if (!access) {
    log.warn(`[agent-acl/contributor-or-admin] agent org-scoped miss slug=${slug ?? "none"} orgId=${getOrgId(req) ?? "none"} userId=${requesterId}`);
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }

  const admin = await isClawAdmin(requesterId);
  const isOwner = access.isOwner;
  const isContributor = !admin && access.isContributor;

  if (!admin && !access.canEdit) {
    res.status(403).json({
      success: false,
      error: "Only the agent owner, contributors, or a CLAW_ADMIN can perform this action",
    });
    return;
  }

  (req as Request & { agentContext: AgentContext }).agentContext = {
    agent: access.agent,
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
