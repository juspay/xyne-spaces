import { apiPost } from './apiClient';

/**
 * One answered question, as the backend stores it. A type alias rather than an interface so it is
 * assignable to the request body's JSON type, which an interface is not.
 */
export type QuestionnaireAnswer = {
  question: string;
  answer: string;
};

/**
 * Saves the signed-in user's onboarding answers — the dashboard's `saveQuestionnaireResponse`.
 *
 * The backend upserts one `onboarding` row per *email* and reads the row's existence as "this
 * person has onboarded" (that is what turns `is_new_user` off), so call this even with an empty
 * payload when nothing was asked.
 */
export async function saveOnboardingQuestionnaire(
  payload: Record<string, QuestionnaireAnswer>,
  token?: string,
): Promise<void> {
  await apiPost<unknown>(
    '/users/me/questionnaire',
    { questionnaireType: 'onboarding', payload },
    token !== undefined ? { token } : undefined,
  );
}
