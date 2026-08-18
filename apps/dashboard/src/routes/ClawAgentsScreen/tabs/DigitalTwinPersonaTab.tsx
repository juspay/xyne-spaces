import { useEffect, useLayoutEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { PencilEditLine } from '@xyne/icons';
import { RefreshCw, Search } from '@/components/ClawAgents/digitalTwin/icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/classNames';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { AgentBehaviourTabV2 } from '@/routes/AIScreen/library/agents/detail/behaviour/AgentBehaviourTabV2';
import { AgentKnowledgeChips } from '@/routes/AIScreen/library/agents/detail/knowledge/AgentKnowledgeChips';
import { useAgentKnowledge } from '@/routes/AIScreen/library/agents/detail/knowledge/useAgentKnowledge';
import { AgentPeopleTabV2 } from '@/routes/AIScreen/library/agents/detail/people/AgentPeopleTabV2';
import { CredentialsCard } from '@/routes/AIScreen/library/agents/detail/persona/credentials/CredentialsCard';
import { ModelCard } from '@/routes/AIScreen/library/agents/detail/persona/model/ModelCard';
import { AgentToolChips } from '@/routes/AIScreen/library/agents/detail/tools/AgentToolChips';
import { useAgentToolSelection } from '@/routes/AIScreen/library/agents/detail/tools/useAgentToolSelection';
import {
  AGENT_DETAIL_TABS,
  type AgentDetailTab,
} from '@/routes/AIScreen/library/agents/detail/detailTabs';
import { useAgentDetailActions } from '@/routes/AIScreen/library/agents/detail/useAgentDetailActions';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import {
  DetailGroup,
  DetailLockedNote,
  DetailSection,
  TWIN_STROKE_CLASS,
} from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';

const DETAILS_SECTIONS = AGENT_DETAIL_TABS.filter(tab => tab.id !== 'activity');

/** Extra terms so search finds a section by common field names, not only its title. */
const SECTION_SEARCH_TERMS: Record<string, readonly string[]> = {
  persona: ['persona', 'name', 'model', 'voice', 'identity', 'credentials'],
  behaviour: ['behaviour', 'behavior', 'sandbox', 'research', 'response', 'tone'],
  tools: ['tools', 'tools and knowledge', 'mcp', 'builtin', 'subagent', 'capabilities'],
  knowledge: ['knowledge', 'tools and knowledge', 'skills', 'memory', 'collections', 'files'],
  people: ['people', 'members', 'shares', 'contributors', 'access', 'permissions'],
};

const TWIN_SECTION_GAP = 'gap-4';

const TWIN_EDIT_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

const TwinToolsAndKnowledge = ({
  agent,
  canEdit,
}: {
  agent: Agent;
  canEdit: boolean;
}): ReactElement => {
  const tools = useAgentToolSelection(agent);
  const knowledge = useAgentKnowledge(agent);
  const [editing, setEditing] = useState(false);
  const chipsEditable = canEdit && editing;

  const toggleEditing = (): void => {
    if (editing) {
      tools.closeManage();
      knowledge.closeBrowse();
      setEditing(false);
      return;
    }
    setEditing(true);
  };

  return (
    <DetailSection
      heading='title'
      typeScale='twin'
      label='Tools and Knowledge'
      className={TWIN_SECTION_GAP}
      {...(canEdit
        ? {
            trailing: (
              <button
                type='button'
                onClick={toggleEditing}
                aria-label={
                  editing ? 'Done editing tools and knowledge' : 'Edit tools and knowledge'
                }
                aria-pressed={editing}
                data-track-category='Claw Agents'
                data-track-name={
                  editing
                    ? 'Digital Twin configuration: done tools and knowledge'
                    : 'Digital Twin configuration: edit tools and knowledge'
                }
                className={
                  editing
                    ? 'h-7 shrink-0 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    : TWIN_EDIT_BUTTON
                }
              >
                {editing ? 'Done' : <PencilEditLine className='size-4' aria-hidden />}
              </button>
            ),
            trailingAlign: 'end' as const,
          }
        : {})}
    >
      <DetailGroup typeScale='twin' className='gap-8'>
        {!canEdit && (
          <DetailLockedNote>
            Only the owner, a contributor, or an admin can change this agent’s tools and knowledge.
          </DetailLockedNote>
        )}
        <AgentToolChips
          canEdit={chipsEditable}
          tools={tools}
          trackName='Digital Twin configuration'
          showAdd={chipsEditable}
        />
        <AgentKnowledgeChips
          canEdit={chipsEditable}
          knowledge={knowledge}
          trackName='Digital Twin configuration'
          showAdd={chipsEditable}
        />
      </DetailGroup>
    </DetailSection>
  );
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

  const visibility = useMemo(() => {
    const matches = (id: AgentDetailTab['id']): boolean => {
      const tab = DETAILS_SECTIONS.find(entry => entry.id === id);
      return tab !== undefined && sectionMatchesSearch(tab, debouncedSearch);
    };
    return {
      persona: matches('persona'),
      behaviour: matches('behaviour'),
      toolsAndKnowledge: matches('tools') || matches('knowledge'),
      people: matches('people'),
    };
  }, [debouncedSearch]);

  const hasVisible =
    visibility.persona || visibility.behaviour || visibility.toolsAndKnowledge || visibility.people;

  const controls = (
    <div className='flex h-9 w-full items-center gap-4 rounded-[10px] bg-foreground/[0.04] pl-2.5 pr-1'>
      <label
        htmlFor='digital-twin-configuration-search'
        className='relative flex h-full min-w-0 flex-1 items-center'
      >
        <span className='sr-only'>Search configuration</span>
        <Search className='pointer-events-none absolute left-0 top-1/2 z-10 size-4 -translate-y-1/2 text-foreground/40' />
        <Input
          id='digital-twin-configuration-search'
          type='search'
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder='Search'
          className='h-full border-0 bg-transparent pl-6 pr-0 text-sm font-medium tracking-[-0.02em] shadow-none placeholder:text-foreground/40 focus-visible:border-0 focus-visible:ring-0'
          data-track-category='Claw Agents'
          data-track-name='Digital Twin search configuration'
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
      <div className='flex flex-col gap-10 pt-4'>
        {!hasVisible ? (
          <div
            className={cn(
              'flex min-h-48 flex-col items-center justify-center rounded-xl bg-muted/20 px-8 py-12 text-center',
              TWIN_STROKE_CLASS,
              'border-dashed',
            )}
          >
            <p className='text-sm font-semibold text-foreground'>No configuration matched</p>
            <p className='mt-1 max-w-[48ch] text-sm text-muted-foreground'>
              Try a different search, or clear it to see Model, Credentials, Behaviour, Tools and
              Knowledge, and People.
            </p>
            <Button
              variant='outline'
              size='sm'
              className='mt-4'
              onClick={() => setSearch('')}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin clear configuration search'
            >
              Clear search
            </Button>
          </div>
        ) : (
          <>
            {visibility.persona && (
              <>
                <section>
                  <ModelCard
                    agent={agent}
                    canEdit={canEdit}
                    className={TWIN_SECTION_GAP}
                    heading='title'
                    typeScale='twin'
                  />
                </section>
                <section>
                  <CredentialsCard
                    slug={agent.slug}
                    canRead={canEdit}
                    canManage={canManageCredentials}
                    className={TWIN_SECTION_GAP}
                    heading='title'
                    typeScale='twin'
                  />
                </section>
              </>
            )}
            {visibility.behaviour && (
              <section>
                <AgentBehaviourTabV2
                  agent={agent}
                  canEdit={canEdit}
                  className={TWIN_SECTION_GAP}
                  heading='title'
                  typeScale='twin'
                />
              </section>
            )}
            {visibility.toolsAndKnowledge && (
              <section>
                <TwinToolsAndKnowledge agent={agent} canEdit={canEdit} />
              </section>
            )}
            {visibility.people && (
              <section>
                <AgentPeopleTabV2
                  agent={agent}
                  actions={actions}
                  className={TWIN_SECTION_GAP}
                  heading='title'
                  typeScale='twin'
                />
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default DigitalTwinPersonaTab;
