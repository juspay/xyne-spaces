import { useState, type ReactElement } from 'react';
import { cn } from '../../../../../utils/classNames';
import { AgentPreviewKnowledgeTab } from './AgentPreviewKnowledgeTab';
import { AgentPreviewPersonaTab } from './AgentPreviewPersonaTab';
import { AgentPreviewToolsTab } from './AgentPreviewToolsTab';
import {
  AGENT_PREVIEW_TABS,
  type AgentPreviewTab,
  type AgentPreviewTabsProps,
} from './AgentPreviewTabs.types';

export function AgentPreviewTabs({ agent, editor }: AgentPreviewTabsProps): ReactElement {
  const [tab, setTab] = useState<AgentPreviewTab>('persona');

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex w-full items-center gap-1'>
        {AGENT_PREVIEW_TABS.map(entry => (
          <button
            key={entry.id}
            type='button'
            onClick={() => setTab(entry.id)}
            aria-current={entry.id === tab ? 'page' : undefined}
            data-track-category='Claw Agent Card'
            data-track-name={`Agent draft preview tab: ${entry.label}`}
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

      {tab === 'persona' && <AgentPreviewPersonaTab agent={agent} editor={editor} />}
      {tab === 'tools' && <AgentPreviewToolsTab agent={agent} editor={editor} />}
      {tab === 'knowledge' && <AgentPreviewKnowledgeTab agent={agent} />}
    </div>
  );
}
