/**
 * Pure Flow-action helpers. No HTTP, no React.
 *
 * Dashboard posts the same shapes to `/apps/flow/action`. This module is the
 * client contract: parse a button action, validate screen JSON, and fold the
 * app response into the current screen.
 */

import {
  validateFlowDefinition,
  type AppActionResponse,
  type FlowAction,
  type FlowDefinition,
  type FlowState,
} from '@xyne/shared';

import { getDefaultAgentCapabilitySelection } from '@/src/utils/flowAgentUtils';
import type { FlowComponentLike, FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

const EMPTY_FLOW_STATE: FlowState = {
  values: {},
  touched: {},
  errors: {},
  submitting: false,
  submitted: false,
  history: [],
  loadingComponentIds: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export type FlowNetworkAction = Extract<FlowAction, { type: 'submit' | 'inputChange' }>;

export type FlowActionTarget = {
  messageId: string;
  conversationId: string;
  canExecute: boolean;
};

export const resolveFlowActionTarget = (input: {
  messageId?: string | null | undefined;
  conversationId?: string | null | undefined;
  fallbackMessageId?: string | null | undefined;
  fallbackConversationId?: string | null | undefined;
  isForwarded: boolean;
}): FlowActionTarget => {
  const messageId = (input.messageId || input.fallbackMessageId || '').trim();
  const summaryConversationId = input.conversationId?.trim() ?? '';
  const fallbackConversationId = input.fallbackConversationId?.trim() ?? '';
  // Thread rows reuse the message id as conversationId for list identity. That
  // is not the Spaces conversation id `/apps/flow/action` expects.
  const conversationId =
    summaryConversationId ||
    (fallbackConversationId && fallbackConversationId !== messageId ? fallbackConversationId : '');
  return {
    messageId,
    conversationId,
    canExecute: !input.isForwarded && messageId.length > 0 && conversationId.length > 0,
  };
};

export const parseFlowAction = (props: Record<string, unknown> | undefined): FlowAction | null => {
  const action = props?.['action'];
  if (!isRecord(action) || typeof action['type'] !== 'string') return null;

  if (action['type'] === 'submit') {
    const actionId = optionalString(action['actionId']);
    if (!actionId) return null;
    const successMessage = optionalString(action['successMessage']);
    const errorMessage = optionalString(action['errorMessage']);
    return {
      type: 'submit',
      actionId,
      ...(successMessage ? { successMessage } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };
  }

  if (action['type'] === 'inputChange') {
    const actionId = optionalString(action['actionId']);
    if (!actionId) return null;
    return {
      type: 'inputChange',
      actionId,
      ...(typeof action['debounceMs'] === 'number' ? { debounceMs: action['debounceMs'] } : {}),
    };
  }

  if (action['type'] === 'update_state' && isRecord(action['stateUpdates'])) {
    const successMessage = optionalString(action['successMessage']);
    return {
      type: 'update_state',
      stateUpdates: action['stateUpdates'],
      ...(successMessage ? { successMessage } : {}),
    };
  }

  if (action['type'] === 'close_screen') {
    const finalMessage = optionalString(action['finalMessage']);
    return {
      type: 'close_screen',
      ...(finalMessage ? { finalMessage } : {}),
    };
  }

  if (action['type'] === 'navigate') {
    const target = optionalString(action['target']);
    return target ? { type: 'navigate', target } : null;
  }

  return null;
};

export const isFlowNetworkAction = (action: FlowAction | null): action is FlowNetworkAction =>
  action?.type === 'submit' || action?.type === 'inputChange';

export type FlowActionButton = {
  key: string;
  label: string;
  variant: string;
  action: FlowAction;
};

export const implicitActionsForComponent = (
  component: FlowComponentLike,
  key: string,
): FlowActionButton[] => {
  const props = isRecord(component.props) ? component.props : undefined;
  const phase = optionalString(props?.['phase']);

  if (component.type === 'plan' && phase === 'proposed') {
    if (props?.['superseded'] === true || props?.['rejected'] === true) return [];
    return [
      {
        key: `${key}-plan-approve`,
        label: 'Approve',
        variant: 'primary',
        action: { type: 'submit', actionId: 'plan-approve' },
      },
      {
        key: `${key}-plan-reject`,
        label: 'Reject',
        variant: 'secondary',
        action: { type: 'submit', actionId: 'plan-reject' },
      },
    ];
  }

  if (component.type === 'call_schedule' && phase === 'proposed') {
    return [
      {
        key: `${key}-schedule-approve`,
        label: 'Approve',
        variant: 'primary',
        action: { type: 'submit', actionId: 'schedule-approve' },
      },
    ];
  }

  if (component.type === 'agent') {
    const variant = optionalString(props?.['variant']) ?? 'draft';
    const agentPhase = optionalString(props?.['phase']) ?? 'pending';
    if (variant !== 'draft' || agentPhase !== 'pending') return [];
    return [
      {
        key: `${key}-agent-decline`,
        label: 'Decline',
        variant: 'danger',
        action: { type: 'submit', actionId: 'agent-draft-decline' },
      },
      {
        key: `${key}-agent-create`,
        label: 'Create Agent',
        variant: 'primary',
        action: { type: 'submit', actionId: 'agent-draft-approve' },
      },
    ];
  }

  return [];
};

export const listFlowActionButtons = (flow: FlowDefinitionLike): FlowActionButton[] => {
  const buttons: FlowActionButton[] = [];

  const walk = (components: FlowComponentLike[] | undefined, parentKey: string): void => {
    if (!components) return;
    components.forEach((component, index) => {
      const key =
        typeof component.id === 'string' && component.id.trim()
          ? `${parentKey}-${component.id}`
          : `${parentKey}-${index}`;
      if (component.type === 'button') {
        const props = isRecord(component.props) ? component.props : undefined;
        const action = parseFlowAction(props);
        if (action) {
          buttons.push({
            key,
            label: optionalString(props?.['label']) || 'Button',
            variant: optionalString(props?.['variant']) || 'secondary',
            action,
          });
        }
      }
      buttons.push(...implicitActionsForComponent(component, key));
      if (Array.isArray(component.children)) walk(component.children, key);
    });
  };

  walk(flow.components, 'flow');
  return buttons;
};

export const mergeFlowStateValues = (
  current: FlowDefinitionLike,
  updates: Record<string, unknown>,
): FlowDefinitionLike => ({
  ...current,
  state: {
    ...current.state,
    values: { ...(current.state?.values ?? {}), ...updates },
  },
});

export const withImplicitFlowValues = (flow: FlowDefinitionLike): Record<string, unknown> => {
  const values: Record<string, unknown> = { ...(flow.state?.values ?? {}) };

  const walk = (components: FlowComponentLike[] | undefined): void => {
    if (!components) return;
    for (const component of components) {
      const id = typeof component.id === 'string' ? component.id.trim() : '';
      const props = isRecord(component.props) ? component.props : undefined;
      const phase = optionalString(props?.['phase']);

      if (component.type === 'plan' && id && phase === 'proposed' && values[id] === undefined) {
        const todos = Array.isArray(props?.['todos']) ? props['todos'] : [];
        values[id] = todos
          .filter(isRecord)
          .filter(todo => todo['included'] === true)
          .map(todo => optionalString(todo['id']))
          .filter((todoId): todoId is string => Boolean(todoId));
      }

      if (
        component.type === 'call_schedule' &&
        id &&
        phase === 'proposed' &&
        values[id] === undefined
      ) {
        const slots = Array.isArray(props?.['slots']) ? props['slots'] : [];
        const firstSlot = slots.find(isRecord);
        values[id] = {
          slotId:
            optionalString(props?.['defaultSlotId']) || optionalString(firstSlot?.['id']) || '',
          duration:
            props?.['defaultDuration'] === 30 ||
            props?.['defaultDuration'] === 45 ||
            props?.['defaultDuration'] === 60
              ? props['defaultDuration']
              : 30,
        };
      }

      if (component.type === 'agent' && id === 'agent' && values[id] === undefined) {
        const seeded = getDefaultAgentCapabilitySelection(props);
        if (seeded.length > 0) values[id] = seeded;
      }

      if (component.type === 'user_question') {
        if (values['answers'] === undefined) values['answers'] = {};
        if (values['notes'] === undefined) values['notes'] = {};
      }

      if (Array.isArray(component.children)) walk(component.children);
    }
  };

  walk(flow.components);
  return values;
};

export const applyClientFlowAction = (
  current: FlowDefinitionLike,
  action: FlowAction,
): { flow: FlowDefinitionLike; toastMessage?: string } => {
  if (action.type === 'update_state') {
    return {
      flow: mergeFlowStateValues(current, action.stateUpdates),
      ...(action.successMessage ? { toastMessage: action.successMessage } : {}),
    };
  }
  if (action.type === 'close_screen') {
    return {
      flow: current,
      ...(action.finalMessage ? { toastMessage: action.finalMessage } : {}),
    };
  }
  if (action.type === 'navigate') {
    return { flow: current };
  }
  return { flow: current };
};

export const toValidatedFlowDefinition = (flow: FlowDefinitionLike): FlowDefinition | null => {
  if (typeof flow.screenId !== 'string' || !flow.screenId.trim()) return null;
  if (!Array.isArray(flow.components) || flow.components.length === 0) return null;

  const stateValues =
    isRecord(flow.state) && isRecord(flow.state['values']) ? flow.state['values'] : {};
  const candidate = {
    version: '2.0' as const,
    screenId: flow.screenId,
    ...(typeof flow.title === 'string' ? { title: flow.title } : {}),
    components: flow.components,
    ...(isRecord(flow.data) ? { data: flow.data } : {}),
    state: {
      ...EMPTY_FLOW_STATE,
      ...(isRecord(flow.state) ? flow.state : {}),
      values: stateValues,
    },
  };

  const result = validateFlowDefinition(candidate);
  if (result.success) return result.data as FlowDefinition;

  // Mobile's linked @xyne/shared can lag behind agent artifact types
  // (user_question, plan, chart, call_schedule, mcp_suggest, …). When zod only rejects
  // unknown component discriminators, still allow a shape-checked payload so
  // Submit can round-trip the same values dashboard posts.
  if (isUnknownComponentTypeValidationError(result.error)) {
    return candidate as FlowDefinition;
  }

  return null;
};

const isUnknownComponentTypeValidationError = (error: {
  issues: ReadonlyArray<{ code: string; path: PropertyKey[] }>;
}): boolean =>
  error.issues.length > 0 &&
  error.issues.every(
    issue =>
      issue.code === 'invalid_union_discriminator' &&
      issue.path.length >= 3 &&
      issue.path[0] === 'components' &&
      issue.path[2] === 'type',
  );

const collectRequiredFieldNames = (
  components: FlowComponentLike[] | undefined,
  names: string[] = [],
): string[] => {
  if (!components) return names;
  for (const component of components) {
    const props = isRecord(component.props) ? component.props : undefined;
    const name = optionalString(props?.['name']);
    if (props?.['required'] === true && name) names.push(name);
    if (Array.isArray(component.children)) collectRequiredFieldNames(component.children, names);
  }
  return names;
};

export const hasMissingRequiredFlowValues = (
  components: FlowComponentLike[] | undefined,
  values: Record<string, unknown>,
): boolean =>
  collectRequiredFieldNames(components).some(name => {
    const value = values[name];
    return value === undefined || value === null || value === '';
  });

type ComponentUpdates = NonNullable<
  Extract<AppActionResponse, { type: 'update_screen_data' }>['componentUpdates']
>;

const patchFlowComponents = (
  components: FlowComponentLike[] | undefined,
  updates: ComponentUpdates,
): FlowComponentLike[] | undefined => {
  if (!components) return components;
  return components.map(component => {
    const id = typeof component.id === 'string' ? component.id : '';
    const patch = id ? updates[id] : undefined;
    const next: FlowComponentLike = patch
      ? {
          ...component,
          ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
          ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
          ...(patch.props !== undefined
            ? { props: { ...(component.props ?? {}), ...patch.props } }
            : {}),
        }
      : component;
    if (!Array.isArray(next.children)) return next;
    const patchedChildren = patchFlowComponents(next.children, updates);
    if (!patchedChildren || patchedChildren === next.children) return next;
    return { ...next, children: patchedChildren };
  });
};

export const applyFlowActionResponse = (
  current: FlowDefinitionLike,
  response: AppActionResponse,
): { flow: FlowDefinitionLike; errorMessage?: string } => {
  switch (response.type) {
    case 'open_screen':
    case 'next_screen':
      return { flow: response.flowJSON };
    case 'update_screen_data': {
      const componentUpdates = response.componentUpdates;
      const patchedComponents = componentUpdates
        ? patchFlowComponents(current.components, componentUpdates)
        : undefined;
      return {
        flow: {
          ...current,
          data: { ...(current.data ?? {}), ...response.data },
          ...(patchedComponents !== undefined ? { components: patchedComponents } : {}),
        },
      };
    }
    case 'error':
      return { flow: current, errorMessage: response.message };
    case 'close_screen':
    case 'ack':
      return { flow: current };
  }
};

const messageFromUnknown = (value: unknown, depth = 0): string | null => {
  if (depth > 2) return null;
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return messageFromUnknown(JSON.parse(trimmed), depth + 1) ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (!isRecord(value)) return null;

  // Spaces proxies claw-auth 4xx as `{ error: "App backend error 403", details: ["{type,message}"] }`.
  // Unwrap details first so the toast is the real diagnosis, not the wrapper.
  if (Array.isArray(value['details'])) {
    const fromDetails = messageFromUnknown(value['details'][0], depth + 1);
    if (fromDetails && !fromDetails.startsWith('App backend error')) return fromDetails;
  }

  const errorField = value['error'];
  const messageField = value['message'];
  if (typeof errorField === 'string' && errorField.trim()) {
    if (typeof messageField === 'string' && messageField.trim()) return messageField;
    if (!errorField.startsWith('App backend error') && errorField !== 'Invalid request') {
      return errorField;
    }
  }
  if (isRecord(errorField)) {
    const nested = messageFromUnknown(errorField, depth + 1);
    if (nested) return nested;
  }
  if (typeof messageField === 'string' && messageField.trim()) return messageField;
  if (Array.isArray(value['errors'])) {
    const fromErrors = messageFromUnknown(value['errors'][0], depth + 1);
    if (fromErrors) return fromErrors;
  }
  return null;
};

const readErrorMessage = (body: string): string | null => {
  try {
    return messageFromUnknown(JSON.parse(body));
  } catch {
    return null;
  }
};

export const flowActionErrorMessage = (error: unknown): string => {
  if (isRecord(error) && typeof error['responseBody'] === 'string') {
    return readErrorMessage(error['responseBody']) ?? 'Action failed';
  }
  if (isRecord(error) && error['responseData'] !== undefined) {
    return messageFromUnknown(error['responseData']) ?? 'Action failed';
  }
  return error instanceof Error ? error.message : 'Action failed';
};
