import { createContext, useContext } from 'react';
import type { OriginResolverCtx } from '../execution/origin/origin-resolver.js';
import type { ResolvedCitation } from '../execution/origin/citation-resolver.js';

/**
 * What a citation marker needs to turn a cited ref into an openable source: the
 * workflow config + step outputs of the execution being read.
 *
 * Supplied by context rather than props because markers mount deep inside
 * renderers that are otherwise data-only — the layout DSL's components and the
 * markdown renderer — and threading a resolver through every one of them (and
 * every existing caller) would be invasive for something most surfaces don't use.
 *
 * The default is `null`, and markers render nothing without it. So a surface that
 * has no execution in scope (a summary, an approval reason, any of the many
 * string-only markdown callers) keeps working untouched, and citations light up
 * only where a provider is mounted.
 */
export const CitationOriginContext = createContext<OriginResolverCtx | null>(null);

export function useCitationOrigin(): OriginResolverCtx | null {
  return useContext(CitationOriginContext);
}

/**
 * Show a cited source — a document, or the step output a value came from.
 *
 * Both kinds go through one opener because they answer the same question. A value
 * citation used to be a deliberate no-op ("clicking is a no-op rather than a lie"),
 * which was honest but read as broken: in one real run 128 of 480 citations were
 * inert buttons. The step's recorded output IS the evidence, so it opens too.
 */
export type OpenCitationDoc = (doc: Extract<ResolvedCitation, { kind: 'doc' | 'value' }>) => void;

/**
 * Where a cited document should open.
 *
 * A surface that can host a side-by-side panel (the run view) provides this, and
 * the source opens as a resizable column beside the data — you keep the value and
 * its evidence on screen together, which is the whole point of checking a citation.
 *
 * Without a provider the marker falls back to a modal, so surfaces with nowhere to
 * put a panel (a preview, an embedded snippet) still open their sources.
 */
export const CitationOpenContext = createContext<OpenCitationDoc | null>(null);

export function useCitationOpener(): OpenCitationDoc | null {
  return useContext(CitationOpenContext);
}
