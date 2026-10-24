import { ComponentType, ReactElement, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PlusDefault, SearchDefault } from '@xyne/icons';
import { X } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button/index';
import { Tooltip } from '@/components/ui/Tooltip';
import AgentsV2 from './agents/AgentsV2';
import SubagentsV2 from './subagents/SubagentsV2';
import SkillsV2 from './skills/SkillsV2';
import McpV2 from './mcp/McpV2';
import AppsV2 from './apps/AppsV2';
import DevelopersV2 from './developers/DevelopersV2';
import { LibraryToolbarSlotProvider } from './shared/components/LibraryToolbarSlot';
import { CreateAppDialog } from '@/routes/AppsMarketplaceScreen/CreateAppDialog';
import { CreateAgentDialog } from './agents/create/CreateAgentDialog';
import { AddHubAgentDialog } from './agents/AddHubAgentDialog';
import { Dialog } from '@/components/ui/Dialog/Dialog';
import { AddSkillList } from '@/routes/SdlcScreen/AddSkillList';

interface LibraryTab {
  id: string;
  label: string;
  content: ComponentType<{ query: string }>;
  searchPlaceholder: string;
  /** A page to go to, or `dialog` for a create flow that opens in place. */
  create: { label: string; path: string } | { label: string; dialog: 'app' } | null;
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
    create: { label: 'Create app', dialog: 'app' },
  },
  {
    id: 'developers',
    label: 'Developers',
    content: DevelopersV2,
    searchPlaceholder: 'Search developer tools',
    // Shipped products (the Spaces MCP and SDK), not something a user creates.
    create: null,
  },
] as const satisfies readonly LibraryTab[];

/** Params owned by a tab — cleared on switch so filters never leak across tabs. */
const TAB_SCOPED_PARAMS = ['q', 'category', 'source', 'hub'];

/** `channelId` scopes the hub to one SDLC hub's agents: its members plus agents pending approval. */
const LibraryV2 = ({
  channelId,
  addAgentBlockedReason = null,
}: {
  channelId?: string | undefined;
  addAgentBlockedReason?: string | null;
} = {}): ReactElement => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tabs = channelId ? LIBRARY_TABS.slice(0, 1) : LIBRARY_TABS;
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  // Every app route lives under `/:workspaceId`, so the create targets below
  // have to carry the prefix when we're inside a workspace.
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const [searchParams, setSearchParams] = useSearchParams();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [createAppOpen, setCreateAppOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const rawTab = searchParams.get('tab');
  const activeTab = tabs.find(t => t.id === rawTab) ?? LIBRARY_TABS[0];
  const createPath = (path: string): string =>
    channelId
      ? `${path}?${new URLSearchParams({ sdlcChannelId: channelId, returnTo: pathname })}`
      : path;
  const TabContent = activeTab.content;

  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [importSkillOpen, setImportSkillOpen] = useState(false);
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
    // Inside an SDLC hub it takes the hub pages' width; the AI screen keeps its own.
    <div
      className={cn(
        'mx-auto flex w-full flex-col pb-16',
        channelId ? 'max-w-6xl px-8' : 'max-w-ai-content px-6',
      )}
    >
      <div className='bg-background sticky top-0 z-10 flex flex-col'>
        <div className='flex items-center gap-5 pt-5'>
          <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
            <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
              Agent Hub
            </h1>
            <p className='text-[15px] leading-[1.2] text-muted-foreground'>
              {channelId && addAgentBlockedReason
                ? `${addAgentBlockedReason} You can still create agents for yourself.`
                : 'View and manage agents, subagent, skills and MCP.'}
            </p>
          </div>
          {activeTab.id === 'skills' && (
            <Button
              type='button'
              variant='outline'
              className='shrink-0'
              onClick={() => setImportSkillOpen(true)}
              data-track-category='Claw Agents'
              data-track-name='Import skill'
            >
              Import
            </Button>
          )}
          {channelId &&
            (addAgentBlockedReason ? (
              <Tooltip content={addAgentBlockedReason}>
                {/* A disabled button gets no hover or focus, so the wrapper carries the tooltip. */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- its tooltip must open from the keyboard */}
                <span className='shrink-0' tabIndex={0}>
                  <Button type='button' variant='outline' disabled>
                    Add agent
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                type='button'
                variant='outline'
                className='shrink-0'
                onClick={() => setAddAgentOpen(true)}
                data-track-category='Claw Agents'
                data-track-name='Add hub agent'
              >
                Add agent
              </Button>
            ))}
          {activeTab.create && (
            <Button
              type='button'
              className='shrink-0'
              onClick={() => {
                const { create } = activeTab;
                if (!create) return;
                if ('dialog' in create) setCreateAppOpen(true);
                else if (activeTab.id === 'agents') setCreateAgentOpen(true);
                else void navigate(prefixWs(createPath(create.path)));
              }}
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
              {tabs.map(tab => (
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
          {channelId ? (
            <AgentsV2 query={query} channelId={channelId} />
          ) : (
            <TabContent key={activeTab.id} query={query} />
          )}
        </div>
      </LibraryToolbarSlotProvider>

      <CreateAppDialog open={createAppOpen} onOpenChange={setCreateAppOpen} />
      <CreateAgentDialog
        open={createAgentOpen}
        onOpenChange={setCreateAgentOpen}
        // Linked to the hub only when its Add members rule allows: approval then adds it there.
        createPath={
          addAgentBlockedReason
            ? `${LIBRARY_TABS[0].create.path}?${new URLSearchParams({ returnTo: pathname })}`
            : createPath(LIBRARY_TABS[0].create.path)
        }
        note={
          !channelId
            ? undefined
            : addAgentBlockedReason
              ? `${addAgentBlockedReason} This agent will be yours only.`
              : 'It shows here as Pending approval, and joins this hub once a claw admin approves it.'
        }
      />
      {channelId && !addAgentBlockedReason && (
        <AddHubAgentDialog
          channelId={channelId}
          open={addAgentOpen}
          onOpenChange={setAddAgentOpen}
        />
      )}
      {/* The hub's Add existing skill dialog, without a hub: it only imports into your skills. */}
      <Dialog
        open={importSkillOpen}
        onOpenChange={setImportSkillOpen}
        title='Import skill'
        description='Import a skill from skills.sh or a GitHub repo.'
        className='max-w-2xl'
      >
        <div className='flex h-[min(560px,80vh)] max-h-[85vh] flex-col'>
          <div className='flex items-start gap-3 px-6 pb-4 pt-6'>
            <div className='min-w-0 flex-1'>
              <h2 className='text-lg font-semibold'>Import skill</h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                Import a skill from skills.sh or a GitHub repo.
              </p>
            </div>
            <button
              type='button'
              aria-label='Close'
              onClick={() => setImportSkillOpen(false)}
              data-track-category='Claw Agents'
              data-track-name='Import skill closed'
              className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            >
              <X size={15} />
            </button>
          </div>
          <div className='flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6'>
            {importSkillOpen && <AddSkillList />}
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default LibraryV2;
