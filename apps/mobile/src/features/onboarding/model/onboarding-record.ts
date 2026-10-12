/**
 * What the deck's answers turn into once there is a session to store them against.
 *
 * Shaped after the dashboard's `QuestionnaireScreen.handleComplete`, so the same person looks the
 * same to the backend whichever client they onboarded on:
 *
 * - **display name and role** go to the user's profile (`userProfile.upsert`, a Zero mutator);
 * - **everything else** goes to `POST /users/me/questionnaire` as `{ question, answer }` pairs.
 *   The backend treats the *existence* of that `onboarding` row as "this email has onboarded"
 *   (it is what flips `is_new_user` off), so it is written even when there is nothing in it.
 *
 * Pure on purpose: the deck is pre-session, so the record is built there and flushed later by
 * `use-flush-pending-onboarding` once the session and Zero exist.
 */

import type { QuestionnaireAnswer } from '@/src/services/onboardingQuestionnaire';

import type { OnboardingAnswers } from './answers';
import type { OnboardingOutcome } from './flow';

export interface PendingOnboarding {
  /** Lower-cased. The record is only flushed for the session that matches it. */
  email: string;
  displayName?: string;
  role?: string;
  /** The `payload` of the `onboarding` questionnaire; `{}` still marks onboarding complete. */
  questionnaire: Record<string, QuestionnaireAnswer>;
}

// The strings the dashboard stores next to each answer. Kept identical so analysis that groups on
// the question text sees one population, not two.
const COMPANY_NAME_QUESTION = 'Company name';
const COMPANY_SIZE_QUESTION = 'Company size';

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : undefined;
}

/**
 * Company name and size are recorded only for an org the person just created — the dashboard's
 * `hasCompanyStep` — which is exactly the `create-org` outcome.
 */
export function buildPendingOnboarding(
  email: string,
  answers: OnboardingAnswers,
  outcome: OnboardingOutcome,
): PendingOnboarding {
  const questionnaire: Record<string, QuestionnaireAnswer> = {};

  if (outcome.kind === 'create-org') {
    const companyName = trimmed(outcome.orgName);
    if (companyName !== undefined) {
      questionnaire['company_name'] = { question: COMPANY_NAME_QUESTION, answer: companyName };
    }
    if (answers.companySize !== undefined) {
      questionnaire['company_size'] = {
        question: COMPANY_SIZE_QUESTION,
        answer: answers.companySize,
      };
    }
  }

  const displayName = trimmed(answers.name);
  const role = trimmed(answers.role);

  return {
    email: normaliseEmail(email),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(role !== undefined ? { role } : {}),
    questionnaire,
  };
}
