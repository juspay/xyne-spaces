import type { FlowPlan } from '@xyne/shared';
import { validateFlowDecisionFields as validateDecisionFields } from '@/services/flowDecisionFieldValidator';
import { zql } from '../queries';
import type { UnreadableTransaction } from '../unreadableTransaction';

/** Validate decision form fields through the current ACL-wrapped Zero transaction. */
export async function validateFlowDecisionFields(
  tx: UnreadableTransaction,
  plan: FlowPlan
): Promise<void> {
  await validateDecisionFields(plan, (fieldId) =>
    tx.run(zql.form_fields.where('id', fieldId).related('globalField').one())
  );
}
