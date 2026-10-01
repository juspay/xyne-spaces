import type { ReactElement } from 'react';
import { ThreeDotsMenuVertical } from '@xyne/icons';
import { DraftAgentAvatar } from '@/components/flowUI/nodes/agent/create/DraftAgentAvatar';
import type { SavedAgentDraft } from '@/components/flowUI/nodes/agent/create/agentCreateDraftStorage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime } from '@/utils/dateUtils';
import { LibraryCard } from '../shared/components/LibraryCard';
import { Pill } from '../shared/primitives/Pill';

/** A saved create-canvas draft in Agent Hub: opens back into Create Agent. */
export function AgentDraftCard({
  draft,
  to,
  onDelete,
}: {
  draft: SavedAgentDraft;
  to: string;
  onDelete: () => void;
}): ReactElement {
  const { form } = draft;
  const name = form.name.trim() || 'Untitled agent';
  const about = form.description.trim() || form.systemPrompt.trim().split('\n')[0]?.trim() || '';
  const edited = `Edited ${formatRelativeTime(draft.savedAt)}`;

  return (
    <div className='group/draft relative' data-testid='agent-draft-card' data-draft-id={draft.id}>
      <LibraryCard
        to={to}
        variant='flat'
        icon={<DraftAgentAvatar form={form} size={44} />}
        name={name}
        meta={<Pill tone='neutral'>Draft</Pill>}
        description={about ? `${edited} · ${about}` : edited}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${name} options`}
          data-testid='agent-draft-menu'
          className='absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/draft:opacity-100 data-[state=open]:opacity-100'
        >
          <ThreeDotsMenuVertical className='size-4' aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' sideOffset={4}>
          <DropdownMenuItem
            onSelect={onDelete}
            className='text-destructive focus:text-destructive'
            data-track-category='Claw Agents'
            data-track-name='Agent Hub: delete draft'
          >
            Delete draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
