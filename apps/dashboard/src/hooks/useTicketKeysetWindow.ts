import { useEffect, useRef, useState } from 'react';

export type KeysetDir = 'forward' | 'backward';

export interface UseTicketKeysetWindowArgs<Row, Cursor> {
  currentId: string | null;
  currentRow: Row | null;
  idOf: (row: Row) => string;
  cursorOf: (row: Row) => Cursor;
  fetchPage: (start: Cursor, dir: KeysetDir, limit: number) => Promise<Row[]>;
  seed?: readonly Row[] | undefined;
  radius?: number;
  pageSize?: number;
  enabled?: boolean;
}

export interface TicketKeysetWindow<Row> {
  prev: Row | null;
  next: Row | null;
}

export function useTicketKeysetWindow<Row, Cursor>(
  args: UseTicketKeysetWindowArgs<Row, Cursor>,
): TicketKeysetWindow<Row> {
  const { currentId, currentRow, seed, radius = 5, pageSize = 10, enabled = true } = args;

  const fnRef = useRef(args);
  fnRef.current = args;

  const [buffer, setBuffer] = useState<Row[]>([]);
  const reachedStart = useRef(false);
  const reachedEnd = useRef(false);
  const inFlight = useRef({ start: false, end: false });

  const idOf = fnRef.current.idOf;
  const idx = currentId ? buffer.findIndex(r => idOf(r) === currentId) : -1;

  useEffect(() => {
    if (!enabled || !currentId) return;
    if (buffer.some(r => fnRef.current.idOf(r) === currentId)) return;
    const fromSeed = seed?.some(r => fnRef.current.idOf(r) === currentId) ? [...seed] : null;
    const next = fromSeed ?? (currentRow ? [currentRow] : null);
    if (!next) return;
    reachedStart.current = false;
    reachedEnd.current = false;
    inFlight.current = { start: false, end: false };
    setBuffer(next);
  }, [enabled, currentId, currentRow, seed, buffer]);

  useEffect(() => {
    if (!enabled || idx === -1 || buffer.length === 0) return;
    const { cursorOf, fetchPage } = fnRef.current;
    const idAt = fnRef.current.idOf;

    const first = buffer[0];
    if (first && idx <= radius && !reachedStart.current && !inFlight.current.start) {
      inFlight.current.start = true;
      const anchor = cursorOf(first);
      void fetchPage(anchor, 'backward', pageSize)
        .then(rows => {
          if (rows.length < pageSize) reachedStart.current = true;
          if (rows.length > 0) {
            setBuffer(prev => {
              const have = new Set(prev.map(idAt));
              const fresh = rows.filter(r => !have.has(idAt(r))).reverse();
              return fresh.length ? [...fresh, ...prev] : prev;
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current.start = false;
        });
    }

    const last = buffer[buffer.length - 1];
    if (last && idx >= buffer.length - 1 - radius && !reachedEnd.current && !inFlight.current.end) {
      inFlight.current.end = true;
      const anchor = cursorOf(last);
      void fetchPage(anchor, 'forward', pageSize)
        .then(rows => {
          if (rows.length < pageSize) reachedEnd.current = true;
          if (rows.length > 0) {
            setBuffer(prev => {
              const have = new Set(prev.map(idAt));
              const fresh = rows.filter(r => !have.has(idAt(r)));
              return fresh.length ? [...prev, ...fresh] : prev;
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current.end = false;
        });
    }
  }, [enabled, idx, buffer, radius, pageSize]);

  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? (buffer[idx - 1] ?? null) : null,
    next: idx < buffer.length - 1 ? (buffer[idx + 1] ?? null) : null,
  };
}
