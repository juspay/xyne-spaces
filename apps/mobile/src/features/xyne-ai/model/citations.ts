import type {
  BriefCitation,
  BriefToolInvocation,
} from '@/src/features/morning-brief/api/dailyBriefApi';
import {
  CLAW_CITATION_MALFORMED_RE,
  buildClawCitationToolNumbers,
  findCitationForChunk,
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

export const linkCitations = (text: string, numbers: ReadonlyMap<string, number>): string =>
  linkifyAndGroupClawCitations(text, numbers).replace(CLAW_CITATION_MALFORMED_RE, '');

export type CitationTap =
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
