import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { useZero } from '@/src/hooks/useZero';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';

import { stripHtml } from '../../utils/strip-html';
import {
  clearMailboxComposeDraft,
  loadMailboxComposeDraft,
  saveMailboxComposeDraft,
  type MailboxComposeDraftSnapshot,
} from './mailbox-compose-draft-store';
import type { MailboxComposerMode } from './mailbox-reply';
import type { MailboxRecipient } from './mailbox-reply.utils';

const DRAFT_DEBOUNCE_MS = 800;

type UseMailboxReplyDraftArgs = {
  composerMode: MailboxComposerMode;
  channelId?: string | undefined;
  conversationId?: string | null | undefined;
  draftId?: string | null | undefined;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  recipients: {
    to: MailboxRecipient[];
    cc: MailboxRecipient[];
    bcc: MailboxRecipient[];
  };
  attachmentIds: readonly string[];
};

function hasPersistableDraftContent(
  bodyHtml: string,
  bodyText: string,
  attachmentIds: readonly string[],
): boolean {
  if (attachmentIds.length > 0) return true;
  return Boolean(stripHtml(bodyHtml).trim() || bodyText.trim());
}

function hasPersistableComposeDraft(
  subject: string,
  bodyHtml: string,
  bodyText: string,
  recipients: UseMailboxReplyDraftArgs['recipients'],
  attachmentIds: readonly string[],
): boolean {
  if (hasPersistableDraftContent(bodyHtml, bodyText, attachmentIds)) return true;
  if (subject.trim()) return true;
  return recipients.to.length > 0 || recipients.cc.length > 0 || recipients.bcc.length > 0;
}

export function useMailboxReplyDraft({
  composerMode,
  channelId,
  conversationId,
  draftId,
  subject,
  bodyHtml,
  bodyText,
  recipients,
  attachmentIds,
}: UseMailboxReplyDraftArgs): {
  flushDraft: () => Promise<void>;
  clearDraft: () => Promise<void>;
} {
  const zero = useZero();
  const draftIdRef = useRef(draftId?.trim() || uuidv4());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({
    composerMode,
    channelId,
    conversationId,
    subject,
    bodyHtml,
    bodyText,
    recipients,
    attachmentIds,
  });

  latestRef.current = {
    composerMode,
    channelId,
    conversationId,
    subject,
    bodyHtml,
    bodyText,
    recipients,
    attachmentIds,
  };

  useEffect(() => {
    if (draftId?.trim()) {
      draftIdRef.current = draftId.trim();
    }
  }, [draftId]);

  const persistReplyDraft = useCallback(async (): Promise<void> => {
    const snapshot = latestRef.current;
    const normalizedChannelId = snapshot.channelId?.trim() ?? '';
    const normalizedConversationId = snapshot.conversationId?.trim() ?? '';
    if (!normalizedChannelId || !normalizedConversationId) return;

    if (!hasPersistableDraftContent(snapshot.bodyHtml, snapshot.bodyText, snapshot.attachmentIds)) {
      return;
    }

    await awaitMutation(
      zero.mutate(
        mutators.emailDraft.upsert({
          id: draftIdRef.current,
          conversationId: normalizedConversationId,
          channelId: normalizedChannelId,
          draftContent: snapshot.bodyHtml,
          attachmentIds: [...snapshot.attachmentIds],
          updatedAt: Date.now(),
        }),
      ),
    );
  }, [zero]);

  const persistComposeDraft = useCallback((): void => {
    const snapshot = latestRef.current;
    const normalizedChannelId = snapshot.channelId?.trim() ?? '';
    if (!normalizedChannelId) return;

    if (
      !hasPersistableComposeDraft(
        snapshot.subject,
        snapshot.bodyHtml,
        snapshot.bodyText,
        snapshot.recipients,
        snapshot.attachmentIds,
      )
    ) {
      clearMailboxComposeDraft(normalizedChannelId);
      return;
    }

    const payload: MailboxComposeDraftSnapshot = {
      subject: snapshot.subject,
      bodyHtml: snapshot.bodyHtml,
      bodyText: snapshot.bodyText,
      to: [...snapshot.recipients.to],
      cc: [...snapshot.recipients.cc],
      bcc: [...snapshot.recipients.bcc],
    };
    saveMailboxComposeDraft(normalizedChannelId, payload);
  }, []);

  const flushDraft = useCallback(async (): Promise<void> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (latestRef.current.composerMode === 'compose') {
      persistComposeDraft();
      return;
    }

    await persistReplyDraft();
  }, [persistComposeDraft, persistReplyDraft]);

  const clearDraft = useCallback(async (): Promise<void> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (latestRef.current.composerMode === 'compose') {
      const normalizedChannelId = latestRef.current.channelId?.trim() ?? '';
      if (normalizedChannelId) clearMailboxComposeDraft(normalizedChannelId);
      return;
    }

    const normalizedConversationId = latestRef.current.conversationId?.trim() ?? '';
    if (!normalizedConversationId) return;

    await awaitMutation(
      zero.mutate(mutators.emailDraft.delete({ conversationId: normalizedConversationId })),
    );
  }, [zero]);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      if (latestRef.current.composerMode === 'compose') {
        persistComposeDraft();
        return;
      }
      void persistReplyDraft().catch(() => undefined);
    }, DRAFT_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    composerMode,
    channelId,
    conversationId,
    subject,
    bodyHtml,
    bodyText,
    recipients.to,
    recipients.cc,
    recipients.bcc,
    attachmentIds,
    persistComposeDraft,
    persistReplyDraft,
  ]);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus): void => {
      if (nextState === 'background' || nextState === 'inactive') {
        void flushDraft().catch(() => undefined);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => {
      subscription.remove();
    };
  }, [flushDraft]);

  return { flushDraft, clearDraft };
}

export { loadMailboxComposeDraft };
