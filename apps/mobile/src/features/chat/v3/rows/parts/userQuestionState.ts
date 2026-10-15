import type { UserQuestionItem } from '@/src/utils/flowUserQuestionUtils';

export type { UserQuestionItem } from '@/src/utils/flowUserQuestionUtils';

export const mergeFlowQuestionAnswer = (
  current: Record<string, string | string[]>,
  questionId: string,
  value: string | string[],
): Record<string, string | string[]> => ({
  ...current,
  [questionId]: value,
});

export const removeFlowQuestionAnswer = (
  answers: Record<string, string | string[]>,
  question: UserQuestionItem,
): Record<string, string | string[]> => {
  if (!(question.id in answers)) return answers;
  const next = { ...answers };
  delete next[question.id];
  return next;
};
