import { useEffect, useLayoutEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Search } from '@/components/ClawAgents/digitalTwin/icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { AgentBehaviourTabV2 } from '@/routes/AIScreen/library/agents/detail/behaviour/AgentBehaviourTabV2';
import { AgentKnowledgeTabV2 } from '@/routes/AIScreen/library/agents/detail/knowledge/AgentKnowledgeTabV2';
import { AgentPeopleTabV2 } from '@/routes/AIScreen/library/agents/detail/people/AgentPeopleTabV2';
import { AgentPersonaTabV2 } from '@/routes/AIScreen/library/agents/detail/persona/AgentPersonaTabV2';
import { AgentToolsTabV2 } from '@/routes/AIScreen/library/agents/detail/tools/AgentToolsTabV2';
import {
  AGENT_DETAIL_TABS,
  type AgentDetailTab,
} from '@/routes/AIScreen/library/agents/detail/detailTabs';
import { useAgentDetailActions } from '@/routes/AIScreen/library/agents/detail/useAgentDetailActions';

const DETAILS_SECTIONS = AGENT_DETAIL_TABS.filter(tab => tab.id !== 'activity');

/** Extra terms so search finds a section by common field names, not only its title. */
const SECTION_SEARCH_TERMS: Record<string, readonly string[]> = {
  persona: ['persona', 'name', 'description', 'prompt', 'model', 'voice', 'identity'],
  behaviour: ['behaviour', 'behavior', 'sandbox', 'research', 'response', 'tone'],
  tools: ['tools', 'mcp', 'builtin', 'subagent', 'capabilities'],
  knowledge: ['knowledge', 'skills', 'memory', 'collections', 'files'],
  people: ['people', 'members', 'shares', 'contributors', 'access', 'permissions'],
};

const sectionMatchesSearch = (tab: AgentDetailTab, query: string): boolean => {
  if (!query) return true;
  const haystack = [tab.label, ...(SECTION_SEARCH_TERMS[tab.id] ?? [])].join(' ').toLowerCase();
  return haystack.includes(query);
};

const DigitalTwinPersonaTab = (): ReactElement => {
  const { data: agent, isLoading, isError, error, refetch } = useClawAgentDetail('digital-twin');
  const actions = useAgentDetailActions(agent);
  // Twin is personal to the signed-in user — unlock edit/credentials even
  // though the underlying agent row is a shared platform slug.
  const canEdit = actions.permissions?.canEdit ?? true;
  const canManageCredentials = true;
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setControlsHost(document.getElementById('digital-twin-route-controls'));
  }, []);

  useEffect((): (() => void) => {
    const timer = window.setTimeout((): void => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const visibleSections = useMemo(
    () => DETAILS_SECTIONS.filter(tab => sectionMatchesSearch(tab, debouncedSearch)),
    [debouncedSearch],
  );

  const controls = (
    <div className='flex h-9 w-full items-center gap-4 rounded-[10px] bg-foreground/[0.04] pl-2.5 pr-1'>
      <label
        htmlFor='digital-twin-details-search'
        className='relative flex h-full min-w-0 flex-1 items-center'
      >
        <span className='sr-only'>Search details</span>
        <Search className='pointer-events-none absolute left-0 top-1/2 z-10 size-4 -translate-y-1/2 text-foreground/40' />
        <Input
          id='digital-twin-details-search'
          type='search'
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder='Search'
          className='h-full border-0 bg-transparent pl-6 pr-0 text-sm font-medium tracking-[-0.02em] shadow-none placeholder:text-foreground/40 focus-visible:border-0 focus-visible:ring-0'
          data-track-category='Claw Agents'
          data-track-name='Digital Twin search details'
        />
      </label>
    </div>
  );

  if (isLoading) {
    return (
      <>
        {controlsHost && createPortal(controls, controlsHost)}
        <div className='flex flex-col gap-6'>
          <Skeleton className='h-5 w-2/3' />
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className='h-32 w-full rounded-2xl' />
          ))}
        </div>
      </>
    );
  }

  if (isError || !agent) {
    return (
      <>
        {controlsHost && createPortal(controls, controlsHost)}
        <div role='alert' className='rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
          <p className='text-sm font-semibold text-destructive'>Agent details did not load.</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            {error?.message ?? 'The Digital Twin agent could not be loaded.'}
          </p>
          <Button variant='outline' size='sm' className='mt-3' onClick={() => void refetch()}>
            <RefreshCw className='size-4' />
            Try again
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {controlsHost && createPortal(controls, controlsHost)}
      <div className='flex flex-col gap-10'>
        {visibleSections.length === 0 ? (
          <div className='flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 py-12 text-center'>
            <p className='text-sm font-semibold text-foreground'>No details matched</p>
            <p className='mt-1 max-w-[48ch] text-sm text-muted-foreground'>
              Try a different search, or clear it to see Persona, Behaviour, Tools, Knowledge, and
              People.
            </p>
            <Button
              variant='outline'
              size='sm'
              className='mt-4'
              onClick={() => setSearch('')}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin clear details search'
            >
              Clear search
            </Button>
          </div>
        ) : (
          visibleSections.map(tab => (
            <section key={tab.id}>
              <h2 className='text-lg font-semibold text-foreground'>{tab.label}</h2>
              <div className='mt-4'>
                {tab.id === 'persona' ? (
                  <AgentPersonaTabV2
                    agent={agent}
                    canEdit={canEdit}
                    canManageCredentials={canManageCredentials}
                  />
                ) : tab.id === 'behaviour' ? (
                  <AgentBehaviourTabV2 agent={agent} canEdit={canEdit} />
                ) : tab.id === 'tools' ? (
                  <AgentToolsTabV2 agent={agent} canEdit={canEdit} />
                ) : tab.id === 'knowledge' ? (
                  <AgentKnowledgeTabV2 agent={agent} canEdit={canEdit} />
                ) : (
                  <AgentPeopleTabV2 agent={agent} actions={actions} />
                )}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
};

export default DigitalTwinPersonaTab;
