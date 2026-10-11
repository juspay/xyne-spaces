import { useCallback, useMemo, useRef, useState } from 'react';

import { EMPTY_ANSWERS, type OnboardingAnswers } from '../model/answers';
import type { OnboardingContext } from '../model/context';
import {
  buildFlow,
  canAdvance,
  firstIncompleteIndex,
  resolveOutcome,
  type CardId,
  type OnboardingOutcome,
} from '../model/flow';
import { readProgress, writeProgress } from '../state/onboarding-progress';

export type DeckDirection = 1 | -1;

export interface OnboardingDeck {
  /** The welcome screen plays once per person; a resumed deck goes straight to the cards. */
  showWelcome: boolean;
  dismissWelcome: () => void;
  flow: readonly CardId[];
  index: number;
  card: CardId;
  answers: OnboardingAnswers;
  /** Which way the last move went, so the card animates in from the right side. */
  direction: DeckDirection;
  canGoBack: boolean;
  canGoNext: boolean;
  isLastCard: boolean;
  answer: (patch: OnboardingAnswers) => void;
  next: () => void;
  back: () => void;
  outcome: OnboardingOutcome;
}

/**
 * Drives the deck: which card is showing, what has been answered, and which way it moves.
 *
 * The flow is derived from the answers on every render rather than stored, so an answer that
 * changes the path (picking a workspace over the community) grows the deck immediately and the
 * dots stay in step. Progress is written on every answer so a kill mid-deck resumes in place.
 */
export function useOnboardingDeck(context: OnboardingContext): OnboardingDeck {
  const restored = useRef(readProgress(context.email)).current;

  const [answers, setAnswers] = useState<OnboardingAnswers>(restored?.answers ?? EMPTY_ANSWERS);
  const [showWelcome, setShowWelcome] = useState(!(restored?.welcomeSeen ?? false));
  const [direction, setDirection] = useState<DeckDirection>(1);
  const [index, setIndex] = useState(() =>
    firstIncompleteIndex(
      buildFlow(context, restored?.answers ?? EMPTY_ANSWERS),
      restored?.answers ?? EMPTY_ANSWERS,
    ),
  );

  const flow = useMemo(() => buildFlow(context, answers), [context, answers]);
  // The flow can shrink under the cursor — answering "community" after having been down the
  // workspace branch drops two cards — so the index is always clamped before it is read.
  const safeIndex = Math.min(index, flow.length - 1);
  const card = flow[safeIndex] as CardId;

  const persist = useCallback(
    (nextAnswers: OnboardingAnswers, welcomeSeen: boolean): void => {
      writeProgress(context.email, nextAnswers, welcomeSeen);
    },
    [context.email],
  );

  const answer = useCallback(
    (patch: OnboardingAnswers): void => {
      setAnswers(current => {
        const merged = { ...current, ...patch };
        persist(merged, true);
        return merged;
      });
    },
    [persist],
  );

  const dismissWelcome = useCallback((): void => {
    setShowWelcome(false);
    persist(answers, true);
  }, [answers, persist]);

  const next = useCallback((): void => {
    setDirection(1);
    setIndex(current => Math.min(current + 1, flow.length - 1));
  }, [flow.length]);

  const back = useCallback((): void => {
    setDirection(-1);
    setIndex(current => Math.max(current - 1, 0));
  }, []);

  return {
    showWelcome,
    dismissWelcome,
    flow,
    index: safeIndex,
    card,
    answers,
    direction,
    canGoBack: safeIndex > 0,
    canGoNext: canAdvance(card, context, answers),
    isLastCard: safeIndex === flow.length - 1,
    answer,
    next,
    back,
    outcome: resolveOutcome(context, answers),
  };
}
