import { EMPTY_FACTS, type DataFacts, type LandingTarget } from '../machine/openState';
import { windowContainsTarget, type TargetableRow } from './windowContainsTarget';
import { isAuthoritativeFor } from '../warm/isAuthoritativeFor';
import { hasPaintableWarmRecords } from '../warm/isPaintableWarmRecord';
import type { WarmWindow } from '../warm/warmWindow.types';

export type WindowFactsInput = {
  conversations: readonly TargetableRow[];
  isInitialLoadComplete: boolean;
  hasReachedStart: boolean;
  initialLoadError?: string | null;
};

export const deriveDataFacts = (
  window: WindowFactsInput,
  target: LandingTarget,
  warm: WarmWindow | null = null,
): DataFacts => {
  const liveRows = window.conversations;
  const hasWarmRows = warm !== null && warm.rows.length > 0;
  return {
    ...EMPTY_FACTS,
    hasPaintableRows: liveRows.length > 0 || hasPaintableWarmRecords(warm),
    containsTarget: windowContainsTarget(liveRows, target) || Boolean(warm?.containsTarget),
    hasWarmWindow: hasWarmRows,
    warmContainsTarget: warm?.containsTarget ?? false,
    liveIsAuthoritative: isAuthoritativeFor(
      { rows: liveRows, isSettled: window.isInitialLoadComplete },
      warm,
      target,
    ),
    expansionExhausted: window.hasReachedStart,
    isInitialLoadComplete: window.isInitialLoadComplete,
    liveLoadFailed: Boolean(window.initialLoadError),
  };
};

export const isSameDataFacts = (a: DataFacts, b: DataFacts): boolean =>
  a.hasPaintableRows === b.hasPaintableRows &&
  a.containsTarget === b.containsTarget &&
  a.hasWarmWindow === b.hasWarmWindow &&
  a.warmContainsTarget === b.warmContainsTarget &&
  a.liveIsAuthoritative === b.liveIsAuthoritative &&
  a.expansionExhausted === b.expansionExhausted &&
  a.isInitialLoadComplete === b.isInitialLoadComplete &&
  a.liveLoadFailed === b.liveLoadFailed;
