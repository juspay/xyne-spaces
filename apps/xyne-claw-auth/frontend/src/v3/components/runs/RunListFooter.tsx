import { Button } from "../ui/Button";

interface Props {
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  onOffsetChange: (next: number) => void;
}

/**
 * The server's hard ceiling on `offset` — GET /runs/paged throws
 * badRequest("offset may not exceed 10000") past it, because deep OFFSET over
 * an index-ordered scan stops being cheap. Mirrored here so Next is disabled at
 * the boundary instead of walking the user into a guaranteed 400.
 */
export const MAX_RUN_LIST_OFFSET = 10000;

/**
 * Range readout + Prev/Next for the run listings, matching the admin
 * Digital-Twin user-controls footer word for word and class for class so
 * pagination reads the same everywhere in v3.
 *
 * The denominator is the point: `total` is an exact count over the same where
 * clause as the rows, which is why this is offset paging and not a cursor.
 */
export function RunListFooter({ total, limit, offset, loading, onOffsetChange }: Props) {
  // The page count is clamped to what the offset ceiling actually reaches: a
  // 30k-run window would otherwise advertise "Page 1 of 1200" when every page
  // past 401 is a 400 from the server. The run count either side of it stays
  // the true `total` — the list is that big, it just isn't all pageable.
  const totalPages = Math.min(
    Math.max(1, Math.ceil(total / limit)),
    Math.floor(MAX_RUN_LIST_OFFSET / limit) + 1,
  );
  const currentPage = Math.floor(offset / limit) + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-xyne-fg-muted">
      <div>
        {total === 0 ? "0 runs" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total} runs`}
        <span className="ml-2">· Page {currentPage} of {totalPages}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={offset === 0 || loading} onClick={() => onOffsetChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button size="sm" variant="secondary" disabled={offset + limit >= total || offset + limit > MAX_RUN_LIST_OFFSET || loading} onClick={() => onOffsetChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}
