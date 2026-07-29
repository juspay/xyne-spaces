import React from 'react';
import { FolderOpen } from 'lucide-react';

interface EmptyPaneV2Props {
  isRoot: boolean;
}

export const EmptyPaneV2: React.FC<EmptyPaneV2Props> = ({ isRoot }) => {
  return (
    <div className='mx-auto flex max-w-md flex-col items-center justify-center gap-3 py-24 text-center'>
      <span className='grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground'>
        <FolderOpen className='h-5 w-5' aria-hidden strokeWidth={1.5} />
      </span>
      <p className='text-[14px] font-medium text-foreground'>
        {isRoot ? 'No collections yet' : 'Nothing here yet'}
      </p>
      <p className='max-w-xs text-[12.5px] text-muted-foreground'>
        {isRoot
          ? 'Create a collection to start organising and uploading documents.'
          : 'Drop files here or use the Upload button to add documents to this folder.'}
      </p>
    </div>
  );
};
