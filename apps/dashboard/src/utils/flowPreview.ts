/**
 * Helpers for rendering a short, single-line text preview of a FlowJSON message
 * (e.g. in DM/channel list previews) instead of mounting the full interactive
 * flow. FlowJSON messages are stored as `<div data-flow-json="...">Flow JSON</div>`;
 * feeding that to the HTML renderer mounts the entire flow card (title, textarea,
 * buttons), which breaks list-row layout. These helpers collapse it to plain text.
 *
 * The same parse/walk is reused by the copy-to-clipboard path (see
 * `getFlowJsonCopyHtml`): without it, copying a FlowJSON message only puts the
 * literal placeholder text "Flow JSON" on the clipboard, because the raw content
 * is a single `<div>` whose only text node is that placeholder.
 */

/**
 * Strips mrkdwn / standard-markdown emphasis and Xyne tokens for a clean preview.
 * When `preserveNewlines` is true, only horizontal whitespace is collapsed so the
 * copy path can keep multi-line structure; otherwise everything collapses to a
 * single line (list/preview use case).
 */
function stripFlowMarkup(raw: string, preserveNewlines = false): string {
  const cleaned = raw
    .replace(/<userid:[^>]+>/g, '')
    .replace(/<channelid:[^>]+>/g, '#channel')
    .replace(/<broadcast:channel>/gi, '@channel')
    .replace(/<broadcast:here>/gi, '@here')
    .replace(/<broadcast:([^>]+)>/gi, '@$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1') // standard markdown bold
    .replace(/\*([^*\n]+)\*/g, '$1') // mrkdwn bold
    .replace(/_([^_\n]+)_/g, '$1') // italic
    .replace(/~([^~\n]+)~/g, '$1') // strike
    .replace(/`([^`\n]+)`/g, '$1') // inline code
    .replace(/^\s*>\s?/gm, ''); // blockquote markers

  if (preserveNewlines) {
    return cleaned
      .replace(/[^\S\n]+/g, ' ') // collapse horizontal whitespace, keep newlines
      .replace(/ *\n */g, '\n') // trim spaces around newlines
      .replace(/\n{3,}/g, '\n\n') // cap consecutive blank lines
      .trim();
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Parses a FlowJSON message's `data-flow-json` payload into ordered text lines
 * (flow title, then every component text `content`, plus plan `desc` and
 * `todos[].text`). Returns null if `content` is not a FlowJSON message.
 * Shared by the single-line preview and the multi-line copy paths so they can
 * never drift.
 */
export function extractFlowJsonTextLines(content: string): string[] | null {
  if (!content.includes('data-flow-json')) return null;
  const attrMatch = content.match(/data-flow-json="([^"]+)"/);
  if (!attrMatch?.[1]) return null;

  try {
    const json = attrMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const flow = JSON.parse(json) as { title?: string; components?: unknown[] };

    const texts: string[] = [];
    if (typeof flow.title === 'string' && flow.title.trim()) {
      texts.push(flow.title.trim());
    }

    const walk = (components: unknown[]): void => {
      for (const comp of components) {
        if (!comp || typeof comp !== 'object') continue;
        const c = comp as Record<string, unknown>;
        const p = c['props'] as Record<string, unknown> | undefined;
        if (p) {
          if (typeof p['content'] === 'string' && p['content'].trim()) {
            texts.push(p['content'].trim());
          }
          // Plan cards (planComponentSchema) hold their prose in `desc` and each
          // step in `todos[].text` — neither is a `content` prop, so without this
          // a whole plan collapses to just its title.
          if (typeof p['desc'] === 'string' && p['desc'].trim()) {
            texts.push(p['desc'].trim());
          }
          if (Array.isArray(p['todos'])) {
            for (const todo of p['todos']) {
              if (!todo || typeof todo !== 'object') continue;
              const t = todo as Record<string, unknown>;
              if (typeof t['text'] === 'string' && t['text'].trim()) {
                texts.push(t['text'].trim());
              }
            }
          }
        }
        if (Array.isArray(c['children'])) walk(c['children'] as unknown[]);
      }
    };
    if (Array.isArray(flow.components)) walk(flow.components);

    return texts;
  } catch {
    return null;
  }
}

/**
 * Returns a clean single-line preview string for a FlowJSON message, or null if
 * the content is not a FlowJSON message. Joins the flow title with every text
 * `content` prop in the component tree, plus plan `desc` / `todos[].text`.
 */
export function getFlowJsonPreviewText(content: string): string | null {
  const texts = extractFlowJsonTextLines(content);
  if (!texts) return null;
  const preview = stripFlowMarkup(texts.join(' — '));
  return preview || null;
}

/**
 * Returns a simple, readable HTML representation of a FlowJSON message for the
 * copy-to-clipboard path (title as bold, each subsequent line as a paragraph),
 * or null if `content` is not a FlowJSON message. Handing this to
 * `copyHtmlToClipboard` yields a faithful rich (`text/html`) flavor and, via the
 * existing `htmlToFormattedText` walk, a matching multi-line plain-text flavor —
 * instead of the placeholder "Flow JSON".
 */
export function getFlowJsonCopyHtml(content: string): string | null {
  const texts = extractFlowJsonTextLines(content);
  if (!texts) return null;

  const lines = texts.map(t => stripFlowMarkup(t, true)).filter(Boolean);
  if (!lines.length) return null;

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = lines
    .map((line, index) => {
      const safe = escapeHtml(line).replace(/\n/g, '<br>');
      return index === 0 ? `<p><strong>${safe}</strong></p>` : `<p>${safe}</p>`;
    })
    .join('');

  return html;
}
