/**
 * Resolves which Spaces workspace an awakened agent reads and acts in.
 *
 * Every Spaces query is tenant-scoped, so a wrong or empty workspaceId either
 * fails the ACL check or — worse — reads the wrong tenant.
 *
 * The authoritative answer is the AGENT'S OWN BOT USER. Spaces stores
 * `workspaceId` on every user row, and an agent's bot is a user like any other,
 * so "which workspace is this agent in?" has exactly one answer and needs no
 * configuration. That also makes a multi-workspace org a non-problem: the bot
 * is in one of them, and that is the one it can act in.
 *
 * This used to read ONLY the org→workspace map in SurfaceTenantLink, which was
 * wrong twice over. Nothing in the product ever writes that table for Spaces
 * (the sole writer is prisma/seed.ts, for local dev), so it is empty in
 * production and awakening was the only consumer that treated it as required —
 * it disabled two live agents in prod on 2026-08-26 for an org that had simply
 * never been seeded. And every other consumer already resolves the right way:
 * credentials-loader.ts does bot-user-first for the app-tools MCP.
 *
 * SurfaceTenantLink survives as a FALLBACK for an agent whose bot user cannot
 * be read (Spaces DB unreachable, or a bot row that predates the column).
 */

import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-workspace");

export class WorkspaceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceResolutionError";
  }
}

async function orgLinks(orgId: string): Promise<string[]> {
  const links = await prisma.surfaceTenantLink.findMany({
    where: { orgId, surfaceType: "spaces" },
    select: { surfaceTenantId: true },
    orderBy: { createdAt: "asc" },
  });
  return links.map((l) => l.surfaceTenantId);
}

export async function resolveWorkspaceId(
  orgId: string,
  spacesAppUserId: string | null | undefined,
  configured?: string,
): Promise<string> {
  const botWorkspaceId = spacesAppUserId
    ? await getWorkspaceIdForUser(spacesAppUserId, "awakening").catch(() => null)
    : null;

  if (configured) {
    // An explicit pin must not be able to aim an agent at a tenant its bot is
    // not in — it could not read there anyway, and silently trying is exactly
    // the cross-tenant mistake this function exists to prevent.
    if (botWorkspaceId && configured !== botWorkspaceId) {
      throw new WorkspaceResolutionError(
        `configured workspaceId "${configured}" is not the workspace this agent's bot belongs to ("${botWorkspaceId}")`,
      );
    }
    if (!botWorkspaceId && !(await orgLinks(orgId)).includes(configured)) {
      throw new WorkspaceResolutionError(
        `configured workspaceId "${configured}" is not linked to this org`,
      );
    }
    return configured;
  }

  if (botWorkspaceId) return botWorkspaceId;

  const links = await orgLinks(orgId);
  const first = links[0];
  if (!first) {
    throw new WorkspaceResolutionError(
      "cannot determine this agent's Spaces workspace: its bot user has no workspace in Spaces " +
      "and no Spaces workspace is linked to this org",
    );
  }
  if (links.length > 1) {
    throw new WorkspaceResolutionError(
      `org has ${links.length} linked Spaces workspaces and the agent's bot user could not be read; ` +
      "set config.awakening.workspaceId to pick one",
    );
  }
  log.info(`[awakening] workspace resolved from org link (bot user unreadable) orgId=${orgId} workspaceId=${first}`);
  return first;
}
