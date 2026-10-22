import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/src/contexts/AuthContext';
import {
  MailboxReply,
  createRecipientDirectory,
  getMailboxReplySendErrorMessage,
  sendMailboxReply,
  buildMailboxReplyRecipients,
  type MailboxReplyDraftPayload,
  type MailboxReplyMode,
  withReplyPrefix,
} from '@/src/features/xyne-desks/detail/components/mailbox-reply';
import { useTicketDetailData } from '@/src/features/xyne-desks/detail/hooks';
import { clearTicketDetailPaintCache } from '@/src/features/xyne-desks/detail/utils';
import { resolveDeskMailboxIdentity } from '@/src/features/xyne-desks/detail/utils/resolve-desk-mailbox-identity';
import { clearTicketsPaintCache } from '@/src/features/xyne-desks/tickets/utils';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { showMessageToast } from '@/src/utils/toast';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

function paramString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

export default function MailboxReplyScreen(): ReactElement {
  const router = useRouter();
  const zero = useZero();
  const { user, workspaceSessionKey } = useAuth();
  const users = useUsers();
  const [isSending, setIsSending] = useState(false);
  const [replyMode, setReplyMode] = useState<MailboxReplyMode>('reply');

  const params = useLocalSearchParams<{
    channelId: string;
    ticketId: string;
    id?: string;
  }>();

  const channelId = paramString(params.channelId);
  const xyneId = paramString(params.ticketId);
  const ticketUuid = paramString(params.id) || undefined;

  const { detail, isMember } = useTicketDetailData({
    channelId,
    xyneId,
    ticketUuid,
  });

  const [prefs] = useCachedQuery(queries.getEmailChannelPreference({ channelId }), {
    enabled: Boolean(channelId),
    ttl: '10m',
  });

  const latestEmail = detail?.emails[detail.emails.length - 1] ?? null;
  const recipientDirectory = useMemo(() => createRecipientDirectory(users), [users]);
  const deskMailbox = useMemo(
    () =>
      resolveDeskMailboxIdentity(
        prefs?.[0] as
          | { sendAsEmail?: string | null; dlEmail?: string | null; ownerUserId?: string | null }
          | undefined,
        users,
        user?.email ?? '',
      ),
    [prefs, user?.email, users],
  );
  const ownDraft = useMemo(
    () => detail?.emailDrafts.find(draft => draft.userId === user?.user_id) ?? null,
    [detail?.emailDrafts, user?.user_id],
  );

  const initialRecipients = useMemo(
    () =>
      buildMailboxReplyRecipients(
        latestEmail,
        deskMailbox.selfEmails,
        recipientDirectory,
        replyMode,
      ),
    [deskMailbox.selfEmails, latestEmail, recipientDirectory, replyMode],
  );

  const recipientPresetKey = `${latestEmail?.id ?? 'loading'}:${replyMode}`;

  const initialSubject = useMemo(
    () => withReplyPrefix(latestEmail?.subject ?? detail?.title),
    [detail?.title, latestEmail?.subject],
  );

  const handleSend = useCallback(
    async (payload: MailboxReplyDraftPayload): Promise<void> => {
      if (isSending) return;
      if (!isMember) {
        showMessageToast('Join this desk before sending replies.');
        return;
      }

      const conversationId = detail?.conversationId;
      if (!conversationId) {
        showMessageToast('Reply details are still loading.');
        return;
      }

      setIsSending(true);
      try {
        const response = await sendMailboxReply({
          conversationId,
          subject: payload.subject,
          bodyText: payload.bodyText,
          bodyHtml: payload.bodyHtml,
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          replyToEmailId: latestEmail?.id,
          draftId: ownDraft?.id,
          attachmentIds: payload.attachmentIds,
          type: payload.replyType,
        });

        clearTicketDetailPaintCache(workspaceSessionKey, channelId, detail.xyneId || xyneId);
        clearTicketDetailPaintCache(workspaceSessionKey, channelId, detail.id);
        clearTicketsPaintCache(workspaceSessionKey, channelId);

        await awaitMutation(zero.mutate(mutators.emailDraft.delete({ conversationId }))).catch(
          () => undefined,
        );

        showMessageToast(response.warning || 'Reply sent');
        router.back();
      } catch (error) {
        showMessageToast(getMailboxReplySendErrorMessage(error));
      } finally {
        setIsSending(false);
      }
    },
    [
      channelId,
      detail?.conversationId,
      detail?.id,
      detail?.xyneId,
      isMember,
      isSending,
      latestEmail?.id,
      ownDraft?.id,
      router,
      workspaceSessionKey,
      xyneId,
      zero,
    ],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <MailboxReply
        key={`${detail?.id ?? 'loading'}:${ownDraft?.id ?? 'no-draft'}`}
        fromEmail={deskMailbox.fromEmail}
        users={users}
        channelId={channelId}
        conversationId={detail?.conversationId ?? undefined}
        threadEmails={detail?.emails ?? []}
        draftId={ownDraft?.id ?? undefined}
        replyMode={replyMode}
        onReplyModeChange={setReplyMode}
        recipientPresetKey={recipientPresetKey}
        initialToRecipients={initialRecipients.to}
        initialCcRecipients={initialRecipients.cc}
        initialBccRecipients={initialRecipients.bcc}
        initialSubject={initialSubject}
        initialBodyHtml={ownDraft?.draftContent ?? ''}
        isSending={isSending}
        onBack={() => router.back()}
        onSend={handleSend}
      >
        <View className='flex-1 bg-neutral-100 dark:bg-tabs-screen'>
          <MailboxReply.Header>
            <MailboxReply.BackButton />
            <View className='flex-1' />
            <MailboxReply.AttachmentButton />
            <MailboxReply.SendButton />
          </MailboxReply.Header>

          <MailboxReply.Form>
            <MailboxReply.From />
            <MailboxReply.To />
            <MailboxReply.Cc />
            <MailboxReply.Bcc />
            <MailboxReply.Subject />
            <MailboxReply.Body />
          </MailboxReply.Form>
        </View>
      </MailboxReply>
    </>
  );
}
