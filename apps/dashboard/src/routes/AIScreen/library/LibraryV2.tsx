import { ComponentType, ReactElement, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PlusDefault, SearchDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button/index';
import AgentsV2 from './agents/AgentsV2';
import SubagentsV2 from './subagents/SubagentsV2';
import SkillsV2 from './skills/SkillsV2';
import McpV2 from './mcp/McpV2';
import AppsV2 from './apps/AppsV2';
import { LibraryToolbarSlotProvider } from './shared/components/LibraryToolbarSlot';

interface LibraryTab {
  id: string;
  label: string;
  content: ComponentType<{ query: string }>;
  searchPlaceholder: string;
  create: { label: string; path: string } | null;
}

const LIBRARY_TABS = [
  {
    id: 'agents',
    label: 'Agents',
    content: AgentsV2,
    searchPlaceholder: 'Search agents',
    create: { label: 'Create Agent', path: '/ai/library/agent/create' },
  },
  {
    id: 'subagents',
    label: 'Subagents',
    content: SubagentsV2,
    searchPlaceholder: 'Search subagents',
    create: { label: 'Create Subagent', path: '/ai/library/subagent/create' },
  },
  {
    id: 'skills',
    label: 'Skills',
    content: SkillsV2,
    searchPlaceholder: 'Search skills',
    create: { label: 'Create Skill', path: '/ai/library/skill/create' },
  },
  {
    id: 'mcp',
    label: 'MCP',
    content: McpV2,
    searchPlaceholder: 'Search MCP servers',
    create: null,
  },
  {
    id: 'apps',
    label: 'Apps',
    content: AppsV2,
    searchPlaceholder: 'Search apps',
    // Apps are created by saving one out of a chat, never from a blank form.
    create: null,
  },
] as const satisfies readonly LibraryTab[];

/** Params owned by a tab — cleared on switch so filters never leak across tabs. */
const TAB_SCOPED_PARAMS = ['q', 'category', 'source'];

const LibraryV2 = (): ReactElement => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  // Every app route lives under `/:workspaceId`, so the create targets below
  // have to carry the prefix when we're inside a workspace.
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const [searchParams, setSearchParams] = useSearchParams();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const rawTab = searchParams.get('tab');
  const activeTab = LIBRARY_TABS.find(t => t.id === rawTab) ?? LIBRARY_TABS[0];
  const TabContent = activeTab.content;

  const query = searchParams.get('q') ?? '';
  const [searchOpen, setSearchOpen] = useState(query.length > 0);

  const setQuery = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const setActiveTab = (id: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    for (const param of TAB_SCOPED_PARAMS) next.delete(param);
    setSearchOpen(false);
    setSearchParams(next);
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
    <div className='max-w-ai-content mx-auto flex w-full flex-col px-6 pb-16'>
      <div className='bg-background sticky top-0 z-10 flex flex-col'>
        <div className='flex items-center gap-5 pt-5'>
          <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
            <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
              Agent Hub
            </h1>
            <p className='text-[15px] leading-[1.2] text-muted-foreground'>
              View and manage agents, subagent, skills and MCP.
            </p>
          </div>
          {activeTab.create && (
            <Button
              type='button'
              className='shrink-0'
              onClick={() => void navigate(prefixWs(activeTab.create.path))}
              data-track-category='Claw Agents'
              data-track-name={activeTab.create.label}
            >
              <PlusDefault className='size-4' />
              {activeTab.create.label}
            </Button>
          )}
        </div>

        <div className='mt-3 flex flex-col gap-5 pb-3 pt-2'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-start gap-1'>
              {LIBRARY_TABS.map(tab => (
                <button
                  key={tab.id}
                  type='button'
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={tab.id === activeTab.id ? 'page' : undefined}
                  data-track-category='Claw Agents'
                  data-track-name={`Library tab: ${tab.label}`}
                  className={cn(
                    'flex h-8 items-center justify-center rounded-[10px] px-3 py-1 text-sm transition-colors',
                    tab.id === activeTab.id
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className='flex items-center justify-center gap-1.5'>
              <button
                type='button'
                onClick={toggleSearch}
                aria-label={activeTab.searchPlaceholder}
                aria-expanded={searchOpen}
                className={cn(
                  'flex size-7 items-center justify-center rounded-[10px] transition-colors hover:bg-muted',
                  searchOpen ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
                data-track-category='Claw Agents'
                data-track-name='Toggle library search'
              >
                <SearchDefault className='size-4' />
              </button>
              <div ref={setToolbarSlot} className='flex items-center' />
            </div>
          </div>

          {searchOpen && (
            <div className='relative'>
              <SearchDefault className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
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
                data-track-category='Claw Agents'
                data-track-name='Search library'
                placeholder={activeTab.searchPlaceholder}
                className='h-9 w-full rounded-[10px] border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          )}
        </div>
      </div>

      <LibraryToolbarSlotProvider value={toolbarSlot}>
        <div className='mt-5'>
          <TabContent key={activeTab.id} query={query} />
        </div>
      </LibraryToolbarSlotProvider>
    </div>
  );
};

export default LibraryV2;
