import type { ImageStyle, ViewStyle } from 'react-native';

import {
  flowComponentTextToMarkdown,
  type FlowComponentLike,
  type FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

import { isDisabled, isVisible } from './flowState';
import { flowStyleToNativeStyle, parseCssLength, toFlowStyleRecord } from './flowStyle';

export const flowComponentKey = (
  parentKey: string,
  component: FlowComponentLike,
  index: number,
): string => {
  const id = typeof component.id === 'string' && component.id.trim() ? component.id : index;
  return `${parentKey}-${id}`;
};

export const isFlowListTextComponent = (
  component: FlowComponentLike,
  stateValues: Record<string, unknown>,
  normalizationOptions: FlowTextNormalizationOptions,
): boolean => {
  if (!isVisible(component, stateValues) || component.type !== 'text') return false;
  if (component.props?.['codeBlock'] === true) return false;
  return /^(?:[ \t\u00a0\u2007\u202f]{0,3})(?:\d+[.)]|[-+*])[ \t\u00a0\u2007\u202f]+/.test(
    flowComponentTextToMarkdown(component, normalizationOptions),
  );
};

export const haveSameFlowStyle = (first: FlowComponentLike, second: FlowComponentLike): boolean => {
  const firstStyle = toFlowStyleRecord(first.style);
  const secondStyle = toFlowStyleRecord(second.style);
  const keys = new Set([...Object.keys(firstStyle), ...Object.keys(secondStyle)]);
  return Array.from(keys).every(key => Object.is(firstStyle[key], secondStyle[key]));
};

export const flowComponentRenderStyle = (
  component: FlowComponentLike,
  stateValues: Record<string, unknown>,
): ViewStyle => {
  const nativeStyle = flowStyleToNativeStyle(component.style);
  return isDisabled(component, stateValues) ? { ...nativeStyle, opacity: 0.55 } : nativeStyle;
};

export const flowImageStyle = (props: Record<string, unknown> | undefined): ImageStyle => ({
  width: parseCssLength(props?.['width']) ?? '100%',
  height: parseCssLength(props?.['height']) ?? 160,
  maxWidth: '100%',
  borderRadius: 6,
});
