import {
  formatValidationErrors,
  validateAppActionResponse,
  type ActionRequest,
  type AppActionResponse,
  type FlowDefinition,
} from '@xyne/shared';

import { apiPost } from './apiClient';
import { buildAuthenticatedHeaders } from './authToken';

const FLOW_ACTION_PATH = '/apps/flow/action';

export type ExecuteFlowActionInput = {
  actionId: string;
  type: 'submit' | 'inputChange';
  values: Record<string, unknown>;
  flowJSON: FlowDefinition;
  messageId: string;
  conversationId: string;
};

/**
 * POST /apps/flow/action — same wire contract as dashboard `flowActionService.execute`.
 * Transport owns auth + JSON; this function only builds the ActionRequest and
 * validates the AppActionResponse.
 */
export const executeFlowAction = async (
  input: ExecuteFlowActionInput,
): Promise<AppActionResponse> => {
  const body: ActionRequest = {
    actionId: input.actionId,
    type: input.type,
    values: input.values,
    context: {
      flowJSON: input.flowJSON,
      messageId: input.messageId,
      conversationId: input.conversationId,
    },
  };

  const headers = await buildAuthenticatedHeaders();
  const raw = await apiPost<unknown>(FLOW_ACTION_PATH, JSON.stringify(body), { headers });
  const parsed = validateAppActionResponse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid response from server: ${formatValidationErrors(parsed).join(', ')}`);
  }
  return parsed.data as AppActionResponse;
};
