/**
 * Height estimate for FlowJSON messages (`<div data-flow-json="…">Flow JSON</div>`),
 * e.g. Slack Block Kit bot cards converted by slackBlockKitToFlowJSON.
 *
 * Without this the HTML estimator sees only the placeholder text "Flow JSON" and
 * sizes a ~400px card as one line, so the virtualizer's offsets for every row past
 * a run of cards are short by hundreds of px and deep-link scrolls land off target.
 *
 * Mirrors the inline (non-compact) FlowRenderer layout:
 *   container  flex-col gap-4, max-w-2xl (672px), wrapped in mt-1.5
 *   column     flex-col gap-2 (+ inline style padding)
 *   row        flex-row gap-3, as tall as its tallest child, width split evenly
 *   card       p-4 + 1px border
 *   text       text-sm + leading-relaxed (14px × 1.625 = 22.75px per line)
 *
 * Each size below is written as its CSS sum, with the component it comes from, so a
 * styling change shows which number to update. Values that CSS can't determine are
 * marked "estimate".
 */

import type { FlowComponent, FlowComponentStyle, FlowDefinition } from '@xyne/shared';

// Layout (FlowRenderer, ContainerNodes, RenderMessageWithHTML)
const FLOW_WRAPPER_MARGIN = 6; // mt-1.5 on the wrapper around FlowScreenManager
const CONTAINER_GAP = 16; // FlowRenderer: gap-4 between top-level components
const COLUMN_GAP = 8; // ColumnNode: gap-2
const ROW_GAP_PX = 12; // RowNode: gap-3
const CARD_CHROME = 16 + 16 + 1 + 1; // CardNode: p-4 top + bottom, 1px border top + bottom
const CONTAINER_WIDTH_DESKTOP = 672; // FlowRenderer: max-w-2xl
const CONTAINER_WIDTH_MOBILE = 320; // estimate: phone width minus message padding

// Text (TextNode): Tailwind font size × leading-relaxed (1.625), which overrides the
// size class's own line height.
const LEADING_RELAXED = 1.625;
const TEXT_FONT_PX: Record<string, number> = {
  xs: 12, // text-xs
  sm: 12, // text-xs (TextNode maps sm → text-xs)
  base: 14, // text-sm
  md: 14, // text-sm (legacy alias)
  lg: 16, // text-base
  xl: 18, // text-lg
};
const DEFAULT_TEXT_FONT_PX = 14; // size 'base' → text-sm
// Average glyph width, measured with the app's own font via canvas.measureText and
// cached per font size. Falls back to half the font size only where no DOM/canvas
// exists or before web fonts finish loading (not cached then, so it re-measures).
const CHAR_WIDTH_SAMPLE = 'The quick brown fox jumps over the lazy dog, 0123456789.';
const charWidthCache = new Map<number, number>();
const avgCharWidth = (fontPx: number): number => {
  const cached = charWidthCache.get(fontPx);
  if (cached !== undefined) return cached;
  const fallback = fontPx * 0.5;
  if (typeof document === 'undefined') return fallback;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return fallback;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  ctx.font = `${fontPx}px ${family}`;
  const width = ctx.measureText(CHAR_WIDTH_SAMPLE).width / CHAR_WIDTH_SAMPLE.length;
  if (!(width > 0)) return fallback;
  if (document.fonts.status === 'loaded') charWidthCache.set(fontPx, width);
  return width;
};

// HeadingNode: font-semibold + Tailwind size's own line height (no leading override).
const headingLine = (level: number): number => {
  switch (level) {
    case 1:
      return 32; // text-2xl
    case 3:
      return 28; // text-lg
    case 4:
      return 24; // text-base
    default:
      return 28; // level 2 (default): text-xl
  }
};

// LinkNode: inline text, inherits .jp-message-html leading-6.
const LINK_LINE = 24;

// ButtonNode: wrapper pt-2 + Button height (size 'lg' → default h-9, otherwise sm h-8).
const BUTTON_HEIGHT_SM = 8 + 32;
const BUTTON_HEIGHT_DEFAULT = 8 + 36;

// DividerNode: <hr> 1px border + default margin '16px 0'.
const DIVIDER_HEIGHT = 16 + 1 + 16;

// Form fields: label (text-sm leading-none = 14) + space-y-1.5 (6) + control.
const FIELD_LABEL = 14 + 6;
const INPUT_CONTROL = 36; // Input: h-9
const TEXTAREA_CONTROL = 80; // Textarea: min-h-[80px]
const SELECT_CONTROL = 36; // SelectTrigger: h-9

// 'select' → RadioNode, 'multiselect' → CheckboxNode: option lists, not dropdowns.
// Outer space-y-2; label `block text-sm` (20); each option row text-sm (20) with
// space-y-2 (8) between rows, or a single row when orientation is horizontal.
const OPTION_GROUP_LABEL = 20 + 8;
const OPTION_ROW = 20;
const OPTION_ROW_GAP = 8;
const OPTION_COUNT_FALLBACK = 3; // estimate: options given as a "$key" reference

// FlowRenderer's fallback for a type missing from NodeRegistry (e.g. 'date'): a
// collapsed <details> — my-1, 1px border, py-2, one text-xs (16) summary line.
const UNREGISTERED_FALLBACK = 4 + 1 + 8 + 16 + 8 + 1 + 4;

// TableNode: wrapper my-1; each row th/td py-1.5 + text-sm (20) + border-b 1px;
// the last body row drops its border (last:border-0).
const TABLE_MARGIN = 4 + 4;
const TABLE_ROW_HEIGHT = 6 + 20 + 6 + 1;

// TextNode codeBlock: <pre> my-1 + py-2, lines at the text's leading-relaxed height.
const CODE_BLOCK_CHROME = 4 + 4 + 8 + 8;

// CodeNode: 1px border × 2 + header (py-3 + 20px icon-button row) + 1px divider;
// body is @pierre/diffs inside max-h-[420px]: `line-height: var(--diffs-line-height,
// 20px)` and `padding-block: var(--diffs-gap-fallback)` = 8px (neither overridden).
const CODE_NODE_CHROME = 1 + 1 + (12 + 20 + 12) + 1;
const CODE_NODE_BODY_MAX = 420;
const CODE_NODE_LINE = 20;
const CODE_NODE_BODY_PADDING = 8 + 8;

// ImageNode: its props.height when given; otherwise the image's own size, unknown
// until it loads.
const IMAGE_HEIGHT_FALLBACK = 200; // estimate
const IMAGE_MIN_HEIGHT = 80; // ImageNode placeholder minHeight

// FlowRenderer title: <h2 className='text-base font-semibold'> (inline, non-compact).
const FLOW_TITLE_LINE = 24;

const UNKNOWN_NODE_HEIGHT = 120; // estimate: rich widgets (pr, plan, chart, agent…)

const decodeAttr = (raw: string): string =>
  raw
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Visible text of a mrkdwn string: links show their label, mentions a short name. */
const visibleText = (text: string): string =>
  text
    .replace(/<(?:userid|groupid|channelid):[^>]+>/g, '@mention-name')
    .replace(/<[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/[*_~`]/g, '');

const textLines = (content: string, widthPx: number, fontPx: number): number => {
  const charsPerLine = Math.max(10, Math.floor(widthPx / avgCharWidth(fontPx)));
  return visibleText(content)
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
};

const verticalPadding = (style: FlowComponentStyle | undefined): number => {
  const padding = style?.padding;
  if (typeof padding !== 'string') return 0;
  const parts = padding.split(/\s+/).map(p => parseFloat(p) || 0);
  if (parts.length === 1) return (parts[0] ?? 0) * 2;
  return (parts[0] ?? 0) + (parts[2] ?? parts[0] ?? 0);
};

const horizontalPadding = (style: FlowComponentStyle | undefined): number => {
  const padding = style?.padding;
  if (typeof padding !== 'string') return 0;
  const parts = padding.split(/\s+/).map(p => parseFloat(p) || 0);
  if (parts.length === 1) return (parts[0] ?? 0) * 2;
  return (parts[1] ?? 0) + (parts[3] ?? parts[1] ?? 0);
};

// FlowRenderer skips hidden components. A string `hidden` is an expression evaluated
// against form state at render time — assume visible.
const isHidden = (node: FlowComponent): boolean => node.hidden === true;

const stackHeight = (children: FlowComponent[], widthPx: number, gap: number): number => {
  const heights = children
    .filter(c => !isHidden(c))
    .map(c => nodeHeight(c, widthPx))
    .filter(h => h > 0);
  if (heights.length === 0) return 0;
  return heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1);
};

const optionGroupHeight = (props: Record<string, unknown>): number => {
  const count = Array.isArray(props['options']) ? props['options'].length : OPTION_COUNT_FALLBACK;
  const rows = props['orientation'] === 'horizontal' ? 1 : Math.max(1, count);
  return (
    (props['label'] ? OPTION_GROUP_LABEL : 0) + rows * OPTION_ROW + (rows - 1) * OPTION_ROW_GAP
  );
};

function nodeHeight(node: FlowComponent, widthPx: number): number {
  if (isHidden(node)) return 0;
  const props = node.props ?? {};
  const children = node.children ?? [];
  const borderLeft = typeof node.style?.borderLeft === 'string' ? 4 : 0;
  const innerWidth = widthPx - horizontalPadding(node.style) - borderLeft;
  const padY = verticalPadding(node.style);

  switch (node.type) {
    case 'text': {
      const content = typeof props['content'] === 'string' ? props['content'] : '';
      if (!content) return 0;
      const size = typeof props['size'] === 'string' ? props['size'] : 'base';
      const fontPx = TEXT_FONT_PX[size] ?? DEFAULT_TEXT_FONT_PX;
      const lineHeight = fontPx * LEADING_RELAXED;
      if (props['codeBlock'] === true) {
        return content.split('\n').length * lineHeight + CODE_BLOCK_CHROME;
      }
      return textLines(content, innerWidth, fontPx) * lineHeight + padY;
    }
    case 'heading': {
      const level = typeof props['level'] === 'number' ? props['level'] : 2;
      return headingLine(level) + padY;
    }
    case 'link':
      return LINK_LINE + padY;
    case 'button':
      return props['size'] === 'lg' ? BUTTON_HEIGHT_DEFAULT : BUTTON_HEIGHT_SM;
    case 'divider':
      return typeof node.style?.margin === 'string'
        ? 1 + verticalPadding({ padding: node.style.margin })
        : DIVIDER_HEIGHT;
    case 'image': {
      const height = props['height'];
      if (typeof height === 'number') return Math.max(height, IMAGE_MIN_HEIGHT);
      if (typeof height === 'string' && /^\d+(px)?$/.test(height)) {
        return Math.max(parseFloat(height), IMAGE_MIN_HEIGHT);
      }
      return IMAGE_HEIGHT_FALLBACK;
    }
    case 'input':
      return (props['label'] ? FIELD_LABEL : 0) + INPUT_CONTROL;
    case 'textarea':
      return (props['label'] ? FIELD_LABEL : 0) + TEXTAREA_CONTROL;
    case 'dropdown':
      return (props['label'] ? FIELD_LABEL : 0) + SELECT_CONTROL;
    case 'select':
    case 'multiselect':
      return optionGroupHeight(props);
    case 'table': {
      const bodyRows = Array.isArray(props['rows']) ? props['rows'].length : 3;
      // header row + body rows, minus the last row's removed border
      return TABLE_MARGIN + (bodyRows + 1) * TABLE_ROW_HEIGHT - (bodyRows > 0 ? 1 : 0);
    }
    case 'code': {
      const code = typeof props['code'] === 'string' ? props['code'] : '';
      const body = Math.min(
        Math.max(1, code.split('\n').length) * CODE_NODE_LINE + CODE_NODE_BODY_PADDING,
        CODE_NODE_BODY_MAX,
      );
      return CODE_NODE_CHROME + body;
    }
    case 'column':
      return stackHeight(children, innerWidth, COLUMN_GAP) + padY;
    case 'card':
      return stackHeight(children, innerWidth - CARD_CHROME, COLUMN_GAP) + CARD_CHROME + padY;
    case 'row': {
      const visible = children.filter(c => !isHidden(c));
      if (visible.length === 0) return 0;
      const cellWidth = (innerWidth - ROW_GAP_PX * (visible.length - 1)) / visible.length;
      return Math.max(...visible.map(c => nodeHeight(c, cellWidth))) + padY;
    }
    case 'date':
      // In FlowComponentType but not registered in NodeRegistry → FlowRenderer's
      // collapsed "unknown component" fallback.
      return UNREGISTERED_FALLBACK;
    // Rich widgets: height depends on live data (steps, files, chart size, …), so
    // CSS can't fix it. Estimated on purpose, not forgotten.
    case 'plan':
    case 'pr':
    case 'pr_approval':
    case 'call_schedule':
    case 'user_question':
    case 'diff':
    case 'ticket':
    case 'chart':
    case 'agent':
    case 'mcpConfigure':
    case 'slash_command_artifact':
    case 'agent_summary':
    case 'mcp_suggest':
    case 'provider_suggest':
      return UNKNOWN_NODE_HEIGHT;
    default: {
      // Exhaustiveness: adding a FlowComponentType without a case above fails the
      // typecheck here. At runtime (a newer type from the backend) → fallback box.
      const unhandled: never = node.type;
      void unhandled;
      return UNREGISTERED_FALLBACK;
    }
  }
}

/**
 * Estimated px height of the FlowJSON block in `content`, or null when the content
 * holds no parseable FlowJSON (callers fall back to the HTML estimate).
 */
export function estimateFlowJsonHeight(content: string, isMobile: boolean): number | null {
  if (!content.includes('data-flow-json')) return null;
  const match = content.match(/data-flow-json="([^"]+)"/);
  if (!match?.[1]) return null;
  try {
    const flow = JSON.parse(decodeAttr(match[1])) as Partial<FlowDefinition>;
    const width = isMobile ? CONTAINER_WIDTH_MOBILE : CONTAINER_WIDTH_DESKTOP;
    const components = flow.components ?? [];
    const title = flow.title ? FLOW_TITLE_LINE : 0;
    const body = stackHeight(components, width, CONTAINER_GAP);
    const gaps = title && body ? CONTAINER_GAP : 0;
    return FLOW_WRAPPER_MARGIN + title + gaps + body;
  } catch {
    return null;
  }
}
