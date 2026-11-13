import { useEffect, useRef, useState } from 'react';
import readXlsxFile, { readSheetNames } from 'read-excel-file';
import { cn } from '../cn.js';
import { ViewerLoading } from './chrome.js';
import { useDomAnchor, type Anchor } from './useDomAnchor.js';
import { AnchorMiss } from './AnchorMiss.js';

const MAX_ROWS = 1000;
type Sheet = { name: string; rows: unknown[][] };

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

// XLSX/XLS renderer — parses with SheetJS, renders each sheet as a themed table
// with tabs when there is more than one sheet.
export default function SheetView({ url, anchor }: { url: string; anchor?: Anchor | undefined }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** The sheet a cell locator names, when it names one. */
  const wantSheet = anchor?.locator?.at === 'cell' ? anchor.locator.sheet : undefined;
  // Re-anchor when the visible sheet changes — a cell locator naming another
  // sheet must not highlight the same coordinates on whichever one is showing.
  const { hit } = useDomAnchor(bodyRef, anchor, `${String(active)}:${String(sheets?.length ?? -1)}`);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setFailed(false);
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.arrayBuffer();
      })
      .then(async (buf) => {
        const names = await readSheetNames(buf);
        const parsed = await Promise.all(
          names.map(async (name) => ({ name, rows: await readXlsxFile(buf, { sheet: name }) })),
        );
        if (!cancelled) setSheets(parsed);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  // Land on the sheet the citation names. Without this the viewer always opened
  // the first sheet, so a cell cited on "dscr sales" showed whatever sheet
  // happened to be first — the anchor then searched the wrong table and missed.
  // Matched leniently: a sheet name copied out of a label may differ in case or
  // padding, and picking the right tab matters more than exactness.
  useEffect(() => {
    if (!sheets || wantSheet === undefined) return;
    const want = wantSheet.trim().toLowerCase();
    const i = sheets.findIndex((s) => s.name.trim().toLowerCase() === want);
    if (i >= 0) setActive(i);
  }, [sheets, wantSheet]);

  if (failed) throw new Error('sheet load failed');
  if (sheets === null) return <ViewerLoading />;

  const sheet = sheets[active] ?? sheets[0];
  if (!sheet) return <ViewerLoading />;
  const [head, ...body] = sheet.rows;
  const capped = body.slice(0, MAX_ROWS);
  const th = 'sticky top-0 border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-2.5 py-1.5 text-left font-semibold text-[var(--wui-fg)]';
  const td = 'border border-[var(--wui-border)] px-2.5 py-1.5 align-top text-[var(--wui-fg-muted)]';

  return (
    <div className="flex h-full flex-col">
      {/* Outside `bodyRef` on purpose: the notice echoes the quote, and anything
          inside the anchored container is searched by `findRange` — it would
          match itself and report a hit. */}
      <AnchorMiss anchor={anchor} hit={hit} />
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--wui-border)] px-3 py-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'shrink-0 rounded px-2.5 py-1 text-[12px] transition-colors',
                i === active
                  ? 'bg-[var(--wui-bg-subtle)] font-semibold text-[var(--wui-fg)]'
                  : 'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div ref={bodyRef} className="overflow-auto px-5 py-4">
        <table className="w-full border-collapse text-[12.5px] tabular-nums">
          {head && (
            <thead>
              <tr>
                {(head as unknown[]).map((c, i) => (
                  <th key={i} className={th} data-row="1" data-col={colName(i)}>{String(c ?? '')}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {/* Cells carry their spreadsheet address (1-based, header included) so
                a `{at:'cell'}` locator resolves by attribute lookup — no
                viewer-specific logic, and it matches what a user sees in Excel. */}
            {capped.map((row, ri) => (
              <tr key={ri}>
                {(row as unknown[]).map((c, ci) => (
                  <td key={ci} className={td} data-row={ri + 2} data-col={colName(ci)}>{String(c ?? '')}</td>
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
