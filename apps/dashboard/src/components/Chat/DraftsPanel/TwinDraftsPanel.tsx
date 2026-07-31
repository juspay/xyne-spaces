import { type ReactElement, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../../../machines/stateMachine';
import type { Conversation } from '@xyne/shared';
import { formatDistanceToNow } from 'date-fns';
import { MessageCard, RecipientAvatar, useRecipientName } from '../MessageCard';
import { rowToTwinReplyDraftView } from '../TwinReplyDraft/twinReplyDraftApi';

/** The subset of a twin draft row this panel needs (structural, so it doesn't
 *  depend on the opaque Zero-derived `TwinDraftDB` alias). */
interface TwinDraftItem {
  id: string;
  channelId: string;
  conversationId?: string | null;
  createdAt: number;
  metadata?: unknown;
}

/**
 * A row for one pending Digital Twin proposal in the Drafts & Sent page. Unlike a
 * user draft it isn't sent/edited/deleted from here — clicking opens the thread,
 * where the in-composer dock lets the owner review + approve/decline it.
 */
const TwinDraftRow = ({ draft }: { draft: TwinDraftItem }): ReactElement => {
  const navigate = useNavigate();
  const view = rowToTwinReplyDraftView(draft);

  // avatarHelpers only access conversation?.channelId, so a partial object is safe
  const channelRef = { channelId: draft.channelId } as Conversation;
  const recipientName = useRecipientName(null, channelRef);
  const displayName = draft.conversationId ? `${recipientName} · thread` : recipientName;

  const preview =
    view?.action === 'react'
      ? `Reacts ${view.emoji ?? ''}`.trim()
      : view?.message?.trim() || '(no message)';
  const timestamp = formatDistanceToNow(new Date(draft.createdAt), { addSuffix: true });

  const handleClick = (): void => {
    void navigate(
      draft.conversationId
        ? `/chat/dir/${draft.channelId}/${draft.conversationId}#origin=${draft.conversationId}`
        : `/chat/dir/${draft.channelId}`,
    );
  };

  return (
    <MessageCard
      recipientAvatar={<RecipientAvatar conversation={channelRef} />}
      recipientName={displayName}
      contentPreview={
        <span className='inline-flex items-center gap-1.5'>
          <Sparkles size={12} className='shrink-0 text-muted-foreground' />
          {preview}
        </span>
      }
      timestamp={timestamp}
      className='rounded-xl'
      onClick={handleClick}
      // Twin drafts are reviewed inside the thread (click opens it) — no inline row actions.
      actions={null}
    />
  );
};

// ─── Panel ────────────────────────────────────────────────────────────────────

const TwinDraftsPanel = (): ReactElement => {
  const twinDrafts = useSelector(stateMachineActor, state => state.context.twinDrafts);

  const items = useMemo<TwinDraftItem[]>(
    () => [...twinDrafts].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
    [twinDrafts],
  );

  return (
    <div className='flex-1 h-full flex flex-col overflow-hidden bg-background'>
      <div className='flex-1 overflow-y-auto p-6'>
        {items.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
            <Sparkles className='text-muted-foreground mb-4' size={48} />
            <p className='text-muted-foreground text-lg font-medium mb-2'>No twin drafts</p>
            <p className='text-muted-foreground text-sm max-w-md'>
              Replies the Digital Twin drafts for you, awaiting your approval, will appear here
            </p>
          </div>
        ) : (
          <Virtuoso<TwinDraftItem>
            data={items}
            className='h-full'
            style={{ height: '100%' }}
            computeItemKey={(_, item) => item.id}
            itemContent={(_, draft) => (
              <div className='mb-4 first:mt-1.5'>
                <TwinDraftRow draft={draft} />
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
};

TwinDraftsPanel.displayName = 'TwinDraftsPanel';

export default TwinDraftsPanel;
