import {
  ChannelRole,
  SDLC_HUB_ITEM_FLAT_RELATION,
  SDLC_HUB_PIN_RELATION,
  SDLC_HUB_SKILL_RELATION,
  sdlcHubKnowledgeFolderId,
  type SdlcHubKnowledgeLinks,
  type SdlcHubPin,
} from '@xyne/shared';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { listS2SClawSkills } from '@/services/clawAgentService';
import { readFromYSweet } from '@/utils/ysweetUtils';
import { ensureLink } from './entityLinkService';
import { withSdlcSearchSync } from '@/zero/vespa-injection/core/sdlc-sync';
import { notifySdlcResourceChanged } from './sdlcResourceChanged';
import type { SdlcActor } from './types';

export interface HubKnowledgeDocument {
  title: string;
  markdown: string;
}

export interface HubKnowledge {
  /** Pinned Knowledge Files, in full. */
  documents: HubKnowledgeDocument[];
  /** Every other Knowledge File, by name; the agent reads one when it needs it. */
  files: { canvasId: string; title: string }[];
  /** Claw skill ids. Claw-auth loads only the global ones into a run. */
  skills: { skillId: string; pinned: boolean }[];
  /** Left out when the actor is not a member of an SDLC hub. */
  isHubAdmin?: boolean;
}

const hubSource = (channelId: string) => ({ sourceType: 'CHANNEL', sourceId: channelId });
/**
 * The hub's skill links and pins. Read modes are hub-wide only: the old per-user pins
 * (sourceType USER) are still in the table but never read, so they change nothing.
 */
async function readLinks(channelId: string): Promise<SdlcHubKnowledgeLinks> {
  const edges = await db.sdlcEntityLink.findMany({
    where: {
      channelId,
      ...hubSource(channelId),
      relationType: { in: [SDLC_HUB_SKILL_RELATION, SDLC_HUB_PIN_RELATION] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      sourceType: true,
      targetType: true,
      targetId: true,
      relationType: true,
      createdBy: true,
    },
  });
  const pins = edges.filter((edge) => edge.relationType === SDLC_HUB_PIN_RELATION);
  const skillPins = pins.filter((pin) => pin.targetType === 'SKILL');
  const hubPinned = new Set(skillPins.map((pin) => pin.targetId));
  return {
    pinnedCanvasIds: pins.filter((pin) => pin.targetType === 'CANVAS').map((pin) => pin.targetId),
    skills: edges
      .filter((edge) => edge.relationType === SDLC_HUB_SKILL_RELATION)
      .map((edge) => ({
        skillId: edge.targetId,
        linkedBy: edge.createdBy,
        pinnedForHub: hubPinned.has(edge.targetId),
        pinnedForMe: false,
      })),
  };
}

export async function readHubKnowledge(
  channelId: string,
  actorUserId: string
): Promise<HubKnowledge> {
  const empty: HubKnowledge = { documents: [], files: [], skills: [] };
  const participant = await db.channelParticipant.findFirst({
    where: { channelId, userId: actorUserId, channel: { type: 'SDLC' } },
    select: { role: true },
  });
  if (!participant) return empty;
  const [placements, links] = await Promise.all([
    db.sdlcEntityLink.findMany({
      where: {
        channelId,
        sourceType: 'FOLDER',
        sourceId: sdlcHubKnowledgeFolderId(channelId),
        targetType: 'CANVAS',
        relationType: SDLC_HUB_ITEM_FLAT_RELATION,
      },
      select: { targetId: true },
    }),
    readLinks(channelId),
  ]);
  const canvases =
    placements.length === 0
      ? []
      : await db.canvas.findMany({
          where: {
            id: { in: placements.map((placement) => placement.targetId) },
            channelId,
            sdlcArtifact: { is: { artifactStatus: 'ACTIVE' } },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, content: true, createdBy: true },
        });
  const pinned = new Set(links.pinnedCanvasIds);
  const documents = await Promise.all(
    canvases
      .filter((canvas) => pinned.has(canvas.id))
      .map(async (canvas) => {
        // Admins edit these live, so the collaborative copy is newer than the row.
        const live = await readFromYSweet(canvas.id, canvas.createdBy);
        const blocks = live.length > 0 ? live : (canvas.content as unknown as BlockNoteBlock[]);
        return { title: canvas.title, markdown: await convertBlockNoteToMarkdown(blocks) };
      })
  );
  return {
    documents,
    files: canvases
      .filter((canvas) => !pinned.has(canvas.id))
      .map((canvas) => ({ canvasId: canvas.id, title: canvas.title })),
    skills: links.skills.map((skill) => ({
      skillId: skill.skillId,
      pinned: skill.pinnedForHub,
    })),
    isHubAdmin: participant.role === ChannelRole.ADMIN,
  };
}

async function requireMember(actor: SdlcActor, channelId: string): Promise<{ isAdmin: boolean }> {
  const member = await db.channelParticipant.findFirst({
    where: {
      channelId,
      userId: actor.userId,
      channel: { workspaceId: actor.workspaceId, type: 'SDLC' },
    },
    select: { role: true },
  });
  if (!member) throw new AppError('SDLC hub membership is required', 403);
  return { isAdmin: member.role === ChannelRole.ADMIN };
}

export async function listHubKnowledgeLinks(
  actor: SdlcActor,
  channelId: string
): Promise<SdlcHubKnowledgeLinks> {
  await requireMember(actor, channelId);
  return readLinks(channelId);
}

const skillLink = (channelId: string, skillId: string) => ({
  channelId,
  ...hubSource(channelId),
  targetType: 'SKILL',
  targetId: skillId,
  relationType: SDLC_HUB_SKILL_RELATION,
});

/**
 * Hub admins only. A global skill reaches every member's runs at once. A personal one (always the
 * admin's own: the list holds global skills and the caller's) is linked now but reaches no run
 * until a claw admin makes it global; claw-auth loads only global skills into hub runs.
 */
export async function linkHubSkill(
  actor: SdlcActor,
  channelId: string,
  skillId: string
): Promise<void> {
  const { isAdmin } = await requireMember(actor, channelId);
  if (!isAdmin) throw new AppError('Only a hub admin can add a skill to this hub', 403);
  const skill = (await listS2SClawSkills(actor.userId, actor.workspaceId)).find(
    (candidate) => candidate.id === skillId
  );
  if (!skill) throw new AppError('Skill not found', 404);
  await withSdlcSearchSync(changes => ensureLink(db, skillLink(channelId, skillId), actor, changes));
  notifySdlcResourceChanged('knowledge', { channelId });
}

export async function unlinkHubSkill(
  actor: SdlcActor,
  channelId: string,
  skillId: string
): Promise<void> {
  const { isAdmin } = await requireMember(actor, channelId);
  const removed = await db.sdlcEntityLink.deleteMany({
    where: { ...skillLink(channelId, skillId), ...(isAdmin ? {} : { createdBy: actor.userId }) },
  });
  if (removed.count === 0)
    throw new AppError('Only the member who linked it or a hub admin can unlink', 403);
  await db.sdlcEntityLink.deleteMany({
    where: {
      channelId,
      targetType: 'SKILL',
      targetId: skillId,
      relationType: SDLC_HUB_PIN_RELATION,
    },
  });
  notifySdlcResourceChanged('knowledge', { channelId });
}

/**
 * Sets or clears a hub-wide pin (Always read), hub admins only. The per-user `me` scope is
 * retired: new writes are refused, and old ones are never read (see readLinks).
 */
export async function setHubPin(
  actor: SdlcActor,
  channelId: string,
  { scope, pinned, ...target }: SdlcHubPin
): Promise<void> {
  if (scope !== 'hub') throw new AppError('A read mode applies to the whole hub', 400);
  const { isAdmin } = await requireMember(actor, channelId);
  if (!isAdmin) throw new AppError('Only hub admins change a read mode', 403);
  const pin = {
    channelId,
    ...hubSource(channelId),
    ...target,
    relationType: SDLC_HUB_PIN_RELATION,
  };
  if (!pinned) {
    await db.sdlcEntityLink.deleteMany({ where: pin });
    notifySdlcResourceChanged('knowledge', { channelId });
    return;
  }
  // Only items in the hub; a skill awaiting approval may have its read mode set already.
  const inHub = await db.sdlcEntityLink.findFirst({
    where:
      target.targetType === 'CANVAS'
        ? {
            channelId,
            sourceType: 'FOLDER',
            sourceId: sdlcHubKnowledgeFolderId(channelId),
            ...target,
            relationType: SDLC_HUB_ITEM_FLAT_RELATION,
          }
        : skillLink(channelId, target.targetId),
    select: { id: true },
  });
  if (!inHub) throw new AppError('Not found in Hub Knowledge', 404);
  await withSdlcSearchSync(changes => ensureLink(db, pin, actor, changes));
  notifySdlcResourceChanged('knowledge', { channelId });
}
