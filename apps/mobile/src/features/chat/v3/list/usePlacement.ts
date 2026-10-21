import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { LegendListRef } from '@legendapp/list/react-native';

import type { LandingTarget, OpenState } from '../machine/openState';
import type { ChatRow } from '../model/chatRow.types';
import { landingIdentity } from './landing';
import { placementPlan } from './placement';

type ListRef = RefObject<LegendListRef | null>;

/** Imperative scroll is reanchor only. First mount uses declarative LegendList props. */
export const usePlacement = ({
  listRef,
  rows,
  target,
  dataKey,
  status,
  packAtEnd,
}: {
  listRef: ListRef;
  rows: readonly ChatRow[];
  target: LandingTarget | null;
  dataKey: string;
  status: OpenState['status'];
  packAtEnd: boolean;
}): void => {
  const mountedKey = useRef<string | null>(null);
  const lastIdentity = useRef<string | null>(null);
  const applied = useRef<string | null>(null);
  const identity = target ? landingIdentity(target) : null;
  const isFirstMount = mountedKey.current !== dataKey;
  const isReanchor =
    !isFirstMount &&
    identity !== null &&
    lastIdentity.current !== null &&
    lastIdentity.current !== identity;

  useLayoutEffect(() => {
    mountedKey.current = dataKey;
    lastIdentity.current = identity;
    if (isFirstMount) {
      applied.current = null;
    }
  }, [dataKey, identity, isFirstMount]);

  useLayoutEffect(() => {
    if ((status !== 'placing' && status !== 'ready') || !target) {
      return;
    }
    const plan = placementPlan(rows, target, false, isReanchor, packAtEnd);
    if (plan.mode !== 'imperative') {
      return;
    }
    const list = listRef.current;
    if (!list?.scrollToIndex) {
      return;
    }
    const scrollKey = `${dataKey}:${identity ?? ''}`;
    if (applied.current === scrollKey) {
      return;
    }
    applied.current = scrollKey;
    void list
      .scrollToIndex({
        index: plan.index,
        animated: false,
        viewPosition: plan.viewPosition,
      })
      .catch(() => {
        applied.current = null;
      });
  }, [dataKey, identity, isReanchor, listRef, packAtEnd, rows, status, target]);
};
