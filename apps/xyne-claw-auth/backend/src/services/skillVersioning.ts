import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { writeAuditLog } from "../lib/audit.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { spacesAppFetch } from "../lib/spaces-api.js";
import { computeSkillDiff, buildSkillAdoptApprovalFlow } from "xyne-claw-shared";
import {
  skillVersionRepository,
  type SnapshotFile,
  type VersionSource,
} from "../repositories/skillVersionRepository.js";
import { agentRequestRepository, userRepository } from "../repositories/index.js";

const log = createLogger("skill-versioning");

function propagationEnabled(): boolean {
  return process.env.SKILL_VERSION_PROPAGATION_ENABLED !== "false";
}

/**
 * Cut a new immutable version of a skill and propagate it to the agents that
 * use it (Point 3 + 4).
 *
 * Propagation policy on a NEW version (v > 1):
 *  - Agents OWNED BY THE EDITOR  → pin auto-advances to the new version.
 *  - Agents owned by ANOTHER user → an adopt request + a Spaces DM diff card is
 *    sent to that owner; the pin only advances if they accept. Until then the
 *    agent keeps running its previously-pinned version.
 *  - Agents with NO owner (org/system agents) → auto-advance (nobody to ask).
 *  - Subagents (org-shared, no per-user owner) → auto-advance.
 *
 * Fully best-effort and fail-open: any propagation error is logged and
 * swallowed so it can never break the edit/approve request that triggered it.
 * Version creation itself is always attempted first and is the durable part.
 */
export async function recordAndPropagateSkillVersion(args: {
  skill: { id: string; slug: string; name: string; orgId: string };
  content: string;
  editorUserId: string | null;
  source: VersionSource;
  files?: SnapshotFile[];
  changelog?: string | null;
}): Promise<void> {
  // Capture the prior current version BEFORE appending — it is the diff base
  // for adopt cards and lets us skip propagation on a no-op save.
  let previous: Awaited<ReturnType<typeof skillVersionRepository.findCurrent>> = null;
  try {
    previous = await skillVersionRepository.findCurrent(args.skill.id);
  } catch (err) {
    log.warn(`[skill-version] findCurrent failed skill=${args.skill.slug}:`, err instanceof Error ? err.message : String(err));
  }

  let appended: Awaited<ReturnType<typeof skillVersionRepository.appendVersion>>;
  try {
    appended = await skillVersionRepository.appendVersion({
      skillId: args.skill.id,
      content: args.content,
      authorUserId: args.editorUserId,
      source: args.source,
      changelog: args.changelog ?? null,
      ...(args.files ? { files: args.files } : {}),
    });
  } catch (err) {
    log.error(`[skill-version] appendVersion failed skill=${args.skill.slug}:`, err);
    return;
  }

  // No new row (idempotent re-save) or the very first version → nothing to
  // propagate. New agents pick up the current version when they attach.
  if (!appended.created || appended.version.version <= 1) return;
  if (!propagationEnabled()) {
    log.info(`[skill-version] propagation disabled; ${args.skill.slug} left at pins unchanged (v${appended.version.version} cut)`);
    return;
  }

  try {
    await propagateNewVersion({
      skill: args.skill,
      editorUserId: args.editorUserId,
      fromContent: previous?.content ?? "",
      fromVersionNumber: previous?.version ?? null,
      fromVersionId: previous?.id ?? null,
      toVersionId: appended.version.id,
      toVersionNumber: appended.version.version,
      toContent: appended.version.content,
    });
  } catch (err) {
    log.error(`[skill-version] propagation failed skill=${args.skill.slug}:`, err);
  }
}

async function propagateNewVersion(ctx: {
  skill: { id: string; slug: string; name: string; orgId: string };
  editorUserId: string | null;
  fromContent: string;
  fromVersionNumber: number | null;
  fromVersionId: string | null;
  toVersionId: string;
  toVersionNumber: number;
  toContent: string;
}): Promise<void> {
  // ── Subagents (org-shared, no per-user owner) → auto-advance every pin. ──
  const subPins = await prisma.subagentSkill.updateMany({
    where: { skillId: ctx.skill.id, NOT: { pinnedVersionId: ctx.toVersionId } },
    data: { pinnedVersionId: ctx.toVersionId },
  });
  if (subPins.count > 0) {
    log.info(`[skill-version] advanced ${subPins.count} subagent pin(s) to v${ctx.toVersionNumber} for ${ctx.skill.slug}`);
  }

  // ── Agents → owner-aware. ──
  const agentPins = await prisma.agentSkill.findMany({
    where: { skillId: ctx.skill.id, NOT: { pinnedVersionId: ctx.toVersionId } },
    include: {
      agent: {
        select: {
          id: true,
          slug: true,
          name: true,
          ownerUserId: true,
          spacesAppId: true,
          spacesAppToken: true,
          spacesAppUserId: true,
        },
      },
    },
  });

  const editorName = (await resolveUserName(ctx.editorUserId)) ?? "an admin";

  for (const pin of agentPins) {
    const agent = pin.agent;
    const ownerIsEditor = !!agent.ownerUserId && agent.ownerUserId === ctx.editorUserId;
    const hasOtherOwner = !!agent.ownerUserId && agent.ownerUserId !== ctx.editorUserId;

    if (!hasOtherOwner || ownerIsEditor) {
      // Editor's own agent, or an ownerless org/system agent → auto-advance.
      await prisma.agentSkill.update({
        where: { id: pin.id },
        data: { pinnedVersionId: ctx.toVersionId },
      });
      await writeAuditLog({
        actorUserId: ctx.editorUserId ?? "system",
        eventType: "SKILL_VERSION_AUTO_ADOPTED",
        targetId: ctx.skill.id,
        description: `Agent "${agent.slug}" auto-advanced to v${ctx.toVersionNumber} of skill "${ctx.skill.name}"`,
      }).catch(() => {});
      continue;
    }

    // Another user's agent → adopt request + DM card to that owner. First FREEZE
    // the agent at the previous version so the approval gate is real: a NULL pin
    // means "follow latest", which would otherwise deliver the new content
    // silently while we are still asking. Concrete pins are left untouched.
    const freezeVersionId = pin.pinnedVersionId ?? ctx.fromVersionId;
    try {
      if (!pin.pinnedVersionId && freezeVersionId) {
        await prisma.agentSkill.update({
          where: { id: pin.id },
          data: { pinnedVersionId: freezeVersionId },
        });
      }
      const { request } = await agentRequestRepository.supersedeAndCreateSkillAdopt({
        skillId: ctx.skill.id,
        skillSlug: ctx.skill.slug,
        agentId: agent.id,
        agentSlug: agent.slug,
        requesterId: ctx.editorUserId ?? "system",
        orgId: ctx.skill.orgId,
        toVersionId: ctx.toVersionId,
        fromVersionId: freezeVersionId,
        proposedContent: ctx.toContent,
      });
      await writeAuditLog({
        actorUserId: ctx.editorUserId ?? "system",
        eventType: "SKILL_VERSION_ADOPT_REQUESTED",
        targetId: ctx.skill.id,
        description: `Adopt request: agent "${agent.slug}" (owner ${agent.ownerUserId}) → v${ctx.toVersionNumber} of skill "${ctx.skill.name}"`,
      }).catch(() => {});

      await notifyAgentOwnerOfAdoptInSpaces({
        approverUserId: agent.ownerUserId!,
        requestId: request.id,
        skillSlug: ctx.skill.slug,
        skillName: ctx.skill.name,
        targetAgentName: agent.name,
        editorName,
        fromVersion: ctx.fromVersionNumber,
        toVersion: ctx.toVersionNumber,
        diff: computeSkillDiff(ctx.fromContent, ctx.toContent),
        agent: {
          slug: agent.slug,
          spacesAppId: agent.spacesAppId,
          spacesAppToken: agent.spacesAppToken,
          spacesAppUserId: agent.spacesAppUserId,
        },
      });
      log.info(`[skill-version] adopt request raised for agent ${agent.slug} owner=${agent.ownerUserId} skill=${ctx.skill.slug} v${ctx.toVersionNumber}`);
    } catch (err) {
      log.warn(`[skill-version] adopt request failed for agent ${agent.slug} skill=${ctx.skill.slug}:`, err instanceof Error ? err.message : String(err));
    }
  }
}

async function resolveUserName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const u = await userRepository.findById(userId);
    return u?.name ?? u?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * DM the AGENT OWNER a card asking whether their agent should adopt the new
 * skill version. Posted with the TARGET agent's own Spaces credentials — the
 * agent tells its owner "I use this skill; it was updated". Best-effort; the
 * adopt request row is authoritative even if the DM fails.
 */
async function notifyAgentOwnerOfAdoptInSpaces(args: {
  approverUserId: string;
  requestId: string;
  skillSlug: string;
  skillName: string;
  targetAgentName: string;
  editorName: string;
  fromVersion: number | null;
  toVersion: number | null;
  diff: ReturnType<typeof computeSkillDiff>;
  agent: {
    slug: string;
    spacesAppId: string | null;
    spacesAppToken: string | null;
    spacesAppUserId: string | null;
  };
}): Promise<void> {
  try {
    const { agent } = args;
    if (!agent.spacesAppId || !agent.spacesAppToken || !agent.spacesAppUserId) {
      log.info(`[skill-version] adopt DM skipped for ${args.skillSlug}: agent ${agent.slug} not Spaces-registered`);
      return;
    }
    const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
    if (!ciphertext || !iv || !authTag) return;
    const token = decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);

    const workspaceId = (await getWorkspaceIdForUser(args.approverUserId, "skill-adopt-owner-dm")) ?? "";
    if (!workspaceId) {
      log.warn(`[skill-version] adopt DM skipped for ${args.skillSlug}: no workspaceId for approver ${args.approverUserId}`);
      return;
    }
    const dm = (await spacesAppFetch("/channel/openDm", {
      targetUserId: args.approverUserId,
      workspaceId,
    }, token)) as { channelId: string };

    const flow = buildSkillAdoptApprovalFlow({
      requestId: args.requestId,
      approverUserId: args.approverUserId,
      skillSlug: args.skillSlug,
      skillName: args.skillName,
      targetAgentName: args.targetAgentName,
      editorName: args.editorName,
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
      diff: args.diff,
      agentSlug: agent.slug,
      spacesAppId: agent.spacesAppId,
      spacesBaseUrl: CONFIG.spacesAppUrl,
    });

    await spacesAppFetch("/chat/postMessage", {
      channelId: dm.channelId,
      flow,
      userId: agent.spacesAppUserId,
    }, token);
    log.info(`[skill-version] sent adopt DM to owner ${args.approverUserId} for agent ${agent.slug} skill=${args.skillSlug}`);
  } catch (err) {
    log.warn(`[skill-version] adopt DM failed for ${args.skillSlug}:`, err instanceof Error ? err.message : String(err));
  }
}
