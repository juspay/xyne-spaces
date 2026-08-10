/* react-markdown component overrides for the inert Obsidian nodes emitted by the
 * remark plugins. Keyed on element type + data-* on the hast node. These render
 * children/text only — no dangerouslySetInnerHTML, no links out of wikilinks. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import type { Components } from 'react-markdown';

const CALLOUT_TONE: Record<string, string> = {
  note: 'border-blue-500 bg-blue-500/10',
  info: 'border-blue-500 bg-blue-500/10',
  todo: 'border-blue-500 bg-blue-500/10',
  tip: 'border-teal-500 bg-teal-500/10',
  hint: 'border-teal-500 bg-teal-500/10',
  important: 'border-teal-500 bg-teal-500/10',
  abstract: 'border-teal-500 bg-teal-500/10',
  summary: 'border-teal-500 bg-teal-500/10',
  success: 'border-green-500 bg-green-500/10',
  check: 'border-green-500 bg-green-500/10',
  done: 'border-green-500 bg-green-500/10',
  question: 'border-amber-500 bg-amber-500/10',
  faq: 'border-amber-500 bg-amber-500/10',
  warning: 'border-amber-500 bg-amber-500/10',
  caution: 'border-amber-500 bg-amber-500/10',
  attention: 'border-amber-500 bg-amber-500/10',
  failure: 'border-red-500 bg-red-500/10',
  danger: 'border-red-500 bg-red-500/10',
  error: 'border-red-500 bg-red-500/10',
  bug: 'border-red-500 bg-red-500/10',
  example: 'border-purple-500 bg-purple-500/10',
  quote: 'border-gray-500 bg-gray-500/10',
  cite: 'border-gray-500 bg-gray-500/10',
};

const propsOf = (node: any): Record<string, any> => (node?.properties ?? {}) as Record<string, any>;
const classOf = (node: any): string => {
  const c = propsOf(node).className;
  return Array.isArray(c) ? c.join(' ') : String(c ?? '');
};

export const obsidianComponents: Components = {
  div: ({ node, children }: any) => {
    const c = classOf(node);
    if (c.includes('obsidian-callout-header')) {
      return (
        <div className='obsidian-callout-header flex items-center gap-2 font-semibold mb-1 text-foreground'>
          {children}
        </div>
      );
    }
    if (c.includes('obsidian-callout')) {
      const type = String(propsOf(node).dataCallout ?? 'note');
      const tone = CALLOUT_TONE[type] ?? 'border-gray-500 bg-gray-500/10';
      return (
        <div className={`obsidian-callout border-l-4 rounded-md px-4 py-3 my-4 ${tone}`}>
          {children}
        </div>
      );
    }
    return <div className={c}>{children}</div>;
  },
  span: ({ node, children }: any) => {
    const p = propsOf(node);
    if (p.dataWikilink !== undefined) {
      return (
        <span
          className='obsidian-wikilink text-action-primary bg-action-primary/10 rounded px-1 py-0.5 cursor-default'
          title={`Wikilink: ${String(p.dataWikilink)} (not linked in preview)`}
        >
          {children}
        </span>
      );
    }
    if (p.dataTag !== undefined) {
      return (
        <span className='obsidian-tag inline-block text-xs rounded-full bg-muted text-action-primary px-2 py-0.5 mx-0.5'>
          {children}
        </span>
      );
    }
    if (p.dataEmbed !== undefined) {
      return (
        <span className='obsidian-embed block border border-dashed border-border rounded-md bg-muted/40 text-muted-foreground text-sm px-3 py-2 my-3'>
          {children}
        </span>
      );
    }
    return <span className={classOf(node)}>{children}</span>;
  },
  mark: ({ children }: any) => (
    <mark className='obsidian-highlight bg-yellow-300/60 dark:bg-yellow-500/40 text-foreground rounded px-0.5'>
      {children}
    </mark>
  ),
  caption: ({ children }: any) => (
    <caption className='obsidian-properties-caption text-left text-xs uppercase tracking-wide text-muted-foreground mb-1'>
      {children}
    </caption>
  ),
};
