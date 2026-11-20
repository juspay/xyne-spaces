import { parseForwardedMessageXml } from '@xyne/shared';
import { marked } from 'marked';
import { getUserDisplayName } from './userDisplayName';

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function messageMetadata(message: { metadata?: unknown }): Record<string, unknown> {
  return message.metadata && typeof message.metadata === 'object'
    ? (message.metadata as Record<string, unknown>)
    : {};
}

/** Preserve Markdown messages exactly; only composer HTML needs conversion. */
export function threadMessageToMarkdown(message: { content: string; metadata?: unknown }): string {
  const isMarkdown = messageMetadata(message)['contentFormat'] === 'markdown';
  const forwarded = parseForwardedMessageXml(message.content);
  if (!forwarded) return isMarkdown ? message.content : messageHtmlToMarkdown(message.content);
  return [
    messageHtmlToMarkdown(forwarded.optionalText ?? ''),
    `Forwarded from ${escapeMarkdown(forwarded.originalSenderName.replace(/[\r\n]+/g, ' '))}`,
    isMarkdown ? forwarded.content : messageHtmlToMarkdown(forwarded.content),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Use the discussion title, then readable opening text, then the channel name. */
export function getThreadExportTitle(
  message: { content: string; metadata?: unknown } | undefined,
  channelName: string,
  discussionTitle = '',
): string {
  if (discussionTitle.trim()) return discussionTitle.trim();
  const content = message ? threadMessageToMarkdown(message) : '';
  const html = marked.parse(content, { async: false });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe').forEach(node => node.remove());
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 100) || channelName.trim() || 'Thread';
}

/** Call cards have their own UI label, even when their sender is the system user. */
export function getThreadSenderLabel(message: {
  senderId: string;
  metadata?: unknown;
}): string | undefined {
  if (messageMetadata(message)['isCallMessage'] === true) return 'Xyne Call';
  if (message.senderId === 'system') return 'System';
  return undefined;
}

type ExportUser = {
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
};

/** Await missing senders using the same cache/point-query strategy as useUserLookup. */
export async function resolveThreadSenderNames(options: {
  messages: readonly ThreadExportMessage[];
  cachedUsers: ReadonlyMap<string, ExportUser>;
  lookupUser: (id: string) => Promise<ExportUser | null | undefined>;
  maskEmailForOthers: boolean;
  selfId: string;
}): Promise<Map<string, string>> {
  const senderIds = [
    ...new Set(
      options.messages
        .filter(message => message.isSent && !message.isDeleted && !getThreadSenderLabel(message))
        .map(message => message.senderId),
    ),
  ];
  const names = await Promise.all(
    senderIds.map(async id => {
      const user = options.cachedUsers.get(id) ?? (await options.lookupUser(id));
      const visibleUser =
        user && options.maskEmailForOthers && id !== options.selfId ? { ...user, email: '' } : user;
      return [id, getUserDisplayName(visibleUser)] as const;
    }),
  );
  return new Map(names);
}

/** Convert stored composer HTML without reading the virtualized message DOM. */
export function messageHtmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return escapeMarkdown(node.textContent ?? '');
    if (!(node instanceof Element)) return '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'iframe'].includes(tag)) return '';
    const text = (): string => Array.from(node.childNodes).map(walk).join('');
    if (tag === 'pre') {
      const code = node.textContent ?? '';
      const fence = '`'.repeat(
        Math.max(3, ...Array.from(code.matchAll(/`+/g), m => m[0].length + 1)),
      );
      const language = node.querySelector('code')?.className.match(/language-([\w+-]+)/)?.[1] ?? '';
      return `\n\n${fence}${language}\n${code}\n${fence}\n\n`;
    }
    if (tag === 'code') {
      const code = node.textContent ?? '';
      const fence = '`'.repeat(
        Math.max(1, ...Array.from(code.matchAll(/`+/g), m => m[0].length + 1)),
      );
      return `${fence} ${code} ${fence}`;
    }
    if (node.getAttribute('data-type') === 'mention') {
      return escapeMarkdown(
        `@${node.getAttribute('data-label') ?? node.textContent ?? 'mention'}`.replace(/^@@/, '@'),
      );
    }
    if (node.hasAttribute('data-flow-json')) {
      // Preserve custom card data rather than silently exporting an empty card.
      try {
        const data = JSON.stringify(JSON.parse(node.getAttribute('data-flow-json') ?? ''), null, 2);
        const fence = '`'.repeat(
          Math.max(3, ...Array.from(data.matchAll(/`+/g), m => m[0].length + 1)),
        );
        return `\n\n${fence}json\n${data}\n${fence}\n\n`;
      } catch {
        return text() || '[Unsupported card]';
      }
    }
    if (tag === 'br') return '  \n';
    if (tag === 'strong' || tag === 'b') return `**${text()}**`;
    if (tag === 'em' || tag === 'i') return `*${text()}*`;
    if (tag === 's' || tag === 'del') return `~~${text()}~~`;
    if (tag === 'a' || tag === 'img') {
      const rawUrl = node.getAttribute(tag === 'a' ? 'href' : 'src') ?? '';
      const label = tag === 'a' ? text() : escapeMarkdown(node.getAttribute('alt') ?? 'Image');
      try {
        const url = new URL(rawUrl, window.location.origin);
        if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return label;
        return `${tag === 'img' ? '!' : ''}[${label}](<${url.href.replace(/>/g, '%3E')}>)`;
      } catch {
        return label;
      }
    }
    if (tag === 'ul' || tag === 'ol') {
      return (
        '\n\n' +
        Array.from(node.children)
          .map((item, index) => {
            const body = walk(item).trim().replace(/\n/g, '\n    ');
            return `${tag === 'ol' ? `${index + 1}.` : '-'} ${body}`;
          })
          .join('\n') +
        '\n\n'
      );
    }
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).map(row =>
        Array.from(row.children).map(cell =>
          walk(cell).trim().replace(/\|/g, '\\|').replace(/\n+/g, '<br>'),
        ),
      );
      const width = Math.max(0, ...rows.map(row => row.length));
      if (!width) return '';
      const line = (row: string[]): string =>
        `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
      return (
        '\n\n' +
        [
          line(rows[0] ?? []),
          line(Array<string>(width).fill('---')),
          ...rows.slice(1).map(line),
        ].join('\n') +
        '\n\n'
      );
    }
    if (tag === 'blockquote')
      return (
        '\n\n' +
        text()
          .trim()
          .split('\n')
          .map(line => `> ${line}`)
          .join('\n') +
        '\n\n'
      );
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${text()}\n\n`;
    if (['p', 'div', 'tr'].includes(tag)) return `\n\n${text()}\n\n`;
    if (tag === 'hr') return '\n\n---\n\n';
    return text();
  };
  return Array.from(doc.body.childNodes).map(walk).join('').trim();
}

export type ThreadExportMessage = {
  messageId: string;
  senderId: string;
  content: string;
  metadata?: unknown;
  createdAt: number;
  isDeleted: boolean;
  isSent: boolean;
  attachments: readonly { originalFilename: string; url: string; isDeleted: boolean }[];
};

export function formatThreadMarkdown(options: {
  title: string;
  channel: string;
  url: string;
  messages: readonly ThreadExportMessage[];
  senderName: (id: string) => string;
  convertContent?: (message: ThreadExportMessage) => string;
}): string {
  const label = (value: string): string => escapeMarkdown(value.replace(/[\r\n]+/g, ' '));
  const seen = new Set<string>();
  const messages = [...options.messages]
    .filter(message => {
      if (message.isDeleted || !message.isSent || seen.has(message.messageId)) return false;
      seen.add(message.messageId);
      return true;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
  const sections = messages.map(message => {
    const attachments = message.attachments
      .filter(a => !a.isDeleted)
      .map(a => {
        try {
          const url = new URL(a.url, options.url);
          return ['https:', 'http:'].includes(url.protocol)
            ? `- [${label(a.originalFilename)}](<${url.href.replace(/>/g, '%3E')}>)`
            : `- ${label(a.originalFilename)}`;
        } catch {
          return `- ${label(a.originalFilename)}`;
        }
      });
    return [
      `## ${label(getThreadSenderLabel(message) ?? options.senderName(message.senderId))} — ${new Date(message.createdAt).toISOString()}`,
      (options.convertContent ?? threadMessageToMarkdown)(message),
      ...(attachments.length ? ['### Attachments', attachments.join('\n')] : []),
    ].join('\n\n');
  });
  return (
    [
      `# ${label(options.title)}`,
      `Channel: ${label(options.channel)}`,
      `[Open thread](<${options.url}>)`,
      ...sections,
    ].join('\n\n') + '\n'
  );
}

export async function downloadThreadMarkdown(title: string, markdown: string): Promise<void> {
  const filename =
    (title
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'thread') + '.md';
  if (window.electronAPI?.exportCanvasMarkdown) {
    await window.electronAPI.exportCanvasMarkdown(filename, markdown);
    return;
  }
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
