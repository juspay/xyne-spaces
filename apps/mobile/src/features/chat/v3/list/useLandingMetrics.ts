import { useCallback, useRef, type RefObject } from 'react';
import type { LegendListRef } from '@legendapp/list/react-native';

import type { ListMetrics, OpenState, LandingTarget } from '../machine/openState';
import type { ChatRow } from '../model/chatRow.types';
import { landingIdentity } from './landing';
import { isPlaced, rowKeyForTarget } from './placement';

type ListRef = RefObject<LegendListRef | null>;

export const useLandingMetrics = ({
  listRef,
  rows,
  target,
  status,
  dataKey,
  onMetrics,
}: {
  listRef: ListRef;
  rows: readonly ChatRow[];
  target: LandingTarget | null;
  status: OpenState['status'];
  dataKey: string;
  onMetrics: ((metrics: ListMetrics) => void) | undefined;
}): (() => void) => {
  const lastSignature = useRef<string | null>(null);

  const report = useCallback((): void => {
    if ((status !== 'placing' && status !== 'ready') || !target || !onMetrics) {
      return;
    }
    const list = listRef.current;
    const viewport = list?.getState?.();
    if (!viewport) {
      return;
    }
    const key = rowKeyForTarget(rows, target);
    const position = key ? viewport.positionByKey(key) : undefined;
    const placed = isPlaced(target, {
      ...(position === undefined ? {} : { position }),
      scroll: viewport.scroll,
      scrollLength: viewport.scrollLength,
      readyToRender: true,
      isAtEnd: viewport.isAtEnd,
    });
    if (!placed) {
      return;
    }
    const signature = `${dataKey}:${landingIdentity(target)}:placed`;
    if (lastSignature.current === signature) {
      return;
    }
    lastSignature.current = signature;
    onMetrics({ targetPlaced: true });
  }, [dataKey, listRef, onMetrics, rows, status, target]);

  return report;
};
