import type {
  BriefCitation,
  BriefToolInvocation,
} from '@/src/features/morning-brief/api/dailyBriefApi';
import {
  CLAW_CITATION_MALFORMED_RE,
  buildClawCitationToolNumbers,
  findCitationForChunk,
  getClawCitationLabel,
  linkifyAndGroupClawCitations,
  parseCiteGroupHref,
  parseCiteHref,
} from '@/src/features/morning-brief/utils/citations';

import type { ToolInvocation } from '../api/xyneAIEvents';

export const citationSources = (tools: ToolInvocation[]): BriefToolInvocation[] =>
  tools.flatMap(({ toolCallId, citations }) =>
    toolCallId && citations ? [{ toolCallId, citations }] : [],
  );

export function citationNumbers(
  answer: string,
  sources: BriefToolInvocation[],
): Map<string, number> {
  const cited = new Set(sources.map(source => source.toolCallId));
  const numbers = new Map<string, number>();
  for (const toolCallId of buildClawCitationToolNumbers(answer).keys()) {
    if (cited.has(toolCallId)) numbers.set(toolCallId, numbers.size + 1);
  }
  return numbers;
}

// The model also invents `[tool-1#2]` tokens and `[n](cite:…)` links that no tool backs.
const NON_CLF_CITATION_RE = /[【[⟦]\s*([A-Za-z0-9_.:-]+)#[\d._#-]+\s*[】\]⟧]/g;
// ...and shortens several chunks of one call to `[clf-x#57, #50]` or `[clf-x#57], #50]`.
const CHUNK_LIST_RE =
  /([【[⟦])(clf-[A-Za-z0-9_.:-]+)#(\d+)\s*[】\]⟧]?((?:\s*,\s*#\d+)+)\s*([】\]⟧])/g;
const CITE_LINK_RE = /\[[^\]]*\]\(((?:xyne-cite(?:-group)?|cite):[^)]*)\)/g;

const splitChunkLists = (text: string): string =>
  text.replace(
    CHUNK_LIST_RE,
    (_match, open: string, id: string, first: string, rest: string, close: string) =>
      [first, ...(rest.match(/\d+/g) ?? [])].map(chunk => `${open}${id}#${chunk}${close}`).join(''),
  );

/** Turns citation tokens into links named after their source, as the dashboard's chips are. */
export const linkCitations = (
  text: string,
  numbers: ReadonlyMap<string, number>,
  sources: BriefToolInvocation[],
): string =>
  linkifyAndGroupClawCitations(
    splitChunkLists(text).replace(NON_CLF_CITATION_RE, (token, id: string) =>
      id.startsWith('clf-') ? token : '',
    ),
    numbers,
  )
    .replace(CLAW_CITATION_MALFORMED_RE, '')
    .replace(CITE_LINK_RE, (link, href: string) => {
      const tap = resolveCitationLink(href, sources);
      if (!tap) return '';
      if (tap.kind === 'group') return link;
      return `[${getClawCitationLabel(tap.citation).replace(/[[\]\\]/g, '\\$&')}](${href})`;
    });

type CitationTap =
  { kind: 'citation'; citation: BriefCitation } | { kind: 'group'; citations: BriefCitation[] };

export function resolveCitationLink(
  url: string,
  sources: BriefToolInvocation[],
): CitationTap | null {
  const ref = parseCiteHref(url);
  if (ref) {
    const citation = findCitationForChunk(sources, ref.toolCallId, ref.chunkIndex);
    return citation ? { kind: 'citation', citation } : null;
  }
  const citations = parseCiteGroupHref(url).flatMap(({ toolCallId, chunkIndex }) => {
    const citation = findCitationForChunk(sources, toolCallId, chunkIndex);
    return citation ? [citation] : [];
  });
  return citations.length > 0 ? { kind: 'group', citations } : null;
}
