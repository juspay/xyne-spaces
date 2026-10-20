import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { AGENT_TAG_PADDING_X, AGENT_TAG_PADDING_Y, AGENT_TAG_RADIUS } from '../constants';

/** "AGENT" beside the name of a bot, app or agent. */
export const AgentTag = memo(function AgentTag(): ReactElement {
  return (
    <View
      className='shrink-0 bg-spaces-surface'
      style={{
        borderRadius: AGENT_TAG_RADIUS,
        paddingHorizontal: AGENT_TAG_PADDING_X,
        paddingVertical: AGENT_TAG_PADDING_Y,
      }}
    >
      <Text className='text-[12px] font-semibold uppercase leading-4 tracking-[0.24px] text-spaces-muted'>
        AGENT
      </Text>
    </View>
  );
});
