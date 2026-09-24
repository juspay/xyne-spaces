import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { FlowContext, FlowContextValue, type FlowMessageContext } from './FlowContext';
import { NodeRegistry } from './nodes/NodeRegistry';
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
  messageContext?: FlowMessageContext;
}

export const FlowRenderer: React.FC<FlowRendererProps> = ({
  flow,
  messageId,
  conversationId,
  onAppAction,
  onStateChange,
  compact = false,
  messageContext,
}) => {
  // A bounded popup has no page scrollbar behind it, so a screen taller than the
  // box gives no sign that it continues. That matters more now the action bar is
  // pinned: the buttons are visible from the start, and someone can submit
  // without ever seeing the fields below.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedFlow, setValidatedFlow] = useState<FlowDefinition | null>(null);
  const [state, setState] = useState<FlowState>(flow.state);

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
    async (action: FlowAction): Promise<boolean> => {
      if (!validatedFlow) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String(
            '[FlowRenderer] executeAction called but validatedFlow is null — skipping',
          ),
        });
        return false;
      }

      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String(`[FlowRenderer] executeAction type=${action.type}`),
        context: [action],
      });

      // Client-only: update_state, close_screen, navigate
      if (action.type === 'update_state') {
        setState(prev => ({ ...prev, values: { ...prev.values, ...action.stateUpdates } }));
        return true;
      }
      if (action.type === 'copy') {
        const { value, successMessage } = action as { value: string; successMessage?: string };
        try {
          // navigator.clipboard is undefined outside a secure context (plain http
          // on a non-localhost host), so report failure rather than throwing.
          await navigator.clipboard.writeText(value);
          toast.success(successMessage ?? 'Copied to clipboard');
          return true;
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[FlowRenderer] clipboard write failed:'),
            context: [error],
          });
          toast.error('Could not copy — select the URL in the message instead.');
          return false;
        }
      }
      if (action.type === 'close_screen' || action.type === 'navigate') {
        const closeAction = action as { type: string; finalMessage?: string };
        const closeResponse: AppActionResponse = closeAction.finalMessage
          ? { type: 'close_screen', finalMessage: closeAction.finalMessage }
          : { type: 'close_screen' };
        onAppAction(closeResponse);
        return true;
      }

      // submit / inputChange — network action
      // Don't set submitting=true for inputChange — keeps the form interactive during cascade loads
      const isInputChange = action.type === 'inputChange';

      // Guard: messageId/conversationId are required for network actions.
      // They may be empty if the component rendered before Zero sync completed.
      if (!messageId || !conversationId) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String(
            '[FlowRenderer] Cannot execute network action — messageId/conversationId not yet available. Please try again.',
          ),
        });
        toast.error('Message context not ready yet. Please try again in a moment.');
        return false;
      }
      if (!isInputChange) {
        setState(prev => {
          const next = { ...prev, submitting: true };
          stateRef.current = next;
          return next;
        });
      }
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String(
          `[FlowRenderer] → sending ${action.type} actionId=${action.actionId} values=`,
        ),
        context: [stateRef.current.values],
      });
      try {
        const response = await flowActionService.execute({
          actionId: action.actionId,
          type: action.type,
          values: stateRef.current.values,
          flowJSON: validatedFlow,
          messageId,
          conversationId,
        });

        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String(`[FlowRenderer] ← response type=${response.type}`),
          context: [response],
        });

        if (response.type === 'error') {
          toast.error(response.message);
          return false;
        }
        onAppAction(response);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action failed';
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[FlowRenderer] executeAction error:'),
          error: message,
        });
        if (!isInputChange) {
          toast.error(
            action.type === 'submit'
              ? ((action as { errorMessage?: string }).errorMessage ?? message)
              : message,
          );
        }
        return false;
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
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'unknown_component_type',
        message: String(`[FlowRenderer] Unknown component type: ${component.type}`),
      });
      // Render a visible fallback instead of silently dropping the card, so a node
      // emitted by a newer @xyne/shared than this deploy ships stays visible and the
      // version skew is obvious rather than surfacing as a blank message.
      return (
        <details
          key={component.id}
          className='my-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs'
        >
          <summary className='cursor-pointer text-muted-foreground'>
            Unsupported card (<code>{component.type}</code>) — update to view it properly
          </summary>
          <pre className='mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-snug'>
            {JSON.stringify(component, null, 2)}
          </pre>
        </details>
      );
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
      ...(messageContext && { messageContext }),
    }),
    [
      state,
      validatedFlow,
      compact,
      messageId,
      conversationId,
      messageContext,
      executeAction,
      validateField,
      validateAllFields,
      updateFieldValue,
      onAppAction,
    ],
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    // 8px of slack: sub-pixel rounding at the end of a scroll otherwise leaves a
    // fraction behind and the pointer never clears.
    const measure = (): void => {
      setHasMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    };

    measure();
    el.addEventListener('scroll', measure, { passive: true });

    // The body is a fixed-height flex child, so its own box never changes when
    // the content inside it grows — watch the children too, or a validation error
    // appearing leaves the pointer stale.
    const observer = new ResizeObserver(measure);
    for (const child of Array.from(el.children)) observer.observe(child);

    return (): void => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [validatedFlow]);

  if (validationError) {
    return (
      <div className='rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive'>
        <strong>Invalid flow definition:</strong> {validationError}
      </div>
    );
  }

  // The node registry is populated synchronously at module load (see NodeRegistry.ts),
  // so the only thing we wait for here is the one-tick flow validation below.
  if (!validatedFlow) {
    return <div className='animate-pulse bg-muted h-32 rounded-lg' />;
  }

  // A trailing row or button is the screen's action bar; anything else at the
  // end is ordinary content and stays in the body.
  const components = validatedFlow.components;
  const last = components.length > 0 ? components[components.length - 1] : undefined;
  // A trailing `row` is only an action bar if it actually holds buttons. A row of
  // two text columns at the end of a screen is content, and pulling it into the
  // footer would put a divider above it and pin it for no reason.
  const isActionBar =
    last?.type === 'button' ||
    (last?.type === 'row' && (last.children ?? []).some(child => child.type === 'button'));

  const title = validatedFlow.title && (
    <h2 className={compact ? 'text-sm font-semibold' : 'text-base font-semibold'}>
      {validatedFlow.title}
    </h2>
  );

  // `compact` is only ever true inside FlowScreenManager's action popup, which is
  // a fixed, centred box with no page scrollbar behind it. Bound the height here
  // and split the screen into a scrolling body and a real footer, so the action
  // bar sits below the scrollport rather than being positioned out of it: no
  // sticky, no negative margins, and the buttons keep their place in the DOM and
  // in this renderer's FlowContext.
  //
  // Inline rendering (compact=false, the channel) is untouched — it has the page
  // to scroll in and should keep flowing at its natural height.
  if (compact) {
    return (
      <FlowContext.Provider value={contextValue}>
        <div className='flow-ui-compact flex flex-col max-h-[70vh]'>
          <div ref={bodyRef} className='flex-1 min-h-0 overflow-y-auto flex flex-col gap-3'>
            {title}
            {(isActionBar ? components.slice(0, -1) : components).map(renderComponent)}
          </div>

          {hasMoreBelow && (
            <div className='shrink-0 flex items-center justify-center pt-1 text-muted-foreground'>
              <ChevronDown className='size-4 motion-safe:animate-bounce' />
              <span className='sr-only'>More content below — scroll to see the rest</span>
            </div>
          )}

          {isActionBar && last && (
            <div className='shrink-0 border-t border-border pt-3 mt-3'>{renderComponent(last)}</div>
          )}
        </div>
      </FlowContext.Provider>
    );
  }

  return (
    <FlowContext.Provider value={contextValue}>
      <div className='flow-ui-container max-w-2xl w-full flex flex-col gap-4'>
        {title}
        {components.map(renderComponent)}
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
