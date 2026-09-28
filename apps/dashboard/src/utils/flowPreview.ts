/**
 * Helpers for rendering a short, single-line text preview of a FlowJSON message
 * (e.g. in DM/channel list previews) instead of mounting the full interactive
 * flow. FlowJSON messages are stored as `<div data-flow-json="...">Flow JSON</div>`;
 * feeding that to the HTML renderer mounts the entire flow card (title, textarea,
 * buttons), which breaks list-row layout. These helpers collapse it to plain text.
 */

/** Resolves a mentioned user id to the name shown in place of its token. */
export type MentionNameResolver = (userId: string) => string | undefined;

/**
 * Strips mrkdwn / standard-markdown emphasis and Xyne tokens for a clean preview.
 * User mentions become `@Name` when a resolver is supplied, and are dropped when
 * it is not — a preview must never leak a raw `<userid:…>` token either way.
 */
export function stripFlowMarkup(raw: string, resolveUserName?: MentionNameResolver): string {
  return raw
    .replace(/<\/?u>/g, '')
    .replace(/<userid:([^>]+)>/g, (_match, userId: string) => {
      const name = resolveUserName?.(userId);
      return name ? `@${name}` : '';
    })
    .replace(
      /<groupid:[^:>]+(?::([^>]+))?>/g,
      (_match, alias: string | undefined) => `@${alias ?? 'group'}`,
    )
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
