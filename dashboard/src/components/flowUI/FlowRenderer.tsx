import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { FlowContext, FlowContextValue } from './FlowContext';
import { NodeRegistry, initializeRegistry } from './nodes/NodeRegistry';
import type {
  FlowComponent,
  FlowState,
  FlowAction,
  FlowDefinition,
  AppActionResponse,
  ValidationRule,
} from '@xyne/shared';
import { validateFlowDefinition, formatValidationErrors } from '@xyne/shared';
import { flowActionService } from '@/services/flowActionService';
import { toast } from 'sonner';

interface FlowRendererProps {
  flow: FlowDefinition;
  messageId: string;
  conversationId: string;
  onAppAction: (response: AppActionResponse) => void;
  onStateChange?: (state: FlowState) => void;
  /** Compact rendering — used inside action-response popups */
  compact?: boolean;
}

export const FlowRenderer: React.FC<FlowRendererProps> = ({
  flow,
  messageId,
  conversationId,
  onAppAction,
  onStateChange,
  compact = false,
}) => {
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedFlow, setValidatedFlow] = useState<FlowDefinition | null>(null);
  const [state, setState] = useState<FlowState>(flow.state);
  const [registryReady, setRegistryReady] = useState(false);

  // Always-current ref so executeAction closures never read stale values.
  // Synced synchronously inside updateFieldValue (not via useEffect) so debounced
  // inputChange calls always get the value the user just selected.
  const stateRef = useRef(state);

  // Track which screenId we last initialised state for.
  // update_screen_data patches arrive as a new `flow` object with the SAME screenId —
  // we must NOT reset form values in that case, only update the flow definition.
  const initializedScreenIdRef = useRef<string | null>(null);

  // Validate flow whenever the prop changes
  useEffect(() => {
    const result = validateFlowDefinition(flow);
    if (!result.success) {
      const errors = formatValidationErrors(result);
      setValidationError(errors.join('; '));
      setValidatedFlow(null);
    } else {
      setValidationError(null);
      setValidatedFlow(result.data as FlowDefinition);
      // Only reset form state when this is genuinely a new screen
      if (initializedScreenIdRef.current !== result.data.screenId) {
        initializedScreenIdRef.current = result.data.screenId;
        // Always start with submitting=false so a remounted screen isn't frozen
        setState({ ...result.data.state, submitting: false });
      }
    }
  }, [flow]);

  useEffect(() => {
    void initializeRegistry().then(() => setRegistryReady(true));
  }, []);

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  const updateFieldValue = useCallback((name: string, value: unknown) => {
    setState(prev => {
      const next = {
        ...prev,
        values: { ...prev.values, [name]: value },
        touched: { ...prev.touched, [name]: true },
      };
      stateRef.current = next; // sync immediately — before any debounced effects fire
      return next;
    });
  }, []);

  const validateField = useCallback(
    (name: string, value: unknown): string | null => {
      if (!validatedFlow) return null;
      const field = findFieldInComponents(validatedFlow.components, name);
      if (!field?.props?.['validation']) return null;

      const rules = field.props['validation'] as ValidationRule[];
      for (const rule of rules) {
        const error = validateRule(rule, value);
        if (error) {
          setState(prev => ({
            ...prev,
            errors: { ...prev.errors, [name]: error },
            touched: { ...prev.touched, [name]: true },
          }));
          return error;
        }
      }
      setState(prev => {
        const newErrors = { ...prev.errors };
        delete newErrors[name];
        return { ...prev, errors: newErrors, touched: { ...prev.touched, [name]: true } };
      });
      return null;
    },
    [validatedFlow],
  );

  const validateAllFields = useCallback((): boolean => {
    if (!validatedFlow) return false;
    let isValid = true;
    const newErrors: Record<string, string> = {};
    const newTouched: Record<string, boolean> = {};

    const validateComponent = (component: FlowComponent) => {
      const props = component.props as
        | { name?: string; validation?: ValidationRule[]; required?: boolean }
        | undefined;
      if (props?.name) {
        const value = state.values[props.name];
        newTouched[props.name] = true;
        if (props.required && (value === undefined || value === '' || value === null)) {
          newErrors[props.name] = 'This field is required';
          isValid = false;
        } else if (props.validation) {
          for (const rule of props.validation) {
            const error = validateRule(rule, value);
            if (error) {
              newErrors[props.name] = error;
              isValid = false;
              break;
            }
          }
        }
      }
      component.children?.forEach(validateComponent);
    };

    validatedFlow.components.forEach(validateComponent);
    setState(prev => ({
      ...prev,
      errors: newErrors,
      touched: { ...prev.touched, ...newTouched },
    }));
    return isValid;
  }, [validatedFlow, state.values]);

  const executeAction = useCallback(
    async (action: FlowAction) => {
      if (!validatedFlow) {
        console.warn('[FlowRenderer] executeAction called but validatedFlow is null — skipping');
        return;
      }

      console.log(`[FlowRenderer] executeAction type=${action.type}`, action);

      // Client-only: update_state, close_screen, navigate
      if (action.type === 'update_state') {
        setState(prev => ({ ...prev, values: { ...prev.values, ...action.stateUpdates } }));
        return;
      }
      if (action.type === 'close_screen' || action.type === 'navigate') {
        const closeAction = action as { type: string; finalMessage?: string };
        const closeResponse: AppActionResponse = closeAction.finalMessage
          ? { type: 'close_screen', finalMessage: closeAction.finalMessage }
          : { type: 'close_screen' };
        onAppAction(closeResponse);
        return;
      }

      // submit / inputChange — network action
      // Don't set submitting=true for inputChange — keeps the form interactive during cascade loads
      const isInputChange = action.type === 'inputChange';
      if (!isInputChange) {
        setState(prev => {
          const next = { ...prev, submitting: true };
          stateRef.current = next;
          return next;
        });
      }
      console.log(
        `[FlowRenderer] → sending ${action.type} actionId=${action.actionId} values=`,
        stateRef.current.values,
      );
      try {
        const response = await flowActionService.execute({
          actionId: action.actionId,
          type: action.type,
          values: stateRef.current.values,
          flowJSON: validatedFlow,
          messageId,
          conversationId,
        });

        console.log(`[FlowRenderer] ← response type=${response.type}`, response);

        if (response.type === 'error') {
          toast.error(response.message);
        } else {
          onAppAction(response);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action failed';
        console.error('[FlowRenderer] executeAction error:', message);
        if (!isInputChange) {
          toast.error(
            action.type === 'submit'
              ? ((action as { errorMessage?: string }).errorMessage ?? message)
              : message,
          );
        }
      } finally {
        if (!isInputChange) {
          setState(prev => {
            const next = { ...prev, submitting: false };
            stateRef.current = next;
            return next;
          });
        }
      }
    },
    [validatedFlow, messageId, conversationId, onAppAction],
  );

  const isVisible = (component: FlowComponent): boolean => {
    if (component.hidden === undefined) return true;
    if (typeof component.hidden === 'boolean') return !component.hidden;
    if (typeof component.hidden === 'string') {
      const expr = component.hidden.trim();
      if (expr.startsWith('!')) {
        const key = expr.slice(1).replace('values.', '');
        return !state.values[key];
      }
      const key = expr.replace('values.', '');
      return !!state.values[key];
    }
    return true;
  };

  const renderComponent = (component: FlowComponent): React.ReactNode => {
    if (!isVisible(component)) return null;
    const Component = NodeRegistry.get(component.type);
    if (!Component) {
      console.warn(`[FlowRenderer] Unknown component type: ${component.type}`);
      return null;
    }
    return (
      <Component key={component.id} node={component}>
        {component.children?.map(renderComponent)}
      </Component>
    );
  };

  const contextValue: FlowContextValue = useMemo(
    () => ({
      state,
      data: validatedFlow?.data ?? {},
      isSubmitting: state.submitting,
      compact,
      updateFieldValue,
      validateField,
      validateAllFields,
      executeAction,
      onAppAction,
      messageId,
      conversationId,
    }),
    [
      state,
      validatedFlow,
      compact,
      messageId,
      conversationId,
      executeAction,
      validateField,
      validateAllFields,
      updateFieldValue,
      onAppAction,
    ],
  );

  if (validationError) {
    return (
      <div className='rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive'>
        <strong>Invalid flow definition:</strong> {validationError}
      </div>
    );
  }

  if (!registryReady || !validatedFlow) {
    return <div className='animate-pulse bg-gray-100 h-32 rounded-lg' />;
  }

  return (
    <FlowContext.Provider value={contextValue}>
      <div
        className={
          compact ? 'flow-ui-compact' : 'flow-ui-container rounded-lg border bg-white p-4 shadow-sm'
        }
      >
        {validatedFlow.title && (
          <h2 className={compact ? 'text-sm font-semibold mb-2' : 'text-base font-semibold mb-3'}>
            {validatedFlow.title}
          </h2>
        )}
        {validatedFlow.components.map(renderComponent)}
      </div>
    </FlowContext.Provider>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function findFieldInComponents(components: FlowComponent[], name: string): FlowComponent | null {
  for (const c of components) {
    const props = c.props as { name?: string } | undefined;
    if (props?.name === name) return c;
    if (c.children) {
      const found = findFieldInComponents(c.children, name);
      if (found) return found;
    }
  }
  return null;
}

function validateRule(rule: ValidationRule, value: unknown): string | null {
  switch (rule.type) {
    case 'required':
      return value === undefined || value === '' || value === null ? rule.message : null;
    case 'min':
      return (value as number) < (rule.value as number) ? rule.message : null;
    case 'max':
      return (value as number) > (rule.value as number) ? rule.message : null;
    case 'minLength':
      return String(value).length < (rule.value as number) ? rule.message : null;
    case 'maxLength':
      return String(value).length > (rule.value as number) ? rule.message : null;
    case 'pattern':
      return !new RegExp(rule.value as string).test(String(value)) ? rule.message : null;
    case 'email':
      return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? rule.message : null;
    default:
      return null;
  }
}
