import { type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { KnowledgeBasePicker } from '@/components/ClawAgents/KnowledgeBasePicker/KnowledgeBasePicker';
import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import { BrowseDialog } from '../../primitives/BrowseDialog';
import type { KbScope } from './knowledgeCatalog';

const SCOPES: ReadonlyArray<{ value: KbScope; label: string; hint: string }> = [
  {
    value: 'COLLECTIONS',
    label: 'Selected collections & files',
    hint: 'Pick an explicit allowlist. Same scope for everyone.',
  },
  {
    value: 'USER',
    label: 'Match my access',
    hint: "Inherits the running user's spaces access — per session.",
  },
];

interface BrowseKnowledgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: KbScope;
  onScopeChange: (next: KbScope) => void;
  grants: KbSelection[];
  onGrantsChange: (next: KbSelection[]) => void;
}

export function BrowseKnowledgeDialog({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  grants,
  onGrantsChange,
}: BrowseKnowledgeDialogProps): ReactElement {
  return (
    <BrowseDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Browse knowledge'
      description='Choose what reference material this agent can read.'
      testId='browse-knowledge-dialog'
      loading={false}
      isError={false}
      onRetry={() => undefined}
      emptyMessage={null}
      toolbar={
        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          {SCOPES.map(option => {
            const selected = scope === option.value;
            return (
              <button
                key={option.value}
                type='button'
                onClick={() => onScopeChange(option.value)}
                aria-pressed={selected}
                data-track-category='Claw Agents'
                data-track-name='Create agent v2: set KB scope'
                className={cn(
                  'flex flex-col items-start gap-1 rounded-[10px] border p-2.5 text-left transition-colors',
                  selected
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/50',
                )}
              >
                <span className='text-sm font-semibold leading-5 text-foreground'>
                  {option.label}
                </span>
                <span className='text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>
      }
    >
      {scope === 'USER' ? (
        <p className='px-2.5 py-8 text-center text-sm leading-5 text-muted-foreground'>
          This agent will read whatever the person running it can already see in Spaces. No
          collections to pick.
        </p>
      ) : (
        <KnowledgeBasePicker value={grants} onChange={onGrantsChange} />
      )}
    </BrowseDialog>
  );
}
