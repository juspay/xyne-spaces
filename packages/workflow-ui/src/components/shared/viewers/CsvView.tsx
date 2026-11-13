import { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { ViewerLoading } from './chrome.js';
import { useDomAnchor, type Anchor } from './useDomAnchor.js';
import { AnchorMiss } from './AnchorMiss.js';

const MAX_ROWS = 1000;

/** Spreadsheet column letter for a 0-based index: 0→A, 25→Z, 26→AA. */
function colName(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// CSV/TSV renderer — parses with papaparse and renders a themed table.
export default function CsvView({ url, anchor }: { url: string; anchor?: Anchor | undefined }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [failed, setFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const { hit } = useDomAnchor(bodyRef, anchor, rows?.length ?? -1);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setFailed(false);
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((t) => {
        const res = Papa.parse<string[]>(t, { skipEmptyLines: true });
        if (!cancelled) setRows(res.data);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) throw new Error('csv load failed');
  if (rows === null) return <ViewerLoading />;

  const [head, ...body] = rows;
  const capped = body.slice(0, MAX_ROWS);
  const th = 'sticky top-0 border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-2.5 py-1.5 text-left font-semibold text-[var(--wui-fg)]';
  const td = 'border border-[var(--wui-border)] px-2.5 py-1.5 align-top text-[var(--wui-fg-muted)]';

  return (
    <div className="h-full overflow-auto">
    {/* Sibling of the anchored container, never inside it — see AnchorMiss. */}
    <AnchorMiss anchor={anchor} hit={hit} />
    <div ref={bodyRef} className="px-5 py-4">
      <table className="w-full border-collapse text-[12.5px] tabular-nums">
        {head && (
          <thead>
            <tr>{head.map((c, i) => <th key={i} className={th} data-row="1" data-col={colName(i)}>{c}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {/* Cells carry their spreadsheet address so a `{at:'cell'}` locator is a
              plain attribute lookup rather than viewer-specific logic. Rows are
              1-based and count the header, matching what a user sees in Excel. */}
          {capped.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => (
                <td key={ci} className={td} data-row={ri + 2} data-col={colName(ci)}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > capped.length && (
        <p className="mt-2 text-[12px] text-[var(--wui-fg-muted)]">
          Showing first {String(capped.length)} of {String(body.length)} rows.
        </p>
      )}
    </div>
    </div>
  );
}
