import { parse } from 'node-html-parser';

export interface ConfluenceTransformContext {
  baseUrl: string;
  pageIdByTitle: Map<string, string>;
  attachmentUrlByFileName: Map<string, string>;
  warnings: string[];
  headings?: string[];
}

const CONFLUENCE_PAGE_LINK_PREFIX = 'xyne-confluence-page://';
const RENDERED_VIEW_MACROS = [
  'attachments',
  'blog-posts',
  'change-history',
  'chart',
  'children',
  'children-display',
  'content-by-label',
  'contentbylabel',
  'content-report-table',
  'contributors',
  'contributors-summary',
  'excerpt-include',
  'gallery',
  'include',
  'iframe',
  'jira',
  'jira-chart',
  'jiraissues',
  'jira-issues',
  'jirareports-blueprint',
  'labels',
  'livesearch',
  'microsoft-onedrive',
  'network',
  'onedrive',
  'index',
  'content-properties',
  'content-properties-report',
  'details',
  'detailssummary',
  'pagetree',
  'pagetreesearch',
  'popular-labels',
  'profile-picture',
  'recently-updated',
  'recently-updated-dashboard',
  'related-labels',
  'roadmap',
  'roadmap-planner',
  'spaces',
  'task-report',
  'user-list',
  'userlister',
  'profile',
  'widget',
  'widget-connector',
  'status',
  'drawio',
  'gliffy',
  'plantuml',
  'lucidchart',
  'mermaid',
  'multimedia',
  'video',
  'movie',
  'html',
  'calendar',
  'team-calendar',
  'monthly-calendar',
];

export function rewriteConfluenceCanvasLinks(
  markdown: string,
  canvasUrlByConfluencePageId: Map<string, string>,
  fallbackConfluenceBaseUrl: string,
): string {
  const fallbackBaseUrl = fallbackConfluenceBaseUrl.replace(/\/+$/, '');

  return markdown.replace(
    /\]\(xyne-confluence-page:\/\/([^)]+)\)/g,
    (_match: string, pageId: string) => {
      const canvasUrl = canvasUrlByConfluencePageId.get(pageId);
      return canvasUrl
        ? `](${canvasUrl})`
        : `](${fallbackBaseUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)})`;
    },
  );
}

export function transformConfluenceStorageToMarkdown(
  html: string,
  context: ConfluenceTransformContext,
): string {
  const root = parse(html || '', {
    blockTextElements: {
      script: false,
      noscript: false,
      style: false,
      pre: true,
    },
    comment: false,
  });

  context.headings = collectHeadings(root, context);

  const markdown = renderChildren(root, context)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  return markdown || '_Imported Confluence page did not contain readable content._';
}

export function hasMeaningfulConfluenceContent(html: string): boolean {
  const warnings: string[] = [];
  const markdown = transformConfluenceStorageToMarkdown(html || '', {
    baseUrl: '',
    pageIdByTitle: new Map(),
    attachmentUrlByFileName: new Map(),
    warnings,
  });

  return markdown !== '_Imported Confluence page did not contain readable content._'
    && markdown.trim().length > 0;
}

export function shouldPreferRenderedConfluenceView(storageHtml: string): boolean {
  return extractMacroNames(storageHtml).some(macroName =>
    RENDERED_VIEW_MACROS.some(renderedMacro => macroMatches(macroName, renderedMacro)),
  );
}

function renderChildren(node: any, context: ConfluenceTransformContext): string {
  return (node.childNodes || []).map((child: any) => renderNode(child, context)).join('');
}

function renderNode(node: any, context: ConfluenceTransformContext): string {
  if (node.nodeType === 3) {
    return normalizeText(node.rawText || node.text || '');
  }

  if (!node.tagName) {
    return renderChildren(node, context);
  }

  const tag = String(node.tagName).toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.substring(1));
    return `${'#'.repeat(level)} ${renderInlineChildren(node, context).trim()}\n\n`;
  }

  switch (tag) {
    case 'p':
    case 'div':
      return `${renderChildren(node, context).trim()}\n\n`;
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
    case 'em':
    case 'i':
    case 'code':
      return renderInlineChildren(node, context).trim();
    case 'time':
      return renderTime(node);
    case 'pre':
      return `\n\`\`\`\n${decodeEntities(node.rawText || node.text || '')}\n\`\`\`\n\n`;
    case 'blockquote':
      return renderChildren(node, context)
        .split('\n')
        .filter(Boolean)
        .map(line => `> ${line}`)
        .join('\n') + '\n\n';
    case 'ul':
      return renderList(node, context, false);
    case 'ol':
      return renderList(node, context, true);
    case 'li':
      return `${renderChildren(node, context).trim()}\n`;
    case 'table':
      return renderTable(node, context);
    case 'tr':
      return `${renderChildren(node, context).trim()}\n`;
    case 'td':
    case 'th':
      return `${renderInlineChildren(node, context).trim()} | `;
    case 'a':
      return renderAnchor(node, context);
    case 'img':
      return renderImage(
        attr(node, 'alt') || attr(node, 'title') || 'image',
        attr(node, 'src') || '',
        context,
      );
    case 'ac:link':
      return renderConfluenceLink(node, context);
    case 'ac:image':
      return renderConfluenceImage(node, context);
    case 'ac:task-list':
      return renderTaskList(node, context);
    case 'ac:task':
    case 'ac:task-body':
      return renderChildren(node, context);
    case 'ac:task-id':
    case 'ac:task-status':
    case 'ac:parameter':
      return '';
    case 'ac:placeholder':
      return '';
    case 'ac:structured-macro':
      return renderStructuredMacro(node, context);
    case 'ac:plain-text-body':
    case 'ac:rich-text-body':
    case 'ac:plain-text-link-body':
      return renderChildren(node, context);
    default:
      if (tag.startsWith('ri:')) {
        return '';
      }
      return renderChildren(node, context);
  }
}

function renderInlineChildren(node: any, context: ConfluenceTransformContext): string {
  return renderChildren(node, context).replace(/\s+/g, ' ');
}

function renderList(node: any, context: ConfluenceTransformContext, ordered: boolean): string {
  const items = (node.childNodes || []).filter((child: any) => String(child.tagName || '').toLowerCase() === 'li');

  return items
    .map((item: any, index: number) => {
      const marker = ordered ? `${index + 1}.` : '-';
      return `${marker} ${renderChildren(item, context).trim()}`;
    })
    .join('\n') + '\n\n';
}

function renderTable(node: any, context: ConfluenceTransformContext): string {
  const rows = findAllByTag(node, 'tr').map((row: any) =>
    (row.childNodes || [])
      .filter((cell: any) => ['td', 'th'].includes(String(cell.tagName || '').toLowerCase()))
      .map((cell: any) => escapeTableCell(
        renderChildren(cell, context).replace(/[ \t]+/g, ' ').trim()
      )),
  );

  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row: string[]) => row.length));
  const normalized = rows.map((row: string[]) => [...row, ...Array(Math.max(columnCount - row.length, 0)).fill('')]);
  const header = normalized[0];
  const separator = Array(columnCount).fill('---');
  const body = normalized.slice(1);

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((row: string[]) => `| ${row.join(' | ')} |`),
    '',
    '',
  ].join('\n');
}

function renderAnchor(node: any, context: ConfluenceTransformContext): string {
  const label = renderInlineChildren(node, context).trim() || attr(node, 'href') || 'link';
  const href = attr(node, 'href');
  if (!href) return label;

  if (href.startsWith('#')) {
    return `[${label}](${href})`;
  }

  const pageId = extractConfluencePageId(href);
  if (pageId) {
    return `[${label}](${CONFLUENCE_PAGE_LINK_PREFIX}${pageId})`;
  }

  return `[${label}](${resolveUrl(href, context.baseUrl)})`;
}

function renderConfluenceLink(node: any, context: ConfluenceTransformContext): string {
  const pageNode = findFirstByTag(node, 'ri:page');
  const urlNode = findFirstByTag(node, 'ri:url');
  const label =
    textFromFirst(node, 'ac:plain-text-link-body') ||
    textFromFirst(node, 'ac:link-body') ||
    attr(pageNode, 'ri:content-title') ||
    attr(urlNode, 'ri:value') ||
    'link';

  const contentId = attr(pageNode, 'ri:content-id');
  if (contentId) {
    return `[${label}](${CONFLUENCE_PAGE_LINK_PREFIX}${contentId})`;
  }

  const title = attr(pageNode, 'ri:content-title');
  if (title) {
    const mappedPageId = context.pageIdByTitle.get(title);
    if (mappedPageId) {
      return `[${label}](${CONFLUENCE_PAGE_LINK_PREFIX}${mappedPageId})`;
    }
    context.warnings.push(`Could not resolve Confluence page link titled "${title}"`);
  }

  const url = attr(urlNode, 'ri:value');
  return url ? `[${label}](${resolveUrl(url, context.baseUrl)})` : label;
}

function renderConfluenceImage(node: any, context: ConfluenceTransformContext): string {
  const attachmentNode = findFirstByTag(node, 'ri:attachment');
  const urlNode = findFirstByTag(node, 'ri:url');
  const filename = attr(attachmentNode, 'ri:filename');
  const alt = attr(node, 'ac:alt') || filename || 'image';

  if (filename) {
    const migratedUrl = context.attachmentUrlByFileName.get(filename);
    if (migratedUrl) {
      return `\n![${alt}](${migratedUrl})\n\n`;
    }
  }

  const url = attr(urlNode, 'ri:value');
  if (url) {
    return renderImage(alt, url, context);
  }

  context.warnings.push(`Could not resolve Confluence image${filename ? ` "${filename}"` : ''}`);
  return `\n> [!WARNING]\n> Imported image could not be resolved${filename ? `: ${filename}` : ''}.\n\n`;
}

function renderStructuredMacro(node: any, context: ConfluenceTransformContext): string {
  const macroName = attr(node, 'ac:name') || 'unknown';
  const plainTextBody = textFromFirst(node, 'ac:plain-text-body');
  const richTextBodyNode = findFirstByTag(node, 'ac:rich-text-body');
  const richTextBody = richTextBodyNode ? renderChildren(richTextBodyNode, context).trim() : '';
  const normalizedMacroName = macroName.toLowerCase();

  if (macroMatches(normalizedMacroName, 'code')) {
    const language = macroParameter(node, 'language');
    return `\n\`\`\`${language || ''}\n${plainTextBody || richTextBody || ''}\n\`\`\`\n\n`;
  }

  if (macroMatchesAny(normalizedMacroName, ['note', 'info', 'tip', 'warning', 'panel'])) {
    return renderPanelMacro(normalizedMacroName, richTextBody || plainTextBody || '');
  }

  if (macroMatches(normalizedMacroName, 'expand')) {
    const title = macroParameter(node, 'title') || 'Expand';
    const body = (richTextBody || plainTextBody || '').trim();
    return `\n<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n\n`;
  }

  if (macroMatches(normalizedMacroName, 'view-file')) {
    return renderViewFileMacro(node, context);
  }

  if (macroMatches(normalizedMacroName, 'anchor')) {
    return renderAnchorMacro(node, context);
  }

  if (macroMatches(normalizedMacroName, 'excerpt')) {
    return richTextBody ? `\n${richTextBody}\n\n` : '';
  }

  if (macroMatchesAny(normalizedMacroName, ['content-properties', 'details'])) {
    return richTextBody ? `\n${richTextBody}\n\n` : '';
  }

  if (macroMatchesAny(normalizedMacroName, ['toc', 'table-of-contents'])) {
    return renderTableOfContentsMacro(context);
  }

  if (macroMatchesAny(normalizedMacroName, ['toc-zone', 'table-of-content-zone'])) {
    return renderTocZoneMacro(richTextBody || plainTextBody || '', context);
  }

  if (macroMatches(normalizedMacroName, 'jirareports-blueprint')) {
    return renderCleanMacroFallback(
      context,
      macroName,
      'Jira report macro could not be converted automatically. Open the original Confluence page for the live report.',
    );
  }

  const fileMacro = renderFileLikeMacro(node, normalizedMacroName, context);
  if (fileMacro !== null) {
    return fileMacro;
  }

  if (macroMatches(normalizedMacroName, 'smart-button')) {
    return renderSmartButtonMacro(node, context);
  }

  if (macroMatchesAny(normalizedMacroName, ['section', 'column'])) {
    return richTextBody ? `\n${richTextBody}\n\n` : '';
  }

  if (macroMatches(normalizedMacroName, 'status')) {
    const title = macroParameter(node, 'title');
    const colour = macroParameter(node, 'colour') || macroParameter(node, 'color');
    const text = title || colour;
    if (!text) return '';
    return `\n_${escapeLinkLabel(text)}_\n\n`;
  }

  if (macroMatchesAny(normalizedMacroName, ['noformat', 'code-block'])) {
    return `\n\`\`\`\n${plainTextBody || richTextBody || ''}\n\`\`\`\n\n`;
  }

  return renderUnsupportedConfluenceMacroFallback(node, macroName, context);
}

function renderAnchorMacro(node: any, context: ConfluenceTransformContext): string {
  const anchorName = macroParameter(node, 'anchor') || macroParameter(node, 'name') || macroParameter(node, '') || '';
  if (!anchorName) {
    context.warnings.push('Confluence anchor macro did not include an anchor name');
    return '';
  }

  return `\n<a id="${escapeHtmlAttribute(anchorName)}"></a>\n\n`;
}

function renderPanelMacro(macroName: string, body: string): string {
  const trimmedBody = body.trim();
  if (!trimmedBody) return '';

  if (macroName === 'panel') {
    return `\n${trimmedBody}\n\n`;
  }

  const label = macroName.charAt(0).toUpperCase() + macroName.slice(1);
  const quotedBody = trimmedBody
    .split('\n')
    .map(line => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
  return `\n> **${label}**\n${quotedBody}\n\n`;
}

function renderViewFileMacro(node: any, context: ConfluenceTransformContext): string {
  const attachmentNode = findFirstByTag(node, 'ri:attachment');
  const filename = attr(attachmentNode, 'ri:filename') || macroParameter(node, 'name') || macroParameter(node, 'filename');
  if (!filename) {
    context.warnings.push('Confluence view-file macro did not include an attachment filename');
    return '\n> [!WARNING]\n> Confluence file preview could not be resolved.\n\n';
  }

  const attachmentId = context.attachmentUrlByFileName.get(filename);
  if (!attachmentId) {
    context.warnings.push(`Could not resolve Confluence file preview attachment "${filename}"`);
    return `\n> [!WARNING]\n> Confluence file preview could not be resolved: ${filename}\n\n`;
  }

  return `\n[${escapeLinkLabel(filename)}](/api/attachments/${encodeURIComponent(attachmentId)}/download)\n\n`;
}

function renderFileLikeMacro(
  node: any,
  macroName: string,
  context: ConfluenceTransformContext,
): string | null {
  if (!macroMatchesAny(macroName, [
    'viewdoc',
    'viewxls',
    'viewppt',
    'viewpdf',
    'pdf',
    'office-word',
    'office-excel',
    'office-powerpoint',
    'office',
  ])) {
    return null;
  }

  const attachmentNode = findFirstByTag(node, 'ri:attachment');
  const filename =
    attr(attachmentNode, 'ri:filename') ||
    macroParameter(node, 'name') ||
    macroParameter(node, 'filename') ||
    macroParameter(node, 'file');

  if (!filename) {
    return renderCleanMacroFallback(
      context,
      macroName,
      `${humanizeMacroName(macroName)} macro could not be resolved because it did not include an attachment filename.`,
    );
  }

  const attachmentId = context.attachmentUrlByFileName.get(filename);
  if (!attachmentId) {
    context.warnings.push(`Could not resolve Confluence ${macroName} attachment "${filename}"`);
    return `\n> [!WARNING]\n> ${humanizeMacroName(macroName)} attachment could not be resolved: ${filename}\n\n`;
  }

  return `\n[${escapeLinkLabel(filename)}](/api/attachments/${encodeURIComponent(attachmentId)}/download)\n\n`;
}

function renderTableOfContentsMacro(context: ConfluenceTransformContext): string {
  const headings = (context.headings || []).filter(Boolean);
  if (headings.length === 0) {
    context.warnings.push('Confluence table of contents macro was omitted because no headings were available');
    return '';
  }

  return `\n${headings.map(heading => `- [${escapeLinkLabel(heading)}](#${slugifyHeading(heading)})`).join('\n')}\n\n`;
}

function renderTocZoneMacro(body: string, context: ConfluenceTransformContext): string {
  const trimmedBody = body.trim();
  if (trimmedBody) {
    return `\n${renderTableOfContentsMacro(context).trim()}\n\n${trimmedBody}\n\n`;
  }

  return renderTableOfContentsMacro(context);
}

function renderSmartButtonMacro(node: any, context: ConfluenceTransformContext): string {
  const label =
    macroParameter(node, 'title') ||
    macroParameter(node, 'text') ||
    macroParameter(node, 'label') ||
    macroParameter(node, 'buttonText') ||
    macroParameter(node, 'button-text') ||
    'Smart button';
  const url = macroParameter(node, 'url') || macroParameter(node, 'link');

  context.warnings.push('Confluence smart-button macro was converted to a static fallback');
  if (url) {
    return `\n[${escapeLinkLabel(label)}](${resolveUrl(url, context.baseUrl)})\n\n`;
  }
  return `\n_${label}_\n\n`;
}

function renderCleanMacroFallback(
  context: ConfluenceTransformContext,
  macroName: string,
  message: string,
): string {
  context.warnings.push(`Confluence macro "${macroName}" was converted to a static fallback`);
  return `\n> [!WARNING]\n> ${message}\n\n`;
}

const UNSUPPORTED_CONFLUENCE_MACRO_MESSAGE =
  'This Confluence macro could not be imported automatically. Open the original Confluence page to view this content.';

function renderUnsupportedConfluenceMacroFallback(
  node: any,
  macroName: string,
  context: ConfluenceTransformContext,
): string {
  const link = macroParameter(node, 'url') || macroParameter(node, 'link');
  const fallback = renderCleanMacroFallback(context, macroName, UNSUPPORTED_CONFLUENCE_MACRO_MESSAGE);
  if (!link) return fallback;

  return `${fallback}[Open macro link](${resolveUrl(link, context.baseUrl)})\n\n`;
}

function renderTaskList(node: any, context: ConfluenceTransformContext, indent = 0): string {
  const tasks = directChildrenByTag(node, 'ac:task');
  if (tasks.length === 0) return '';

  return tasks
    .map((task: any) => renderTask(task, context, indent))
    .join('') + (indent === 0 ? '\n' : '');
}

function renderTask(node: any, context: ConfluenceTransformContext, indent: number): string {
  const status = textFromFirst(node, 'ac:task-status')?.toLowerCase();
  const checked = status === 'complete' || status === 'done' || status === 'checked';
  const bodyNode = findFirstByTag(node, 'ac:task-body');
  const body = renderTaskBody(bodyNode || node, context);
  const nestedLists = directChildrenByTag(bodyNode || node, 'ac:task-list')
    .map((list: any) => renderTaskList(list, context, indent + 1))
    .join('');
  const prefix = '  '.repeat(indent);

  return `${prefix}- [${checked ? 'x' : ' '}] ${body}\n${nestedLists}`;
}

function renderTaskBody(node: any, context: ConfluenceTransformContext): string {
  return (node.childNodes || [])
    .filter((child: any) => {
      const tag = String(child.tagName || '').toLowerCase();
      return !['ac:task-id', 'ac:task-status', 'ac:task-list'].includes(tag);
    })
    .map((child: any) => renderNode(child, context))
    .join('')
    .replace(/\n+/g, ' ')
    .trim();
}

function renderImage(alt: string, src: string, context: ConfluenceTransformContext): string {
  if (!src) {
    context.warnings.push(`Image "${alt}" did not include a source URL`);
    return '';
  }

  return `\n![${alt}](${resolveUrl(src, context.baseUrl)})\n\n`;
}

function renderTime(node: any): string {
  const value =
    attr(node, 'datetime') ||
    attr(node, 'data-date') ||
    attr(node, 'title') ||
    cleanText(node.rawText || node.text || '');
  if (!value) return '';

  return formatConfluenceDate(value);
}

function formatConfluenceDate(value: string): string {
  const trimmedValue = value.trim();
  const dateOnly = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateOnly) return trimmedValue;

  const [, year, month, day] = dateOnly;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function macroParameter(node: any, name: string): string | undefined {
  const parameters = findAllByTag(node, 'ac:parameter');
  const parameter = parameters.find((item: any) => (attr(item, 'ac:name') || '') === name);
  return parameter ? cleanText(parameter.rawText || parameter.text || '') : undefined;
}

function extractMacroNames(html: string): string[] {
  const root = parse(html || '', { comment: false });
  return findAllByTag(root, 'ac:structured-macro')
    .map((node: any) => attr(node, 'ac:name')?.toLowerCase())
    .filter((macroName: string | undefined): macroName is string => Boolean(macroName));
}

function collectHeadings(root: any, context: ConfluenceTransformContext): string[] {
  const headings: string[] = [];
  const visit = (node: any): void => {
    const tag = String(node.tagName || '').toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const heading = renderInlineChildren(node, context).trim();
      if (heading) headings.push(heading);
      return;
    }
    for (const child of node.childNodes || []) {
      visit(child);
    }
  };

  visit(root);
  return headings;
}

function textFromFirst(node: any, tag: string): string | undefined {
  const found = findFirstByTag(node, tag);
  if (!found) return undefined;
  return cleanText(found.rawText || found.text || '');
}

function findFirstByTag(node: any, tag: string): any | undefined {
  return findAllByTag(node, tag)[0];
}

function findAllByTag(node: any, tag: string): any[] {
  const normalizedTag = tag.toLowerCase();
  const result: any[] = [];

  const visit = (current: any): void => {
    if (String(current.tagName || '').toLowerCase() === normalizedTag) {
      result.push(current);
    }
    for (const child of current.childNodes || []) {
      visit(child);
    }
  };

  visit(node);
  return result;
}

function directChildrenByTag(node: any, tag: string): any[] {
  if (!node) return [];
  const normalizedTag = tag.toLowerCase();
  return (node.childNodes || []).filter((child: any) =>
    String(child.tagName || '').toLowerCase() === normalizedTag,
  );
}

function attr(node: any, name: string): string | undefined {
  if (!node || typeof node.getAttribute !== 'function') return undefined;
  return node.getAttribute(name) || node.getAttribute(name.toLowerCase()) || undefined;
}

function extractConfluencePageId(href: string): string | undefined {
  const decoded = decodeURIComponent(href);
  const pageIdQuery = decoded.match(/[?&]pageId=(\d+)/i);
  if (pageIdQuery) return pageIdQuery[1];

  const pagePath = decoded.match(/\/pages\/(\d+)(?:\/|$)/i);
  if (pagePath) return pagePath[1];

  return undefined;
}

function resolveUrl(url: string, baseUrl: string): string {
  if (/^(https?:|mailto:|xyne-confluence-page:\/\/)/i.test(url)) {
    return url;
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  return `${baseUrl.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
}

function normalizeText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ');
}

function escapeLinkLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function humanizeMacroName(macroName: string): string {
  return macroName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function macroMatches(macroName: string, expectedMacroName: string): boolean {
  const normalizedMacroName = compactMacroName(macroName);
  const normalizedExpectedMacroName = compactMacroName(expectedMacroName);
  return normalizedMacroName === normalizedExpectedMacroName
    || normalizedMacroName.includes(normalizedExpectedMacroName);
}

function macroMatchesAny(macroName: string, expectedMacroNames: string[]): boolean {
  return expectedMacroNames.some(expectedMacroName => macroMatches(macroName, expectedMacroName));
}

function compactMacroName(macroName: string): string {
  return macroName.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function cleanText(text: string): string {
  return decodeEntities(text).trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function escapeTableCell(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
    .replace(/(?:<br>){3,}/g, '<br><br>');
}
