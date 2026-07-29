import { db } from '@/database/client';
import { UserRepository } from '@/database/repositories/users';
import { extractEmailAddress } from '@/utils/email';

const userRepository = new UserRepository();

type TelephonyAgentMapping = Record<string, { agentId: string; skill?: string }>;

function normalizeMappingValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function resolveTelephonyAgentUserId(
  workspaceId: string,
  metadata: Record<string, unknown>,
  currentAgentUserId?: string | null,
  agentMapping: TelephonyAgentMapping = {},
): Promise<string | null> {
  const liveAgentUserId =
    typeof metadata.liveAgentUserId === 'string' ? metadata.liveAgentUserId.trim() : '';
  if (liveAgentUserId) {
    const liveUserId = await resolveWorkspaceUserId(workspaceId, liveAgentUserId);
    if (liveUserId) return liveUserId;
  }

  const agentId = typeof metadata.agentId === 'string' ? metadata.agentId.trim() : '';
  const mappedUserId = await resolveMappedAgentUserId(workspaceId, metadata, agentMapping);
  if (mappedUserId) return mappedUserId;

  const agentEmail = extractEmailAddress(agentId);
  if (!agentEmail) {
    return resolveWorkspaceUserId(workspaceId, currentAgentUserId);
  }

  const user = await userRepository.findByEmailCaseInsensitive(agentEmail, workspaceId);
  if (user) return user.id;

  return resolveWorkspaceUserId(workspaceId, currentAgentUserId);
}

async function resolveWorkspaceUserId(
  workspaceId: string,
  candidate: string | null | undefined,
): Promise<string | null> {
  const normalizedCandidate = candidate?.trim();
  if (!normalizedCandidate) return null;

  const user = await db.user.findFirst({
    where: {
      workspaceId,
      OR: [
        { id: normalizedCandidate },
        { email: { equals: normalizedCandidate, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function resolveMappedAgentUserId(
  workspaceId: string,
  metadata: Record<string, unknown>,
  agentMapping: TelephonyAgentMapping,
): Promise<string | null> {
  const agentId = normalizeMappingValue(metadata.agentId);
  if (!agentId) return null;

  const skill = normalizeMappingValue(metadata.skill);
  const mappedUserId = Object.entries(agentMapping).find(([, mapping]) => {
    if (normalizeMappingValue(mapping.agentId) !== agentId) return false;
    const mappedSkill = normalizeMappingValue(mapping.skill);
    return !mappedSkill || mappedSkill === skill;
  })?.[0]?.trim();

  if (!mappedUserId) return null;

  return resolveWorkspaceUserId(workspaceId, mappedUserId);
}
