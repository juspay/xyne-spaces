import { createContext, useContext } from 'react';

/** How a step (or section) differs between the two versions being compared. */
export type DiffMark = 'added' | 'removed' | 'changed' | 'moved';

/** Keys for the non-step sections; steps are keyed by their id. */
export const TRIGGER_DIFF_KEY = 'trigger';
/** The List view shows the trigger's type and its filters in separate sections. */
export const TRIGGER_TYPE_DIFF_KEY = 'trigger.type';
export const TRIGGER_CONFIG_DIFF_KEY = 'trigger.config';
export const SCHEDULE_DIFF_KEY = 'schedule';

export interface DiffHighlightValue {
  /** The older version reads red, the newer green — whichever pane it is in. */
  tone: 'old' | 'new';
  marks: ReadonlyMap<string, DiffMark>;
}

/** Provided by the version compare view and approval review; null elsewhere, so cards render as usual. */
export const DiffHighlightContext = createContext<DiffHighlightValue | null>(null);

export interface ResolvedDiffMark {
  mark: DiffMark;
  tone: DiffHighlightValue['tone'];
}

export function useDiffMark(key: string): ResolvedDiffMark | null {
  const ctx = useContext(DiffHighlightContext);
  const mark = ctx?.marks.get(key);
  return ctx && mark ? { mark, tone: ctx.tone } : null;
}

export function diffHighlightClass(diff: ResolvedDiffMark): string {
  return diff.tone === 'old'
    ? 'ring-2 ring-red-500/60 bg-red-500/5'
    : 'ring-2 ring-green-500/60 bg-green-500/5';
}
