import { useCallback, useEffect, type ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useChatInputMentionState, useChatInputPanelState } from '@/src/components/input-composer';
import { useInputComposerMentions } from '@/src/components/input-composer/hooks/useInputComposerMentions';
import type { MentionListItem } from '@/src/components/input-composer/utils/mentions';
import { haptics } from '@/src/utils/haptics';

import { MENTIONS_CARD_ANNOUNCE_DELAY_MS } from '../constants';
import type { BarAnchor } from '../hooks/use-bar-anchor';
import { mentionsCardAnnouncement } from '../model/mentions-card';
import { MentionsCard } from './mentions-card';
import { MentionsCardLayer } from './mentions-card-layer';

type RoomMentionsProps = {
  anchor: BarAnchor;
};

/** Mounted only while open, as the classic list is, so its searches run only then. */
function OpenRoomMentions({ anchor }: RoomMentionsProps): ReactElement {
  const { isChannelMode, items, onSelectItem } = useInputComposerMentions();
  const { mentionQuery } = useChatInputMentionState();

  const pick = useCallback(
    (item: MentionListItem): void => {
      void haptics.selection();
      onSelectItem(item);
    },
    [onSelectItem],
  );

  const announcement = mentionsCardAnnouncement(items.length, isChannelMode);
  // Spoken once typing pauses, so it never cuts off the screen reader echoing each character.
  useEffect(() => {
    const timer = setTimeout(
      () => AccessibilityInfo.announceForAccessibility(announcement),
      MENTIONS_CARD_ANNOUNCE_DELAY_MS,
    );
    return (): void => clearTimeout(timer);
  }, [announcement]);

  return (
    <MentionsCardLayer anchor={anchor}>
      {maxHeight => (
        <MentionsCard
          items={items}
          isChannelMode={isChannelMode}
          query={mentionQuery}
          maxHeight={maxHeight}
          onPick={pick}
        />
      )}
    </MentionsCardLayer>
  );
}

/**
 * The typing bar's @ / # suggestions: the classic mention state and picking,
 * shown as the redesign's floating card. It closes with the mention (a pick,
 * a space, the trigger deleted) and when the field lets go of focus.
 */
export function RoomMentions({ anchor }: RoomMentionsProps): ReactElement | null {
  const { isMentionOpen } = useChatInputMentionState();
  const { isInputFocused } = useChatInputPanelState();
  if (!isMentionOpen || !isInputFocused) return null;
  return <OpenRoomMentions anchor={anchor} />;
}
