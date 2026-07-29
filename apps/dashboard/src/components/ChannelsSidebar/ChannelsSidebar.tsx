import { ReactElement, ReactNode, useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import SidebarItem from '../Project/ProjectSidebar/SidebarItem';

interface Channel {
  id: string;
  name?: string | null;
}

interface ChannelsSidebarProps {
  channels: Channel[];
  selectedChannelId: string | null;
  onSelectChannel: (channelId: string | null) => void;
  onCollapse?: () => void;
  headerAction?: ReactNode;
}

const ChannelsSidebar = ({
  channels,
  selectedChannelId,
  onSelectChannel,
  onCollapse,
  headerAction,
}: ChannelsSidebarProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 'Enter') return;
      const active = document.activeElement;
      if (!containerRef.current || !active || !containerRef.current.contains(active)) return;
      // Skip when typing in an input/textarea/contenteditable.
      const tag = (active as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement).isContentEditable) {
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const list = document.querySelector<HTMLElement>('[data-slot="ticket-list-view"]');
        list?.focus();
        return;
      }
      if (channels.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const currentIndex = channels.findIndex(c => c.id === selectedChannelId);
      const delta = e.key === 'j' ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : channels.length - 1
          : Math.max(0, Math.min(channels.length - 1, currentIndex + delta));
      const next = channels[nextIndex];
      if (next) onSelectChannel(next.id);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [channels, selectedChannelId, onSelectChannel]);

  return (
    <div
      ref={containerRef}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role='region'
      aria-label='Desks'
      className='h-full flex flex-col bg-sidebar outline-none'
    >
      {/* Header - matches ProjectSidebar structure */}
      <div className='flex-shrink-0 h-14 sticky top-0 z-50 bg-sidebar border-b border-border flex items-center'>
        <div className='px-4 flex items-center justify-between w-full'>
          <h2 className='text-foreground font-inter text-base font-semibold leading-normal'>
            Desks
          </h2>
          <div className='flex items-center gap-1'>
            {headerAction}
            {onCollapse && (
              <button
                onClick={onCollapse}
                className='p-2 hover:bg-muted rounded-md transition-colors'
                aria-label='Collapse sidebar'
                title='Collapse sidebar'
                data-track-category='Support'
                data-track-name='CollapseChannelsSidebar'
              >
                <ChevronLeft className='size-4 text-muted-foreground' />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content - uses same padding as ProjectSidebar */}
      <div className='flex-1 overflow-y-auto px-3 py-4'>
        {/* Channel List */}
        {channels.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-32 text-muted-foreground text-sm px-4 text-center'>
            No channels available
          </div>
        ) : (
          <div className='mt-2 space-y-0.5' data-testid='channel-list'>
            {channels.map(channel => {
              const channelName = channel.name?.trim() || 'Unnamed Channel';
              return (
                <SidebarItem
                  key={channel.id}
                  label={channelName}
                  isActive={selectedChannelId === channel.id}
                  onClick={() => onSelectChannel(channel.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelsSidebar;
