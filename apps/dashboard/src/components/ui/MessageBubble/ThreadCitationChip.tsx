import { ReactElement } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { CitationLink } from '../../Chat/XyneAISidebar/components/CitationLink';
import {
  findCitationForChunk,
  buildClawCitationUrl,
  getClawCitationLabel,
  citationOpensInNewTab,
  resolveCitationIconUrl,
} from '../../Chat/XyneAISidebar/utils/clawCitationUrl';
import type { ClawCitation, ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

/**
 * Renders a single `[clf-<toolCallId>#<chunkIndex>]` inline citation as a
 * clickable chip (brand icon + title) inside a Spaces thread message.
 *
 * Self-contained sibling of the sidebar's ClawCitationChip: it reuses the SAME
 * pure resolvers (findCitationForChunk / buildClawCitationUrl /
 * getClawCitationLabel / resolveCitationIconUrl) so the thread chip and the
 * sidebar chip produce identical links, labels, and icons — but it carries none
 * of the sidebar-only wiring (ConversationToolInvocationsContext, debug panel).
 * Citation metadata is read from the message's baked-in `clawCitations`
 * (metadata) rather than a live /messages fetch, since re-opened threads never
 * re-call claw.
 */
export function ThreadCitationChip({
  toolCallId,
  chunkIndex,
  toolNumber,
  toolInvocations,
}: {
  toolCallId: string;
  chunkIndex: number;
  toolNumber: number;
  toolInvocations: ToolInvocation[] | undefined;
}): ReactElement {
  const citation = findCitationForChunk(toolInvocations, toolCallId, chunkIndex);
  const url = citation ? buildClawCitationUrl(citation) : null;
  const label = citation ? getClawCitationLabel(citation) : `${toolNumber}.${chunkIndex}`;
  const tooltip = buildTooltip(citation, label);
  const iconUrl = resolveCitationIconUrl(citation);

  // `claw-citation-chip` matches the `!important` override in global.css that
  // keeps the chip text neutral (not link-blue/underlined). Mirrors the
  // sidebar chip's styling so both surfaces look identical.
  const chipClass =
    'claw-citation-chip ' +
    'inline-flex items-center gap-1 align-middle ' +
    'px-1.5 h-[1.25rem] max-w-[180px] mx-[2px] rounded-xl ' +
    'text-[10px] font-medium leading-none ' +
    'bg-muted border border-border/50 ' +
    'hover:bg-accent hover:border-border ' +
    'transition-colors';

  const chipInner = (
    <>
      {iconUrl ? (
        <img src={iconUrl} alt='' aria-hidden className='w-3.5 h-3.5 shrink-0 object-contain' />
      ) : null}
      <span className='min-w-0 truncate'>{label}</span>
    </>
  );

  const trigger =
    url && citation ? (
      <CitationLink
        url={url}
        newTab={citationOpensInNewTab(citation)}
        className={chipClass}
        ariaLabel={tooltip}
      >
        {chipInner}
      </CitationLink>
    ) : (
      <span className={chipClass} aria-label={tooltip}>
        {chipInner}
      </span>
    );

  return (
    <Tooltip content={tooltip} side='top' delayDuration={200} sideOffset={4}>
      {trigger}
    </Tooltip>
  );
}

function buildTooltip(citation: ClawCitation | null, fallback: string): string {
  if (!citation) return fallback;
  if (citation.kind === 'ticket' && citation.ticketId) {
    return citation.channelName
      ? `Ticket ${citation.ticketId} in #${citation.channelName}`
      : `Ticket ${citation.ticketId}`;
  }
  if (citation.kind === 'thread') {
    return citation.channelName ? `Thread in #${citation.channelName}` : 'Spaces thread';
  }
  if (citation.kind === 'canvas') {
    return citation.label ? `Canvas — ${citation.label}` : 'Canvas';
  }
  if (citation.kind === 'recording') {
    return citation.label ? `Recording — ${citation.label}` : 'Recording';
  }
  if (citation.kind === 'external') {
    return citation.label || citation.url || 'External link';
  }
  if (citation.kind === 'collection-item') {
    return citation.fileName || citation.label || 'Knowledge base file';
  }
  return getClawCitationLabel(citation);
}

export default ThreadCitationChip;
