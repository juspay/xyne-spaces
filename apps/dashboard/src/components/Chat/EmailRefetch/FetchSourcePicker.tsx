import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Mail, Plug, RefreshCw } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { ChannelFetchSource } from '../../../services/clients/deskSourcesApi';

const sourceTypeIcon = (sourceType: ChannelFetchSource['sourceType']): React.ReactElement =>
  sourceType === 'app-desk' ? (
    <Plug size={14} className='shrink-0' />
  ) : (
    <Mail size={14} className='shrink-0' />
  );

interface FetchSourcePickerProps {
  sources: ChannelFetchSource[];
  leadingAction?: { label: string; onSelect: () => void } | undefined;
  onSelect: (sourceId: string | null, sourceName?: string) => void;
  children: React.ReactNode;
}

export const FetchSourcePicker: React.FC<FetchSourcePickerProps> = ({
  sources,
  leadingAction,
  onSelect,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const rowClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
  const pick = (sourceId: string | null, sourceName?: string): void => {
    setOpen(false);
    onSelect(sourceId, sourceName);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align='end'
          side='bottom'
          sideOffset={6}
          avoidCollisions
          collisionPadding={16}
          className={cn(
            'z-50 w-64 rounded-lg border border-border bg-popover p-1 shadow-md',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-150',
          )}
        >
          <div className='px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            Fetch from
          </div>
          {leadingAction && (
            <button
              type='button'
              className={rowClass}
              onClick={() => {
                setOpen(false);
                leadingAction.onSelect();
              }}
              data-track-category='Support'
              data-track-name='FetchLeadingAction'
            >
              <RefreshCw size={14} className='shrink-0' />
              <span className='truncate font-medium'>{leadingAction.label}</span>
            </button>
          )}
          {!leadingAction && sources.length > 1 && (
            <button
              type='button'
              className={rowClass}
              onClick={() => pick(null)}
              data-track-category='Support'
              data-track-name='FetchAllSources'
            >
              <RefreshCw size={14} className='shrink-0' />
              <span className='truncate font-medium'>All sources</span>
              <span className='ml-auto text-xs text-muted-foreground'>{sources.length}</span>
            </button>
          )}
          {sources.map(source => (
            <button
              key={source.sourceId}
              type='button'
              className={rowClass}
              onClick={() => pick(source.sourceId, source.displayName)}
              data-track-category='Support'
              data-track-name='FetchSource'
              data-track-metadata={JSON.stringify({
                sourceId: source.sourceId,
                sourceType: source.sourceType,
              })}
            >
              {sourceTypeIcon(source.sourceType)}
              <span className='truncate'>{source.displayName}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
