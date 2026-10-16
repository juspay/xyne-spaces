import { ChannelScopeType } from '@xyne/shared';

/**
 * Backend channel-name resolution — the single source of truth for turning a
 * channel row into a human label in server-generated text (notifications,
 * activity, Slack mirrors).
 *
 * WHY THIS EXISTS
 * ---------------
 * `channel.name` is a complected column: for DEFAULT channels it is a human
 * display name, but for DM / GROUP_DM channels it holds the participant user
 * ids comma-joined (e.g. `"cuidA,cuidB,cuidC"`, sorted). Interpolating it raw
 * into a title (`#${channel.name}`) prints cuids to the user — the exact
 * canvas / call-summary "hashes in the notification" defect.
 *
 * The frontend already isolates this in `useChannelDisplayName` /
 * `ChatDirectory.utils.resolveChannelLabel`. The backend had no equivalent, so
 * every notification builder re-derived (or forgot) the DM branch on its own.
 * This module is the backend counterpart: resolve names in ONE place so the raw
 * id-CSV is never representable in a title again.
 */

export const isDMScope = (scopeType?: ChannelScopeType | null): boolean =>
  scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;

/**
 * DM / GROUP_DM channels store their participant ids comma-joined in `name`.
 * Returns [] for non-DM channels (their `name` is a real display name, not ids).
 */
export const parseDMParticipantIds = (
  name: string | null | undefined,
  scopeType?: ChannelScopeType | null,
): string[] => {
  if (scopeType != null && !isDMScope(scopeType)) return [];
  return (name ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
};

export interface ChannelMentionLabelInput {
  scopeType?: ChannelScopeType | null;
  /** The raw `channel.name` column. */
  name: string | null | undefined;
  /** id -> display label (`displayName || name`) for the DM participants. */
  participantNames: Map<string, string>;
  /**
   * The perspective the label is built for. For a notification this is the
   * viewer/recipient (or the sender) and is excluded from a DM label so we
   * don't name a conversation after the person reading it.
   */
  viewerId?: string | null;
}

export interface ChannelMentionLabel {
  /** Safe, human label. Never a raw id-CSV. */
  label: string;
  /** True for DM / GROUP_DM — callers must NOT prefix a '#'. */
  isDm: boolean;
}

/**
 * Resolve a channel into `{ label, isDm }` for use in a notification title.
 *
 * - DEFAULT / named channels -> `{ label: name, isDm: false }`. Caller prefixes '#'.
 * - DM / GROUP_DM -> the OTHER participants' names (viewer excluded), matching
 *   the frontend's "Alice, Bob and 2 others" convention. Never the id-CSV.
 *
 * Pure and synchronous — the caller is responsible for loading `participantNames`.
 */
export function resolveChannelMentionLabel(
  input: ChannelMentionLabelInput,
): ChannelMentionLabel {
  const { scopeType, name, participantNames, viewerId } = input;

  if (!isDMScope(scopeType)) {
    return { label: name ?? 'a channel', isDm: false };
  }

  const ids = parseDMParticipantIds(name, scopeType);
  const otherIds = ids.filter(id => id !== viewerId);

  // Self-DM: the viewer is the only participant.
  if (otherIds.length === 0) {
    const self = viewerId ? participantNames.get(viewerId) : undefined;
    return { label: self ? `${self} (you)` : 'yourself', isDm: true };
  }

  const names = otherIds
    .map(id => participantNames.get(id))
    .filter((n): n is string => Boolean(n));

  // Participants not resolvable (not loaded / deleted) — a neutral phrase still
  // beats a cuid.
  if (names.length === 0) {
    return { label: 'a direct message', isDm: true };
  }

  if (otherIds.length <= 3) {
    return { label: names.join(', '), isDm: true };
  }

  const visible = names.slice(0, 3);
  const remaining = otherIds.length - visible.length;
  return {
    label: `${visible.join(', ')} and ${remaining} other${remaining > 1 ? 's' : ''}`,
    isDm: true,
  };
}

/**
 * Convenience: the "in <location>" fragment used by mention titles.
 * DEFAULT -> `#name`; DM -> the participant names (no '#').
 */
export function formatMentionLocation(input: ChannelMentionLabelInput): string {
  const { label, isDm } = resolveChannelMentionLabel(input);
  return isDm ? label : `#${label}`;
}
