import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { EntitySharePill } from './EntitySharePill';
import { MessageMetadata } from './MessageBubble.utils';

interface CallShareBubbleProps {
  message: {
    content: string;
    metadata: MessageMetadata | null;
  };
}

/**
 * The card posted when a regular call is shared to a channel or DM
 * (recordingSharingService.createRecordingPostMessage, `call_share_post`).
 *
 * The recordings counterpart is RecordingBubble, which also has to cover a live
 * anchor; a call is only ever shared once it's over, so this is the settled card
 * alone. Everything it renders is on the message, so no query on `calls` is needed
 * — and the share wrote an entity_access row, so anyone who can read the message
 * can open the call.
 */
export const CallShareBubble: React.FC<CallShareBubbleProps> = ({ message }) => {
  const navigate = useNavigate();

  const metadata = message.metadata;
  const title = message.content || 'Untitled Call';
  const durationMs = typeof metadata?.['durationMs'] === 'number' ? metadata['durationMs'] : null;
  const noteHtml =
    typeof metadata?.['messageContent'] === 'string' ? metadata['messageContent'] : null;
  // The detail route keys on `calls.id`, not the externalId the rest of the
  // metadata carries, so the share stamps it separately.
  const callRowId = typeof metadata?.['callRowId'] === 'string' ? metadata['callRowId'] : null;

  return (
    <div className='flex w-full max-w-lg flex-col gap-1'>
      {noteHtml && (
        <div className='jp-message-html whitespace-pre-wrap break-words text-sm text-foreground'>
          <RenderMessageWithHTML message={noteHtml} />
        </div>
      )}
      <EntitySharePill
        title={title}
        durationMs={durationMs}
        icon={<Phone size={13} strokeWidth={2.5} />}
        ariaLabel={`Open call ${title}`}
        onOpen={
          callRowId
            ? (): void => {
                void navigate(`/calls/${callRowId}/detail`);
              }
            : undefined
        }
        trackName='OPEN_SHARED_CALL'
      />
    </div>
  );
};
