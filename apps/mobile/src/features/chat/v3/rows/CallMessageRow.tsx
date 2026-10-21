import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import type { ChatMessageRow } from '../model/chatRow.types';
import { CallMessageCard } from './parts/CallMessageCard';
import { JumpHighlight } from './JumpHighlight';
import { RowEntrance } from './RowEntrance';

/** V2's special system-call row: centered card, with actions owned by the card. */
export const CallMessageRow = memo(function CallMessageRow({
  row,
}: {
  row: ChatMessageRow;
}): ReactElement {
  return (
    <JumpHighlight conversationId={row.model.conversationId} enabled={row.model.isHighlighted}>
      <RowEntrance conversationId={row.model.conversationId} enabled={row.model.isEntering}>
        <View className='py-1 flex-row justify-center'>
          <CallMessageCard model={row.model} />
        </View>
      </RowEntrance>
    </JumpHighlight>
  );
});
