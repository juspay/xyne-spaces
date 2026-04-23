import { FileBubble } from '../ui/FileBubble/FileBubble';
import { queries } from '../../zero/queries';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useCachedQuery } from '../../hooks/useCachedQuery';

interface FileListProps {
  channelId: string;
}

type Anchor = {
  row: {
    attachementId: string;
    createdAt: number;
  } | null;
  direction: 'forward' | 'backward';
};

const LATEST_ANCHOR: Anchor = {
  row: null,
  direction: 'forward' as const,
};

const PAGE_SIZE = 20;

const FileListV2: React.FC<FileListProps> = ({ channelId }) => {
  const [anchor, setAnchor] = useState<Anchor>(LATEST_ANCHOR);
  const [attachementsResponse, attachementsDetails] = useCachedQuery(
    queries.getConversationAttachements({
      channelId: channelId,
      limit: PAGE_SIZE,
      start: anchor.row,
      direction: anchor.direction,
    }),
  );
  const [attachements, setAttachments] = useState(attachementsResponse);
  const [firstItemIndex, setFirstItemIndex] = useState(0);

  const scrollRange = useRef<{
    startIndex: number;
    endIndex: number;
  }>(null);

  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      scrollRange.current = range;
    },
    [scrollRange],
  );

  useEffect(() => {
    if (attachementsDetails.type === 'complete') {
      const a =
        anchor.direction === 'backward'
          ? attachementsResponse.reverse()
          : [...attachementsResponse];
      setAttachments([...a]);
    }
  }, [attachementsResponse, attachementsDetails.type]);

  // if (files.length === 0) {
  //   return (
  //     <div className='text-center text-muted-foreground py-8 flex-1 flex flex-col items-center justify-center select-none bg-[#FFFFFF]'>
  //       <img
  //         src='/images/empty-attachments.png'
  //         alt='No files shared in this channel yet.'
  //         width={200}
  //         height={200}
  //       />
  //       <p className='text-muted-foreground'>No files shared in this channel yet.</p>
  //     </div>
  //   );
  // }

  const handleEndReached = useCallback(() => {
    if (scrollRange.current === null || scrollRange.current.startIndex === 0) {
      return;
    }
    const startIndex = scrollRange.current.startIndex - firstItemIndex;
    const newAnchorIndex = Math.max(0, startIndex - 2);
    const attachementAnchor = attachements[newAnchorIndex];
    if (!attachementAnchor) {
      return;
    }
    setFirstItemIndex(v => v + newAnchorIndex);
    setAnchor({
      row: {
        attachementId: attachementAnchor.id,
        createdAt: attachementAnchor.createdAt,
      },
      direction: 'forward' as const,
    });
  }, [scrollRange, attachements]);

  const handleStartReached = useCallback(() => {
    if (scrollRange.current === null || anchor.row === null) {
      return;
    }
    if (attachements.length < PAGE_SIZE) {
      setFirstItemIndex(0);
      setAnchor(LATEST_ANCHOR);
    }
    const endIndex = scrollRange.current.endIndex - firstItemIndex;
    // const startIndex = scrollRange.current.startIndex - firstItemIndex;
    const newAnchorIndex = Math.min(attachements.length - 1, endIndex + 2);
    const attachementAnchor = attachements[newAnchorIndex];
    if (!attachementAnchor) {
      return;
    }
    setFirstItemIndex(v => v - (attachements.length - newAnchorIndex));
    setAnchor({
      row: {
        attachementId: attachementAnchor.id,
        createdAt: attachementAnchor.createdAt,
      },
      direction: 'backward' as const,
    });
  }, [scrollRange, attachements]);

  return (
    <div
      data-component='FileListV2'
      className='flex-1 relative no-scrollbar min-h-0 px-4 bg-background'
    >
      <Virtuoso
        data={attachements}
        style={{ height: '100%' }}
        // startReached={}
        atBottomStateChange={atBottom => {
          if (atBottom) {
            handleEndReached();
          }
        }}
        atTopStateChange={atTop => {
          if (atTop) {
            handleStartReached();
          }
        }}
        firstItemIndex={firstItemIndex}
        rangeChanged={handleRangeChanged}
        computeItemKey={(_, data) => {
          return data.id;
        }}
        itemContent={(_, file) => (
          <FileBubble
            key={`${file.id}`}
            attachment={file}
            createdAt={file.createdAt}
            createdBy={file.createdBy}
          />
        )}
      />
    </div>
  );
  // <div className='overflow-auto no-scrollbar p-4 space-y-3'>
  //   {files.map((file, idx) => (

  //   ))}
  // </div>
};

export default FileListV2;
