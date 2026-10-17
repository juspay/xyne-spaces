import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { useAuth } from '@/src/contexts/AuthContext';
import {
  MailboxReply,
  clearMailboxComposeDraft,
  createMailboxRecipient,
  createRecipientDirectory,
  getMailboxReplySendErrorMessage,
  loadMailboxComposeDraft,
  parseDefaultCcEmails,
  sendMailboxCompose,
  type MailboxRecipient,
  type MailboxReplyDraftPayload,
} from '@/src/features/xyne-desks/detail/components/mailbox-reply';
import { resolveDeskMailboxIdentity } from '@/src/features/xyne-desks/detail/utils/resolve-desk-mailbox-identity';
import { clearTicketsPaintCache } from '@/src/features/xyne-desks/tickets/utils';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useUsers } from '@/src/hooks/useUsers';
import { showMessageToast } from '@/src/utils/toast';
import { queries } from '@/src/zero/queries';

function paramString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

export default function MailboxComposeScreen(): ReactElement {
  const router = useRouter();
  const { user, workspaceSessionKey } = useAuth();
  const users = useUsers();
  const [isSending, setIsSending] = useState(false);
  const composeIdRef = useRef(uuidv4());

  const params = useLocalSearchParams<{
    channelId: string;
    to?: string;
  }>();

  const channelId = paramString(params.channelId);
  const prefilledTo = paramString(params.to);
  const recipientDirectory = useMemo(() => createRecipientDirectory(users), [users]);

  const [prefs] = useCachedQuery(queries.getEmailChannelPreference({ channelId }), {
    enabled: Boolean(channelId),
    ttl: '10m',
  });

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

  const savedComposeDraft = useMemo(
    () => (channelId ? loadMailboxComposeDraft(channelId) : null),
    [channelId],
  );

  const defaultCcKey = useMemo(() => {
    const row = prefs?.[0] as { defaultCc?: string | null } | undefined;
    return row?.defaultCc ?? '';
  }, [prefs]);

  const initialToRecipients = useMemo((): MailboxRecipient[] => {
    if (savedComposeDraft?.to.length) return savedComposeDraft.to;
    if (!prefilledTo) return [];
    const recipient = createMailboxRecipient(prefilledTo, { directory: recipientDirectory });
    return recipient ? [recipient] : [];
  }, [prefilledTo, recipientDirectory, savedComposeDraft?.to]);

  const initialCcRecipients = useMemo((): MailboxRecipient[] => {
    if (savedComposeDraft?.cc.length) return savedComposeDraft.cc;
    const row = prefs?.[0] as { defaultCc?: string | null } | undefined;
    return parseDefaultCcEmails(row?.defaultCc)
      .map(value => createMailboxRecipient(value, { directory: recipientDirectory }))
      .filter((recipient): recipient is MailboxRecipient => recipient !== null);
  }, [prefs, recipientDirectory, savedComposeDraft?.cc]);

  const handleSend = useCallback(
    async (payload: MailboxReplyDraftPayload): Promise<void> => {
      if (isSending) return;
      if (!channelId) {
        showMessageToast('Desk is still loading.');
        return;
      }

      setIsSending(true);
      try {
        const response = await sendMailboxCompose({
          channelId,
          subject: payload.subject,
          bodyText: payload.bodyText,
          bodyHtml: payload.bodyHtml,
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          attachmentIds: payload.attachmentIds,
        });

        clearTicketsPaintCache(workspaceSessionKey, channelId);
        clearMailboxComposeDraft(channelId);
        showMessageToast(response.warning || 'Email sent');

        const nextChannelId = response.channelId || channelId;
        const ticketXyneId = response.ticketXyneId;
        if (ticketXyneId) {
          router.replace({
            pathname: '/xyne-desks/[channelId]/[ticketId]',
            params: {
              channelId: nextChannelId,
              ticketId: ticketXyneId,
              ...(response.ticketId ? { id: response.ticketId } : {}),
            },
          });
          return;
        }

        router.back();
      } catch (error) {
        showMessageToast(getMailboxReplySendErrorMessage(error));
      } finally {
        setIsSending(false);
      }
    },
    [channelId, isSending, router, workspaceSessionKey],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <MailboxReply
        key={composeIdRef.current}
        composerMode='compose'
        fromEmail={deskMailbox.fromEmail}
        users={users}
        channelId={channelId}
        initialToRecipients={initialToRecipients}
        initialCcRecipients={initialCcRecipients}
        initialBccRecipients={savedComposeDraft?.bcc ?? []}
        initialSubject={savedComposeDraft?.subject ?? ''}
        initialBodyHtml={savedComposeDraft?.bodyHtml ?? ''}
        recipientPresetKey={`${composeIdRef.current}:${prefilledTo}:${defaultCcKey}:${savedComposeDraft?.bodyHtml ?? ''}`}
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
