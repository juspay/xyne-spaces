import type { SelectedMention } from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import type { User, UserGroup } from '../machines/stateMachine';

/** Builds a search's `mentionHighlights` phrases from the active mention chips. */
export type MentionHighlightsBuilder = (
  userMentions: SelectedMention[],
  channelMentions: SelectedMention[],
  userGroupMentions: SelectedMention[],
) => string[];

/**
 * Returns a builder that turns the active mention chips into `mentionHighlights` phrases — every
 * display form a mention could have rendered as in the message text (`@displayName` / `@name` for
 * a user, `@name` / `@alias` for a group), `@`-prefixed so a bare word in prose can't false-match.
 * Callers pass their own id→record maps, so nothing is re-subscribed. Falls back to the chip's own
 * name when an id isn't in the maps (data not yet synced, or the entity isn't in the loaded set).
 */
export function makeMentionHighlightsBuilder(
  usersById: ReadonlyMap<string, User>,
  userGroupsById: ReadonlyMap<string, UserGroup>,
): MentionHighlightsBuilder {
  return (userMentions, channelMentions, userGroupMentions) => {
    const phrases: string[] = [];
    for (const chip of userMentions) {
      const user = usersById.get(chip.id);
      if (user?.displayName) phrases.push(`@${user.displayName}`);
      if (user?.name) phrases.push(`@${user.name}`);
      if (!user && chip.name) phrases.push(`@${chip.name}`);
    }
    // Channels have no display/alias duality — keep their single label (unchanged behavior).
    for (const chip of channelMentions) {
      if (chip.name) phrases.push(chip.name);
    }
    for (const chip of userGroupMentions) {
      const group = userGroupsById.get(chip.id);
      if (group?.name) phrases.push(`@${group.name}`);
      if (group?.alias) phrases.push(`@${group.alias}`);
      if (!group && chip.name) phrases.push(`@${chip.name}`);
    }
    return [...new Set(phrases.filter(Boolean))];
  };
}
