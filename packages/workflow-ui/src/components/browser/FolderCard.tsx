import { Folder } from 'lucide-react';
import { cn } from '../shared/cn.js';

type Props = {
  size?: 'sm' | 'md';
};

export function FolderCard({ size = 'md' }: Props) {
  const isSm = size === 'sm';
  return (
    <div
      aria-hidden
      className={cn(
        'flex items-center justify-center',
        isSm ? 'h-9 w-9' : 'h-14 w-14',
      )}
    >
      <Folder
        strokeWidth={1.75}
        className={cn('text-muted-foreground', isSm ? 'h-5 w-5' : 'h-10 w-10')}
      />
    </div>
  );
}
