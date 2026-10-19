/**
 * Pure CSS-like → React Native style mapping for Flow-JSON components.
 *
 * Faithful port of the style helpers embedded in v2
 * `conversation-composer/flow-json-message.tsx`, extracted so the v3 Flow
 * renderer can reuse them and they can be unit-tested in isolation. No runtime
 * React / React Native imports — `ViewStyle` is a type-only import (erased at
 * build), so this module stays testable under the tsx node runner.
 */
import type { ViewStyle } from 'react-native';

export type FlowDimension = number | `${number}%`;

/**
 * Flow JSON is decoded from an untrusted payload. Keep the dynamic style
 * lookup in this boundary instead of making every renderer cast the shared
 * schema's closed style type to an indexable object.
 */
export const toFlowStyleRecord = (style: unknown): Readonly<Record<string, unknown>> =>
  typeof style === 'object' && style !== null && !Array.isArray(style)
    ? (style as Readonly<Record<string, unknown>>)
    : {};

const REM_IN_PX = 16;

export const parseCssLength = (value: unknown): FlowDimension | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|%)?$/.exec(trimmed);
  if (!match?.[1]) return undefined;
  const numericValue = Number(match[1]);
  const unit = match[2];
  if (unit === '%') return `${numericValue}%`;
  if (!unit || unit === 'px') return numericValue;
  return numericValue * REM_IN_PX;
};

export const parseCssSpacing = (value: unknown): number[] | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (typeof value !== 'string') return undefined;

  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return undefined;
  const parsed = parts.map(part => parseCssLength(part));
  if (parsed.some(item => typeof item !== 'number')) return undefined;
  return parsed as number[];
};

const applyCssSpacing = (
  nativeStyle: ViewStyle,
  property: 'padding' | 'margin',
  value: unknown,
): void => {
  const spacing = parseCssSpacing(value);
  if (!spacing) return;

  const [first, second = first, third = first, fourth = second] = spacing;
  const top = first ?? 0;
  const right = spacing.length === 1 ? top : (second ?? top);
  const bottom = spacing.length <= 2 ? top : (third ?? top);
  const left = spacing.length <= 2 ? right : (fourth ?? right);

  if (spacing.length === 1) {
    nativeStyle[property] = top;
    return;
  }

  if (property === 'padding') {
    nativeStyle.paddingTop = top;
    nativeStyle.paddingRight = right;
    nativeStyle.paddingBottom = bottom;
    nativeStyle.paddingLeft = left;
  } else {
    nativeStyle.marginTop = top;
    nativeStyle.marginRight = right;
    nativeStyle.marginBottom = bottom;
    nativeStyle.marginLeft = left;
  }
};

export const parseColorFromBorder = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value
    .trim()
    .split(/\s+/)
    .find(token => token.startsWith('#') || token.startsWith('rgb') || token.startsWith('hsl'));
};

/**
 * Map a Flow component `style` object to a React Native `ViewStyle`.
 *
 * Intentionally does NOT copy web-only `maxHeight` / `overflow`: RN has no
 * nested scroll inside the list, so tall Flow bodies rely on message-level
 * collapse instead of an inner scroll region. Pixel widths are dropped (web
 * canvas sizes overflow a mobile bubble); percentage widths are kept.
 */
export const flowStyleToNativeStyle = (style: unknown): ViewStyle => {
  const styleRecord = toFlowStyleRecord(style);
  const nativeStyle: ViewStyle = {};
  applyCssSpacing(nativeStyle, 'padding', styleRecord['padding']);
  applyCssSpacing(nativeStyle, 'margin', styleRecord['margin']);
  const gap = parseCssLength(styleRecord['gap']);
  const width = parseCssLength(styleRecord['width']);
  const maxWidth = parseCssLength(styleRecord['maxWidth']);
  const minWidth = parseCssLength(styleRecord['minWidth']);
  const borderRadius = parseCssLength(styleRecord['borderRadius']);

  if (gap !== undefined) nativeStyle.gap = gap;
  if (typeof width === 'string') nativeStyle.width = width;
  if (maxWidth !== undefined) nativeStyle.maxWidth = maxWidth;
  if (typeof minWidth === 'string') nativeStyle.minWidth = minWidth;
  if (borderRadius !== undefined) nativeStyle.borderRadius = borderRadius;

  const align = styleRecord['align'];
  if (align === 'left') nativeStyle.alignItems = 'flex-start';
  if (align === 'center') nativeStyle.alignItems = 'center';
  if (align === 'right') nativeStyle.alignItems = 'flex-end';
  if (align === 'stretch') nativeStyle.alignItems = 'stretch';

  if (typeof styleRecord['backgroundColor'] === 'string') {
    nativeStyle.backgroundColor = styleRecord['backgroundColor'];
  }

  const border = styleRecord['border'];
  if (border) {
    nativeStyle.borderWidth = 1;
    nativeStyle.borderColor = parseColorFromBorder(border) ?? '#d1d5db';
  }

  const borderLeft = styleRecord['borderLeft'];
  if (borderLeft) {
    nativeStyle.borderLeftWidth = 3;
    nativeStyle.borderLeftColor = parseColorFromBorder(borderLeft) ?? '#d1d5db';
  }

  return nativeStyle;
};
