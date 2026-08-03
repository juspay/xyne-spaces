import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import type { RoomRecap } from '@xyne/shared';
import {
  buildClawCitationToolNumbers,
  linkifyAndGroupClawCitations,
  stripCitationMarks,
} from '../ui/TipTapExtensions/CitationMark';
import { createMarkdownComponents, type ClawCitationContext } from '../../utils/markdownComponents';
import type { ClawCitation, ToolInvocation } from '../Chat/XyneAISidebar/utils/XyneAITypes';

/**
 * `room_recaps.citations` is a free-form JSON column, so narrow it at runtime.
 * The curation agent writes `[{ toolCallId, citations: ClawCitation[] }, …]`;
 * anything else (including the `null` every pre-citations recap carries) yields
 * an empty list, which switches the whole citation path off.
 */
function parseRecapCitations(raw: unknown): ToolInvocation[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw as readonly unknown[];
  const toolInvocations: ToolInvocation[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { toolCallId, citations } = entry as { toolCallId?: unknown; citations?: unknown };
    if (typeof toolCallId !== 'string' || !toolCallId) continue;
    if (!Array.isArray(citations) || citations.length === 0) continue;
    toolInvocations.push({
      toolCallId,
      citations: citations as ClawCitation[],
      // Inert filler — the citation chips only ever read `toolCallId` and
      // `citations`, but ToolInvocation requires these fields.
      toolName: '',
      args: {},
      status: 'completed',
      durationMs: 0,
    });
  }
  return toolInvocations;
}

export interface RecapMarkdown {
  /** Recap body with raw `[clf-…#n]` tokens rewritten into `cite:` links. */
  content: string;
  markdownComponents: Components;
}

/**
 * Shared recap rendering wiring for the Summary and Checklist tabs.
 *
 * Recaps keep the RAW claw citation tokens in `body` and the structured sources
 * in `citations`; the path/label for each source is resolved here (client-side)
 * exactly the way Ask AI does it — `linkifyAndGroupClawCitations` turns tokens
 * into synthetic `cite:` / `cite-group:` links and `createMarkdownComponents`'
 * `a` override swaps those for citation chips.
 *
 * Recaps written before this change already contain resolved `[[n]](url)` links
 * and carry `citations = null`; they have no `clf-` tokens, so both steps are a
 * no-op and they keep rendering as plain markdown links.
 */
export function useRecapMarkdown(recap: RoomRecap): RecapMarkdown {
  const rawCitations: unknown = recap.citations;

  const citationCtx = useMemo<ClawCitationContext | undefined>(() => {
    const toolInvocations = parseRecapCitations(rawCitations);
    if (toolInvocations.length === 0) return undefined;
    const toolNumbers = buildClawCitationToolNumbers(recap.body);
    if (toolNumbers.size === 0) return undefined;
    return { toolInvocations, toolNumbers };
  }, [rawCitations, recap.body]);

  const content = useMemo(() => {
    if (recap.body.indexOf('clf-') === -1) return recap.body;
    const linkified = citationCtx
      ? linkifyAndGroupClawCitations(recap.body, citationCtx.toolNumbers)
      : recap.body;
    // Drops leftover / malformed tokens so they never render as literal text.
    return stripCitationMarks(linkified);
  }, [recap.body, citationCtx]);

  const markdownComponents = useMemo<Components>(
    () => ({ ...createMarkdownComponents(recap.id, citationCtx), img: () => null }),
    [recap.id, citationCtx],
  );

  return { content, markdownComponents };
}
