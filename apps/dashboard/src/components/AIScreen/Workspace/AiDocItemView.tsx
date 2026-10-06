import { useState, type ReactElement } from 'react';
import {
  ANNOTATE_SCRIPT_TAG,
  HtmlDocView,
  requestComments,
  useAnnotate,
  useFrameTransport,
  type PickedBlock,
  type WorkspaceItem,
} from '../../workspaceItems';
import { InlineCommentThread, type InlineCommentTarget } from './InlineCommentThread';
import { usePublishViewerAction } from './viewerActions';

export function AiDocItemView({ item }: { item: WorkspaceItem }): ReactElement {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [picked, setPicked] = useState<PickedBlock | null>(null);
  const [openThread, setOpenThread] = useState<InlineCommentTarget | null>(null);

  const transport = useFrameTransport(frame, {
    onPick: setPicked,
    onMarkClick: (commentId, rect) => {
      if (!rect) {
        requestComments(item.id, commentId);
        return;
      }
      setOpenThread(current => {
        if (current?.commentId === commentId) {
          transport.clearActive?.();
          return null;
        }
        return { commentId, rect };
      });
    },
  });

  const annotate = useAnnotate({
    item,
    url: item.url ?? '',
    transport,
    picked,
    onPicked: setPicked,
  });

  usePublishViewerAction(() => annotate.toggle, [annotate.picking, annotate.toggle === null]);

  return (
    <div className='relative h-full min-h-0'>
      <HtmlDocView
        url={item.contentUrl ?? item.url ?? ''}
        title={item.title}
        inject={ANNOTATE_SCRIPT_TAG}
        onFrame={setFrame}
      />
      {annotate.box}
      {openThread ? (
        <InlineCommentThread
          item={item}
          target={openThread}
          onClose={() => {
            setOpenThread(null);
            transport.clearActive?.();
          }}
        />
      ) : null}
    </div>
  );
}
