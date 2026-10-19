import { ChannelScopeType } from '@xyne/shared';

/**
 * Promotion converts a group DM into a regular channel (`GROUP_DM` → `DEFAULT`).
 *
 * The server mutator rejects every other scope type and every non-participant,
 * so the action is offered only where it can actually succeed. Mirrors
 * dashboard's `showPromoteButton` in `Chat/Info/Info.tsx`.
 */
export const canPromoteConversationToChannel = ({
  scopeType,
  isParticipant,
}: {
  scopeType: string | undefined;
  isParticipant: boolean;
}): boolean => isParticipant && scopeType === ChannelScopeType.GROUP_DM;
