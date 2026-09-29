import { useRef, useState, type KeyboardEvent } from 'react';
import type { MidSuggestion } from '../lib/portfolio';
import { Close, MENU_STYLE, SearchIcon } from './primitives';

/**
 * Merchant ID search for the whole page: typed text keeps merchants whose ID contains it, and matching
 * IDs are suggested; picking one turns it into a chip that narrows to exactly that merchant.
 */
export function SearchBox({
  mids,
  search,
  suggestions,
  defaults,
  onMids,
  onSearch,
  onPicked,
}: {
  mids: string[];
  search: string;
  suggestions: MidSuggestion[];
  /** Shown before anything is typed: most-searched or busiest merchants. */
  defaults: { title: string; items: MidSuggestion[] };
  onMids: (mids: string[]) => void;
  onSearch: (q: string) => void;
  /** A merchant was picked from the list (for the search history). */
  onPicked?: (mid: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // null = the default row: an exact MID match, else the free-text row.
  const [active, setActive] = useState<number | null>(null);
  const q = search.trim();
  // Typed: matching IDs, then "keep IDs containing the text" as the last row. Empty: the defaults.
  const list = q ? suggestions : defaults.items;
  const rows = q ? list.length + 1 : list.length;
  const exact = q ? list.findIndex(s => s.mid.toLowerCase() === q.toLowerCase()) : -1;
  const cur = active === null ? (q ? (exact >= 0 ? exact : list.length) : 0) : Math.min(active, rows - 1);

  const type = (v: string): void => {
    onSearch(v);
    setOpen(true);
    setActive(null);
  };
  const pick = (mid: string): void => {
    onMids([...mids, mid]);
    onPicked?.(mid);
    onSearch('');
    setOpen(false);
    setActive(null);
    input.current?.focus();
  };
  const choose = (i: number): void => {
    if (i < list.length) pick(list[i].mid);
    else setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && search === '' && mids.length > 0) {
      onMids(mids.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (rows > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setOpen(true);
      setActive((cur + (e.key === 'ArrowDown' ? 1 : rows - 1)) % rows);
    } else if (e.key === 'Enter' && open && rows > 0) {
      e.preventDefault();
      choose(cur);
    }
  };

  return (
    <div style={{ position: 'relative', width: 230, maxWidth: '100%' }}>
      <div
        onClick={() => {
          input.current?.focus();
          setOpen(true);
        }}
        className="field"
        style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', boxSizing: 'border-box', overflow: 'hidden', border: `1px solid ${mids.length > 0 ? 'var(--t5)' : 'var(--input)'}`, borderRadius: 6, background: 'var(--bg)', cursor: 'text', transition: 'border-color .15s, box-shadow .15s' }}
      >
        <SearchIcon />
        {mids.slice(0, 1).map(mid => (
          <Chip key={mid} mid={mid} onRemove={() => onMids(mids.filter(m => m !== mid))} />
        ))}
        {mids.length > 1 && (
          <span data-tip={mids.slice(1).join(', ')} style={{ flex: 'none', height: 22, display: 'flex', alignItems: 'center', padding: '0 7px', borderRadius: 4, background: 'var(--bg3)', fontSize: 12, fontWeight: 500, color: 'var(--t1)' }}>
            +{mids.length - 1}
          </span>
        )}
        <input
          ref={input}
          role="combobox"
          aria-label="Search merchant IDs"
          aria-expanded={open && rows > 0}
          aria-autocomplete="list"
          value={search}
          onChange={e => type(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder={mids.length > 0 ? 'Add merchant…' : 'Search merchant ID…'}
          style={{ all: 'unset', flex: 1, minWidth: 80, height: 24, fontSize: 14, color: 'var(--t1)' }}
        />
        {(search || mids.length > 0) && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={e => {
              e.stopPropagation();
              onSearch('');
              onMids([]);
            }}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', color: 'var(--t4)' }}
          >
            <Close size={12} />
          </button>
        )}
      </div>
      {open && (rows > 0 || mids.length > 1) && (
        // preventDefault keeps focus in the input so a click lands before blur closes the list.
        <div role="listbox" onMouseDown={e => e.preventDefault()} style={{ ...MENU_STYLE, left: 0, width: 320, maxWidth: 'calc(100vw - 32px)', top: 'calc(100% + 6px)' }}>
          {mids.length > 1 && (
            <>
              <div style={SECTION}>Selected · {mids.length}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 10px 8px', borderBottom: rows > 0 ? '1px solid var(--bd2)' : 'none', marginBottom: rows > 0 ? 4 : 0 }}>
                {mids.map(mid => (
                  <Chip key={mid} mid={mid} onRemove={() => onMids(mids.filter(m => m !== mid))} />
                ))}
              </div>
            </>
          )}
          {list.length > 0 && <div style={SECTION}>{q ? 'Merchant IDs' : defaults.title}</div>}
          {list.map((s, i) => (
            <button
              key={s.mid}
              type="button"
              role="option"
              aria-selected={i === cur}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s.mid)}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', borderRadius: 4, fontSize: 14, background: i === cur ? 'var(--bg3)' : 'transparent' }}
            >
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t1)', fontWeight: i === exact ? 600 : 400 }}>
                {s.mid}
              </span>
              <span style={{ fontSize: 12, color: 'var(--t3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {s.open} open · {s.total} total
              </span>
            </button>
          ))}
          {q && (
            <button
              type="button"
              role="option"
              aria-selected={cur === list.length}
              onMouseEnter={() => setActive(list.length)}
              onClick={() => choose(list.length)}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', borderRadius: 4, fontSize: 14, color: 'var(--t2)', background: cur === list.length ? 'var(--bg3)' : 'transparent', marginTop: list.length > 0 ? 4 : 0 }}
            >
              <SearchIcon size={13} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Merchant IDs containing “<b style={{ fontWeight: 600, color: 'var(--t1)' }}>{q}</b>”
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const SECTION = { padding: '6px 8px 4px', fontSize: 12, fontWeight: 500, color: 'var(--t3)' } as const;

function Chip({ mid, onRemove }: { mid: string; onRemove: () => void }) {
  return (
    <span className="mono" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, height: 22, padding: '0 4px 0 7px', borderRadius: 4, background: 'var(--bg3)', fontSize: 12, fontWeight: 500, color: 'var(--t1)', maxWidth: 150 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mid}</span>
      <button
        type="button"
        aria-label={`Remove ${mid}`}
        onClick={e => {
          e.stopPropagation();
          onRemove();
        }}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', color: 'var(--t4)', padding: 2 }}
      >
        <Close size={10} />
      </button>
    </span>
  );
}
