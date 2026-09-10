import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button/Button';
import { standaloneNavigate } from '../../../utils/electronApp';
import { useRouteContext } from '../../../hooks/useRouteContext';

interface SurfaceNudgeResultProps {
  actionResult: Record<string, unknown> | null;
  channelId?: string | undefined;
}

export const SurfaceNudgeResult: React.FC<SurfaceNudgeResultProps> = ({
  actionResult,
  channelId,
}) => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();

  const normalized = useMemo(() => {
    if (!actionResult) return null;
    const actionType =
      (actionResult['actionType'] as string | undefined) ||
      (actionResult['action_type'] as string | undefined);
    const result =
      (actionResult['result'] as Record<string, unknown> | undefined) ||
      (actionResult['data'] as Record<string, unknown> | undefined) ||
      actionResult;
    return { actionType, result };
  }, [actionResult]);

  if (!normalized || !normalized.actionType) return null;

  // CREATE_TICKET_FROM_MESSAGE: show navigation to the created ticket
  if (normalized.actionType === 'CREATE_TICKET_FROM_MESSAGE') {
    const result = normalized.result ?? {};
    const entityId = typeof result['entityId'] === 'string' ? result['entityId'] : null;
    const targetChannelId =
      typeof result['channelId'] === 'string' ? result['channelId'] : (channelId ?? null);
    const conversationId =
      typeof result['conversationId'] === 'string' ? result['conversationId'] : null;

    if (!entityId || !targetChannelId) return null;

    return (
      <div className='mt-2 flex items-center justify-end'>
        <Button
          size='sm'
          onClick={() =>
            standaloneNavigate(
              navigate,
              `${baseRoute}/${targetChannelId}?tab=tickets&ticketId=${entityId}${
                conversationId ? `&conversationId=${conversationId}` : ''
              }`,
            )
          }
          data-track-category='NUDGES'
          data-track-name='OPEN_NUDGE_RESULT_CREATED_TICKET'
        >
          Open ticket
        </Button>
      </div>
    );
  }

  // OPEN_TICKET: show button to navigate to the ticket
  if (normalized.actionType === 'OPEN_TICKET') {
    const result = normalized.result ?? {};
    const entityId = typeof result['entityId'] === 'string' ? result['entityId'] : null;
    const targetChannelId =
      typeof result['channelId'] === 'string' ? result['channelId'] : (channelId ?? null);
    const conversationId =
      typeof result['conversationId'] === 'string' ? result['conversationId'] : null;

    if (!entityId || !targetChannelId) return null;

    return (
      <div className='mt-2 flex items-center justify-end'>
        <Button
          size='sm'
          onClick={() =>
            standaloneNavigate(
              navigate,
              `${baseRoute}/${targetChannelId}?tab=tickets&ticketId=${entityId}${
                conversationId ? `&conversationId=${conversationId}` : ''
              }`,
            )
          }
          data-track-category='NUDGES'
          data-track-name='OPEN_NUDGE_RESULT_TICKET'
        >
          Open ticket
        </Button>
      </div>
    );
  }

  // OPEN_RELATED_MESSAGE: show button to navigate to the related message
  if (normalized.actionType === 'OPEN_RELATED_MESSAGE') {
    const result = normalized.result ?? {};
    const entityId = typeof result['entityId'] === 'string' ? result['entityId'] : null;
    const targetChannelId =
      typeof result['channelId'] === 'string' ? result['channelId'] : (channelId ?? null);
    const conversationId =
      typeof result['conversationId'] === 'string' ? result['conversationId'] : null;

    if (!entityId || !targetChannelId) return null;

    return (
      <div className='mt-2 flex items-center justify-end'>
        <Button
          size='sm'
          onClick={() =>
            standaloneNavigate(
              navigate,
              conversationId
                ? `${baseRoute}/${targetChannelId}/${conversationId}${entityId ? `?messageId=${entityId}` : ''}`
                : `${baseRoute}/${targetChannelId}`,
            )
          }
          data-track-category='NUDGES'
          data-track-name='OPEN_NUDGE_RESULT_MESSAGE'
        >
          View message
        </Button>
      </div>
    );
  }

  return null;
};
