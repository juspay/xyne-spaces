import { apiInstance } from './clients/apiClient';
import {
  validateAppActionResponse,
  formatValidationErrors,
  type ActionRequest,
  type AppActionResponse,
  type FlowDefinition,
} from '@xyne/shared';

export const flowActionService = {
  /**
   * Execute a flow action.
   * Sends the full current screen JSON (stateless) and returns the app backend response.
   */
  execute: async (params: {
    actionId: string;
    type: 'submit' | 'inputChange';
    values: Record<string, unknown>;
    flowJSON: FlowDefinition;
    messageId: string;
    conversationId: string;
  }): Promise<AppActionResponse> => {
    const body: ActionRequest = {
      actionId: params.actionId,
      type: params.type,
      values: params.values,
      context: {
        flowJSON: params.flowJSON,
        messageId: params.messageId,
        conversationId: params.conversationId,
      },
    };

    const response = await apiInstance.post('/apps/flow/action', body);
    const raw: unknown = response.data;

    const result = validateAppActionResponse(raw);
    if (!result.success) {
      const errors = formatValidationErrors(result);
      throw new Error(`Invalid response from server: ${errors.join(', ')}`);
    }

    return result.data as AppActionResponse;
  },
};
