import type { ReactElement, ReactNode } from 'react';
import { MATCH_CLASS } from '@/components/FileViewer/search/htmlHighlight';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function HighlightMatch({ text, query }: { text: string; query: string }): ReactElement {
  const needle = query.trim();
  if (!needle) return <>{text}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(needle)})`, 'gi'));

  return (
    <>
      {parts.map(
        (part, index): ReactNode =>
          part.toLowerCase() === needle.toLowerCase() ? (
            <mark key={index} className={MATCH_CLASS}>
              {part}
            </mark>
          ) : (
            part
          ),
      )}
    </>
  );
}
