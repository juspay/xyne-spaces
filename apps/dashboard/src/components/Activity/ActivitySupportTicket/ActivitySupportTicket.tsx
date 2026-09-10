import { ReactElement, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { SupportTicketDetail } from '../../../routes/SupportScreen/SupportScreen';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUserChannelStatuses } from '../../../hooks/useChannels';

const EMPTY_TICKET_FILTER = {
  assignedTo: undefined,
  createdBy: undefined,
  priority: undefined,
  stageName: undefined,
  aiCategory: undefined,
  conversationIdWhitelist: undefined,
  hasAiDraft: undefined,
  hasSubTickets: undefined,
  userGroups: undefined,
  lastEmailAtStart: undefined,
  lastEmailAtEnd: undefined,
  createdAtStart: undefined,
  createdAtEnd: undefined,
} as const;

/**
 * Renders a Support/Desk ticket detail INSIDE the Activity panel outlet, so
 * clicking a desk-channel mention in the Activity list keeps the list on the
 * left instead of navigating away to the full `/support` inbox.
 *
 * Two routes map here:
 *  - `ticket/:channelId`            — no ticket id yet; resolve it from the
 *    `?conversationId=` query (mirroring SupportScreen's deeplink effect), then
 *    redirect to the `:ticketId` form.
 *  - `ticket/:channelId/:ticketId`  — render `<SupportTicketDetail>` directly.
 */
const ActivitySupportTicket = (): ReactElement => {
  const navigate = useNavigate();
  const { workspaceId, channelId, ticketId } = useParams<{
    workspaceId?: string;
    channelId?: string;
    ticketId?: string;
  }>();

  const activityBase = `/${workspaceId ?? ''}/chat/activity`;
  const ticketBase = `${activityBase}/ticket`;

  const userChannelStatuses = useUserChannelStatuses();
  const isMember = useMemo(
    () => !!channelId && userChannelStatuses.some(status => status.channelId === channelId),
    [userChannelStatuses, channelId],
  );
  const [channelPreferenceRows, channelPreferenceDetails] = useCachedQuery(
    queries.getEmailChannelPreference({ channelId: channelId || '' }),
    { enabled: !!channelId },
  );

  // No ticket id in the URL yet — resolve it from the conversation, then redirect.
  if (!ticketId) {
    return <ActivityTicketResolver channelId={channelId} ticketBase={ticketBase} />;
  }

  return (
    <SupportTicketDetail
      ticketFilter={EMPTY_TICKET_FILTER}
      isMember={isMember}
      onMailtoClick={email => window.open(`mailto:${email}`, '_blank', 'noopener,noreferrer')}
      channelPreference={channelPreferenceRows?.[0]}
      channelPreferenceLoaded={channelPreferenceDetails.type === 'complete'}
      navBasePath={ticketBase}
      onBack={() => {
        void navigate(activityBase);
      }}
    />
  );
};

/**
 * Resolves the ticket xyneId from a conversationId (the shape the Activity list
 * builds its link with) and redirects to the `:ticketId` route. Mirrors
 * SupportScreen's deeplink resolution effect.
 */
const ActivityTicketResolver = ({
  channelId,
  ticketBase,
}: {
  channelId: string | undefined;
  ticketBase: string;
}): ReactElement => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get('conversationId');
  const messageId = searchParams.get('messageId');

  const [conversation, conversationDetails] = useCachedQuery(
    queries.getConversationByIdWithChannel({
      conversationId: conversationId || '',
      channelId: channelId || '',
      isMember: true,
    }),
    { enabled: !!conversationId && !!channelId },
  );

  useEffect(() => {
    if (!channelId) return;

    // Pre-existing /support deeplink, used as a graceful fallback when an
    // embeddable ticket can't be resolved (no conversationId, or the
    // conversation has no linked ticket). Avoids spinning forever. The navigate
    // shim prefixes the workspace id.
    const supportFallback = `/support/${channelId}${
      conversationId
        ? `?conversationId=${conversationId}${messageId ? `&messageId=${messageId}` : ''}`
        : ''
    }`;

    // Nothing to resolve without a conversationId — go straight to the inbox.
    if (!conversationId) {
      void navigate(supportFallback, { replace: true });
      return;
    }

    const xyneId = conversation?.ticket?.xyneId;
    if (xyneId) {
      // Carry through all params except conversationId (moved to router state),
      // preserving messageId (deep-scroll) and selectedActivity (row highlight).
      const params = new URLSearchParams(searchParams);
      params.delete('conversationId');
      const qs = params.toString();
      void navigate(`${ticketBase}/${channelId}/${xyneId}${qs ? `?${qs}` : ''}`, {
        replace: true,
        state: {
          conversationId,
          ticketId: conversation?.ticket?.id,
        },
      });
      return;
    }

    // Query settled (complete or error) but no ticket resolved — fall back to
    // /support rather than spinning forever.
    if (conversationDetails.type !== 'unknown') {
      void navigate(supportFallback, { replace: true });
    }
  }, [
    conversation,
    conversationDetails,
    channelId,
    ticketBase,
    conversationId,
    messageId,
    searchParams,
    navigate,
  ]);

  return (
    <div className='h-full w-full flex items-center justify-center text-muted-foreground'>
      <Loader2 className='w-5 h-5 animate-spin' />
    </div>
  );
};

export default ActivitySupportTicket;
