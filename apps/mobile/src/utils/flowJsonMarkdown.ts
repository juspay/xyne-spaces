import type { FlowComponentStyle } from '@xyne/shared';

import { diffComponentToMarkdown } from './flowDiffUtils';
import { codeComponentToMarkdown } from './flowCodeUtils';
import { callScheduleComponentToMarkdown } from './flowCallScheduleUtils';
import { chartComponentToMarkdown } from './flowChartUtils';
import {
  mcpSuggestComponentToMarkdown,
  isMcpSuggestFlow,
  mcpSuggestFlowToMarkdown,
} from './flowMcpSuggestUtils';
import { prComponentToMarkdown } from './flowPrUtils';
import {
  agentCardFlowToMarkdown,
  agentComponentToMarkdown,
  isAgentCardFlow,
} from './flowAgentUtils';
import { isWriteApprovalFlow, writeApprovalFlowToMarkdown } from './flowApprovalUtils';
import {
  isUserQuestionFlow,
  userQuestionComponentToMarkdown,
  userQuestionFlowToMarkdown,
} from './flowUserQuestionUtils';
import { normalizeMarkdownListIndentation } from './markdownListNormalization';
import { sanitizeFlowUrl } from './flowUrlUtils';
import {
  countCompletedPlanTodos,
  createPlanComponentViewModel,
  extractPlanMarkdownHeader,
  extractPlanStatusToneFromMarkdown,
  findPlanComponent,
  getPlanTodoStatus,
  isPlanTodoCompleted,
  isPlanTodoIncluded,
  resolvePlanHeaderStatus,
  type FlowPlanStatusTone,
  type PlanComponentViewModel,
} from './flowPlanUtils';

export { sanitizeFlowUrl };

export type {
  FlowPlanMarkdownHeader,
  FlowPlanStatusTone,
  PlanComponentViewModel,
  PlanTodoDisplayStatus,
  PlanTodoViewModel,
} from './flowPlanUtils';

export {
  countCompletedPlanTodos,
  createPlanComponentViewModel,
  extractPlanMarkdownHeader,
  extractPlanStatusToneFromMarkdown,
  findPlanComponent,
  formatPlanStatusLabel,
  getPlanStatusTone,
  getPlanTodoStatus,
  isPlanTodoCompleted,
  isPlanTodoIncluded,
  normalizePlanStatusTone,
  normalizePlanTodoDisplayStatus,
  resolvePlanHeaderStatus,
  resolvePlanTodoDisplayStatuses,
} from './flowPlanUtils';
import { decodeEntitySet } from './htmlText';

export type FlowComponentLike = {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown>;
  children?: FlowComponentLike[];
  style?: Record<string, unknown> | FlowComponentStyle;
  hidden?: unknown;
  disabled?: unknown;
};

export type FlowDefinitionLike = {
  version?: unknown;
  screenId?: unknown;
  title?: unknown;
  components?: FlowComponentLike[];
  data?: Record<string, unknown>;
  state?: {
    values?: Record<string, unknown>;
  };
};

export type FlowJsonPart =
  { type: 'flow'; definition: FlowDefinitionLike } | { type: 'html'; html: string };

export type FlowEmojiReference = {
  id: string;
  name?: string;
};

export type FlowTextMap = ReadonlyMap<string, string> | Record<string, string> | undefined;

export type FlowEmojiMap =
  | ReadonlyMap<string, FlowEmojiReference | string>
  | Record<string, FlowEmojiReference | string>
  | undefined;

export type FlowTextNormalizationOptions = {
  userNames?: FlowTextMap;
  channelNames?: FlowTextMap;
  groupNames?: FlowTextMap;
  standardEmojis?: FlowTextMap;
  customEmojis?: FlowEmojiMap;
  /** Set to false for code blocks, where mentions should remain readable text. */
  mentionLinks?: boolean;
  /** Skip buttons so a collapsed preview can show a live action row instead of duplicate labels. */
  omitButtons?: boolean;
};

const FLOW_JSON_DIV_PATTERN = /<div\b[^>]*\bdata-flow-json\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi;
const ANGLE_LINK_PATTERN = /<(https?:[^|>]*)\|([^>]+)>|<(https?:[^>\s]+)>/g;
const FLOW_MENTION_PATTERN = /<(userid|channelid|groupid|broadcast):([^:>]+)(?::([^>]+))?>/gi;
const USER_MENTION_PATTERN = /<@([A-Za-z0-9_.-]+)(?:\|([^>]*))?>/g;
const GROUP_MENTION_PATTERN = /<!subteam\^([A-Za-z0-9_.-]+)(?:\|([^>]*))?>/g;
const CHANNEL_MENTION_PATTERN = /<#([A-Za-z0-9_.-]+)(?:\|([^>]*))?>/g;
const BROADCAST_MENTION_PATTERN = /<!([a-z]+)(?:\|[^>]*)?>/gi;
const SHORTCODE_PATTERN = /:([a-zA-Z0-9_+-]+):/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFlowComponentLike = (value: unknown): value is FlowComponentLike => {
  if (!isRecord(value) || typeof value['type'] !== 'string') return false;
  if (value['props'] !== undefined && !isRecord(value['props'])) return false;
  if (value['style'] !== undefined && !isRecord(value['style'])) return false;
  if (value['children'] !== undefined) {
    if (!Array.isArray(value['children']) || !value['children'].every(isFlowComponentLike)) {
      return false;
    }
  }
  return true;
};

const FLOW_JSON_ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'", apos: "'" };

const isFlowDefinitionLike = (value: unknown): value is FlowDefinitionLike =>
  isRecord(value) &&
  (value['version'] === undefined ||
    value['version'] === '2.0' ||
    value['version'] === '2' ||
    value['version'] === 2) &&
  typeof value['screenId'] === 'string' &&
  Array.isArray(value['components']) &&
  value['components'].every(isFlowComponentLike) &&
  (value['data'] === undefined || isRecord(value['data'])) &&
  (value['state'] === undefined ||
    (isRecord(value['state']) &&
      (value['state']['values'] === undefined || isRecord(value['state']['values']))));

const getMapValue = <T>(
  map: ReadonlyMap<string, T> | Record<string, T> | undefined,
  key: string,
): T | undefined => {
  if (!map) return undefined;
  if (typeof (map as ReadonlyMap<string, T>).get === 'function') {
    return (map as ReadonlyMap<string, T>).get(key);
  }
  return (map as Record<string, T>)[key];
};

const getCaseInsensitiveMapValue = <T>(
  map: ReadonlyMap<string, T> | Record<string, T> | undefined,
  key: string,
): T | undefined => {
  const normalizedKey = key.toLowerCase();
  const direct = getMapValue(map, normalizedKey) ?? getMapValue(map, key);
  if (direct !== undefined) return direct;

  if (map && typeof (map as ReadonlyMap<string, T>).get !== 'function') {
    const entry = Object.entries(map as Record<string, T>).find(
      ([entryKey]) => entryKey.toLowerCase() === normalizedKey,
    );
    return entry?.[1];
  }
  return undefined;
};

const getStringProp = (props: Record<string, unknown> | undefined, key: string): string => {
  const value = props?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

const getUrlProp = (props: Record<string, unknown> | undefined, key: string): string =>
  sanitizeFlowUrl(getStringProp(props, key));

export const isSafeFlowLink = (href: string): boolean =>
  /^https?:\/\//i.test(sanitizeFlowUrl(href));

const escapeMarkdownLabel = (value: string): string => value.replace(/[\\[\]]/g, '\\$&');

const convertAngleLinksToMarkdown = (text: string): string =>
  text.replace(
    ANGLE_LINK_PATTERN,
    (
      match,
      labeledUrl: string | undefined,
      label: string | undefined,
      bareUrl: string | undefined,
    ) => {
      if (labeledUrl) return `[${label}](${labeledUrl})`;
      if (bareUrl) return `[${bareUrl}](${bareUrl})`;
      return match;
    },
  );

const mentionDisplayName = (
  value: string | undefined,
  fallback: string,
  prefix: string,
): string => {
  const displayName = value?.trim() || fallback;
  return `${prefix}${displayName.replace(/^[@#]/, '')}`;
};

const formatMention = (
  label: string,
  scheme: string,
  id: string,
  mentionLinks: boolean,
): string => {
  if (!mentionLinks) return label;
  return `[${escapeMarkdownLabel(label)}](${scheme}${encodeURIComponent(id)})`;
};

const normalizeMentionTokens = (text: string, options: FlowTextNormalizationOptions): string => {
  const mentionLinks = options.mentionLinks !== false;
  let normalized = text;

  normalized = normalized.replace(
    USER_MENTION_PATTERN,
    (_, id: string, explicitName: string | undefined) =>
      formatMention(
        mentionDisplayName(getMapValue(options.userNames, id) ?? explicitName, id, '@'),
        'xyne://user/',
        id,
        mentionLinks,
      ),
  );
  normalized = normalized.replace(
    GROUP_MENTION_PATTERN,
    (_, id: string, explicitName: string | undefined) =>
      formatMention(
        mentionDisplayName(getMapValue(options.groupNames, id) ?? explicitName, id, '@'),
        'xyne://group/',
        id,
        mentionLinks,
      ),
  );
  normalized = normalized.replace(
    CHANNEL_MENTION_PATTERN,
    (_, id: string, explicitName: string | undefined) =>
      formatMention(
        mentionDisplayName(getMapValue(options.channelNames, id) ?? explicitName, id, '#'),
        'xyne://channel/',
        id,
        mentionLinks,
      ),
  );
  normalized = normalized.replace(BROADCAST_MENTION_PATTERN, (_, range: string) =>
    formatMention(`@${range}`, 'xyne://broadcast/', range, mentionLinks),
  );

  normalized = normalized.replace(
    FLOW_MENTION_PATTERN,
    (_, kind: string, id: string, explicitName: string | undefined) => {
      if (kind.toLowerCase() === 'broadcast') {
        return formatMention(
          `@${explicitName?.trim() || id}`,
          'xyne://broadcast/',
          id,
          mentionLinks,
        );
      }

      const lowerKind = kind.toLowerCase();
      const isUser = lowerKind === 'userid';
      const isChannel = lowerKind === 'channelid';
      const map = isUser
        ? options.userNames
        : isChannel
          ? options.channelNames
          : options.groupNames;
      const prefix = isChannel ? '#' : '@';
      const fallback = getMapValue(map, id) ?? explicitName ?? id;
      const label = mentionDisplayName(fallback, id, prefix);
      const scheme = isUser ? 'xyne://user/' : isChannel ? 'xyne://channel/' : 'xyne://group/';
      return formatMention(label, scheme, id, mentionLinks);
    },
  );

  return normalized;
};

const normalizeMessageFormatting = (text: string): string =>
  text
    // The message format uses single asterisks/tildes while Markdown uses double markers.
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=$|[\s)\]}.,!?;:])/gm, '$1**$2**')
    .replace(/(^|[\s([{])~([^~\n]+)~(?=$|[\s)\]}.,!?;:])/gm, '$1~~$2~~');

const normalizeEmojiShortcodes = (text: string, options: FlowTextNormalizationOptions): string =>
  text.replace(SHORTCODE_PATTERN, (match, name: string, offset: number, source: string) => {
    // Do not reinterpret the `:name:` section of our opaque custom-emoji marker.
    const preceding = source.slice(Math.max(0, offset - 64), offset);
    if (/xemoji:[^:]*$/.test(preceding)) return match;

    const customEmoji = getCaseInsensitiveMapValue(options.customEmojis, name);
    if (customEmoji) {
      const reference =
        typeof customEmoji === 'string'
          ? { id: customEmoji, name }
          : { id: customEmoji.id, name: customEmoji.name ?? name };
      return `xemoji:${reference.id}:${encodeURIComponent(reference.name)}:emojix`;
    }

    const standardEmoji = getCaseInsensitiveMapValue(options.standardEmojis, name);
    if (standardEmoji) return standardEmoji;

    // The alert/warning aliases are not present in every Unicode emoji catalog.
    if (name.toLowerCase() === 'alert' || name.toLowerCase() === 'warning') return '⚠️';
    return match;
  });

/** Convert `:name:` shortcodes to `xemoji` placeholders or unicode glyphs. */
export const replaceEmojiShortcodesWithMarkdown = (
  text: string,
  options: Pick<FlowTextNormalizationOptions, 'customEmojis' | 'standardEmojis'> = {},
): string => {
  if (!text) return '';
  return normalizeEmojiShortcodes(text, options);
};

export const normalizeFlowTextToMarkdown = (
  text: string,
  options: FlowTextNormalizationOptions = {},
): string => {
  if (!text) return '';
  let normalized = convertAngleLinksToMarkdown(text);
  normalized = normalizeMentionTokens(normalized, options);
  normalized = normalizeMessageFormatting(normalized);
  return normalizeEmojiShortcodes(normalized, options);
};

const getPlanTodoMarkdown = (
  todo: unknown,
  options: FlowTextNormalizationOptions,
  phase: string,
): string | null => {
  if (!isRecord(todo)) return null;
  const text = typeof todo['text'] === 'string' ? todo['text'].trim() : '';
  if (!text) return null;
  const mark =
    isPlanTodoCompleted(getPlanTodoStatus(todo)) ||
    (phase === 'proposed' && isPlanTodoIncluded(todo))
      ? 'x'
      : ' ';
  return `- [${mark}] ${normalizeFlowTextToMarkdown(text, options)}`;
};

const collectPlanComponentMarkdown = (
  props: Record<string, unknown> | undefined,
  out: string[],
  options: FlowTextNormalizationOptions,
): void => {
  const title = getStringProp(props, 'title');
  const todos = Array.isArray(props?.['todos']) ? props['todos'] : [];
  const completedCount = countCompletedPlanTodos(todos);
  const phase = getStringProp(props, 'phase').toLowerCase();
  const { statusLabel } = resolvePlanHeaderStatus(props ?? {}, completedCount, todos.length);

  const header = [
    title ? `**${normalizeFlowTextToMarkdown(title, options)}**` : '**Plan**',
    `\` ${statusLabel} \``,
  ].join(' ');
  out.push(header);

  const description = getStringProp(props, 'desc') || getStringProp(props, 'description');
  if (description) out.push(normalizeFlowTextToMarkdown(description, options));

  if (todos.length > 0) out.push(`${completedCount} of ${todos.length} completed`);

  const todoLines = todos.flatMap(todo => {
    const line = getPlanTodoMarkdown(todo, options, phase);
    return line ? [line] : [];
  });
  if (todoLines.length > 0) out.push(todoLines.join('\n'));
};

export const getPlanComponentViewModel = (
  component: FlowComponentLike,
  options: FlowTextNormalizationOptions = {},
): PlanComponentViewModel | null =>
  createPlanComponentViewModel(component, text => normalizeFlowTextToMarkdown(text, options));

const flowTextPropsToMarkdown = (
  component: FlowComponentLike,
  options: FlowTextNormalizationOptions,
): string => {
  const props = isRecord(component.props) ? component.props : undefined;
  const content = getStringProp(props, 'content') || getStringProp(props, 'text');
  if (!content) return '';

  const codeBlock = props?.['codeBlock'] === true;
  const normalized = normalizeFlowTextToMarkdown(
    content,
    codeBlock ? { ...options, mentionLinks: false } : options,
  );
  if (codeBlock) return `\`\`\`\n${normalized}\n\`\`\``;

  const normalizedList = normalizeMarkdownListIndentation(normalized);

  const withBold =
    props?.['bold'] === true && !/^\*\*/.test(normalizedList)
      ? `**${normalizedList}**`
      : normalizedList;
  return props?.['italic'] === true && !/^_/.test(withBold) ? `_${withBold}_` : withBold;
};

const getControlMarkdown = (
  component: FlowComponentLike,
  options: FlowTextNormalizationOptions,
): string => {
  const props = isRecord(component.props) ? component.props : undefined;
  const type = typeof component.type === 'string' ? component.type : 'control';
  const label = getStringProp(props, 'label') || getStringProp(props, 'name');
  const placeholder =
    getStringProp(props, 'placeholder') ||
    getStringProp(props, 'defaultValue') ||
    getStringProp(props, 'value');
  const optionsValue = Array.isArray(props?.['options'])
    ? props['options']
        .filter(isRecord)
        .map(option => getStringProp(option, 'label'))
        .filter(Boolean)
        .join(', ')
    : '';
  const suffix = placeholder || optionsValue;
  const normalizedLabel = normalizeFlowTextToMarkdown(label || type, options);
  return suffix
    ? `**${normalizedLabel}:** ${normalizeFlowTextToMarkdown(suffix, options)}`
    : `**${normalizedLabel}**`;
};

const tableToMarkdown = (
  props: Record<string, unknown> | undefined,
  options: FlowTextNormalizationOptions,
): string => {
  const rows = Array.isArray(props?.['rows']) ? props['rows'] : [];
  const normalizedRows = rows
    .filter(row => Array.isArray(row))
    .map(row =>
      row.map(cell =>
        normalizeFlowTextToMarkdown(typeof cell === 'string' ? cell : String(cell), options),
      ),
    );
  if (normalizedRows.length === 0) return '';
  const hasHeader = props?.['hasHeader'] === true;
  const separator = (normalizedRows[0] ?? []).map(() => '---');
  const markdownRows = normalizedRows.map(row => `| ${row.join(' | ')} |`);
  if (hasHeader) markdownRows.splice(1, 0, `| ${separator.join(' | ')} |`);
  return markdownRows.join('\n');
};

const collectFlowComponentMarkdown = (
  component: FlowComponentLike,
  out: string[],
  options: FlowTextNormalizationOptions,
): void => {
  if (component.hidden === true) return;

  const type = typeof component.type === 'string' ? component.type : '';
  const props = isRecord(component.props) ? component.props : undefined;

  if (type === 'text' || type === 'heading') {
    const content = flowTextPropsToMarkdown(component, options);
    if (!content) return;
    if (type === 'heading' && !props?.['codeBlock']) {
      const level =
        typeof props?.['level'] === 'number' ? Math.min(4, Math.max(1, props['level'])) : 2;
      out.push(`${'#'.repeat(level)} ${content.replace(/^#+\s+/, '')}`);
    } else {
      out.push(content);
    }
    return;
  }

  if (type === 'plan') {
    collectPlanComponentMarkdown(props, out, options);
    return;
  }

  if (type === 'diff') {
    const markdown = diffComponentToMarkdown(component);
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'code') {
    const markdown = codeComponentToMarkdown(component, options);
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'pr') {
    const markdown = prComponentToMarkdown(component, options);
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'call_schedule') {
    const markdown = callScheduleComponentToMarkdown(component, options);
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'chart') {
    const markdown = chartComponentToMarkdown(component, options);
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'mcp_suggest') {
    const markdown = mcpSuggestComponentToMarkdown(component, options);
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'agent') {
    const markdown = agentComponentToMarkdown(
      component,
      text => normalizeFlowTextToMarkdown(text, options),
      options,
    );
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'user_question') {
    const markdown = userQuestionComponentToMarkdown(component, options);
    if (markdown) out.push(markdown);
    return;
  }

  if (type === 'link') {
    const label = normalizeFlowTextToMarkdown(getStringProp(props, 'label'), options);
    const href = getUrlProp(props, 'href');
    if (label && isSafeFlowLink(href)) out.push(`[${escapeMarkdownLabel(label)}](${href})`);
    else if (label) out.push(label);
    return;
  }

  if (type === 'divider') {
    out.push('---');
    return;
  }

  if (type === 'image') {
    const src = getUrlProp(props, 'src');
    const alt = normalizeFlowTextToMarkdown(getStringProp(props, 'alt') || 'image', options);
    if (src) out.push(`![${escapeMarkdownLabel(alt)}](${src})`);
    return;
  }

  if (type === 'table') {
    const table = tableToMarkdown(props, options);
    if (table) out.push(table);
    return;
  }

  if (type === 'button') {
    if (options.omitButtons) return;
    out.push(getControlMarkdown(component, options));
    return;
  }

  if (
    type === 'input' ||
    type === 'textarea' ||
    type === 'dropdown' ||
    type === 'select' ||
    type === 'multiselect' ||
    type === 'date'
  ) {
    out.push(getControlMarkdown(component, options));
    return;
  }

  if (Array.isArray(component.children)) {
    for (const child of component.children) collectFlowComponentMarkdown(child, out, options);
  }

  const fallback =
    getStringProp(props, 'content') ||
    getStringProp(props, 'label') ||
    getStringProp(props, 'name');
  if (fallback) out.push(normalizeFlowTextToMarkdown(fallback, options));
};

export const flowComponentsToMarkdown = (
  components: FlowComponentLike[] | undefined,
  options: FlowTextNormalizationOptions = {},
): string => {
  if (!components || components.length === 0) return '';
  const lines: string[] = [];
  for (const component of components) collectFlowComponentMarkdown(component, lines, options);
  return normalizeMarkdownListIndentation(lines.filter(line => line.length > 0).join('\n\n'));
};

export const flowDefinitionToMarkdown = (
  definition: FlowDefinitionLike,
  options: FlowTextNormalizationOptions = {},
): string => {
  const normalizeText = (text: string): string => normalizeFlowTextToMarkdown(text, options);

  if (isWriteApprovalFlow(definition)) {
    return normalizeMarkdownListIndentation(
      writeApprovalFlowToMarkdown(definition, normalizeText, options),
    );
  }

  if (isAgentCardFlow(definition)) {
    return normalizeMarkdownListIndentation(
      agentCardFlowToMarkdown(definition, normalizeText, options),
    );
  }

  if (isUserQuestionFlow(definition)) {
    return normalizeMarkdownListIndentation(userQuestionFlowToMarkdown(definition, options));
  }

  if (isMcpSuggestFlow(definition)) {
    return normalizeMarkdownListIndentation(mcpSuggestFlowToMarkdown(definition, options));
  }

  return normalizeMarkdownListIndentation(
    [
      typeof definition.title === 'string'
        ? normalizeFlowTextToMarkdown(definition.title, options)
        : '',
      flowComponentsToMarkdown(definition.components, options),
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
};

export const flowComponentTextToMarkdown = (
  component: FlowComponentLike,
  options: FlowTextNormalizationOptions = {},
): string => flowTextPropsToMarkdown(component, options);

const parseFlowDefinition = (escaped: string): FlowDefinitionLike | null => {
  if (!escaped) return null;
  try {
    const parsed: unknown = JSON.parse(decodeEntitySet(escaped, FLOW_JSON_ENTITIES));
    return isFlowDefinitionLike(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const parseFlowJsonDefinitions = (html: string): FlowDefinitionLike[] => {
  return parseFlowJsonParts(html)
    .filter((part): part is Extract<FlowJsonPart, { type: 'flow' }> => part.type === 'flow')
    .map(part => part.definition);
};

export const parseFlowJsonParts = (html: string): FlowJsonPart[] => {
  if (typeof html !== 'string' || html.trim() === '') return [];
  FLOW_JSON_DIV_PATTERN.lastIndex = 0;
  const parts: FlowJsonPart[] = [];
  const lowerHtml = html.toLowerCase();
  let cursor = 0;
  for (const match of html.matchAll(FLOW_JSON_DIV_PATTERN)) {
    const parsed = parseFlowDefinition(match[2] ?? '');
    if (!parsed) continue;

    const start = match.index ?? 0;
    const openingTagEnd = start + match[0].length;
    const closingTagStart = lowerHtml.indexOf('</div>', openingTagEnd);
    const wrapperEnd = closingTagStart >= 0 ? closingTagStart + '</div>'.length : openingTagEnd;

    if (start > cursor) parts.push({ type: 'html', html: html.slice(cursor, start) });
    parts.push({ type: 'flow', definition: parsed });
    cursor = wrapperEnd;
  }
  if (parts.length === 0) return [];
  if (cursor < html.length) parts.push({ type: 'html', html: html.slice(cursor) });
  return parts;
};

export const parseFlowJson = (html: string): FlowDefinitionLike | null =>
  parseFlowJsonDefinitions(html)[0] ?? null;

export const isFlowJsonHtml = (html: string): boolean => parseFlowJsonDefinitions(html).length > 0;

export const extractFlowPlanStatusToneFromMarkdown = extractPlanStatusToneFromMarkdown;

export const extractFlowPlanMarkdownHeader = extractPlanMarkdownHeader;

export const extractFlowJsonPlanStatusTone = (html: string): FlowPlanStatusTone | null => {
  const parsed = parseFlowJson(html);
  const planComponent = findPlanComponent(parsed?.components);
  if (!planComponent || !isRecord(planComponent.props)) return null;

  const todos = Array.isArray(planComponent.props['todos']) ? planComponent.props['todos'] : [];
  const completedCount = countCompletedPlanTodos(todos);
  const { statusTone } = resolvePlanHeaderStatus(planComponent.props, completedCount, todos.length);
  return statusTone;
};

export const extractFlowJsonMarkdown = (html: string): string | null => {
  const definitions = parseFlowJsonDefinitions(html);
  if (definitions.length === 0) return null;

  const md = definitions
    .map(definition => flowDefinitionToMarkdown(definition))
    .filter(Boolean)
    .join('\n\n');
  return md.trim().length > 0 ? md : null;
};
