/**
 * Says so when a citation's passage could not be found in the document.
 *
 * `useDomAnchor` has always computed this (`hit`), and every viewer threw it
 * away — so a citation whose quote doesn't occur in the source opened the file at
 * the top, indistinguishable from a citation that never carried an anchor at all.
 * In one real run 109 citations were in exactly that state (the agent had written
 * a description like "read directly from CMA sheet '20'" instead of quoting a
 * cell), and nothing on screen said so.
 *
 * Silence is the wrong default here: the reader is being asked to VERIFY a value,
 * and "we couldn't show you where this came from" is a material part of the
 * answer. It also turns a whole class of provenance bugs from invisible into
 * self-reporting.
 */
import type { ReactNode } from 'react';
import type { Anchor } from './useDomAnchor.js';

export function AnchorMiss({
  anchor,
  hit,
}: {
  anchor?: Anchor | undefined;
  hit: boolean;
}): ReactNode {
  const wanted = !!anchor && (anchor.quote !== undefined || anchor.locator !== undefined);
  if (!wanted || hit) return null;

  return (
    <div
      role="status"
      className="shrink-0 border-b border-[color-mix(in_srgb,#f59e0b_45%,transparent)] bg-[color-mix(in_srgb,#f59e0b_12%,transparent)] px-4 py-2 text-[11.5px] leading-snug text-[var(--wui-fg)]"
    >
      Couldn&rsquo;t locate the cited passage in this document — showing it from the top.
      {anchor.quote !== undefined && (
        <span className="ml-1 text-[var(--wui-fg-muted)]">
          Looked for: &ldquo;{anchor.quote.length > 90 ? `${anchor.quote.slice(0, 90)}…` : anchor.quote}&rdquo;
        </span>
      )}
    </div>
  );
}
