/**
 * §8.1 reuse gate: **Adopt**. Characterised against v2 htmlListsToMarkdown.
 * Line-budget exemption: 340 < 400 (design C1).
 */

type HtmlTextNode = {
  kind: 'text';
  value: string;
};

type HtmlElementNode = {
  kind: 'element';
  tagName: string;
  openTag: string;
  children: HtmlNode[];
  isVoid: boolean;
};

type HtmlNode = HtmlTextNode | HtmlElementNode;

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const LIST_TAGS = new Set(['ol', 'ul']);
const MIN_NESTED_LIST_INDENT = 3;
const MARKDOWN_CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;
const CODE_TOKEN_OPEN = '\uE000xyne-list-code:';
const CODE_TOKEN_CLOSE = '\uE001';
const CODE_TOKEN_PATTERN = /\uE000xyne-list-code:(\d+)\uE001/g;

const isElement = (node: HtmlNode | undefined, tagName?: string): node is HtmlElementNode =>
  node?.kind === 'element' && (tagName === undefined || node.tagName === tagName);

const findTagEnd = (html: string, start: number): number => {
  let quote: '"' | "'" | null = null;

  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }

  return -1;
};

const getTagName = (tag: string): string | null => {
  const match = /^<\s*\/?\s*([a-z][a-z0-9:-]*)\b/i.exec(tag);
  return match?.[1]?.toLowerCase() ?? null;
};

const isClosingTag = (tag: string): boolean => /^<\s*\//.test(tag);

const isSelfClosingTag = (tag: string): boolean => /\/\s*>$/.test(tag);

const appendText = (children: HtmlNode[], value: string): void => {
  if (!value) return;
  const previous = children[children.length - 1];
  if (previous?.kind === 'text') {
    previous.value += value;
  } else {
    children.push({ kind: 'text', value });
  }
};

/**
 * Parse just enough HTML structure to retain balanced block/list nesting.
 * Inline markup is kept as the original tag/text nodes and is serialized back
 * for the existing inline conversion pipeline.
 */
const parseHtmlFragment = (html: string): HtmlNode[] => {
  const root: HtmlElementNode = {
    kind: 'element',
    tagName: '#root',
    openTag: '',
    children: [],
    isVoid: false,
  };
  const stack: HtmlElementNode[] = [root];

  let cursor = 0;
  while (cursor < html.length) {
    const openIndex = html.indexOf('<', cursor);
    if (openIndex === -1) {
      appendText(stack[stack.length - 1]!.children, html.slice(cursor));
      break;
    }

    appendText(stack[stack.length - 1]!.children, html.slice(cursor, openIndex));

    if (html.startsWith('<!--', openIndex)) {
      const commentEnd = html.indexOf('-->', openIndex + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(html, openIndex);
    if (tagEnd === -1) {
      appendText(stack[stack.length - 1]!.children, html.slice(openIndex));
      break;
    }

    const rawTag = html.slice(openIndex, tagEnd + 1);
    const tagName = getTagName(rawTag);
    if (!tagName) {
      cursor = tagEnd + 1;
      continue;
    }

    if (isClosingTag(rawTag)) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]?.tagName === tagName) {
          stack.length = index;
          break;
        }
      }
      cursor = tagEnd + 1;
      continue;
    }

    const isVoid = VOID_TAGS.has(tagName) || isSelfClosingTag(rawTag);
    const element: HtmlElementNode = {
      kind: 'element',
      tagName,
      openTag: rawTag,
      children: [],
      isVoid,
    };
    stack[stack.length - 1]!.children.push(element);

    if (!isVoid) stack.push(element);
    cursor = tagEnd + 1;
  }

  return root.children;
};

const serializeNode = (node: HtmlNode): string => {
  if (node.kind === 'text') return node.value;
  if (node.isVoid) return node.openTag;
  return `${node.openTag}${node.children.map(serializeNode).join('')}</${node.tagName}>`;
};

const getNumericAttribute = (tag: string, name: string): number | null => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"(-?\\d+)"|'(-?\\d+)'|(-?\\d+))`, 'i').exec(
    tag,
  );
  const rawValue = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!rawValue) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
};

const serializeListContentNode = (node: HtmlNode): string => {
  if (node.kind === 'text') return node.value;
  if (LIST_TAGS.has(node.tagName)) return '';
  if (node.tagName === 'br') return '\n';
  if (node.tagName === 'p' || node.tagName === 'div') {
    return `${node.children.map(serializeListContentNode).join('')}\n`;
  }
  if (node.isVoid) return node.openTag;
  return `${node.openTag}${node.children.map(serializeListContentNode).join('')}</${node.tagName}>`;
};

const normalizeListItemContent = (content: string): string =>
  content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();

type RenderedList = {
  markdown: string;
  nextOrderedValue: number | null;
};

const getFirstListItem = (list: HtmlElementNode): HtmlElementNode | null =>
  list.children.find((child): child is HtmlElementNode => isElement(child, 'li')) ?? null;

const renderListCore = (
  list: HtmlElementNode,
  baseIndent: number,
  orderedStartOverride?: number,
): RenderedList => {
  const ordered = list.tagName === 'ol';
  const firstListItem = ordered ? getFirstListItem(list) : null;
  let nextOrderedValue =
    orderedStartOverride ??
    getNumericAttribute(list.openTag, 'start') ??
    (firstListItem ? getNumericAttribute(firstListItem.openTag, 'value') : null) ??
    1;
  const renderedItems: string[] = [];

  for (const child of list.children) {
    if (!isElement(child, 'li')) {
      if (child.kind === 'text' && child.value.trim() === '') continue;
      // Valid TipTap lists contain only <li> children. Preserve unexpected
      // content rather than silently dropping it.
      renderedItems.push(`${' '.repeat(baseIndent)}${serializeNode(child).trim()}`);
      continue;
    }

    const explicitValue = ordered ? getNumericAttribute(child.openTag, 'value') : null;
    const marker = ordered ? `${explicitValue ?? nextOrderedValue}.` : '-';
    if (ordered) nextOrderedValue = (explicitValue ?? nextOrderedValue) + 1;

    const content = normalizeListItemContent(
      child.children
        .filter(item => !isElement(item) || !LIST_TAGS.has(item.tagName))
        .map(serializeListContentNode)
        .join(''),
    );
    const nestedLists = child.children.filter(
      (item): item is HtmlElementNode => isElement(item) && LIST_TAGS.has(item.tagName),
    );
    const markerIndent = ' '.repeat(baseIndent);
    const contentIndent = ' '.repeat(baseIndent + marker.length + 1);
    const contentLines = content ? content.split('\n') : [''];
    const itemLines = [
      `${markerIndent}${marker}${contentLines[0] ? ` ${contentLines[0]}` : ''}`,
      ...contentLines.slice(1).map(line => `${contentIndent}${line}`),
    ];

    for (const nestedList of nestedLists) {
      const nestedIndent = baseIndent + Math.max(MIN_NESTED_LIST_INDENT, marker.length + 1);
      const nestedMarkdown = renderListCore(nestedList, nestedIndent).markdown;
      if (nestedMarkdown) itemLines.push(nestedMarkdown);
    }

    renderedItems.push(itemLines.join('\n'));
  }

  return {
    markdown: renderedItems.join('\n'),
    nextOrderedValue: ordered ? nextOrderedValue : null,
  };
};

const serializeWithLists = (nodes: HtmlNode[]): string => {
  let serialized = '';
  let previousNodeWasList = false;
  let previousListTagName: 'ol' | 'ul' | null = null;
  let previousListBaseIndent = 0;
  let previousListNextOrderedValue: number | null = null;

  for (const node of nodes) {
    if (node.kind === 'element' && LIST_TAGS.has(node.tagName)) {
      const listTagName: 'ol' | 'ul' = node.tagName === 'ol' ? 'ol' : 'ul';
      const isAdjacentSameTypeList = previousNodeWasList && previousListTagName === listTagName;
      // Class-based list padding such as dashboard/mobile `pl-6` is only
      // presentation metadata. Only the HTML tree establishes genuine nesting,
      // which is handled inside renderListCore.
      const baseIndent = isAdjacentSameTypeList ? previousListBaseIndent : 0;
      const shouldContinueOrderedList =
        isAdjacentSameTypeList &&
        listTagName === 'ol' &&
        getNumericAttribute(node.openTag, 'start') === null &&
        getNumericAttribute(getFirstListItem(node)?.openTag ?? '', 'value') === null;
      const renderedList = renderListCore(
        node,
        baseIndent,
        shouldContinueOrderedList && previousListNextOrderedValue !== null
          ? previousListNextOrderedValue
          : undefined,
      );
      if (!renderedList.markdown) continue;

      // Adjacent same-type list blocks are serialized as one Markdown list so
      // their markers share one indentation level.
      if (isAdjacentSameTypeList) {
        serialized = serialized.replace(/\n{2}$/, '\n');
      }
      if (!serialized.endsWith('\n')) serialized += '\n';
      serialized += `${renderedList.markdown}\n\n`;
      previousNodeWasList = true;
      previousListTagName = listTagName;
      previousListBaseIndent = baseIndent;
      previousListNextOrderedValue = renderedList.nextOrderedValue;
      continue;
    }

    if (node.kind === 'element' && !node.isVoid) {
      serialized += `${node.openTag}${serializeWithLists(node.children)}</${node.tagName}>`;
      previousNodeWasList = false;
      previousListTagName = null;
      previousListNextOrderedValue = null;
      continue;
    }

    serialized += serializeNode(node);
    if (node.kind !== 'text' || node.value.trim() !== '') {
      previousNodeWasList = false;
      previousListTagName = null;
      previousListNextOrderedValue = null;
    }
  }

  return serialized;
};

const protectMarkdownCode = (html: string): { html: string; code: string[] } => {
  const code: string[] = [];
  const protectedHtml = html.replace(MARKDOWN_CODE_PATTERN, match => {
    const index = code.push(match) - 1;
    return `${CODE_TOKEN_OPEN}${index}${CODE_TOKEN_CLOSE}`;
  });
  return { html: protectedHtml, code };
};

const restoreMarkdownCode = (markdown: string, code: string[]): string =>
  markdown.replace(CODE_TOKEN_PATTERN, (match, index: string) => code[Number(index)] ?? match);

/**
 * Convert balanced HTML lists to CommonMark while preserving list depth.
 * Unlike regex replacement, this handles nested and mixed <ol>/<ul> trees.
 */
export const convertHtmlListsToMarkdown = (html: string): string => {
  const protectedInput = protectMarkdownCode(html);
  if (!/<\s*(?:ol|ul)(?:\s|>)/i.test(protectedInput.html)) {
    return restoreMarkdownCode(protectedInput.html, protectedInput.code);
  }
  const markdown = serializeWithLists(parseHtmlFragment(protectedInput.html));
  return restoreMarkdownCode(markdown, protectedInput.code);
};
