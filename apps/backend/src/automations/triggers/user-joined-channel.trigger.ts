import { emitDomainEvent } from '@/events/emitDomainEvent';
import { z } from 'zod';
import { ChannelScopeType } from '@xyne/shared';
import { BaseTrigger, type FilterMatchResult } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import type { UserJoinedChannelEventPayload } from '../types/automation-events';

export const USER_JOINED_CHANNEL_EVENT = 'USER_JOINED_CHANNEL';

/**
 * How the membership row came to exist.
 * - SELF_JOINED: the user joined a public channel themselves.
 * - ADDED_BY_MEMBER: another member added them.
 * - AUTO_JOINED: the platform added them (e.g. the workspace "general" channel on onboarding).
 */
export const UserJoinMethod = {
  SELF_JOINED: 'SELF_JOINED',
  ADDED_BY_MEMBER: 'ADDED_BY_MEMBER',
  AUTO_JOINED: 'AUTO_JOINED',
} as const;
export type UserJoinMethod = (typeof UserJoinMethod)[keyof typeof UserJoinMethod];

const JOIN_METHODS = [
  UserJoinMethod.SELF_JOINED,
  UserJoinMethod.ADDED_BY_MEMBER,
  UserJoinMethod.AUTO_JOINED,
] as const;

/**
 * A channel creator is inserted as a participant in the same mutation that creates
 * the channel. That is "created a channel", not "joined one", so it is not emitted.
 */
const CREATOR_JOIN_WINDOW_MS = 60_000;

const UserJoinedChannelConfigSchema = z.object({
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to these channels. Empty matches every channel.'),
  userIds: z
    .array(z.string())
    .optional()
    .describe('Only fire when one of these users joins. Empty matches anyone.'),
  joinMethods: z
    .array(z.enum(JOIN_METHODS))
    .optional()
    .describe(
      'How the user joined: SELF_JOINED (joined a public channel), ADDED_BY_MEMBER (added by someone), AUTO_JOINED (added by the platform, e.g. the general channel on onboarding). Empty matches all.',
    ),
});

const PersonSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export const UserJoinedChannelOutputSchema = z.object({
  channel: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      visibility: z.string().nullable(),
    })
    .nullable(),
  user: PersonSchema.nullable(),
  addedBy: PersonSchema.nullable(),
  channelId: z.string(),
  userId: z.string(),
  addedById: z.string().nullable(),
  joinMethod: z.enum(JOIN_METHODS),
  role: z.string().nullable(),
  joinedAt: z.coerce.date(),
  /** The membership was removed before the run picked it up. */
  removed: z.boolean(),
});

type UserJoinedChannelConfig = z.infer<typeof UserJoinedChannelConfigSchema>;
type UserJoinedChannelOutput = z.infer<typeof UserJoinedChannelOutputSchema>;

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter((v): v is string => v.length > 0);
}

export class UserJoinedChannelTrigger extends BaseTrigger<typeof UserJoinedChannelConfigSchema> {
  readonly type = USER_JOINED_CHANNEL_EVENT;
  readonly configSchema = UserJoinedChannelConfigSchema;
  readonly outputSchema = UserJoinedChannelOutputSchema;
  readonly name = 'When a user joins a channel';
  readonly description =
    'Fires when a person becomes a member of a channel — by joining it, being added by someone, or being auto-joined. Scope by channel, user, or how they joined. Direct messages are not included.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'UserPlus';
  readonly scopeFilterFields = ['channelIds', 'userIds'] as const;

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return hydrateUserJoinedChannelPayload(payload as unknown as UserJoinedChannelEventPayload);
  }

  override matchFilters(filter: Record<string, unknown>, payload: Record<string, unknown>): boolean {
    return this.matchFiltersDetailed(filter, payload).matched;
  }

  override matchFiltersDetailed(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): FilterMatchResult {
    return matchUserJoinedChannel(
      filter as UserJoinedChannelConfig,
      payload as unknown as UserJoinedChannelOutput,
    );
  }
}

export function matchUserJoinedChannel(
  cfg: UserJoinedChannelConfig,
  p: Pick<UserJoinedChannelOutput, 'channelId' | 'userId' | 'joinMethod'> & { removed?: boolean },
): FilterMatchResult {
  // The user left (or was removed) before the run started — nothing to act on.
  if (p.removed) return { matched: false, failed: 'removed' };

  const channelIds = cleanIds(cfg.channelIds);
  if (channelIds.length > 0 && !channelIds.includes(p.channelId)) {
    return { matched: false, failed: 'channelIds' };
  }
  const userIds = cleanIds(cfg.userIds);
  if (userIds.length > 0 && !userIds.includes(p.userId)) {
    return { matched: false, failed: 'userIds' };
  }
  const joinMethods = Array.isArray(cfg.joinMethods) ? cfg.joinMethods : [];
  if (joinMethods.length > 0 && !joinMethods.includes(p.joinMethod)) {
    return { matched: false, failed: 'joinMethods' };
  }
  return { matched: true };
}

export const userJoinedChannelTrigger = new UserJoinedChannelTrigger();

export interface UserJoinedChannelInput {
  channelId: string;
  userId: string;
  /** Who performed the insert. Equal to userId (or null) for a self-join. */
  actorId?: string | null;
  /** Set when the platform, not a person, added the member. */
  autoJoined?: boolean;
}

/** Pure: how the user joined, given who performed the insert. */
export function resolveJoinMethod(input: UserJoinedChannelInput): UserJoinMethod {
  if (input.autoJoined) return UserJoinMethod.AUTO_JOINED;
  if (!input.actorId || input.actorId === input.userId) return UserJoinMethod.SELF_JOINED;
  return UserJoinMethod.ADDED_BY_MEMBER;
}

/**
 * Fan out the `USER_JOINED_CHANNEL` automation event. Fire-and-forget; resolves the
 * workspace from the channel. Only regular channels (scopeType DEFAULT) emit — DMs,
 * group DMs, ticket and document channels add participants as an implementation
 * detail, not as a "join". Failures are logged and must not fail the membership write.
 */
export async function emitUserJoinedChannel(input: UserJoinedChannelInput): Promise<void> {
  try {
    const channel = await db.channel
      .findUnique({
        where: { id: input.channelId },
        select: { workspaceId: true, scopeType: true, createdBy: true, createdAt: true },
      })
      .catch(() => null);
    if (!channel?.workspaceId) return;
    if (channel.scopeType !== ChannelScopeType.DEFAULT) return;

    // The creator's own membership row lands with the channel itself.
    if (
      channel.createdBy === input.userId &&
      Date.now() - new Date(channel.createdAt).getTime() < CREATOR_JOIN_WINDOW_MS
    ) {
      return;
    }

    const joinMethod = resolveJoinMethod(input);
    await emitDomainEvent(
      {
        type: USER_JOINED_CHANNEL_EVENT,
        payload: {
          channelId: input.channelId,
          userId: input.userId,
          addedById: joinMethod === UserJoinMethod.ADDED_BY_MEMBER ? (input.actorId ?? null) : null,
          joinMethod,
        },
      },
      channel.workspaceId,
    );
  } catch (err) {
    logger.error('[automations] emitUserJoinedChannel failed', {
      channelId: input.channelId,
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function hydrateUserJoinedChannelPayload(
  payload: UserJoinedChannelEventPayload,
): Promise<UserJoinedChannelOutput> {
  const { channelId, userId, addedById, joinMethod } = payload;
  const personSelect = { id: true, name: true, displayName: true, email: true } as const;

  const [channel, participant, user, addedBy] = await Promise.all([
    db.channel
      .findUnique({ where: { id: channelId }, select: { id: true, name: true, visibility: true } })
      .catch(() => null),
    db.channelParticipant
      .findUnique({
        where: { channelId_userId: { channelId, userId } },
        select: { role: true, joinedAt: true },
      })
      .catch(() => null),
    db.user.findUnique({ where: { id: userId }, select: personSelect }).catch(() => null),
    addedById
      ? db.user.findUnique({ where: { id: addedById }, select: personSelect }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const toPerson = (u: typeof user) =>
    u ? { id: u.id, name: u.displayName || u.name || null, email: u.email ?? null } : null;

  return {
    channel: channel
      ? { id: channel.id, name: channel.name ?? null, visibility: channel.visibility ?? null }
      : null,
    user: toPerson(user),
    addedBy: toPerson(addedBy),
    channelId,
    userId,
    addedById: addedById ?? null,
    joinMethod,
    role: participant?.role ?? null,
    joinedAt: participant?.joinedAt ?? new Date(),
    removed: !participant,
  };
}
