import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { injectMarks } from '../../../FileViewer/search/htmlHighlight';
import type { HighlightRange } from '../../../FileViewer/search/types';
import { cn } from '../../../../utils/classNames';
import { usePreviewFind } from '../../chrome';
import { findPattern, type FindProvider } from '../../find';
import { useCodeFontSize } from './codeFontSize';
import { highlightLines } from './languages';

/** Past this many, the rest are not marked. */
const MATCH_LIMIT = 5000;

interface Match {
  line: number;
  start: number;
  end: number;
}

/**
 * A text as numbered lines, coloured for its language: the text previewer's whole
 * view, and the source view of Markdown and HTML. Only the lines in sight are drawn,
 * so a log of a hundred thousand lines scrolls as one of ten. Its text size is the
 * reader's, from the toolbar; the frame's find searches it line by line.
 */
export function CodeLines(props: {
  text: string;
  language: string | null;
  /** Long lines wrap rather than scroll sideways. */
  wrap: boolean;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fontSize = useCodeFontSize();
  const lineHeight = Math.round(fontSize * 1.6);
  const lines = useMemo(
    () => highlightLines(props.text, props.language),
    [props.text, props.language],
  );
  const plainLines = useMemo(() => props.text.replace(/\r\n?/g, '\n').split('\n'), [props.text]);
  // In characters: the widest line sets how far the view scrolls sideways when lines
  // don't wrap, as the rows are placed absolutely and can't stretch it themselves.
  const widest = useMemo(
    () => plainLines.reduce((most, line) => Math.max(most, line.length), 0),
    [plainLines],
  );
  // Room for the largest number and the padding either side of it.
  const gutter = `calc(${String(lines.length).length}ch + 2.25rem)`;

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => lineHeight,
    overscan: 20,
  });
  // A new size moves every line: measured again from the top.
  useEffect(() => virtualizer.measure(), [virtualizer, lineHeight, props.wrap]);

  // ── Find ──
  const [marks, setMarks] = useState<{ matches: Match[]; current: number } | null>(null);
  const matchesRef = useRef<Match[]>([]);
  const finder = useMemo<FindProvider>(
    () => ({
      search: query => {
        // Case-blind on the line as it is, so offsets match the line drawn.
        const pattern = findPattern(query);
        const matches: Match[] = [];
        for (let line = 0; line < plainLines.length && matches.length < MATCH_LIMIT; line += 1) {
          const text = plainLines[line] ?? '';
          pattern.lastIndex = 0;
          for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
            matches.push({ line, start: found.index, end: found.index + found[0].length });
          }
        }
        matchesRef.current = matches;
        setMarks({ matches, current: -1 });
        return matches.length;
      },
      reveal: index => {
        const match = matchesRef.current[index];
        if (!match) return;
        setMarks(current => current && { ...current, current: index });
        virtualizer.scrollToIndex(match.line, { align: 'center' });
        // Once the line is drawn, its match brought into view sideways too.
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            scrollRef.current
              ?.querySelector('[data-xyne-find-active="true"]')
              ?.scrollIntoView({ block: 'nearest', inline: 'center' }),
          ),
        );
      },
      clear: () => {
        matchesRef.current = [];
        setMarks(null);
      },
    }),
    [plainLines, virtualizer],
  );
  usePreviewFind(finder);

  const rangesByLine = useMemo(() => {
    const byLine = new Map<number, HighlightRange[]>();
    marks?.matches.forEach((match, index) => {
      const ranges = byLine.get(match.line) ?? [];
      ranges.push({ start: match.start, end: match.end, isActive: index === marks.current });
      byLine.set(match.line, ranges);
    });
    return byLine;
  }, [marks]);

  const lineHtml = (index: number): string => {
    const html = lines[index] || ' ';
    const ranges = rangesByLine.get(index);
    // A mark is an element too, so it carries the monospace itself.
    return ranges
      ? injectMarks(html, ranges).replace(/<mark class="/g, '<mark class="font-code ')
      : html;
  };

  return (
    <div
      ref={scrollRef}
      // On each element below, not only here: the app sets its sans font on every
      // element directly, so nothing inside would inherit the monospace.
      className='h-full overflow-auto py-2 font-code'
      style={{ fontSize, lineHeight: `${lineHeight}px` }}
    >
      <div
        className='relative'
        style={{
          height: virtualizer.getTotalSize(),
          minWidth: props.wrap ? undefined : `calc(${gutter} + ${widest + 4}ch)`,
        }}
      >
        {virtualizer.getVirtualItems().map(row => (
          <div
            key={row.key}
            data-index={row.index}
            ref={props.wrap ? virtualizer.measureElement : undefined}
            className='absolute left-0 top-0 flex w-full'
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {/* Stays put while the lines scroll sideways. */}
            <span
              aria-hidden='true'
              className='sticky left-0 shrink-0 select-none bg-background pl-4 pr-5 text-right font-code tabular-nums text-muted-foreground/60'
              style={{ width: gutter, minHeight: lineHeight }}
            >
              {row.index + 1}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 pr-6 font-code text-foreground',
                props.wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
              )}
              style={{ minHeight: lineHeight }}
              // highlightLines escapes the text; the markup is highlight.js's own spans
              // and the find's marks, never the query.
              dangerouslySetInnerHTML={{ __html: lineHtml(row.index) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
