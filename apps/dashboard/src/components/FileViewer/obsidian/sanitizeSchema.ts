/* Hardened rehype-sanitize allow-list for UNTRUSTED attachment markdown.
 *
 * This schema is the single security gate for the Obsidian render path. It is
 * used WITHOUT rehype-raw, so raw HTML in the file is never parsed into the DOM
 * to begin with; this allow-list then keeps only the inert Obsidian constructs
 * our remark plugins emit (styled div/span/mark + a properties table).
 *
 * Never added: script, iframe, object, embed, form, style attr, on* handlers.
 * href/src protocols stay at rehype-sanitize defaults (http/https/mailto). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultSchema } from 'rehype-sanitize';

const A = (defaultSchema.attributes ?? {}) as Record<string, any[]>;
const merge = (tag: string, extra: any[]): any[] => [...(A[tag] ?? []), ...extra];

export const obsidianSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'div', 'span', 'mark', 'caption'],
  attributes: {
    ...A,
    '*': merge('*', ['className']),
    input: merge('input', ['checked']),
    // Inert Obsidian constructs — data-* carry semantics for the component layer.
    div: ['className', 'dataCallout'],
    span: ['className', 'dataWikilink', 'dataTag', 'dataEmbed'],
    mark: ['className'],
    // Properties table.
    table: merge('table', ['className']),
    tbody: merge('tbody', ['className']),
    tr: merge('tr', ['className']),
    th: merge('th', ['className']),
    td: merge('td', ['className']),
    caption: ['className'],
  },
  protocols: { ...defaultSchema.protocols },
};
