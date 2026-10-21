import { ChannelScopeType, ChannelType } from '@xyne/shared';

/**
 * DMs in custom sections.
 *
 * A section can hold DMs as well as channels: membership lives on the user's
 * own `channel_user_status.sectionId` for both, and `channel.moveToSection`
 * takes either. Web shows a sectioned DM inside its section and offers DMs
 * when a section is created or managed. These helpers give the mobile channel
 * lists the same two answers without touching how they pick channels.
 *
 * Pure and dependency-light on purpose, so both channel screens share one rule
 * and the rule is testable without a renderer.
 */

type DmCandidate = {
  id: string;
  type?: ChannelType | string | null | undefined;
  scopeType: ChannelScopeType;
  channelStats?: { lastActivityAt?: number | null | undefined } | null | undefined;
};

type DmStatus = {
  channelId: string;
  isClosed?: boolean | null | undefined;
  sectionId?: string | null | undefined;
};

export const isDmScope = (scopeType: ChannelScopeType): boolean =>
  scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;

const byRecency = <T extends DmCandidate>(a: T, b: T): number =>
  (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0);

/**
 * Every DM and group DM a section may hold: the open ones, freshest first.
 *
 * A DM the user closed is hidden from every other list (web's
 * `groupChannelsByScope` skips it too), so it is not offered here either.
 */
export function selectSectionableDms<T extends DmCandidate>(
  channels: readonly T[],
  statuses: readonly DmStatus[],
): T[] {
  const statusById = new Map(statuses.map(status => [status.channelId, status] as const));
  const result: T[] = [];

  for (const channel of channels) {
    if (channel.type === ChannelType.EMAIL) continue;
    if (!isDmScope(channel.scopeType)) continue;
    if (statusById.get(channel.id)?.isClosed === true) continue;
    result.push(channel);
  }

  return result.sort(byRecency);
}

/**
 * The open DMs filed into a section that still exists.
 *
 * A DM whose section was deleted is left out rather than dropped into the
 * Channels group: unsectioned DMs belong to the DMs tab, not this one.
 */
export function selectSectionedDms<T extends DmCandidate>(
  channels: readonly T[],
  statuses: readonly DmStatus[],
  sections: readonly { id: string }[],
): T[] {
  if (sections.length === 0) return [];
  const sectionIds = new Set(sections.map(section => section.id));
  const statusById = new Map(statuses.map(status => [status.channelId, status] as const));

  return selectSectionableDms(channels, statuses).filter(channel => {
    const sectionId = statusById.get(channel.id)?.sectionId;
    return typeof sectionId === 'string' && sectionIds.has(sectionId);
  });
}
