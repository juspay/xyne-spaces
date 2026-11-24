import { memo, useMemo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { BUBBLE_MORE_RADIUS } from '../../constants';
import { useSelfFace } from '../../hooks/use-self-face';
import { faceMosaic } from '../../model/bubbles';
import { SenderFace } from '../message-avatar';

type BubbleFacesProps = {
  faceIds: readonly string[];
  /** The 58 bubble's mosaic, or the 34 tile at the start of a list row. */
  tile: 'bubble' | 'row';
};

/**
 * A parked thread's faces: one, two on a diagonal, or three, the last turning
 * "+N" past that. You are drawn as the room draws you.
 */
export const BubbleFaces = memo(function BubbleFaces({
  faceIds,
  tile,
}: BubbleFacesProps): ReactElement {
  const { faces, more } = useMemo(() => faceMosaic(faceIds, tile), [faceIds, tile]);
  const self = useSelfFace();

  return (
    <>
      {faces.map(({ userId, slot }) => (
        <View key={userId} className='absolute' style={{ left: slot.left, top: slot.top }}>
          <SenderFace
            userId={userId}
            displayName={self?.name ?? ''}
            isSelf={userId === self?.id}
            size={slot.size}
          />
        </View>
      ))}
      {more ? (
        <View
          className='absolute items-center justify-center bg-spaces-surface'
          style={{
            left: more.slot.left,
            top: more.slot.top,
            width: more.slot.size,
            height: more.slot.size,
            borderRadius: BUBBLE_MORE_RADIUS,
          }}
        >
          <Text className='text-[10px] font-semibold leading-3 text-spaces-muted'>
            +{more.count}
          </Text>
        </View>
      ) : null}
    </>
  );
});
