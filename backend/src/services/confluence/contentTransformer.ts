import { parse } from 'node-html-parser';

export interface ConfluenceTransformContext {
  baseUrl: string;
  pageIdByTitle: Map<string, string>;
  attachmentUrlByFileName: Map<string, string>;
  warnings: string[];
}

const CONFLUENCE_PAGE_LINK_PREFIX = 'xyne-confluence-page://';

export function rewriteConfluenceCanvasLinks(
  markdown: string,
  canvasUrlByConfluencePageId: Map<string, string>,
): string {
  return markdown.replace(
    /\]\(xyne-confluence-page:\/\/([^)]+)\)/g,
    (match: string, pageId: string) => {
      const canvasUrl = canvasUrlByConfluencePageId.get(pageId);
      return canvasUrl ? `](${canvasUrl})` : match;
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

  const markdown = renderChildren(root, context)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  return markdown || '_Imported Confluence page did not contain readable content._';
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
      return `**${renderInlineChildren(node, context).trim()}**`;
    case 'em':
    case 'i':
      return `_${renderInlineChildren(node, context).trim()}_`;
    case 'code':
      return `\`${renderInlineChildren(node, context).trim()}\``;
    case 'pre':
      return `\n\`\`\`\n${node.rawText || node.text || ''}\n\`\`\`\n\n`;
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
      .map((cell: any) => escapeTableCell(renderInlineChildren(cell, context).trim())),
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
  const richTextBody = textFromFirst(node, 'ac:rich-text-body');

  if (macroName === 'code') {
    const language = macroParameter(node, 'language');
    return `\n\`\`\`${language || ''}\n${plainTextBody || richTextBody || ''}\n\`\`\`\n\n`;
  }

  if (['note', 'info', 'tip', 'warning', 'panel'].includes(macroName)) {
    return '';
  }

  if (macroName === 'expand') {
    const title = macroParameter(node, 'title') || 'Expand';
    const body = (richTextBody || plainTextBody || '').trim();
    return `\n<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n\n`;
  }

  context.warnings.push(`Unsupported Confluence macro "${macroName}" was replaced with a placeholder`);
  return `\n> [!WARNING]\n> Unsupported Confluence macro omitted: ${macroName}\n\n`;
}

function renderImage(alt: string, src: string, context: ConfluenceTransformContext): string {
  if (!src) {
    context.warnings.push(`Image "${alt}" did not include a source URL`);
    return '';
  }

  return `\n![${alt}](${resolveUrl(src, context.baseUrl)})\n\n`;
}

function macroParameter(node: any, name: string): string | undefined {
  const parameters = findAllByTag(node, 'ac:parameter');
  const parameter = parameters.find((item: any) => attr(item, 'ac:name') === name);
  return parameter ? cleanText(parameter.rawText || parameter.text || '') : undefined;
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
    .replace(/&quot;/g, '"');
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
