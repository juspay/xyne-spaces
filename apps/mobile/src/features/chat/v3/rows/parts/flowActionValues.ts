import { withImplicitFlowValues } from '@/src/utils/flowAction';
import { sanitizeUserQuestionAnswers } from '@/src/utils/flowUserQuestionUtils';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

/**
 * Build the values sent to the Flow action endpoint.
 *
 * The server does not accept blank user-question answers. Keep this
 * normalization at the network boundary so the row can keep its richer,
 * user-editable state while every submit/input-change action receives the
 * same validated shape.
 */
export const flowActionValuesFor = (flow: FlowDefinitionLike): Record<string, unknown> => {
  const values = withImplicitFlowValues(flow);
  if (values['answers'] === undefined) return values;

  return {
    ...values,
    answers: sanitizeUserQuestionAnswers(values['answers'] as Record<string, unknown> | undefined),
  };
};
