import { ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThreadMessages from '../../components/Chat/ThreadPannel';
import ConversationPanelV2 from '../../components/Chat/ConversationPannel/ConversationPanelV2';
import EntityList from '../../components/Entities/EntityList';
import EntityMessages, { type SelectedPanel } from '../../components/Entities/EntityMessages';
import type { EntityListItem } from '../../api/entitiesApi';

/**
 * Entity review.
 *
 * Three panes: the extraction registry, the threads an entity was found in, and the
 * conversation itself. The third pane mirrors SearchResultsSidePanel
 * (SearchResults.tsx:1642) — `ThreadMessages` for a conversation with replies,
 * `ConversationPanelV2` for a standalone message — so opening something here
 * behaves exactly as it does on the full search screen.
 */
const EntitiesScreen = (): ReactElement => {
  const [selected, setSelected] = useState<EntityListItem | null>(null);
  const [panel, setPanel] = useState<SelectedPanel | null>(null);
  const navigate = useNavigate();

  const selectEntity = (entity: EntityListItem): void => {
    setSelected(entity);
    // The open conversation belongs to the previous entity; keeping it would leave
    // the panel showing something unrelated to the new selection.
    setPanel(null);
  };

  return (
    <div
      data-testid='entities-page'
      className='h-full bg-background md:rounded-2xl overflow-hidden shadow-md'
    >
      {/* min-h-0 is load-bearing: grid items default to `min-height: auto`, so
          without it the row grows to fit its content, the panes' overflow-y-auto
          never gets a bounded height, and nothing can scroll. */}
      <div
        className={`grid grid-cols-1 h-full min-h-0 ${
          panel
            ? 'md:grid-cols-[280px_minmax(0,1fr)_minmax(0,1.2fr)]'
            : 'md:grid-cols-[320px_minmax(0,1fr)]'
        }`}
      >
        <EntityList selectedId={selected?.id ?? null} onSelect={selectEntity} />

        {selected ? (
          <EntityMessages key={selected.id} entity={selected} onSelectPanel={setPanel} />
        ) : (
          <div className='hidden md:flex items-center justify-center text-sm text-muted-foreground'>
            Select an entity to review the threads it was extracted from.
          </div>
        )}

        {panel && (
          <div className='hidden md:flex flex-col min-h-0 border-l border-border'>
            {panel.kind === 'thread' ? (
              <ThreadMessages
                channelId={panel.channelId}
                conversationId={panel.conversationId}
                matchedMessageId={panel.matchedMessageId}
                showChannelLink
                onChannelLinkClick={() =>
                  void navigate(`/chat/dir/${panel.channelId}#origin=${panel.conversationId}`)
                }
                onClose={() => setPanel(null)}
              />
            ) : (
              <ConversationPanelV2
                channelId={panel.channelId}
                previousChannelId={null}
                linkedConversationIdOverride={panel.conversationId}
                linkedItemCreatedAtOverride={panel.conversationCreatedAt ?? null}
                onClose={() => setPanel(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EntitiesScreen;
