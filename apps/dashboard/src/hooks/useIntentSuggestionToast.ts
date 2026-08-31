/**
 * Renders on-device intent detections as a suggestion toast.
 *
 * Classification happens in a Web Worker, clears its threshold, and surfaces here
 * as a toast with one action — no server call, no agent run, no cost, no latency.
 * This is now the ONLY thing a detection does. The alternative — an agent picking
 * attendees and posting a `call_start` card into the thread — was built, measured
 * at ~77s round-trip, and removed for the first cut. See the note at the top of
 * services/onDeviceIntent/config.ts for how to bring it back.
 *
 * Mounted by ChatInput, which is the only place that has both the channel and
 * conversation context the actions need. This hook owns no modal state — it
 * invokes callbacks the caller supplies, so there is exactly one owner per modal.
 *
 * See docs/ON_DEVICE_INTENT.md
 */
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { intentClassifier, type IntentDetection } from '../services/onDeviceIntent';

/** What a suggestion is allowed to do. One entry per wired destination. */
export interface IntentSuggestionActions {
  openScheduleCall: () => void;
  openCreateTicket: () => void;
  openAddPeople: () => void;
}

interface Suggestion {
  message: string;
  /** Button label, or undefined when the message itself is the whole answer. */
  action?: string;
  run?: (actions: IntentSuggestionActions) => void;
}

/**
 * Copy and destination per detection.
 *
 * Every message follows one shape — "Looks like you are trying to <do the thing>".
 * These fire uninvited while someone is mid-sentence, so a single recognisable
 * opening reads as one feature rather than four unrelated interruptions, and it
 * keeps the hedge ("looks like") on every row — this is a guess, and the copy
 * should never sound more certain than the classifier is.
 *
 * Keyed by `intentId` for single-action intents and `intentId:topicId` for
 * topic-routed ones. The `run` callback lives in the table rather than in the
 * toast call: it used to be a hardcoded `openScheduleCall()` for every entry,
 * which meant adding a second row here would have opened the Schedule Call modal
 * for it. A table that only looks table-driven is worse than an explicit switch.
 *
 * A detection with no row here is SILENT — that is the correct behaviour for an
 * intent wired ahead of its UI, not a blank toast.
 */
const SUGGESTIONS: Record<string, Suggestion> = {
  'start-call': {
    message: 'Looks like you are trying to schedule a call',
    action: 'Schedule Call',
    run: actions => actions.openScheduleCall(),
  },
  // How-to questions. These converge with the intents above where the product has
  // the same destination: "can we hop on a call" and "how do I start a call" are
  // different asks that want the same modal.
  'platform-help:start-call': {
    message: 'Looks like you are trying to start a call',
    action: 'Start Call',
    run: actions => actions.openScheduleCall(),
  },
  'platform-help:create-ticket': {
    message: 'Looks like you are trying to create a ticket',
    action: 'Create Ticket',
    run: actions => actions.openCreateTicket(),
  },
  'platform-help:add-people': {
    message: 'Looks like you are trying to add people to this channel',
    action: 'Add People',
    run: actions => actions.openAddPeople(),
  },
};

/**
 * A suggestion nobody acts on should not linger — it is unsolicited, and the user
 * was in the middle of typing. Long enough to notice and click, short enough to
 * stay out of the way.
 */
const TOAST_DURATION_MS = 12_000;

/**
 * How long a given suggestion stays suppressed after being shown.
 *
 * The per-message toast id only stops the SAME message from stacking duplicates.
 * How-to questions arrive in runs — someone who cannot find the ticket button
 * asks three ways in a row — and being told the same thing three times is how an
 * ambient suggestion turns into a nag. Per key, per session; deliberately not
 * persisted, since a fresh session is a fresh chance to be useful.
 */
const REPEAT_COOLDOWN_MS = 5 * 60 * 1000;

function suggestionKey(detection: IntentDetection): string {
  return detection.topicId ? `${detection.intentId}:${detection.topicId}` : detection.intentId;
}

export function useIntentSuggestionToast(actions: IntentSuggestionActions): void {
  // The subscription must not be torn down and rebuilt on every render, but the
  // handler needs the current callbacks — so it lives in a ref and the effect
  // below subscribes exactly once.
  const onDetection = useRef<(d: IntentDetection) => void>(() => undefined);
  const lastShownAt = useRef<Map<string, number>>(new Map());

  const latestActions = useRef(actions);
  latestActions.current = actions;

  const show = useCallback((detection: IntentDetection): void => {
    const key = suggestionKey(detection);
    const copy = SUGGESTIONS[key];
    if (!copy) return;

    const now = Date.now();
    const shownAt = lastShownAt.current.get(key);
    if (shownAt !== undefined && now - shownAt < REPEAT_COOLDOWN_MS) return;
    lastShownAt.current.set(key, now);

    toast(copy.message, {
      // Stable id keyed on the message: re-classifying the same message replaces
      // its toast instead of stacking duplicates.
      id: `intent-${detection.messageId}`,
      duration: TOAST_DURATION_MS,
      ...(copy.action && copy.run
        ? {
            action: {
              label: copy.action,
              onClick: () => copy.run?.(latestActions.current),
            },
          }
        : {}),
    });
  }, []);

  onDetection.current = show;

  useEffect(() => intentClassifier.subscribe(d => onDetection.current(d)), []);
}
