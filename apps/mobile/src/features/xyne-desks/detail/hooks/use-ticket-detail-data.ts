import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useUserChannelStatuses } from '@/src/hooks/useChannels';
import { queries } from '@/src/zero/queries';

import type { TicketDetailEmailSnapshot, TicketDetailSnapshot } from '../types';
import {
  emailAttachmentCount,
  getTicketDetailPaintCache,
  mapEmailRows,
  mapTicketDetail,
  mergeEmailLists,
  mergeTicketDetailEmails,
  normalizeEmailSnapshots,
  setTicketDetailPaintCache,
  ticketEmailsLookIncomplete,
  type EmailRowLike,
} from '../utils';

export type UseTicketDetailDataArgs = {
  channelId: string;
  /** URL path param — xyneId (dashboard parity). */
  xyneId: string;
  /** Optional internal ticket UUID from list navigation. */
  ticketUuid?: string | undefined;
};

export type UseTicketDetailDataReturn = {
  detail: TicketDetailSnapshot | null;
  isMember: boolean;
  isInitialLoading: boolean;
  isNotFound: boolean;
};

type BestEmails = {
  ticketId: string;
  emails: TicketDetailEmailSnapshot[];
};

/**
 * Single ticket + emails — local-first / optimistic.
 *
 * Lotus-specific gap vs dashboard:
 * Zero `related('emails')` can arrive as [] (mem kv + fallback→Zero latch),
 * while dashboard's warm persisted client usually already has email rows.
 * We therefore:
 * 1. Also query `getEmailsForTicket(conversationId)` (EmailsACL root query)
 * 2. Keep sticky "best emails" so an empty Zero handoff can't wipe the chain
 * 3. Avoid poisoning paint cache with incomplete (emailCount>0, emails:[]) snapshots
 */
export function useTicketDetailData({
  channelId,
  xyneId,
  ticketUuid,
}: UseTicketDetailDataArgs): UseTicketDetailDataReturn {
  const { user, workspaceSessionKey: sessionKey } = useAuth();
  const workspaceId = user?.workspaceId ?? '';
  const userChannelStatuses = useUserChannelStatuses();

  const isMember = useMemo(() => {
    if (!channelId) return false;
    return userChannelStatuses.some(s => s.channelId === channelId);
  }, [userChannelStatuses, channelId]);

  const ticketKey = ticketUuid || xyneId;

  const [ticket, ticketDetails] = useCachedQuery(
    queries.supportTicketDetail({
      id: ticketUuid || undefined,
      xyneId: xyneId || undefined,
      workspaceId,
      channelId,
      isMember,
    }),
    {
      enabled: Boolean(channelId && workspaceId && (ticketUuid || xyneId)),
      ttl: '10m',
    },
  );

  const ticketMapped = useMemo(() => mapTicketDetail(ticket), [ticket]);
  const conversationId = ticketMapped?.conversationId ?? '';
  const ticketRowId = ticketUuid || ticketMapped?.id || '';

  const [emailsByConversation, emailsDetails] = useCachedQuery(
    queries.getEmailsForTicket({ conversationId }),
    {
      enabled: Boolean(conversationId),
      ttl: '10m',
    },
  );

  const [ticketRowWithAttachments] = useCachedQuery(
    queries.supportTicketRowV3({
      id: ticketRowId,
      channelId,
      isMember,
    }),
    {
      enabled: Boolean(ticketRowId && channelId),
      ttl: '10m',
    },
  );

  const [ticketByXyneId] = useCachedQuery(
    queries.supportTicketByXyneIdV4({
      xyneId,
      workspaceId,
      channelId,
      isMember,
    }),
    {
      enabled: Boolean(!ticketUuid && xyneId && workspaceId && channelId),
      ttl: '10m',
    },
  );

  const emailsFromAttachmentQueries = useMemo(() => {
    const row = (ticketRowWithAttachments ?? ticketByXyneId) as
      { emails?: ReadonlyArray<EmailRowLike> | null } | null | undefined;
    return mapEmailRows(row?.emails);
  }, [ticketByXyneId, ticketRowWithAttachments]);

  const paintSeed = useMemo(
    () => getTicketDetailPaintCache(sessionKey, channelId, ticketKey),
    [sessionKey, channelId, ticketKey],
  );
  const lastGoodRef = useRef<TicketDetailSnapshot | null>(paintSeed);

  const [bestEmails, setBestEmails] = useState<BestEmails | null>(() =>
    paintSeed && paintSeed.emails.length > 0
      ? { ticketId: paintSeed.id, emails: paintSeed.emails }
      : null,
  );

  useEffect(() => {
    const seed = getTicketDetailPaintCache(sessionKey, channelId, ticketKey);
    lastGoodRef.current = seed;
    setBestEmails(
      seed && seed.emails.length > 0 ? { ticketId: seed.id, emails: seed.emails } : null,
    );
  }, [sessionKey, channelId, ticketKey]);

  const liveDetail = useMemo(() => {
    if (!ticketMapped) return null;
    let next = mergeTicketDetailEmails(ticketMapped, emailsByConversation);
    next = mergeTicketDetailEmails(next, emailsFromAttachmentQueries);
    return next;
  }, [emailsByConversation, emailsFromAttachmentQueries, ticketMapped]);

  useEffect(() => {
    if (!liveDetail || liveDetail.emails.length === 0) return;
    setBestEmails(prev => {
      if (!prev || prev.ticketId !== liveDetail.id) {
        return { ticketId: liveDetail.id, emails: liveDetail.emails };
      }
      const previousEmails = normalizeEmailSnapshots(prev.emails);
      if (liveDetail.emails.length > previousEmails.length) {
        return {
          ticketId: liveDetail.id,
          emails: mergeEmailLists(liveDetail.emails, previousEmails),
        };
      }
      const emails = mergeEmailLists(previousEmails, liveDetail.emails);
      const previousCount = previousEmails.reduce(
        (sum, email) => sum + emailAttachmentCount(email),
        0,
      );
      const nextCount = emails.reduce((sum, email) => sum + emailAttachmentCount(email), 0);
      if (nextCount <= previousCount) {
        if (prev.emails === previousEmails) return prev;
        return { ticketId: prev.ticketId, emails: previousEmails };
      }
      return { ticketId: liveDetail.id, emails };
    });
  }, [liveDetail]);

  const detailWithBestEmails = useMemo(() => {
    if (!liveDetail) return null;
    if (!bestEmails || bestEmails.ticketId !== liveDetail.id) return liveDetail;

    if (bestEmails.emails.length > liveDetail.emails.length) {
      return {
        ...liveDetail,
        emails: mergeEmailLists(bestEmails.emails, liveDetail.emails),
        emailCount: Math.max(liveDetail.emailCount, bestEmails.emails.length),
      };
    }

    const emails = mergeEmailLists(liveDetail.emails, bestEmails.emails);
    const liveCount = liveDetail.emails.reduce(
      (sum, email) => sum + emailAttachmentCount(email),
      0,
    );
    const mergedCount = emails.reduce((sum, email) => sum + emailAttachmentCount(email), 0);
    if (mergedCount <= liveCount) return liveDetail;

    return { ...liveDetail, emails };
  }, [liveDetail, bestEmails]);

  useEffect(() => {
    if (!detailWithBestEmails) return;
    if (ticketEmailsLookIncomplete(detailWithBestEmails)) return;
    lastGoodRef.current = detailWithBestEmails;
    setTicketDetailPaintCache(sessionKey, channelId, ticketKey, detailWithBestEmails);
  }, [detailWithBestEmails, sessionKey, channelId, ticketKey]);

  const queryPending = ticketDetails.type !== 'complete';
  const emailsPending = Boolean(conversationId) && emailsDetails.type !== 'complete';
  const fallback = lastGoodRef.current ?? paintSeed;

  let detail = detailWithBestEmails ?? (queryPending && fallback ? fallback : detailWithBestEmails);

  if (
    detail &&
    ticketEmailsLookIncomplete(detail) &&
    fallback &&
    fallback.id === detail.id &&
    fallback.emails.length > 0
  ) {
    detail = {
      ...detail,
      emails: fallback.emails,
      emailCount: Math.max(detail.emailCount, fallback.emailCount),
    };
  }

  const waitingForEmails =
    detail !== null && ticketEmailsLookIncomplete(detail) && (queryPending || emailsPending);

  const isInitialLoading = (detail === null && queryPending) || waitingForEmails;
  const isNotFound = detail === null && ticketDetails.type === 'complete' && !waitingForEmails;

  return {
    detail,
    isMember,
    isInitialLoading,
    isNotFound,
  };
}
