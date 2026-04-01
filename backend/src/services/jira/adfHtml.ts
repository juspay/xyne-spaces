const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeHtmlAttribute = (value: string): string => escapeHtml(value);

const adfInlineToHtml = (node: any): string => {
  if (!node) return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (Array.isArray(node)) return node.map(adfInlineToHtml).join('');

  if (node.type === 'text') {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    let html = escapeHtml(typeof node.text === 'string' ? node.text : '');

    for (const mark of marks) {
      if (!mark?.type) continue;
      switch (mark.type) {
        case 'link': {
          const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
          if (href) {
            html = `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">${html || escapeHtml(href)}</a>`;
          }
          break;
        }
        case 'strong':
          html = `<strong>${html}</strong>`;
          break;
        case 'em':
          html = `<em>${html}</em>`;
          break;
        case 'code':
          html = `<code>${html}</code>`;
          break;
        case 'strike':
          html = `<s>${html}</s>`;
          break;
        case 'underline':
          html = `<u>${html}</u>`;
          break;
        default:
          break;
      }
    }

    return html;
  }

  if (node.type === 'hardBreak') return '<br />';
  if (node.type === 'mention') {
    const mentionText = node.attrs?.text || node.attrs?.displayName || node.attrs?.id || '';
    return escapeHtml(mentionText);
  }
  if (node.type === 'emoji') {
    const emojiText = node.attrs?.text || node.attrs?.shortName || '';
    return escapeHtml(emojiText);
  }
  if (node.type === 'status') {
    return escapeHtml(node.attrs?.text || '');
  }
  if (node.type === 'date') {
    return escapeHtml(node.attrs?.timestamp || '');
  }
  if (node.type === 'inlineCard' || node.type === 'blockCard' || node.type === 'embedCard') {
    const url = node.attrs?.url || '';
    return url
      ? `<a href="${escapeHtmlAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : '';
  }

  return Array.isArray(node.content) ? node.content.map(adfInlineToHtml).join('') : '';
};

const adfListItemsToHtml = (items: any[] | undefined, ordered: boolean): string => {
  const tag = ordered ? 'ol' : 'ul';
  const content = Array.isArray(items)
    ? items
        .map(item => {
          if (!item) return '';
          const html = adfToHtml(item, { listMode: true });
          return html ? `<li>${html}</li>` : '';
        })
        .join('')
    : '';

  return content ? `<${tag}>${content}</${tag}>` : '';
};

const adfTaskListToHtml = (items: any[] | undefined): string => {
  const content = Array.isArray(items)
    ? items
        .map(item => {
          if (!item) return '';
          const isDone = item?.attrs?.state === 'DONE';
          const html = adfToHtml(item, { listMode: true, taskMode: true });
          return `<li><input type="checkbox" disabled${isDone ? ' checked' : ''} /> ${html}</li>`;
        })
        .join('')
    : '';

  return content ? `<ul data-jira-task-list="true">${content}</ul>` : '';
};

const adfTableCellToHtml = (node: any, tagName: 'th' | 'td'): string => {
  const content = Array.isArray(node?.content) ? node.content.map((child: any) => adfToHtml(child)).join('') : '';
  const normalized = content || '<p></p>';
  return `<${tagName}>${normalized}</${tagName}>`;
};

export const adfToHtml = (node: any, options: { listMode?: boolean; taskMode?: boolean } = {}): string => {
  if (!node) return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (Array.isArray(node)) return node.map(child => adfToHtml(child, options)).join('');

  switch (node.type) {
    case 'doc':
      return Array.isArray(node.content) ? node.content.map((child: any) => adfToHtml(child)).join('') : '';
    case 'paragraph': {
      const content = Array.isArray(node.content) ? node.content.map(adfInlineToHtml).join('') : '';
      return options.listMode ? content : `<p>${content || '<br />'}</p>`;
    }
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? Math.min(3, Math.max(1, node.attrs.level)) : 1;
      const content = Array.isArray(node.content) ? node.content.map(adfInlineToHtml).join('') : '';
      return `<h${level}>${content}</h${level}>`;
    }
    case 'bulletList':
      return adfListItemsToHtml(node.content, false);
    case 'orderedList':
      return adfListItemsToHtml(node.content, true);
    case 'taskList':
      return adfTaskListToHtml(node.content);
    case 'listItem':
    case 'taskItem':
      return Array.isArray(node.content)
        ? node.content.map((child: any) => adfToHtml(child, { listMode: true, taskMode: options.taskMode })).join('')
        : '';
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' && node.attrs.language.trim()
        ? ` data-language="${escapeHtmlAttribute(node.attrs.language.trim())}"`
        : '';
      return `<pre><code${language}>${escapeHtml(adfToText(node).trimEnd())}</code></pre>`;
    }
    case 'blockquote':
    case 'panel': {
      const content = Array.isArray(node.content) ? node.content.map((child: any) => adfToHtml(child)).join('') : '';
      return `<blockquote>${content}</blockquote>`;
    }
    case 'rule':
      return '<hr />';
    case 'table': {
      const rows = Array.isArray(node.content) ? node.content.filter((row: any) => row?.type === 'tableRow') : [];
      const htmlRows = rows
        .map((row: any, rowIndex: number) => {
          const cells = Array.isArray(row.content) ? row.content : [];
          const cellHtml = cells
            .map((cell: any) => adfTableCellToHtml(cell, cell?.type === 'tableHeader' || rowIndex === 0 ? 'th' : 'td'))
            .join('');
          return `<tr>${cellHtml}</tr>`;
        })
        .join('');
      return htmlRows ? `<table><tbody>${htmlRows}</tbody></table>` : '';
    }
    default:
      if (Array.isArray(node.content)) return node.content.map((child: any) => adfToHtml(child, options)).join('');
      return adfInlineToHtml(node);
  }
};

export const adfToText = (node: any): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  if (node.type === 'text') {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    const linkMark = marks.find((mark: any) => mark?.type === 'link' && typeof mark?.attrs?.href === 'string');
    if (linkMark?.attrs?.href && node.text && node.text !== linkMark.attrs.href) {
      return `${node.text} (${linkMark.attrs.href})`;
    }
    return node.text || '';
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'inlineCard' || node.type === 'blockCard' || node.type === 'embedCard') {
    return node.attrs?.url || '';
  }
  if (node.type === 'mention') {
    return node.attrs?.text || node.attrs?.displayName || node.attrs?.id || '';
  }
  if (node.type === 'emoji') {
    return node.attrs?.text || node.attrs?.shortName || '';
  }
  if (node.type === 'status') {
    return node.attrs?.text || '';
  }
  if (node.type === 'date') {
    return node.attrs?.timestamp || '';
  }
  const content = Array.isArray(node.content) ? node.content.map(adfToText).join('') : '';

  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return `${content}\n`;
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return `${content}\n`;
    case 'listItem':
      return `- ${content}\n`;
    case 'taskItem':
      return `${node.attrs?.state === 'DONE' ? '[x]' : '[ ]'} ${content}\n`;
    case 'codeBlock':
      return `${content}\n`;
    case 'doc':
      return content;
    default:
      return content;
  }
};


export interface AdfMentionResolvers {
  resolveUserMention?: (mention: {
    id?: string;
    text?: string;
    displayName?: string;
  }) => Promise<{
    userId: string;
    username: string;
  } | null>;
}

const renderResolvedUserMention = (userId: string, username: string): string => {
  const mentionText = username.startsWith('@') ? username : `@${username}`;
  const escapedText = escapeHtml(mentionText);
  return `<span class="chat-input-mention" data-mention="true" data-mention-type="user" data-user-id="${escapeHtmlAttribute(userId)}" data-username="${escapeHtmlAttribute(username)}">${escapedText}</span>`;
};

const adfInlineToHtmlAsync = async (node: any, resolvers: AdfMentionResolvers): Promise<string> => {
  if (!node) return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map(child => adfInlineToHtmlAsync(child, resolvers)));
    return parts.join('');
  }

  if (node.type === 'text') {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    let html = escapeHtml(typeof node.text === 'string' ? node.text : '');

    for (const mark of marks) {
      if (!mark?.type) continue;
      switch (mark.type) {
        case 'link': {
          const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
          if (href) {
            html = `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">${html || escapeHtml(href)}</a>`;
          }
          break;
        }
        case 'strong':
          html = `<strong>${html}</strong>`;
          break;
        case 'em':
          html = `<em>${html}</em>`;
          break;
        case 'code':
          html = `<code>${html}</code>`;
          break;
        case 'strike':
          html = `<s>${html}</s>`;
          break;
        case 'underline':
          html = `<u>${html}</u>`;
          break;
        default:
          break;
      }
    }

    return html;
  }

  if (node.type === 'hardBreak') return '<br />';
  if (node.type === 'mention') {
    const mentionText = node.attrs?.text || node.attrs?.displayName || node.attrs?.id || '';
    const resolvedMention = await resolvers.resolveUserMention?.({
      id: typeof node.attrs?.id === 'string' ? node.attrs.id : undefined,
      text: typeof node.attrs?.text === 'string' ? node.attrs.text : undefined,
      displayName: typeof mentionText === 'string' ? mentionText : undefined,
    });

    if (resolvedMention?.userId && resolvedMention.username) {
      return renderResolvedUserMention(resolvedMention.userId, resolvedMention.username);
    }

    return escapeHtml(mentionText);
  }
  if (node.type === 'emoji') {
    const emojiText = node.attrs?.text || node.attrs?.shortName || '';
    return escapeHtml(emojiText);
  }
  if (node.type === 'status') {
    return escapeHtml(node.attrs?.text || '');
  }
  if (node.type === 'date') {
    return escapeHtml(node.attrs?.timestamp || '');
  }
  if (node.type === 'inlineCard' || node.type === 'blockCard' || node.type === 'embedCard') {
    const url = node.attrs?.url || '';
    return url
      ? `<a href="${escapeHtmlAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
      : '';
  }

  if (!Array.isArray(node.content)) return '';
  const parts = await Promise.all(node.content.map((child: any) => adfInlineToHtmlAsync(child, resolvers)));
  return parts.join('');
};

const adfListItemsToHtmlAsync = async (
  items: any[] | undefined,
  ordered: boolean,
  resolvers: AdfMentionResolvers,
): Promise<string> => {
  const tag = ordered ? 'ol' : 'ul';
  const parts = Array.isArray(items)
    ? await Promise.all(
        items.map(async item => {
          if (!item) return '';
          const html = await adfToHtmlAsync(item, resolvers, { listMode: true });
          return html ? `<li>${html}</li>` : '';
        }),
      )
    : [];

  const content = parts.join('');
  return content ? `<${tag}>${content}</${tag}>` : '';
};

const adfTaskListToHtmlAsync = async (
  items: any[] | undefined,
  resolvers: AdfMentionResolvers,
): Promise<string> => {
  const parts = Array.isArray(items)
    ? await Promise.all(
        items.map(async item => {
          if (!item) return '';
          const isDone = item?.attrs?.state === 'DONE';
          const html = await adfToHtmlAsync(item, resolvers, { listMode: true, taskMode: true });
          return `<li><input type="checkbox" disabled${isDone ? ' checked' : ''} /> ${html}</li>`;
        }),
      )
    : [];

  const content = parts.join('');
  return content ? `<ul data-jira-task-list="true">${content}</ul>` : '';
};

const adfTableCellToHtmlAsync = async (
  node: any,
  tagName: 'th' | 'td',
  resolvers: AdfMentionResolvers,
): Promise<string> => {
  const parts = Array.isArray(node?.content)
    ? await Promise.all(node.content.map((child: any) => adfToHtmlAsync(child, resolvers)))
    : [];
  const content = parts.join('');
  const normalized = content || '<p></p>';
  return `<${tagName}>${normalized}</${tagName}>`;
};

export const adfToHtmlAsync = async (
  node: any,
  resolvers: AdfMentionResolvers = {},
  options: { listMode?: boolean; taskMode?: boolean } = {},
): Promise<string> => {
  if (!node) return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map(child => adfToHtmlAsync(child, resolvers, options)));
    return parts.join('');
  }

  switch (node.type) {
    case 'doc': {
      const parts = Array.isArray(node.content)
        ? await Promise.all(node.content.map((child: any) => adfToHtmlAsync(child, resolvers)))
        : [];
      return parts.join('');
    }
    case 'paragraph': {
      const parts = Array.isArray(node.content)
        ? await Promise.all(node.content.map((child: any) => adfInlineToHtmlAsync(child, resolvers)))
        : [];
      const content = parts.join('');
      return options.listMode ? content : `<p>${content || '<br />'}</p>`;
    }
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? Math.min(3, Math.max(1, node.attrs.level)) : 1;
      const parts = Array.isArray(node.content)
        ? await Promise.all(node.content.map((child: any) => adfInlineToHtmlAsync(child, resolvers)))
        : [];
      return `<h${level}>${parts.join('')}</h${level}>`;
    }
    case 'bulletList':
      return adfListItemsToHtmlAsync(node.content, false, resolvers);
    case 'orderedList':
      return adfListItemsToHtmlAsync(node.content, true, resolvers);
    case 'taskList':
      return adfTaskListToHtmlAsync(node.content, resolvers);
    case 'listItem':
    case 'taskItem': {
      const parts = Array.isArray(node.content)
        ? await Promise.all(
            node.content.map((child: any) => adfToHtmlAsync(child, resolvers, { listMode: true, taskMode: options.taskMode })),
          )
        : [];
      return parts.join('');
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' && node.attrs.language.trim()
        ? ` data-language="${escapeHtmlAttribute(node.attrs.language.trim())}"`
        : '';
      return `<pre><code${language}>${escapeHtml(adfToText(node).trimEnd())}</code></pre>`;
    }
    case 'blockquote':
    case 'panel': {
      const parts = Array.isArray(node.content)
        ? await Promise.all(node.content.map((child: any) => adfToHtmlAsync(child, resolvers)))
        : [];
      return `<blockquote>${parts.join('')}</blockquote>`;
    }
    case 'rule':
      return '<hr />';
    case 'table': {
      const rows = Array.isArray(node.content) ? node.content.filter((row: any) => row?.type === 'tableRow') : [];
      const htmlRows = await Promise.all(
        rows.map(async (row: any, rowIndex: number) => {
          const cells = Array.isArray(row.content) ? row.content : [];
          const cellParts = await Promise.all(
            cells.map((cell: any) =>
              adfTableCellToHtmlAsync(cell, cell?.type === 'tableHeader' || rowIndex === 0 ? 'th' : 'td', resolvers),
            ),
          );
          return `<tr>${cellParts.join('')}</tr>`;
        }),
      );
      return htmlRows.length > 0 ? `<table><tbody>${htmlRows.join('')}</tbody></table>` : '';
    }
    default:
      if (Array.isArray(node.content)) {
        const parts = await Promise.all(node.content.map((child: any) => adfToHtmlAsync(child, resolvers, options)));
        return parts.join('');
      }
      return adfInlineToHtmlAsync(node, resolvers);
  }
};
