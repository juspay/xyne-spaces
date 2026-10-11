/**
 * Deck progress, kept across launches.
 *
 * The "quit halfway" path in the spec means a person who closes the app mid-deck comes back to
 * the first card they have not done, with their earlier answers intact. Progress is keyed by
 * email so a different account on the same device starts clean.
 */

import { deleteKeys, getJson, setJson } from '@/src/services/localStorage';

import type { OnboardingAnswers } from '../model/answers';

const PROGRESS_KEY = 'onboarding_progress';

interface StoredProgress {
  email: string;
  answers: OnboardingAnswers;
  /** Whether the welcome screen has already played, so a resume goes straight to the deck. */
  welcomeSeen: boolean;
}

export function readProgress(
  email: string,
): { answers: OnboardingAnswers; welcomeSeen: boolean } | null {
  const stored = getJson<StoredProgress>(PROGRESS_KEY);
  if (!stored || stored.email !== email) {
    return null;
  }
  return { answers: stored.answers ?? {}, welcomeSeen: stored.welcomeSeen === true };
}

export function writeProgress(
  email: string,
  answers: OnboardingAnswers,
  welcomeSeen: boolean,
): void {
  setJson(PROGRESS_KEY, { email, answers, welcomeSeen } satisfies StoredProgress);
}

export function clearProgress(): void {
  deleteKeys([PROGRESS_KEY]);
}
