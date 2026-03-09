import { ReactElement } from 'react';
import { Plus, Search, Hash } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface ChannelAddDropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBrowseChannels: () => void;
  onCreateChannel: () => void;
}

const ChannelAddDropdown = ({
  open,
  onOpenChange,
  onBrowseChannels,
  onCreateChannel,
}: ChannelAddDropdownProps): ReactElement => {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type='button'
          className='text-[#464C53] hover:text-[#1D1E1F] p-1 rounded transition-colors'
        >
          <Plus className='w-4 h-4' />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side='bottom'
          align='start'
          sideOffset={4}
          collisionPadding={8}
          className='min-w-[160px] bg-popover rounded-md shadow-lg border border-border p-1 z-50'
        >
          <DropdownMenu.Item
            onSelect={onBrowseChannels}
            className='flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent rounded cursor-pointer outline-none'
          >
            <Search className='w-4 h-4' />
            Browse channels
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onCreateChannel}
            className='flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent rounded cursor-pointer outline-none'
          >
            <Hash className='w-4 h-4' />
            Create channel
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export default ChannelAddDropdown;
