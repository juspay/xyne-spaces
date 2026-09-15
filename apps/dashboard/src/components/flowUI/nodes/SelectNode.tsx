import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { useRef } from 'react';
import { useFlow } from '../FlowContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { cn } from '../../../utils/classNames';
import type { FlowComponent, SelectOption, FlowAction } from '@xyne/shared';

interface SelectNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const SelectNode: React.FC<SelectNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        name: string;
        label?: string;
        placeholder?: string;
        /** Static array OR "$<key>" dynamic reference */
        options: SelectOption[] | string;
        required?: boolean;
        /** Optional action fired when value changes (e.g. inputChange for cascading dropdowns) */
        action?: FlowAction;
      }
    | undefined;

  const { state, data, updateFieldValue, validateField, executeAction } = useFlow();

  // Debounce ref — keeps the pending timer between renders without causing re-renders
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!props?.name) return null;

  // Resolve options: static array or "$<key>" dynamic reference
  const resolvedOptions: SelectOption[] = (() => {
    if (Array.isArray(props.options)) return props.options;
    if (typeof props.options === 'string' && props.options.startsWith('$')) {
      const key = props.options.slice(1); // strip leading '$'
      const dataValue = data[key];
      if (Array.isArray(dataValue)) return dataValue as SelectOption[];
    }
    return [];
  })();

  const value = (state.values[props.name] as string) || '';
  const error = state.errors[props.name];
  const isTouched = state.touched[props.name];
  const isLoading = state.loadingComponentIds.includes(node.id);

  const handleChange = (val: string) => {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String(`[SelectNode] value changed  name=${props.name}  value=${val}`),
    });
    // updateFieldValue syncs stateRef immediately so the debounced executeAction
    // reads the correct (freshly selected) values when it fires
    updateFieldValue(props.name, val);
    validateField(props.name, val);

    const action = props.action;
    if (action?.type === 'inputChange') {
      const ms = action.debounceMs ?? 0;
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String(
          `[SelectNode] scheduling inputChange  actionId=${action.actionId}  debounceMs=${ms}`,
        ),
      });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String(`[SelectNode] firing inputChange  actionId=${action.actionId}`),
        });
        void executeAction(action);
      }, ms);
    }
  };

  return (
    <div className='space-y-1.5' style={node.style}>
      {props.label && (
        <label className='text-sm font-medium text-foreground leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
          {props.label}
          {props.required && <span className='text-destructive ml-0.5'>*</span>}
        </label>
      )}
      <Select value={value} onValueChange={handleChange} disabled={state.submitting || isLoading}>
        <SelectTrigger
          className={cn(
            'w-full',
            error && isTouched && 'border-destructive focus:ring-destructive/20',
          )}
        >
          <SelectValue placeholder={isLoading ? 'Loading…' : props.placeholder || 'Select...'} />
        </SelectTrigger>
        <SelectContent>
          {resolvedOptions.map(opt => (
            <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled === true}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && isTouched && <p className='text-xs text-destructive'>{error}</p>}
    </div>
  );
};
