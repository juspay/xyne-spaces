import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Search, Package, Code2 } from 'lucide-react';
import { useResearchOptions, type ResearchContext } from '../../hooks/useResearchAgent';
import { cn } from '../../utils/classNames';

interface ComposerResearchPickerProps {
  research: ResearchContext | null;
  onResearchChange: (research: ResearchContext | null) => void;
}

/**
 * "Search" button + Research Agent picker for the /ai composer. Ports the
 * sidebar's (XyneAIInputBox) research dropdown: lazy-loaded products /
 * repositories tabs, selecting one sets the ResearchContext (deep research
 * target). Uses the same useResearchOptions hook as the sidebar.
 */
export function ComposerResearchPicker({
  research,
  onResearchChange,
}: ComposerResearchPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'products' | 'repositories'>('products');
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { products, repositories, isLoading, triggerFetch, hasFetched } = useResearchOptions();

  const filteredItems = useMemo(() => {
    const items = tab === 'products' ? products : repositories;
    if (!search.trim()) return items.slice(0, 10);
    const q = search.toLowerCase();
    return items.filter(item => item.name.toLowerCase().includes(q)).slice(0, 10);
  }, [products, repositories, tab, search]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open, tab]);

  const handleOpen = (): void => {
    if (!hasFetched) triggerFetch();
    setSearch('');
    setOpen(o => !o);
  };

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        onClick={handleOpen}
        aria-label='Select product or repository for research'
        title='Deep Research target'
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full transition',
          research
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        )}
        data-track-category='XyneAI'
        data-track-name='OPEN_RESEARCH_SELECTOR'
      >
        <Search className='h-4 w-4' aria-hidden />
      </button>

      {open && (
        <div className='absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg'>
          <div className='flex border-b border-border'>
            {(['products', 'repositories'] as const).map(t => (
              <button
                key={t}
                type='button'
                onClick={() => setTab(t)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors',
                  tab === t
                    ? 'border-b-2 border-foreground bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )}
                data-track-category='XyneAI'
                data-track-name={
                  t === 'products' ? 'SELECT_PRODUCTS_TAB' : 'SELECT_REPOSITORIES_TAB'
                }
              >
                {t === 'products' ? <Package className='h-4 w-4' /> : <Code2 className='h-4 w-4' />}
                {t === 'products' ? 'Products' : 'Repositories'}
              </button>
            ))}
          </div>

          <div className='border-b border-border bg-muted p-2'>
            <input
              ref={searchInputRef}
              type='text'
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${tab}...`}
              className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='XyneAI'
              data-track-name='RESEARCH_SEARCH_INPUT'
            />
          </div>

          <div className='max-h-64 overflow-y-auto'>
            {isLoading ? (
              <div className='px-3 py-6 text-center text-sm text-muted-foreground'>Loading...</div>
            ) : filteredItems.length > 0 ? (
              <div className='py-1'>
                {filteredItems.map(item => (
                  <button
                    key={item.id}
                    type='button'
                    onClick={() => {
                      onResearchChange({
                        type: tab === 'products' ? 'product' : 'repository',
                        id: item.id,
                        name: item.name,
                      });
                      setOpen(false);
                      setSearch('');
                    }}
                    className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent'
                    data-track-category='XyneAI'
                    data-track-name='SELECT_RESEARCH_ITEM'
                  >
                    {tab === 'products' ? (
                      <Package className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
                    ) : (
                      <Code2 className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
                    )}
                    <span className='flex-1 truncate font-medium text-foreground'>{item.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                No {tab} found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
