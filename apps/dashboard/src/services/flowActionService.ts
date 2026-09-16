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
    // Ephemeral cards are never persisted, so the server cannot look up which app
    // owns this one. It signs a token into the flow's `data` at post time and
    // re-mints it on every screen advance; read it back out here so neither
    // FlowRenderer nor any other caller has to know the mechanism exists.
    const token = params.flowJSON.data?.['__xyneFlowToken'];

    const body: ActionRequest = {
      actionId: params.actionId,
      type: params.type,
      values: params.values,
      context: {
        flowJSON: params.flowJSON,
        messageId: params.messageId,
        conversationId: params.conversationId,
        ...(typeof token === 'string' && token ? { token } : {}),
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
