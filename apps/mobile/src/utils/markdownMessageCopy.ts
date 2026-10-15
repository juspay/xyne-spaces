/**
 * Copy Message support for markdown-bodied messages (agent / bot responses).
 *
 * Agent responses are persisted as markdown, not as composer HTML. The chat
 * renderer treats a body without HTML tags as markdown (`htmlToMD` passes it
 * through), but Copy Message used to hand that markdown to the HTML-only copy
 * pipeline: the plain text kept raw `**`/`-` markers and the rich clipboard
 * entry wrapped the markdown in `<html>…</html>` without any block markup, so
 * the native editor collapsed every newline and pasted one flat line with the
 * markdown syntax visible.
 *
 * This module converts the markdown into:
 *  - `storedHtml`: dashboard-shaped HTML (the same shape a composer-authored
 *    message is stored in), so the existing `storedHtmlToComposerHtml`
 *    pipeline can turn it into `react-native-enriched` markup on paste, and
 *  - `plainText`: readable text (no markdown markers) for the system clipboard,
 *    which is also the key the composer uses to match the rich clipboard entry.
 *
 * Supported subset mirrors what the composer can represent: paragraphs, bold,
 * italic, strikethrough, inline code, links, user mentions, bullet/numbered
 * lists, block quotes and code blocks. Headings become bold paragraphs (the
 * composer has no heading control; the dashboard copy path does the same),
 * tables become `a | b` lines, and horizontal rules are dropped.
 */

export type MarkdownMessageCopy = {
  plainText: string;
  storedHtml: string;
};

const HTML_TAG_RE = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

/**
 * True when a stored message body is markdown rather than composer HTML.
 * Mirrors the renderer: a body without HTML tags is painted as markdown.
 */
export const isMarkdownMessageBody = (content: string): boolean => {
  if (typeof content !== 'string' || content.trim().length === 0) return false;
  return !HTML_TAG_RE.test(content);
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PLACEHOLDER = (index: number): string => `\uE000${index}\uE000`;
const PLACEHOLDER_RE = /\uE000(\d+)\uE000/g;

type InlineResult = { html: string; text: string };

const USER_MENTION_HREF_RE = /^xyne:\/\/user\/([^/?#\s]+)/i;

/** Convert one line of inline markdown to HTML + readable text. */
const renderInline = (source: string): InlineResult => {
  const htmlTokens: string[] = [];
  const textTokens: string[] = [];
  const protect = (html: string, text: string): string => {
    htmlTokens.push(html);
    textTokens.push(text);
    return PLACEHOLDER(htmlTokens.length - 1);
  };

  let s = source;

  // Inline code first so its content is never treated as markdown.
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks: string, code: string) => {
    const inner = code.replace(/^ (.*) $/, '$1');
    return protect(`<code>${escapeHtml(inner)}</code>`, inner);
  });

  // Images: keep the alt text only (the composer cannot hold remote images).
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string) =>
    protect(escapeHtml(alt), alt),
  );

  // Links (including Spaces user mentions rendered as xyne://user/<id> links).
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, href: string) => {
    const labelResult = renderInline(label);
    const mention = USER_MENTION_HREF_RE.exec(href);
    if (mention) {
      const name = labelResult.text.replace(/^@/, '').trim();
      const userId = mention[1] ?? '';
      return protect(
        `<span class="chat-input-mention" data-user-id="${escapeHtml(userId)}" data-username="${escapeHtml(
          name,
        )}">@${escapeHtml(name)}</span>`,
        `@${name}`,
      );
    }
    return protect(`<a href="${escapeHtml(href)}">${labelResult.html}</a>`, labelResult.text);
  });

  // Bare autolinks <https://…>.
  s = s.replace(/<((?:https?|mailto):[^\s>]+)>/gi, (_m, url: string) =>
    protect(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`, url),
  );

  // Everything left is literal text: escape it, then apply emphasis markers.
  let html = escapeHtml(s);
  let text = s;

  const emphasis: Array<[RegExp, string, string]> = [
    [/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<b><i>$1</i></b>', '$1'],
    [/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>', '$1'],
    [/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>', '$1$2'],
    [/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>', '$1'],
    [/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>', '$1$2'],
    [/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>', '$1$2'],
  ];
  for (const [re, htmlReplacement, textReplacement] of emphasis) {
    html = html.replace(re, htmlReplacement);
    text = text.replace(re, textReplacement);
  }

  // Backslash escapes (\* \_ \# …) render as the literal character.
  html = html.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1');
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1');

  html = html.replace(PLACEHOLDER_RE, (_m, i: string) => htmlTokens[Number(i)] ?? '');
  text = text.replace(PLACEHOLDER_RE, (_m, i: string) => textTokens[Number(i)] ?? '');
  return { html, text };
};

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)\s*$/;
const HEADING_RE = /^ {0,3}#{1,6}(?:\s+(.*?))?\s*#*\s*$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const splitTableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .replace(/\\\|/g, '\uE001')
    .split('|')
    .map(cell => cell.replace(/\uE001/g, '\\|').trim());

const isTableStart = (lines: readonly string[], index: number): boolean => {
  const header = lines[index] ?? '';
  const separator = lines[index + 1] ?? '';
  return header.includes('|') && separator.includes('-') && TABLE_SEPARATOR_RE.test(separator);
};

type Block = { html: string; text: string };

type ListRun = {
  ordered: boolean;
  nested: boolean;
  items: Array<{ number: number; content: string }>;
};

/**
 * Convert a markdown message body into stored-message HTML plus readable text.
 * Pure and dependency-free so it can run in node:test and on device.
 */
export const markdownToMessageCopy = (markdown: string): MarkdownMessageCopy => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let pendingBlank = false;

  const push = (block: Block): void => {
    if (pendingBlank && blocks.length > 0) {
      blocks.push({ html: '<p></p>', text: '' });
    }
    pendingBlank = false;
    blocks.push(block);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      pendingBlank = true;
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const code: string[] = [];
      i += 1;
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const closing = current.trim();
        if (
          closing.length >= marker.length &&
          closing === (marker[0] ?? '`').repeat(closing.length)
        ) {
          i += 1;
          break;
        }
        code.push(current);
        i += 1;
      }
      const codeText = code.join('\n');
      push({ html: `<pre><code>${escapeHtml(codeText)}</code></pre>`, text: codeText });
      continue;
    }

    if (HR_RE.test(line)) {
      // Horizontal rule: keep only the visual gap.
      pendingBlank = true;
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading && /^ {0,3}#{1,6}(\s|$)/.test(line)) {
      const inline = renderInline(heading[1] ?? '');
      if (inline.text.trim()) {
        push({ html: `<p><strong>${inline.html}</strong></p>`, text: inline.text });
      }
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i] ?? '')) {
        quoteLines.push(QUOTE_RE.exec(lines[i] ?? '')?.[1] ?? '');
        i += 1;
      }
      const rendered = quoteLines.map(renderInline);
      push({
        html: `<blockquote>${rendered
          .map(r => (r.text.trim() ? `<p>${r.html}</p>` : '<p></p>'))
          .join('')}</blockquote>`,
        text: rendered.map(r => r.text).join('\n'),
      });
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows: string[][] = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitTableRow(lines[i] ?? ''));
        i += 1;
      }
      const rendered = rows.map(cells => cells.map(renderInline));
      push({
        html: rendered
          .map(
            (cells, rowIndex) =>
              `<p>${cells
                .map(c => (rowIndex === 0 ? `<strong>${c.html}</strong>` : c.html))
                .join(' | ')}</p>`,
          )
          .join(''),
        text: rendered.map(cells => cells.map(c => c.text).join(' | ')).join('\n'),
      });
      continue;
    }

    const listMatch = LIST_RE.exec(line);
    if (listMatch) {
      const baseIndent = (listMatch[1] ?? '').length;
      const topOrdered = /\d/.test(listMatch[2] ?? '');
      // The composer has no nested lists and splits a list item on any line
      // break, so nested items become their own run of items (a separate
      // <ul>/<ol> when the marker kind changes) and continuation lines are
      // joined with a space.
      const runs: ListRun[] = [];
      const addItem = (
        ordered: boolean,
        number: number,
        nested: boolean,
        content: string,
      ): void => {
        const last = runs[runs.length - 1];
        if (last && last.ordered === ordered && last.nested === nested) {
          last.items.push({ number, content });
        } else {
          runs.push({ ordered, nested, items: [{ number, content }] });
        }
      };
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const item = LIST_RE.exec(current);
        if (item) {
          const itemOrdered = /\d/.test(item[2] ?? '');
          const nested = (item[1] ?? '').length >= baseIndent + 2;
          // A top-level marker of the other kind starts a new list block.
          if (!nested && itemOrdered !== topOrdered && runs.length > 0) break;
          addItem(itemOrdered, Number.parseInt(item[2] ?? '', 10) || 0, nested, item[3] ?? '');
          i += 1;
          continue;
        }
        if (current.trim() === '') {
          // Loose list: continue only when the next non-blank line is still part of it.
          let next = i + 1;
          while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1;
          const nextItem = LIST_RE.exec(lines[next] ?? '');
          if (
            nextItem &&
            ((nextItem[1] ?? '').length >= baseIndent + 2 ||
              /\d/.test(nextItem[2] ?? '') === topOrdered)
          ) {
            i = next;
            continue;
          }
          break;
        }
        const lastRun = runs[runs.length - 1];
        const lastItem = lastRun?.items[lastRun.items.length - 1];
        if (/^\s+\S/.test(current) && lastItem && !FENCE_RE.test(current)) {
          // Lazy continuation of the previous item.
          lastItem.content = `${lastItem.content} ${current.trim()}`;
          i += 1;
          continue;
        }
        break;
      }

      const html: string[] = [];
      const text: string[] = [];
      for (const run of runs) {
        const tag = run.ordered ? 'ol' : 'ul';
        const rendered = run.items.map(item => ({ ...item, inline: renderInline(item.content) }));
        html.push(
          `<${tag}>${rendered.map(item => `<li><p>${item.inline.html}</p></li>`).join('')}</${tag}>`,
        );
        const indent = run.nested ? '   ' : '';
        rendered.forEach((item, index) => {
          const number = item.number || index + 1;
          const marker = run.ordered ? `${number}. ` : '• ';
          text.push(`${indent}${marker}${item.inline.text}`);
        });
      }
      push({ html: html.join(''), text: text.join('\n') });
      continue;
    }

    // Plain paragraph: each source line stays its own line, as rendered in chat.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (
        current.trim() === '' ||
        FENCE_RE.test(current) ||
        QUOTE_RE.test(current) ||
        LIST_RE.test(current) ||
        /^ {0,3}#{1,6}(\s|$)/.test(current) ||
        isTableStart(lines, i)
      ) {
        break;
      }
      paragraph.push(current.trim());
      i += 1;
    }
    const rendered = paragraph.map(renderInline);
    push({
      html: rendered.map(r => `<p>${r.html}</p>`).join(''),
      text: rendered.map(r => r.text).join('\n'),
    });
  }

  return {
    storedHtml: blocks.map(b => b.html).join(''),
    plainText: blocks
      .map(b => b.text)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
};
