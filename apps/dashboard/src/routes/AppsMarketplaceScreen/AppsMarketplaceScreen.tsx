import { useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlusDefault, SearchDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button/index';
import AppsV2 from '@/routes/AIScreen/library/apps/AppsV2';
import { LibraryToolbarSlotProvider } from '@/routes/AIScreen/library/shared/components/LibraryToolbarSlot';
import { CreateAppDialog } from './CreateAppDialog';

/**
 * Apps Marketplace: the workspace's apps as their own rail module.
 *
 * The list is Agent Hub → Apps itself (`AppsV2`), so the two never drift; this
 * adds the module's own header and the way to start a new app from a name.
 */
const AppsMarketplaceScreen = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const [searchOpen, setSearchOpen] = useState(query.length > 0);
  const [createOpen, setCreateOpen] = useState(false);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const setQuery = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const toggleSearch = (): void => {
    setSearchOpen(prev => {
      if (prev) {
        setQuery('');
        return false;
      }
      setTimeout(() => searchRef.current?.focus(), 0);
      return true;
    });
  };

  return (
    <div className='h-full w-full overflow-y-auto bg-background'>
      <div className='max-w-ai-content mx-auto flex w-full flex-col px-6 pb-16'>
        <div className='sticky top-0 z-10 flex flex-col bg-background'>
          <div className='flex items-center gap-5 pt-8'>
            <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
              <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
                Apps
              </h1>
              <p className='text-[15px] leading-[1.2] text-muted-foreground'>
                Front ends your workspace builds on Xyne data.
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <button
                type='button'
                onClick={toggleSearch}
                aria-label='Search apps'
                aria-expanded={searchOpen}
                className={cn(
                  'flex size-9 items-center justify-center rounded-[10px] transition-colors hover:bg-muted',
                  searchOpen ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
                data-track-category='Apps'
                data-track-name='AppsMarketplaceSearchToggle'
              >
                <SearchDefault className='size-4' />
              </button>
              <div ref={setToolbarSlot} className='flex items-center' />
              <Button
                type='button'
                onClick={() => setCreateOpen(true)}
                data-track-category='Apps'
                data-track-name='AppsMarketplaceCreateApp'
              >
                <PlusDefault className='size-4' />
                Create app
              </Button>
            </div>
          </div>

          {searchOpen && (
            <div className='relative pt-4'>
              <SearchDefault className='pointer-events-none absolute left-3 top-[calc(50%+8px)] size-4 -translate-y-1/2 text-muted-foreground' />
              <input
                ref={searchRef}
                type='text'
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setQuery('');
                    setSearchOpen(false);
                  }
                }}
                placeholder='Search apps'
                data-track-category='Apps'
                data-track-name='AppsMarketplaceSearch'
                className='h-9 w-full rounded-[10px] border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          )}
          <div className='pb-3' />
        </div>

        <LibraryToolbarSlotProvider value={toolbarSlot}>
          <div className='mt-5'>
            <AppsV2 query={query} />
          </div>
        </LibraryToolbarSlotProvider>
      </div>

      <CreateAppDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
};

export default AppsMarketplaceScreen;
