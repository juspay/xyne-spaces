/**
 * Pure Flow-JSON prop / state evaluation helpers.
 *
 * Faithful port of the visibility, disabled, control-value and option
 * resolution logic embedded in v2 `conversation-composer/flow-json-message.tsx`.
 * No React / React Native runtime imports — `FlowComponentLike` is a type-only
 * import (erased at build), keeping this module unit-testable under the tsx
 * node runner without materializing `@xyne/shared`.
 */
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

export const getStringProp = (props: Record<string, unknown> | undefined, key: string): string => {
  const value = props?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

export const stripMarkdownSyntax = (value: string): string =>
  value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~`]/g, '');

export const getStateValue = (values: Record<string, unknown>, expression: string): unknown => {
  const key = expression.trim().replace(/^values\./, '');
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
};

export const isVisible = (
  component: FlowComponentLike,
  values: Record<string, unknown>,
): boolean => {
  if (component.hidden === undefined) return true;
  if (typeof component.hidden === 'boolean') return !component.hidden;
  if (typeof component.hidden !== 'string') return true;

  const expression = component.hidden.trim();
  if (!expression) return true;
  if (expression.startsWith('!')) return !getStateValue(values, expression.slice(1));
  return !!getStateValue(values, expression);
};

export const isDisabled = (
  component: FlowComponentLike,
  values: Record<string, unknown>,
): boolean => {
  if (component.disabled === true) return true;
  if (typeof component.disabled !== 'string') return false;
  const expression = component.disabled.trim();
  if (!expression) return false;
  if (expression.startsWith('!')) return !getStateValue(values, expression.slice(1));
  return !!getStateValue(values, expression);
};

export const getControlValue = (props: Record<string, unknown> | undefined): string =>
  getStringProp(props, 'value') ||
  getStringProp(props, 'defaultValue') ||
  getStringProp(props, 'placeholder');

export const getControlValueFromState = (
  props: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
): string => {
  const name = getStringProp(props, 'name');
  const stateValue = name ? values[name] : undefined;
  if (typeof stateValue === 'string') return stateValue;
  if (typeof stateValue === 'number' || typeof stateValue === 'boolean') return String(stateValue);
  if (Array.isArray(stateValue)) return stateValue.map(String).join(', ');
  return getControlValue(props);
};

export const getControlOptions = (
  props: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): { label: string; value: string }[] => {
  const configuredOptions = props?.['options'];
  const options =
    typeof configuredOptions === 'string' && configuredOptions.startsWith('$')
      ? data[configuredOptions.slice(1)]
      : configuredOptions;
  if (!Array.isArray(options)) return [];
  return options
    .filter(value => typeof value === 'object' && value !== null && !Array.isArray(value))
    .map(value => {
      const record = value as Record<string, unknown>;
      const label = getStringProp(record, 'label');
      const optionValue = getStringProp(record, 'value') || label;
      return { label: label || optionValue, value: optionValue };
    })
    .filter(option => option.label.length > 0 && option.value.length > 0);
};
