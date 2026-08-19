/**
 * Helpers for rendering a short, single-line text preview of a FlowJSON message
 * (e.g. in DM/channel list previews) instead of mounting the full interactive
 * flow. FlowJSON messages are stored as `<div data-flow-json="...">Flow JSON</div>`;
 * feeding that to the HTML renderer mounts the entire flow card (title, textarea,
 * buttons), which breaks list-row layout. These helpers collapse it to plain text.
 */

/** Strips mrkdwn / standard-markdown emphasis and Xyne tokens for a clean preview. */
function stripFlowMarkup(raw: string): string {
  return raw
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
    .replace(/^\s*>\s?/gm, '') // blockquote markers
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns a clean single-line preview string for a FlowJSON message, or null if
 * the content is not a FlowJSON message. Joins the flow title with every text
 * `content` prop in the component tree, plus plan `desc` / `todos[].text`.
 */
export function getFlowJsonPreviewText(content: string): string | null {
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

    const preview = stripFlowMarkup(texts.join(' — '));
    return preview || null;
  } catch {
    return null;
  }
}
