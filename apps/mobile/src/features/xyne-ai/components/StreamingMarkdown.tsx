import { useMemo, type ReactElement } from 'react';
import remend, { INCOMPLETE_IMAGE_PLACEHOLDER } from 'remend';

import { BlockMarkdown } from '@/src/features/chat/v3/rows/BlockMarkdown';

const INCOMPLETE_IMAGE = `](${INCOMPLETE_IMAGE_PLACEHOLDER})`;

/**
 * Closes markdown left open mid-stream (`**bold`, `` `code ``, `[link](ht`) so a
 * partial answer renders as formatted text instead of flashing raw syntax.
 * An unfinished image is held back rather than shown broken.
 */
function completeStreamingMarkdown(markdown: string): string {
  const completed = remend(markdown, { linkMode: 'text-only', katex: false });
  return completed.endsWith(INCOMPLETE_IMAGE)
    ? completed.slice(0, completed.lastIndexOf('!['))
    : completed;
}

export const StreamingMarkdown = ({
  markdown,
  isStreaming,
  viewerId,
  onOpenUrl,
}: {
  markdown: string;
  isStreaming: boolean;
  viewerId: string;
  onOpenUrl: (url: string) => void;
}): ReactElement => {
  const rendered = useMemo(
    () => (isStreaming ? completeStreamingMarkdown(markdown) : markdown),
    [markdown, isStreaming],
  );
  return (
    <BlockMarkdown markdown={rendered} mine={false} viewerId={viewerId} onOpenUrl={onOpenUrl} />
  );
};
