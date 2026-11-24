import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import { BUBBLE_RADIUS, BUBBLE_SHADOW, BUBBLE_SIZE } from '../../constants';
import type { BubbleAgentState } from '../../model/bubbles';
import { BubbleReadyDot, BubbleWorkingBadge } from './bubble-badges';
import { BubbleFaces } from './bubble-faces';

type BubbleThreadProps = {
  faceIds: readonly string[];
  agent: BubbleAgentState;
};

/**
 * Figma "Bubble / Thread": the front parked thread as a 58 tile of its faces,
 * with the agent's state on its corners (working bottom left, answered top
 * right). Drawing only: the stack owns its gestures and position.
 */
export const BubbleThread = memo(function BubbleThread({
  faceIds,
  agent,
}: BubbleThreadProps): ReactElement {
  return (
    <View
      className='bg-spaces-surface-raised'
      style={{
        width: BUBBLE_SIZE,
        height: BUBBLE_SIZE,
        borderRadius: BUBBLE_RADIUS,
        boxShadow: BUBBLE_SHADOW,
      }}
    >
      <BubbleFaces faceIds={faceIds} tile='bubble' />
      {agent.kind === 'working' ? <BubbleWorkingBadge /> : null}
      {agent.kind === 'answered' ? <BubbleReadyDot /> : null}
    </View>
  );
});
