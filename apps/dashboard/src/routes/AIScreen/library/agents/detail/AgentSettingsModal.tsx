import { useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { V2Dialog } from '../../shared/primitives/V2Dialog';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentDetailActions } from './useAgentDetailActions';
import { AgentBehaviourTabV2 } from './behaviour/AgentBehaviourTabV2';
import { AgentPeopleTabV2 } from './people/AgentPeopleTabV2';
import { AgentCallGraphTabV2 } from './callGraph/AgentCallGraphTabV2';
import { AgentActivityTabV2 } from './activity/AgentActivityTabV2';
import { ModelCard } from './persona/model/ModelCard';
import { CredentialsCard } from './persona/credentials/CredentialsCard';
import { AgentPromptVersions } from './persona/AgentPromptVersions';

type SectionId = 'model' | 'behaviour' | 'people' | 'call-graph' | 'activity' | 'versions';

interface Section {
  id: SectionId;
  label: string;
  ownerOnly?: boolean;
}

const SECTIONS: readonly Section[] = [
  { id: 'model', label: 'Model' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'people', label: 'People' },
  { id: 'call-graph', label: 'Call graph', ownerOnly: true },
  { id: 'activity', label: 'Activity' },
  { id: 'versions', label: 'Version history' },
];

export function AgentSettingsModal({
  open,
  onOpenChange,
  agent,
  actions,
  canEdit,
  canManageDelegation,
  onPromptRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: Agent;
  actions: AgentDetailActions;
  canEdit: boolean;
  canManageDelegation: boolean;
  onPromptRestored?: ((restored: string) => void) | undefined;
}): ReactElement {
  const [section, setSection] = useState<SectionId>('model');
  const visible = SECTIONS.filter(entry => !entry.ownerOnly || canManageDelegation);
  const active = visible.some(entry => entry.id === section) ? section : 'model';

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Agent settings'
      description={`Model, access and history for @${agent.slug}.`}
      testId='agent-settings-modal'
      width='wide'
      className='max-w-[900px]'
    >
      <div className='flex h-[min(70vh,640px)] w-full min-h-0 gap-6'>
        <nav className='flex w-[164px] shrink-0 flex-col gap-0.5'>
          {visible.map(entry => (
            <button
              key={entry.id}
              type='button'
              onClick={() => setSection(entry.id)}
              aria-current={entry.id === active ? 'page' : undefined}
              data-track-category='Claw Agents'
              data-track-name={`Agent settings: ${entry.label}`}
              className={cn(
                'flex h-8 items-center rounded-lg px-3 text-left text-sm transition-colors',
                entry.id === active
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
          {active === 'model' ? (
            <div className='flex flex-col gap-6'>
              <ModelCard agent={agent} canEdit={canEdit} />
              <CredentialsCard
                slug={agent.slug}
                canRead={canEdit}
                canManage={actions.isOwner || actions.isAdmin}
              />
            </div>
          ) : active === 'behaviour' ? (
            <AgentBehaviourTabV2 agent={agent} canEdit={canEdit} />
          ) : active === 'people' ? (
            <AgentPeopleTabV2 agent={agent} actions={actions} />
          ) : active === 'call-graph' ? (
            <AgentCallGraphTabV2 agent={agent} />
          ) : active === 'activity' ? (
            <AgentActivityTabV2 agent={agent} canEdit={canEdit} />
          ) : (
            <AgentPromptVersions
              agentSlug={agent.slug}
              canRestore={canEdit}
              onRestored={onPromptRestored ?? ((): void => {})}
            />
          )}
        </div>
      </div>
    </V2Dialog>
  );
}
