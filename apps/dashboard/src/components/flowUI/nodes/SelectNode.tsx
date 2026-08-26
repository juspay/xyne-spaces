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
import { MultiSelect, type MultiSelectOption } from '../../ui/MultiSelect';
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
        /** Renders a searchable pill dropdown; the field value becomes string[] */
        multiple?: boolean;
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

  const error = state.errors[props.name];
  const isTouched = state.touched[props.name];
  const isLoading = state.loadingComponentIds.includes(node.id);

  // Shared by both modes. updateFieldValue syncs stateRef synchronously, and
  // executeAction reads that ref when the timer fires, so the new value does not
  // need threading through here.
  const scheduleInputChange = (): void => {
    const action = props.action;
    if (action?.type !== 'inputChange') return;
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
  };

  // ── Multi-select mode ──────────────────────────────────────────────────────
  // Radix Select has no multiple mode, so this path uses the MultiSelect popover
  // (search + removable pills) instead. No hooks here — both branches must run the
  // same ones, and everything above this point is already unconditional.
  if (props.multiple === true) {
    const rawValue = state.values[props.name];
    const selectedValues: string[] = Array.isArray(rawValue) ? (rawValue as string[]) : [];

    const multiOptions: MultiSelectOption[] = resolvedOptions.map(opt => ({
      value: opt.value,
      label: opt.label,
      ...(opt.description ? { subtitle: opt.description } : {}),
      ...(opt.disabled ? { isDeactivated: true } : {}),
    }));

    const handleMultiChange = (values: string[]): void => {
      // MultiSelect treats isDeactivated as presentational — it greys the row but
      // still lets it be toggled — so SelectOption.disabled is enforced here.
      const next = values.filter(v => !resolvedOptions.some(o => o.value === v && o.disabled));
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String(`[SelectNode] values changed  name=${props.name}  value=${next.join(',')}`),
      });
      updateFieldValue(props.name, next);
      validateField(props.name, next);
      scheduleInputChange();
    };

    return (
      <div className='space-y-1.5' style={node.style}>
        {props.label && (
          <label className='text-sm font-medium text-foreground leading-none'>
            {props.label}
            {props.required && <span className='text-destructive ml-0.5'>*</span>}
          </label>
        )}
        <MultiSelect
          options={multiOptions}
          selectedValues={selectedValues}
          onChange={handleMultiChange}
          placeholder={isLoading ? 'Loading…' : props.placeholder || 'Select...'}
          disabled={state.submitting || isLoading}
          {...(error && isTouched ? { error } : {})}
        />
      </div>
    );
  }

  const value = (state.values[props.name] as string) || '';

  const handleChange = (val: string) => {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String(`[SelectNode] value changed  name=${props.name}  value=${val}`),
    });
    updateFieldValue(props.name, val);
    validateField(props.name, val);
    scheduleInputChange();
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
