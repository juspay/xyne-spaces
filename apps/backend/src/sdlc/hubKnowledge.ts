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
  /** Claw skill ids. Claw-auth drops the ones this user may not read. */
  skills: { skillId: string; pinned: boolean }[];
}

const hubSource = (channelId: string) => ({ sourceType: 'CHANNEL', sourceId: channelId });
const userSource = (userId: string) => ({ sourceType: 'USER', sourceId: userId });

/** The hub's skill links and pins, plus the pins this user set for their own runs. */
async function readLinks(channelId: string, userId: string): Promise<SdlcHubKnowledgeLinks> {
  const edges = await db.sdlcEntityLink.findMany({
    where: {
      channelId,
      OR: [
        {
          ...hubSource(channelId),
          relationType: { in: [SDLC_HUB_SKILL_RELATION, SDLC_HUB_PIN_RELATION] },
        },
        { ...userSource(userId), relationType: SDLC_HUB_PIN_RELATION },
      ],
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
  const pinnedBy = (sourceType: string) =>
    new Set(skillPins.filter((pin) => pin.sourceType === sourceType).map((pin) => pin.targetId));
  const hubPinned = pinnedBy('CHANNEL');
  const myPinned = pinnedBy('USER');
  return {
    pinnedCanvasIds: pins.filter((pin) => pin.targetType === 'CANVAS').map((pin) => pin.targetId),
    skills: edges
      .filter((edge) => edge.relationType === SDLC_HUB_SKILL_RELATION)
      .map((edge) => ({
        skillId: edge.targetId,
        linkedBy: edge.createdBy,
        pinnedForHub: hubPinned.has(edge.targetId),
        pinnedForMe: myPinned.has(edge.targetId),
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
    select: { id: true },
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
    readLinks(channelId, actorUserId),
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
      pinned: skill.pinnedForHub || skill.pinnedForMe,
    })),
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
  return readLinks(channelId, actor.userId);
}

const skillLink = (channelId: string, skillId: string) => ({
  channelId,
  ...hubSource(channelId),
  targetType: 'SKILL',
  targetId: skillId,
  relationType: SDLC_HUB_SKILL_RELATION,
});

/**
 * A hub admin links a global skill, which every member's runs then get by name.
 * A member links only their own personal skill, which reaches only their runs.
 * Open door: when that personal skill is later made global, its name and description reach
 * every member's runs with no hub admin step. Close it here when hub approval exists.
 */
export async function linkHubSkill(
  actor: SdlcActor,
  channelId: string,
  skillId: string
): Promise<void> {
  const { isAdmin } = await requireMember(actor, channelId);
  // The list holds global skills and the caller's own, so a personal one found here is theirs.
  const skill = (await listS2SClawSkills(actor.userId, actor.workspaceId)).find(
    (candidate) => candidate.id === skillId
  );
  if (!skill) throw new AppError('Skill not found', 404);
  if (skill.scope === 'global' && !isAdmin) {
    throw new AppError('Only a hub admin can link a global skill', 403);
  }
  await ensureLink(db, skillLink(channelId, skillId), actor);
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
}

/**
 * Sets or clears one pin. See SDLC_HUB_PIN_RELATION for the two kinds.
 * - `hub`: hub admins only, on a Knowledge File or a global skill.
 * - `me`: any member, on a Linked Skill they can use. Knowledge Files have no personal pin.
 */
export async function setHubPin(
  actor: SdlcActor,
  channelId: string,
  { scope, pinned, ...target }: SdlcHubPin
): Promise<void> {
  const { isAdmin } = await requireMember(actor, channelId);
  const forHub = scope === 'hub';
  if (forHub && !isAdmin) throw new AppError('Only hub admins can pin for everyone', 403);
  if (!forHub && target.targetType === 'CANVAS') {
    throw new AppError('Knowledge Files are pinned for everyone, by a hub admin', 400);
  }
  const pin = {
    channelId,
    ...(forHub ? hubSource(channelId) : userSource(actor.userId)),
    ...target,
    relationType: SDLC_HUB_PIN_RELATION,
  };
  if (!pinned) {
    await db.sdlcEntityLink.deleteMany({ where: pin });
    return;
  }
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
  if (target.targetType === 'SKILL') {
    // The list holds global skills and the caller's own, so a miss is someone else's personal skill.
    const skill = (await listS2SClawSkills(actor.userId, actor.workspaceId)).find(
      (candidate) => candidate.id === target.targetId
    );
    if (!skill) throw new AppError('Skill not found', 404);
    if (forHub && skill.scope !== 'global') {
      throw new AppError('A personal skill can be pinned only for yourself', 400);
    }
  }
  await ensureLink(db, pin, actor);
}
