import { Fragment, useMemo, type JSX } from 'react';
import { normalizeHighlightTerms, splitOnHighlightTerms } from '../../../utils/highlightTerms';

interface HighlightedTextProps {
  text: string;
  /** Words from the active search. Empty or absent renders `text` unchanged. */
  terms?: readonly string[] | undefined;
}

/** Marks search terms in plain display text, for fields rendered from Zero rather than
 * from the search hit, which already carries Vespa's <hi> tags. */
export const HighlightedText = ({ text, terms }: HighlightedTextProps): JSX.Element => {
  const segments = useMemo(
    () => (terms?.length ? splitOnHighlightTerms(text, normalizeHighlightTerms(terms)) : []),
    [text, terms],
  );

  if (segments.length === 0) return <>{text}</>;

  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <mark
            key={index}
            className='bg-yellow-200 font-medium text-foreground dark:bg-yellow-500/30'
          >
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
};
