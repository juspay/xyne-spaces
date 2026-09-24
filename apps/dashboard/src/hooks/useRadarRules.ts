import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { RadarRule, RadarRuleCondition } from '@xyne/shared';
import {
  createRadarRule,
  deleteRadarRule,
  fetchRadarRules,
  updateRadarRule,
} from '../api/radarApi';

/** Mirrors the server's cap, so the builder can say "full" before saving. */
export const MAX_RULES = 50;
/** Per scope, inside one rule. A longer OR list is a filter, not a rule. */
export const MAX_RULE_VALUES = 20;
/** Per value, mirroring the server. Only ever refuses a paste. */
export const MAX_RULE_VALUE_LENGTH = 100;

export interface RadarRules {
  rules: RadarRule[];
  /** Say so before offering to save — a refusal after the fact loses the draft. */
  atRuleLimit: boolean;
  createRule: (conditions: RadarRuleCondition[]) => void;
  updateRule: (id: string, conditions: RadarRuleCondition[]) => void;
  deleteRule: (id: string) => void;
}

/** Temporary id for an unsaved rule — distinguishable so a failed create rolls
 *  back without taking a real rule with it. */
const draftId = (): string => `pending-${Math.random().toString(36).slice(2, 10)}`;

/** Retries of a failed rules load, then it stops. Bounded because the pane
 *  showing nothing is a display problem, not a reason to hammer the server. */
const RULE_LOAD_RETRIES = 3;
/** Doubles per attempt: 1.5s, 3s, 6s. */
const RULE_LOAD_BACKOFF_MS = 1500;

/** A silent rollback reads as lost work. Prefers the server's own message,
 *  which names the real refusal. */
const rollbackToast =
  (verb: string) =>
  (error: unknown): void => {
    const fromServer = (error as { response?: { data?: { error?: string } } })?.response?.data
      ?.error;
    toast.error(fromServer || `Could not ${verb} that rule. Your rules are unchanged.`);
  };

/**
 * Radar's rules for the signed-in reader, held by the server so the feed can
 * classify against them as it is read. A rule decides placement, never whether
 * a row exists.
 *
 * Mutations apply locally first and reconcile when the request answers; a
 * failure puts the previous list back. `onServerChange` fires only once the
 * server has actually accepted a write, because the verdict on every feed item
 * is computed there — the list on screen is stale until it is re-read.
 */
export const useRadarRules = (
  userId: string | undefined,
  onServerChange?: () => void,
): RadarRules => {
  const [rules, setRules] = useState<RadarRule[]>([]);
  // The list as of right now, so a mutation can compute the next one without an
  // updater callback. Updaters must be pure, and these need to capture what
  // they replaced in order to roll it back — an assignment inside an updater
  // would hand back the already-updated value if React ran it twice.
  const rulesRef = useRef<RadarRule[]>([]);
  const commit = useCallback((next: RadarRule[]): void => {
    rulesRef.current = next;
    setRules(next);
  }, []);

  // Read through a ref so a new callback identity cannot restart the fetch.
  const notify = useRef(onServerChange);
  notify.current = onServerChange;
  const changed = useCallback((): void => notify.current?.(), []);

  /**
   * A failed load has to actually come back, not just be marked as retryable —
   * an empty list means the pane says "no rules" while the server goes on
   * muting, and nothing about a re-render fixes that. Bumping this is what
   * re-runs the effect; clearing a ref could not, since no dependency moved.
   */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const attemptsFor = useRef<{ id: string; failures: number }>({ id: '', failures: 0 });

  useEffect(() => {
    if (!userId) return;
    // A different reader starts over: their rules, and their retry budget.
    if (attemptsFor.current.id !== userId) attemptsFor.current = { id: userId, failures: 0 };
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void fetchRadarRules()
      .then(next => {
        if (!live) return;
        attemptsFor.current.failures = 0;
        commit(next);
      })
      .catch(() => {
        // Empty mutes nothing, so a failed load can only ever show more.
        if (!live) return;
        commit([]);
        if (attemptsFor.current.failures >= RULE_LOAD_RETRIES) return;
        const wait = RULE_LOAD_BACKOFF_MS * 2 ** attemptsFor.current.failures;
        attemptsFor.current.failures += 1;
        timer = setTimeout(() => setLoadAttempt(n => n + 1), wait);
      });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // loadAttempt is the retry trigger; a sign-in resolving after mount moves
    // userId and refetches for the same reason.
  }, [userId, loadAttempt, commit]);

  const atRuleLimit = rules.length >= MAX_RULES;

  const api = useMemo(
    () => ({
      atRuleLimit,
      createRule: (conditions: RadarRuleCondition[]): void => {
        if (conditions.length === 0 || atRuleLimit) return;
        const temp = draftId();
        commit([...rulesRef.current, { id: temp, conditions }]);
        void createRadarRule(conditions)
          .then(saved => {
            commit(rulesRef.current.map(r => (r.id === temp ? saved : r)));
            changed();
          })
          .catch(error => {
            commit(rulesRef.current.filter(r => r.id !== temp));
            rollbackToast('save')(error);
          });
      },
      updateRule: (id: string, conditions: RadarRuleCondition[]): void => {
        if (conditions.length === 0) return;
        const previous = rulesRef.current.find(r => r.id === id);
        commit(rulesRef.current.map(r => (r.id === id ? { id, conditions } : r)));
        void updateRadarRule(id, conditions)
          .then(changed)
          .catch(error => {
            if (previous) commit(rulesRef.current.map(r => (r.id === id ? previous : r)));
            rollbackToast('update')(error);
          });
      },
      deleteRule: (id: string): void => {
        const before = rulesRef.current;
        const at = before.findIndex(r => r.id === id);
        const removed = at >= 0 ? before[at] : undefined;
        commit(before.filter(r => r.id !== id));
        void deleteRadarRule(id)
          .then(changed)
          .catch(error => {
            // Back where it was, not appended: the list is ordered, and a failed
            // delete should leave no trace at all.
            if (removed && at >= 0) {
              const now = rulesRef.current;
              commit([...now.slice(0, at), removed, ...now.slice(at)]);
            }
            rollbackToast('delete')(error);
          });
      },
    }),
    [atRuleLimit, commit, changed],
  );

  return { rules, ...api };
};
