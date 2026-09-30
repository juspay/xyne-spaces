import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { V2Dialog } from '../../../shared/primitives/V2Dialog';
import { AgentActivityTabV2 } from '../activity/AgentActivityTabV2';
import { AgentBehaviourTabV2 } from '../behaviour/AgentBehaviourTabV2';
import { AgentCallGraphTabV2 } from '../callGraph/AgentCallGraphTabV2';
import { AGENT_SETTINGS_TABS, type AgentSettingsTabId } from '../detailTabs';
import { AgentMemorySection } from '../knowledge/AgentMemorySection';
import { isDigitalTwin } from '../knowledge/agentMemoryService';
import { AgentPeopleTabV2 } from '../people/AgentPeopleTabV2';
import { AgentPersonaTabV2 } from '../persona/AgentPersonaTabV2';
import type { AgentDetailActions } from '../useAgentDetailActions';
import { draftConfigTarget, useSavedAgentConfig } from './agentConfigTarget';

interface ShellProps {
  open: boolean;
  onClose: () => void;
  tabs: ReadonlyArray<{ id: AgentSettingsTabId; label: string }>;
  tab: AgentSettingsTabId;
  onTabChange: (tab: AgentSettingsTabId) => void;
  children: ReactNode;
}

/**
 * A modal over the profile (or the create page): the tab pills stay pinned
 * under the title while the tab scrolls. Fixed height, so switching tabs
 * doesn't make the dialog jump.
 */
function SettingsShell({
  open,
  onClose,
  tabs,
  tab,
  onTabChange,
  children,
}: ShellProps): ReactElement {
  return (
    <V2Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      title='Settings'
      description="The agent's model, behaviour, members and activity"
      testId='agent-settings-dialog'
      width='wide'
      className='h-[min(85vh,720px)]'
    >
      <div
        className='sticky top-0 z-10 -mx-[22px] flex flex-wrap items-center gap-1 bg-card px-[22px] pb-3'
        role='tablist'
      >
        {tabs.map(entry => (
          <button
            key={entry.id}
            type='button'
            role='tab'
            aria-selected={entry.id === tab}
            onClick={() => onTabChange(entry.id)}
            data-track-category='Claw Agents'
            data-track-name={`Agent settings tab: ${entry.label}`}
            className={cn(
              'flex h-8 items-center justify-center rounded-[10px] px-3 py-1 text-sm transition-colors',
              entry.id === tab
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className='flex w-full flex-col pb-4'>{children}</div>
    </V2Dialog>
  );
}

interface SavedAgentSettingsProps {
  open: boolean;
  onClose: () => void;
  agent: Agent;
  actions: AgentDetailActions;
  tab: AgentSettingsTabId;
  onTabChange: (tab: AgentSettingsTabId) => void;
  /** A prompt version was restored: the profile's instructions show it. */
  onPromptRestored: (systemPrompt: string) => void;
}

/** Settings of a saved agent. Every change is saved as it is made. */
export function SavedAgentSettings({
  open,
  onClose,
  agent,
  actions,
  tab,
  onTabChange,
  onPromptRestored,
}: SavedAgentSettingsProps): ReactElement {
  const target = useSavedAgentConfig(agent);
  const canEdit = actions.permissions?.canEdit ?? false;
  const canManage = actions.isOwner || actions.isAdmin;
  // Delegation approvals spend the callee's credentials and quota, so the
  // inbox is the owner's (or an admin's) — mirrors claw's canManageRequests.
  const tabs = AGENT_SETTINGS_TABS.filter(
    entry =>
      (!entry.ownerOnly || canManage) && (entry.id !== 'memory' || !isDigitalTwin(agent.slug)),
  );
  const active = tabs.some(entry => entry.id === tab) ? tab : 'persona';

  return (
    <SettingsShell open={open} onClose={onClose} tabs={tabs} tab={active} onTabChange={onTabChange}>
      {active === 'persona' ? (
        <AgentPersonaTabV2
          target={target}
          canEdit={canEdit}
          saved={{ slug: agent.slug, canManageCredentials: canManage, onPromptRestored }}
        />
      ) : active === 'behaviour' ? (
        <AgentBehaviourTabV2 target={target} canEdit={canEdit} />
      ) : active === 'memory' ? (
        <AgentMemorySection agent={agent} canEdit={canEdit} />
      ) : active === 'people' ? (
        <AgentPeopleTabV2 agent={agent} actions={actions} />
      ) : active === 'call-graph' ? (
        <AgentCallGraphTabV2 agent={agent} />
      ) : (
        <AgentActivityTabV2 agent={agent} canEdit={canEdit} />
      )}
    </SettingsShell>
  );
}

interface DraftAgentSettingsProps {
  open: boolean;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  tab: AgentSettingsTabId;
  onTabChange: (tab: AgentSettingsTabId) => void;
  disabled?: boolean;
}

/**
 * Settings of the agent being created. Model and behaviour are kept in the
 * draft and saved with the agent; members, runs, memory and delegation only
 * exist once it does, so those tabs appear on its profile.
 */
export function DraftAgentSettings({
  open,
  onClose,
  config,
  onConfigChange,
  tab,
  onTabChange,
  disabled = false,
}: DraftAgentSettingsProps): ReactElement {
  const target = draftConfigTarget(config, onConfigChange);
  const tabs = AGENT_SETTINGS_TABS.filter(entry => !entry.savedOnly);
  const active = tabs.some(entry => entry.id === tab) ? tab : 'persona';

  return (
    <SettingsShell open={open} onClose={onClose} tabs={tabs} tab={active} onTabChange={onTabChange}>
      {active === 'behaviour' ? (
        <AgentBehaviourTabV2 target={target} canEdit={!disabled} />
      ) : (
        <AgentPersonaTabV2 target={target} canEdit={!disabled} />
      )}
      <p className='pt-8 text-xs leading-5 text-muted-foreground'>
        Members, memory, activity and call graph are set up once the agent is saved.
      </p>
    </SettingsShell>
  );
}
