import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { ChatMessageRow } from '../model/chatRow.types';
import { FlowSystemMessageCard } from './parts/FlowSystemMessageCard';
import { NonParticipantMessageCard } from './parts/NonParticipantMessageCard';

type SystemMessageRowProps = {
  row: ChatMessageRow;
};

/**
 * v2 parity (`message-row.tsx` SYSTEM branch): join/add/leave sit in the
 * `conversation-composer-system-*` pill, not as bare muted caption text.
 */
export function SystemMessageRow({ row }: SystemMessageRowProps): ReactElement {
  if (row.model.nonParticipantPreview) {
    return <NonParticipantMessageCard row={row} />;
  }

  if (row.model.isFlowJson && row.model.body.flowParts.length > 0) {
    return (
      <View className='py-1 flex-row justify-center'>
        <FlowSystemMessageCard row={row} />
      </View>
    );
  }

  const text = row.model.body.plainText || row.model.body.markdown;
  if (!text.trim()) {
    return <View style={{ height: 8 }} />;
  }

  return (
    <View className='py-1 flex-row justify-center'>
      <View className='my-4 max-w-[95%] self-center rounded-lg bg-conversation-composer-system-bg p-1.5 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
        <Text className='text-center text-xs font-medium leading-5 tracking-[-0.16px] text-conversation-composer-system-text'>
          {text}
        </Text>
      </View>
    </View>
  );
}
