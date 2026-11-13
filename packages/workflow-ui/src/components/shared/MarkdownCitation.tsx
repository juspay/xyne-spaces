/**
 * Renders a `:::citation{…}` block: the statement as normal prose, trailed by a
 * ↗ marker opening the source it came from.
 *
 * Named `MarkdownCitation`, not `Citation` — the SDK already has a `Citation`,
 * the author-time overlay attached to a step's *config* in the builder. Same
 * word, different concept; keeping the names apart keeps the two from being
 * confused for one another.
 */
import type { ReactNode } from 'react';
import type { CitationRef } from './citation.js';
import { CitationArrow } from './CitationArrow.js';

export interface MarkdownCitationProps {
  /** Ref path into the workflow, as shown to the agent in a `[source: …]` label. */
  ref?: string | undefined;
  /** 1-based page within the resolved document. Arrives as a string from markdown. */
  page?: string | undefined;
  /** External source, as an alternative to `ref`. */
  url?: string | undefined;
  /** The exact source text, highlighted once the document opens. */
  quote?: string | undefined;
  /** Label for the url form. */
  title?: string | undefined;
  children?: ReactNode;
}

/** Directive attributes are always strings; a page must survive as a real number. */
function toPage(page: string | undefined): number | undefined {
  if (page === undefined) return undefined;
  const n = Number(page);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

function toCitation(props: MarkdownCitationProps): CitationRef | undefined {
  // Checked here as well as in the sanitize schema: markdown reaches this
  // component from an LLM, and a `javascript:` target must not become a link.
  if (props.url !== undefined && /^https?:\/\//i.test(props.url)) {
    return { kind: 'url', url: props.url, ...(props.title ? { title: props.title } : {}) };
  }
  if (props.ref !== undefined && props.ref !== '') {
    const page = toPage(props.page);
    return {
      kind: 'ref',
      ref: props.ref,
      ...(page !== undefined ? { locator: { at: 'page' as const, page } } : {}),
      ...(props.quote ? { quote: props.quote } : {}),
    };
  }
  return undefined;
}

export function MarkdownCitation(props: MarkdownCitationProps) {
  const citation = toCitation(props);
  return (
    <span className="wui-citation">
      {props.children}
      {citation && <CitationArrow citation={citation} />}
    </span>
  );
}
