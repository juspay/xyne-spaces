import { createReactStyleSpec } from '@blocknote/react';

const COMMENT_THREAD_ATTR = 'data-canvas-comment-thread-id';

export const canvasCommentThreadStyleSpec = createReactStyleSpec(
  {
    type: 'canvasCommentThread',
    propSchema: 'string',
  },
  {
    render: ({ value, contentRef }) => (
      <span
        ref={contentRef}
        data-canvas-comment-thread-id={value}
        className='canvas-comment-anchor'
      />
    ),
  },
);

export const getCanvasCommentThreadSelector = (threadId: string): string => {
  const escapedThreadId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(threadId)
      : threadId.replace(/["\\]/g, '\\$&');

  return `[${COMMENT_THREAD_ATTR}="${escapedThreadId}"]`;
};
