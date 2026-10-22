import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  ArrowLeft,
  Bold,
  ChevronDown,
  Code,
  Italic,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Reply,
  ReplyAll,
  SendHorizontal,
  Strikethrough,
  Underline,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type HtmlStyle,
  type OnChangeHtmlEvent,
  type OnChangeStateEvent,
  type OnChangeTextEvent,
} from 'react-native-enriched';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { Dropdown } from '@/src/components/ui/dropdown';
import Avatar from '@/src/components/ui/avatar';
import {
  formatFileSize,
  truncateFileName,
} from '@/src/components/chat/message/message-attachments.utils';
import { getFileTypeConfig } from '@/src/components/chat/file-attachment-card';
import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import { withAlpha } from '@/src/utils/color';
import { showMessageToast } from '@/src/utils/toast';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import { stripHtml } from '../../utils/strip-html';
import type { TicketDetailEmailSnapshot } from '../../types';
import {
  describeEmailAttachmentSelection,
  mailboxAttachmentFromPicked,
  MAX_EMAIL_ATTACHMENT_FILES,
  selectEmailAttachments,
  uploadedMailboxAttachmentIds,
  type MailboxEmailAttachment,
} from './mailbox-reply.attachments';
import {
  uploadMailboxEmailAttachments,
  deleteMailboxEmailAttachment,
} from './mailbox-reply.attachments-upload';
import { pickMailboxEmailAttachments } from './mailbox-reply.pick';
import {
  createMailboxRecipient,
  createRecipientDirectory,
  enrichMailboxRecipient,
  enrichMailboxRecipients,
  getMailboxRecipientColor,
  getMailboxRecipientInitial,
  parseRecipientInput,
  type MailboxRecipient,
  type MailboxReplyDirectoryUser,
  type RecipientFieldName,
} from './mailbox-reply.utils';
import {
  buildContactPool,
  buildSuggestions,
  type RecipientSuggestion,
} from './mailbox-reply.suggestions';
import { RecipientSuggestionsDropdown } from './recipient-suggestions-dropdown';
import { useDeskContacts } from './use-desk-contacts';
import { useMailboxReplyDraft } from './use-mailbox-reply-draft';

export const MAILBOX_REPLY_HEADER_HEIGHT = 56;
export const MAILBOX_REPLY_FORMATTING_TOOLBAR_HEIGHT = 56;

const LEFT_COLUMN_WIDTH = 112;

const KEYBOARD_STICKY_STYLE = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 50,
  backgroundColor: 'transparent',
} as const;

export type MailboxReplyMode = 'reply' | 'replyAll';
export type MailboxComposerMode = 'reply' | 'compose';
type MailboxReplySendType = 'REPLY' | 'REPLY_ALL';

const MAILBOX_REPLY_MODE_TO_SEND_TYPE: Record<MailboxReplyMode, MailboxReplySendType> = {
  reply: 'REPLY',
  replyAll: 'REPLY_ALL',
};

export type MailboxReplyDraftPayload = {
  from: string;
  replyMode: MailboxReplyMode;
  replyType: MailboxReplySendType;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  to: MailboxRecipient[];
  cc: MailboxRecipient[];
  bcc: MailboxRecipient[];
  attachmentIds: string[];
};

type MailboxReplyContextValue = {
  fromEmail: string;

  replyMode: MailboxReplyMode;
  setReplyMode: (value: MailboxReplyMode) => void;

  subject: string;
  setSubject: (value: string) => void;

  recipients: Record<RecipientFieldName, MailboxRecipient[]>;
  recipientInputs: Record<RecipientFieldName, string>;
  ccBccVisible: boolean;
  showCcBcc: () => void;
  updateRecipientInput: (field: RecipientFieldName, value: string) => void;
  commitRecipientInput: (field: RecipientFieldName) => void;
  selectRecipientSuggestion: (field: RecipientFieldName, suggestion: RecipientSuggestion) => void;
  removeLastRecipient: (field: RecipientFieldName) => void;
  contactPool: readonly RecipientSuggestion[];

  bodyInputRef: RefObject<EnrichedTextInputInstance | null>;
  initialBodyHtml: string;
  bodyText: string;
  bodyHtml: string;
  bodyStyleState: OnChangeStateEvent | null;
  formattingToolbarVisible: boolean;
  setBodyText: (value: string) => void;
  setBodyHtml: (value: string) => void;
  setBodyStyleState: (value: OnChangeStateEvent | null) => void;
  showFormattingToolbar: () => void;
  hideFormattingToolbar: () => void;

  sendReply: () => void;
  isSending: boolean;
  composerMode: MailboxComposerMode;
  attachments: MailboxEmailAttachment[];
  isUploadingAttachments: boolean;
  canAddAttachments: boolean;
  openAttachSheet: () => void;
  removeAttachment: (clientId: string) => void;

  onBack: () => void;
  flushDraftBeforeExit: () => Promise<void>;
};

const MailboxReplyContext = createContext<MailboxReplyContextValue | null>(null);

type MailboxReplyRootProps = {
  children: ReactNode;
  fromEmail: string;
  users?: readonly MailboxReplyDirectoryUser[] | undefined;
  initialToRecipients?: MailboxRecipient[] | undefined;
  initialCcRecipients?: MailboxRecipient[] | undefined;
  initialBccRecipients?: MailboxRecipient[] | undefined;
  recipientPresetKey?: string | undefined;
  replyMode?: MailboxReplyMode | undefined;
  initialReplyMode?: MailboxReplyMode | undefined;
  initialSubject?: string | undefined;
  initialBodyHtml?: string | undefined;
  isSending?: boolean | undefined;
  composerMode?: MailboxComposerMode | undefined;
  channelId?: string | undefined;
  conversationId?: string | undefined;
  threadEmails?: readonly TicketDetailEmailSnapshot[] | undefined;
  draftId?: string | null | undefined;
  onBack: () => void;
  onReplyModeChange?: ((value: MailboxReplyMode) => void) | undefined;
  onSend?: ((payload: MailboxReplyDraftPayload) => void | Promise<void>) | undefined;
};

const MailboxReplyRoot = memo(function MailboxReplyRoot({
  children,
  fromEmail,
  users = [],
  initialToRecipients = [],
  initialCcRecipients = [],
  initialBccRecipients = [],
  recipientPresetKey,
  replyMode: controlledReplyMode,
  initialReplyMode = 'reply',
  initialSubject = '',
  initialBodyHtml = '',
  isSending = false,
  composerMode = 'reply',
  channelId,
  conversationId,
  threadEmails = [],
  draftId,
  onBack,
  onReplyModeChange,
  onSend,
}: MailboxReplyRootProps): ReactElement {
  const recipientDirectory = useMemo(() => createRecipientDirectory(users), [users]);
  const deskContacts = useDeskContacts(channelId);
  const [prefs] = useCachedQuery(
    queries.getEmailChannelPreference({ channelId: channelId ?? '' }),
    {
      enabled: Boolean(channelId),
      ttl: '10m',
    },
  );
  const contactPool = useMemo(() => {
    const row = prefs?.[0] as { sendAsEmail?: string | null; dlEmail?: string | null } | undefined;
    return buildContactPool(users, deskContacts, threadEmails, [row?.sendAsEmail, row?.dlEmail]);
  }, [deskContacts, prefs, threadEmails, users]);
  const bodyInputRef = useRef<EnrichedTextInputInstance | null>(null);
  const initialBodyHtmlRef = useRef(initialBodyHtml);
  const lastRecipientPresetKeyRef = useRef(recipientPresetKey);

  const [uncontrolledReplyMode, setUncontrolledReplyMode] =
    useState<MailboxReplyMode>(initialReplyMode);
  const [subject, setSubject] = useState(initialSubject);
  const [bodyText, setBodyText] = useState('');
  const [bodyHtml, setBodyHtml] = useState(initialBodyHtml);
  const [bodyStyleState, setBodyStyleState] = useState<OnChangeStateEvent | null>(null);
  const [formattingToolbarVisible, setFormattingToolbarVisible] = useState(false);
  const [ccBccVisible, setCcBccVisible] = useState(
    initialCcRecipients.length > 0 || initialBccRecipients.length > 0,
  );

  const [recipients, setRecipients] = useState<Record<RecipientFieldName, MailboxRecipient[]>>({
    to: enrichMailboxRecipients(initialToRecipients, recipientDirectory),
    cc: enrichMailboxRecipients(initialCcRecipients, recipientDirectory),
    bcc: enrichMailboxRecipients(initialBccRecipients, recipientDirectory),
  });

  const [recipientInputs, setRecipientInputs] = useState<Record<RecipientFieldName, string>>({
    to: '',
    cc: '',
    bcc: '',
  });
  const [attachments, setAttachments] = useState<MailboxEmailAttachment[]>([]);
  const isPickingAttachmentsRef = useRef(false);
  const attachmentsRef = useRef<MailboxEmailAttachment[]>([]);
  attachmentsRef.current = attachments;
  const uploadedAttachmentIds = useMemo(
    () => uploadedMailboxAttachmentIds(attachments),
    [attachments],
  );

  const { flushDraft } = useMailboxReplyDraft({
    composerMode,
    channelId,
    conversationId,
    draftId,
    subject,
    bodyHtml,
    bodyText,
    recipients,
    attachmentIds: uploadedAttachmentIds,
  });

  const replyMode = controlledReplyMode ?? uncontrolledReplyMode;
  const isUploadingAttachments = attachments.some(attachment => attachment.status === 'uploading');
  const canAddAttachments = attachments.length < MAX_EMAIL_ATTACHMENT_FILES && !isSending;

  const setReplyMode = useCallback(
    (nextReplyMode: MailboxReplyMode): void => {
      if (nextReplyMode === replyMode) return;

      if (controlledReplyMode === undefined) {
        setUncontrolledReplyMode(nextReplyMode);
      }

      onReplyModeChange?.(nextReplyMode);
    },
    [controlledReplyMode, onReplyModeChange, replyMode],
  );

  const showCcBcc = useCallback((): void => {
    setCcBccVisible(true);
  }, []);

  const showFormattingToolbar = useCallback((): void => {
    setFormattingToolbarVisible(true);
  }, []);

  const hideFormattingToolbar = useCallback((): void => {
    setFormattingToolbarVisible(false);
  }, []);

  useEffect(() => {
    if (!recipientPresetKey || lastRecipientPresetKeyRef.current === recipientPresetKey) return;

    lastRecipientPresetKeyRef.current = recipientPresetKey;
    setRecipients({
      to: enrichMailboxRecipients(initialToRecipients, recipientDirectory),
      cc: enrichMailboxRecipients(initialCcRecipients, recipientDirectory),
      bcc: enrichMailboxRecipients(initialBccRecipients, recipientDirectory),
    });
    setRecipientInputs({ to: '', cc: '', bcc: '' });
    setCcBccVisible(initialCcRecipients.length > 0 || initialBccRecipients.length > 0);
  }, [
    initialBccRecipients,
    initialCcRecipients,
    initialToRecipients,
    recipientDirectory,
    recipientPresetKey,
  ]);

  useEffect(() => {
    setRecipients(prev => {
      let changed = false;
      const next: Record<RecipientFieldName, MailboxRecipient[]> = {
        to: prev.to.map(recipient => {
          const enriched = enrichMailboxRecipient(recipient, recipientDirectory);
          if (enriched !== recipient) changed = true;
          return enriched;
        }),
        cc: prev.cc.map(recipient => {
          const enriched = enrichMailboxRecipient(recipient, recipientDirectory);
          if (enriched !== recipient) changed = true;
          return enriched;
        }),
        bcc: prev.bcc.map(recipient => {
          const enriched = enrichMailboxRecipient(recipient, recipientDirectory);
          if (enriched !== recipient) changed = true;
          return enriched;
        }),
      };
      return changed ? next : prev;
    });
  }, [recipientDirectory]);

  const addRecipients = useCallback((field: RecipientFieldName, next: MailboxRecipient[]) => {
    if (next.length === 0) return;

    setRecipients(prev => {
      const existing = new Set(prev[field].map(item => item.email.toLowerCase()));
      const fresh = next.filter(item => !existing.has(item.email.toLowerCase()));
      if (fresh.length === 0) return prev;
      return { ...prev, [field]: [...prev[field], ...fresh] };
    });
  }, []);

  const setRecipientInput = useCallback((field: RecipientFieldName, value: string) => {
    setRecipientInputs(prev => (prev[field] === value ? prev : { ...prev, [field]: value }));
  }, []);

  const updateRecipientInput = useCallback(
    (field: RecipientFieldName, value: string) => {
      const parsed = parseRecipientInput(value, false, recipientDirectory);
      addRecipients(field, parsed.recipients);
      setRecipientInput(field, parsed.remainder);
    },
    [addRecipients, recipientDirectory, setRecipientInput],
  );

  const commitRecipientInput = useCallback(
    (field: RecipientFieldName) => {
      const parsed = parseRecipientInput(recipientInputs[field], true, recipientDirectory);
      addRecipients(field, parsed.recipients);
      setRecipientInput(field, parsed.remainder);
    },
    [addRecipients, recipientDirectory, recipientInputs, setRecipientInput],
  );

  const removeLastRecipient = useCallback((field: RecipientFieldName) => {
    setRecipients(prev => {
      if (prev[field].length === 0) return prev;
      return { ...prev, [field]: prev[field].slice(0, -1) };
    });
  }, []);

  const selectRecipientSuggestion = useCallback(
    (field: RecipientFieldName, suggestion: RecipientSuggestion): void => {
      const recipient = createMailboxRecipient(suggestion.email, {
        directory: recipientDirectory,
        name: suggestion.name,
      });
      if (!recipient) return;
      addRecipients(field, [recipient]);
      setRecipientInput(field, '');
    },
    [addRecipients, recipientDirectory, setRecipientInput],
  );

  const removeAttachment = useCallback((clientId: string): void => {
    const target = attachmentsRef.current.find(attachment => attachment.clientId === clientId);
    setAttachments(prev => prev.filter(attachment => attachment.clientId !== clientId));
    if (target?.serverId && target.status === 'uploaded') {
      void deleteMailboxEmailAttachment(target.serverId).catch(() => undefined);
    }
  }, []);

  const addPickedAttachments = useCallback(
    async (picked: ComposerAttachment[]): Promise<void> => {
      const selection = selectEmailAttachments(attachmentsRef.current.length, picked);
      const limitMessage = describeEmailAttachmentSelection(selection);
      if (limitMessage) showMessageToast(limitMessage);
      if (selection.accepted.length === 0) return;

      const pending = selection.accepted.map(mailboxAttachmentFromPicked);
      setAttachments(prev => [...prev, ...pending]);

      try {
        const serverIds = await uploadMailboxEmailAttachments({
          files: selection.accepted,
          composerMode,
          conversationId,
          channelId,
        });

        const serverIdByClientId = new Map(
          pending.map((attachment, index) => [attachment.clientId, serverIds[index] ?? null]),
        );

        setAttachments(prev =>
          prev.map(attachment => {
            if (!serverIdByClientId.has(attachment.clientId)) return attachment;
            const serverId = serverIdByClientId.get(attachment.clientId);
            if (!serverId) {
              return {
                ...attachment,
                status: 'failed',
                error: 'Upload incomplete',
              };
            }
            return {
              ...attachment,
              status: 'uploaded',
              serverId,
            };
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to upload attachments.';
        const failedIds = new Set(pending.map(attachment => attachment.clientId));
        setAttachments(prev =>
          prev.map(attachment =>
            failedIds.has(attachment.clientId)
              ? { ...attachment, status: 'failed', error: message }
              : attachment,
          ),
        );
        showMessageToast(message);
      }
    },
    [channelId, composerMode, conversationId],
  );

  const openAttachSheet = useCallback((): void => {
    if (isSending || isPickingAttachmentsRef.current) return;
    if (attachmentsRef.current.length >= MAX_EMAIL_ATTACHMENT_FILES) {
      showMessageToast(`You can attach at most ${MAX_EMAIL_ATTACHMENT_FILES} files per email.`);
      return;
    }

    void (async () => {
      isPickingAttachmentsRef.current = true;
      try {
        const picked = await pickMailboxEmailAttachments();
        if (picked.length === 0) return;
        await addPickedAttachments(picked);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to add attachment';
        Alert.alert('Attachment unavailable', message);
      } finally {
        isPickingAttachmentsRef.current = false;
      }
    })();
  }, [addPickedAttachments, isSending]);

  const getRecipientsForSend = useCallback((): Record<RecipientFieldName, MailboxRecipient[]> => {
    const next: Record<RecipientFieldName, MailboxRecipient[]> = {
      to: [...recipients.to],
      cc: [...recipients.cc],
      bcc: [...recipients.bcc],
    };
    const nextInputs: Record<RecipientFieldName, string> = { to: '', cc: '', bcc: '' };
    let recipientsChanged = false;
    let inputsChanged = false;

    (['to', 'cc', 'bcc'] as const).forEach(field => {
      const parsed = parseRecipientInput(recipientInputs[field], true, recipientDirectory);
      nextInputs[field] = parsed.remainder;

      if (parsed.remainder !== recipientInputs[field]) {
        inputsChanged = true;
      }

      if (parsed.recipients.length === 0) return;

      const existing = new Set(next[field].map(item => item.email.toLowerCase()));
      const fresh = parsed.recipients.filter(item => !existing.has(item.email.toLowerCase()));
      if (fresh.length === 0) return;

      next[field] = [...next[field], ...fresh];
      recipientsChanged = true;
    });

    if (recipientsChanged) setRecipients(next);
    if (inputsChanged) setRecipientInputs(nextInputs);

    return next;
  }, [recipientDirectory, recipientInputs, recipients]);

  const sendReply = useCallback(() => {
    if (isSending) return;
    if (attachmentsRef.current.some(attachment => attachment.status === 'uploading')) {
      showMessageToast('Wait for attachments to finish uploading.');
      return;
    }
    if (attachmentsRef.current.some(attachment => attachment.status === 'failed')) {
      showMessageToast('Remove failed attachments or try again.');
      return;
    }

    const nextRecipients = getRecipientsForSend();

    void onSend?.({
      from: fromEmail,
      replyMode,
      replyType: MAILBOX_REPLY_MODE_TO_SEND_TYPE[replyMode],
      subject,
      bodyText,
      bodyHtml,
      to: nextRecipients.to,
      cc: nextRecipients.cc,
      bcc: nextRecipients.bcc,
      attachmentIds: uploadedMailboxAttachmentIds(attachmentsRef.current),
    });
  }, [bodyHtml, bodyText, fromEmail, getRecipientsForSend, isSending, onSend, replyMode, subject]);

  const value = useMemo<MailboxReplyContextValue>(
    () => ({
      fromEmail,

      replyMode,
      setReplyMode,

      subject,
      setSubject,

      recipients,
      recipientInputs,
      ccBccVisible,
      showCcBcc,
      updateRecipientInput,
      commitRecipientInput,
      selectRecipientSuggestion,
      removeLastRecipient,
      contactPool,

      bodyInputRef,
      initialBodyHtml: initialBodyHtmlRef.current,
      bodyText,
      bodyHtml,
      bodyStyleState,
      formattingToolbarVisible,
      setBodyText,
      setBodyHtml,
      setBodyStyleState,
      showFormattingToolbar,
      hideFormattingToolbar,

      sendReply,
      isSending,
      composerMode,
      attachments,
      isUploadingAttachments,
      canAddAttachments,
      openAttachSheet,
      removeAttachment,

      onBack,
      flushDraftBeforeExit: flushDraft,
    }),
    [
      attachments,
      bodyHtml,
      bodyText,
      bodyStyleState,
      canAddAttachments,
      ccBccVisible,
      commitRecipientInput,
      flushDraft,
      formattingToolbarVisible,
      fromEmail,
      hideFormattingToolbar,
      isSending,
      isUploadingAttachments,
      onBack,
      openAttachSheet,
      recipientInputs,
      recipients,
      removeAttachment,
      removeLastRecipient,
      replyMode,
      sendReply,
      setReplyMode,
      showCcBcc,
      showFormattingToolbar,
      composerMode,
      contactPool,
      selectRecipientSuggestion,
      subject,
      updateRecipientInput,
    ],
  );

  return <MailboxReplyContext.Provider value={value}>{children}</MailboxReplyContext.Provider>;
});

function useMailboxReply(): MailboxReplyContextValue {
  const value = useContext(MailboxReplyContext);
  if (!value) throw new Error('MailboxReply components must be used inside <MailboxReply>.');
  return value;
}

function Header({ children }: { children: ReactNode }): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View
      className='absolute inset-x-0 top-0 z-40 bg-neutral-100 dark:bg-tabs-screen'
      style={{ paddingTop: insets.top }}
    >
      <View className='flex-row items-center px-3' style={{ height: MAILBOX_REPLY_HEADER_HEIGHT }}>
        {children}
      </View>
    </View>
  );
}

function Form({ children }: { children: ReactNode }): ReactElement {
  const insets = useSafeAreaInsets();
  const { formattingToolbarVisible } = useMailboxReply();

  const bottomSpace =
    insets.bottom + 32 + (formattingToolbarVisible ? MAILBOX_REPLY_FORMATTING_TOOLBAR_HEIGHT : 0);

  return (
    <View className='flex-1' style={{ paddingTop: insets.top + MAILBOX_REPLY_HEADER_HEIGHT }}>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps='always'
        scrollEnabled={!formattingToolbarVisible}
        nestedScrollEnabled
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        bottomOffset={formattingToolbarVisible ? MAILBOX_REPLY_FORMATTING_TOOLBAR_HEIGHT + 24 : 24}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomSpace }}
      >
        {children}
        <AttachmentsList />
      </KeyboardAwareScrollView>

      <FormattingToolbar />
    </View>
  );
}

function BackButton(): ReactElement {
  const {
    onBack,
    flushDraftBeforeExit,
    composerMode,
    subject,
    bodyHtml,
    bodyText,
    recipients,
    recipientInputs,
    attachments,
  } = useMailboxReply();
  const foreground = useCSSVariable('--color-foreground') as string;

  const handlePress = (): void => {
    void (async () => {
      await flushDraftBeforeExit();

      if (composerMode !== 'compose') {
        onBack();
        return;
      }

      const hasRecipients =
        recipients.to.length > 0 || recipients.cc.length > 0 || recipients.bcc.length > 0;
      const hasTypedRecipients =
        recipientInputs.to.trim().length > 0 ||
        recipientInputs.cc.trim().length > 0 ||
        recipientInputs.bcc.trim().length > 0;
      const hasBody = Boolean(stripHtml(bodyHtml).trim() || bodyText.trim());
      const dirty = Boolean(
        subject.trim() || hasBody || hasRecipients || hasTypedRecipients || attachments.length > 0,
      );

      if (!dirty) {
        onBack();
        return;
      }

      onBack();
    })();
  };

  return (
    <HeaderIconButton label='Back' onPress={handlePress}>
      <ArrowLeft size={25} color={foreground} strokeWidth={2.2} />
    </HeaderIconButton>
  );
}

function AttachmentButton(): ReactElement {
  const { openAttachSheet, canAddAttachments, isSending } = useMailboxReply();
  const foreground = useCSSVariable('--color-foreground') as string;

  return (
    <HeaderIconButton
      label='Add attachment'
      onPress={openAttachSheet}
      disabled={isSending || !canAddAttachments}
    >
      <Paperclip size={23} color={foreground} strokeWidth={2.2} />
    </HeaderIconButton>
  );
}

function SendButton(): ReactElement {
  const { sendReply, isSending, isUploadingAttachments, composerMode } = useMailboxReply();
  const scheme = useColorScheme();
  const sendColor = scheme === 'dark' ? '#E9D5FF' : '#7C3AED';
  const busy = isSending || isUploadingAttachments;
  const label = isSending
    ? composerMode === 'compose'
      ? 'Sending email'
      : 'Sending reply'
    : isUploadingAttachments
      ? 'Uploading attachments'
      : composerMode === 'compose'
        ? 'Send email'
        : 'Send reply';

  return (
    <HeaderIconButton label={label} onPress={sendReply} disabled={busy}>
      {busy ? (
        <ActivityIndicator size='small' color={sendColor} />
      ) : (
        <SendHorizontal size={25} color={sendColor} strokeWidth={2.3} />
      )}
    </HeaderIconButton>
  );
}

function HeaderIconButton({
  label,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  children: ReactElement;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      className='size-11 items-center justify-center rounded-full active:bg-foreground/5 disabled:opacity-60'
    >
      {children}
    </Pressable>
  );
}

function AttachmentsList(): ReactElement | null {
  const { attachments, removeAttachment } = useMailboxReply();
  const foreground = useCSSVariable('--color-foreground') as string;

  if (attachments.length === 0) return null;

  return (
    <View className='gap-2 px-6 pb-4'>
      {attachments.map(attachment => {
        const isImage = attachment.mimetype.startsWith('image/');
        const config = getFileTypeConfig(attachment.mimetype, attachment.originalFilename);
        const Icon = config.icon;
        const subtitle =
          attachment.status === 'uploading'
            ? 'Uploading…'
            : attachment.status === 'failed'
              ? attachment.error || 'Upload failed'
              : formatFileSize(attachment.size);

        return (
          <View
            key={attachment.clientId}
            className='flex-row items-center gap-3 rounded-2xl bg-foreground/5 px-3 py-2'
          >
            {isImage ? (
              <Image
                source={{ uri: attachment.localUri }}
                className='size-11 rounded-xl'
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View
                className='size-11 items-center justify-center rounded-xl'
                style={{ backgroundColor: config.color }}
              >
                <Icon size={22} color='#fff' strokeWidth={2.2} />
              </View>
            )}

            <View className='min-w-0 flex-1'>
              <Text className='text-[15px] font-medium text-foreground' numberOfLines={1}>
                {truncateFileName(attachment.originalFilename, 28)}
              </Text>
              <Text
                className={
                  attachment.status === 'failed'
                    ? 'text-[13px] text-red-500'
                    : 'text-[13px] text-foreground/55'
                }
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            </View>

            {attachment.status === 'uploading' ? (
              <ActivityIndicator size='small' color={foreground} />
            ) : (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`Remove ${attachment.originalFilename}`}
                hitSlop={8}
                onPress={() => removeAttachment(attachment.clientId)}
                className='size-9 items-center justify-center rounded-full active:bg-foreground/10'
              >
                <X size={18} color={foreground} strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function From(): ReactElement {
  const { fromEmail } = useMailboxReply();

  return (
    <View className='min-h-[72px] flex-row items-center border-b border-foreground/15 px-6'>
      <Text className='text-[16px] text-foreground/70' style={{ width: LEFT_COLUMN_WIDTH - 44 }}>
        From
      </Text>

      <Text className='min-w-0 flex-1 text-[17px] text-foreground' numberOfLines={1}>
        {fromEmail || 'Unknown'}
      </Text>
    </View>
  );
}

function To(): ReactElement {
  const { ccBccVisible, showCcBcc, composerMode } = useMailboxReply();
  const isCompose = composerMode === 'compose';

  return (
    <RecipientField
      field='to'
      placeholder='To'
      {...(isCompose ? { label: 'To' } : { leftAccessory: <ReplyModeButton /> })}
      rightAccessory={
        ccBccVisible ? null : (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Show Cc and Bcc fields'
            hitSlop={8}
            onPress={showCcBcc}
            className='size-11 items-center justify-center rounded-full active:bg-foreground/5'
          >
            <ChevronDown size={22} color='#A1A1AA' strokeWidth={2.2} />
          </Pressable>
        )
      }
    />
  );
}

function Cc(): ReactElement | null {
  const { ccBccVisible } = useMailboxReply();
  if (!ccBccVisible) return null;
  return <RecipientField field='cc' label='Cc' placeholder='Cc' />;
}

function Bcc(): ReactElement | null {
  const { ccBccVisible } = useMailboxReply();
  if (!ccBccVisible) return null;
  return <RecipientField field='bcc' label='Bcc' placeholder='Bcc' />;
}

function Subject(): ReactElement {
  const { subject, setSubject } = useMailboxReply();
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;

  return (
    <View className='min-h-[56px] justify-center border-b border-foreground/15 px-6 py-4'>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        multiline
        placeholder='Subject'
        placeholderTextColor={muted}
        className='text-[16px] leading-7 text-foreground'
        style={{ color: foreground, padding: 0 }}
      />
    </View>
  );
}

function Body(): ReactElement {
  const {
    bodyInputRef,
    initialBodyHtml,
    setBodyText,
    setBodyHtml,
    setBodyStyleState,
    showFormattingToolbar,
    formattingToolbarVisible,
  } = useMailboxReply();

  const foreground = (useCSSVariable('--color-foreground') as string | undefined) ?? '#F4F4F5';
  const mutedForeground =
    (useCSSVariable('--color-secondary-foreground') as string | undefined) ?? '#A1A1AA';
  const actionPrimary =
    (useCSSVariable('--color-action-primary') as string | undefined) ?? '#7C3AED';
  const codeText =
    (useCSSVariable('--color-conversation-input-code-text') as string | undefined) ?? foreground;
  const codeBg =
    (useCSSVariable('--color-conversation-input-code-background') as string | undefined) ??
    'rgba(161, 161, 170, 0.18)';

  const htmlStyle = useMemo<HtmlStyle>(
    () => ({
      h1: {
        fontSize: 32,
        bold: false,
      },
      h2: {
        fontSize: 24,
        bold: false,
      },
      h3: {
        fontSize: 20,
        bold: false,
      },
      h4: {
        fontSize: 16,
        bold: false,
      },
      h5: {
        fontSize: 14,
        bold: false,
      },
      h6: {
        fontSize: 12,
        bold: false,
      },
      blockquote: {
        borderColor: mutedForeground,
        borderWidth: 3,
        gapWidth: 10,
        color: mutedForeground,
      },
      codeblock: {
        color: codeText,
        backgroundColor: codeBg,
        borderRadius: 8,
      },
      code: {
        color: codeText,
        backgroundColor: codeBg,
      },
      a: {
        color: actionPrimary,
        textDecorationLine: 'underline',
      },
      ol: {
        gapWidth: 8,
        marginLeft: 18,
        markerColor: mutedForeground,
        markerFontWeight: '500',
      },
      ul: {
        bulletColor: mutedForeground,
        bulletSize: 5,
        marginLeft: 18,
        gapWidth: 8,
      },
      ulCheckbox: {
        boxSize: 24,
        gapWidth: 16,
        marginLeft: 18,
        boxColor: actionPrimary,
      },
      mention: {
        color: actionPrimary,
        backgroundColor: codeBg,
        textDecorationLine: 'none',
      },
    }),
    [actionPrimary, codeBg, codeText, mutedForeground],
  );

  const inputStyle = useMemo(
    () => ({
      flex: 1,
      minHeight: 320,
      color: foreground,
      fontSize: 18,
      ...(Platform.OS === 'android' ? { includeFontPadding: false } : { lineHeight: 26 }),
      padding: 0,
    }),
    [foreground],
  );

  const handleChangeText = useCallback(
    (event: NativeSyntheticEvent<OnChangeTextEvent>) => {
      setBodyText(event.nativeEvent.value ?? '');
    },
    [setBodyText],
  );

  const handleChangeHtml = useCallback(
    (event: NativeSyntheticEvent<OnChangeHtmlEvent>) => {
      setBodyHtml(event.nativeEvent.value ?? '');
    },
    [setBodyHtml],
  );

  const handleChangeState = useCallback(
    (event: NativeSyntheticEvent<OnChangeStateEvent>) => {
      setBodyStyleState(event.nativeEvent);
    },
    [setBodyStyleState],
  );

  return (
    <View className='min-h-[360px] flex-1 px-6 py-5'>
      <EnrichedTextInput
        ref={bodyInputRef}
        editable
        scrollEnabled={formattingToolbarVisible}
        autoCapitalize='sentences'
        placeholder='Compose email...'
        placeholderTextColor={mutedForeground}
        cursorColor={actionPrimary}
        selectionColor={actionPrimary}
        htmlStyle={htmlStyle}
        onFocus={showFormattingToolbar}
        onChangeText={handleChangeText}
        onChangeHtml={handleChangeHtml}
        onChangeState={handleChangeState}
        androidExperimentalSynchronousEvents
        style={inputStyle}
        {...(initialBodyHtml ? { defaultValue: initialBodyHtml } : {})}
      />
    </View>
  );
}

function RecipientField({
  field,
  label,
  placeholder,
  leftAccessory,
  rightAccessory,
}: {
  field: RecipientFieldName;
  label?: string | undefined;
  placeholder: string;
  leftAccessory?: ReactNode | undefined;
  rightAccessory?: ReactNode | undefined;
}): ReactElement {
  const {
    recipients,
    recipientInputs,
    updateRecipientInput,
    commitRecipientInput,
    selectRecipientSuggestion,
    removeLastRecipient,
    contactPool,
  } = useMailboxReply();

  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-foreground') as string;

  const fieldRecipients = recipients[field];
  const inputValue = recipientInputs[field];
  const isEmpty = fieldRecipients.length === 0;
  const suggestions = useMemo(
    () =>
      isFocused
        ? buildSuggestions(
            contactPool,
            inputValue,
            fieldRecipients.map(recipient => recipient.email),
          )
        : [],
    [contactPool, fieldRecipients, inputValue, isFocused],
  );

  const handleSubmit = useCallback(() => {
    const first = suggestions[0];
    if (first) {
      selectRecipientSuggestion(field, first);
      return;
    }
    commitRecipientInput(field);
  }, [commitRecipientInput, field, selectRecipientSuggestion, suggestions]);

  return (
    <View>
      <View
        className='flex-row border-b border-foreground/15 px-4'
        style={{
          minHeight: isEmpty ? 56 : 76,
          paddingTop: isEmpty ? 0 : 8,
          paddingBottom: isEmpty ? 4 : 8,
        }}
      >
        <View style={{ width: LEFT_COLUMN_WIDTH - 34 }} className='items-start justify-center'>
          {leftAccessory ?? <Text className='px-2 text-[16px] text-foreground/70'>{label}</Text>}
        </View>

        <View className='min-w-0 flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-2 py-1'>
          {fieldRecipients.map(recipient => (
            <RecipientPill key={recipient.id} recipient={recipient} />
          ))}

          <TextInput
            ref={inputRef}
            value={inputValue}
            onChangeText={value => updateRecipientInput(field, value)}
            onSubmitEditing={handleSubmit}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setTimeout(() => {
                setIsFocused(false);
                commitRecipientInput(field);
              }, 180);
            }}
            onKeyPress={event => {
              if (event.nativeEvent.key === 'Backspace' && inputValue.length === 0) {
                removeLastRecipient(field);
              }
            }}
            submitBehavior='newline'
            autoCapitalize='none'
            autoCorrect={false}
            keyboardType='default'
            returnKeyType='done'
            placeholder={
              fieldRecipients.length === 0 && field !== 'cc' && field !== 'bcc' ? placeholder : ''
            }
            placeholderTextColor={muted}
            className='text-[18px] text-foreground'
            style={{
              color: foreground,
              minWidth: inputValue.length > 0 ? 132 : 72,
              flexGrow: 1,
              padding: 0,
              height: isEmpty ? '100%' : 'auto',
            }}
          />
        </View>

        {rightAccessory ? (
          <View className='items-center justify-start pt-2'>{rightAccessory}</View>
        ) : null}
      </View>

      <RecipientSuggestionsDropdown
        suggestions={suggestions}
        onSelect={suggestion => {
          selectRecipientSuggestion(field, suggestion);
          setIsFocused(false);
        }}
      />
    </View>
  );
}

function ReplyModeButton(): ReactElement {
  const { replyMode, setReplyMode } = useMailboxReply();
  const scheme = useColorScheme();
  const foreground = useCSSVariable('--color-foreground') as string;
  const background = useCSSVariable('--color-background') as string;
  const input = useCSSVariable('--color-input') as string;
  const selectedBackground = withAlpha(foreground, 0.08);
  const borderColor = withAlpha(foreground, 0.1);
  const menuBackground = scheme === 'dark' ? background : input;
  const Icon = replyMode === 'replyAll' ? ReplyAll : Reply;
  const label = replyMode === 'replyAll' ? 'Reply all' : 'Reply';

  const itemStyle = useCallback(
    (value: MailboxReplyMode) => ({
      minHeight: 48,
      backgroundColor: replyMode === value ? selectedBackground : 'transparent',
    }),
    [replyMode, selectedBackground],
  );

  return (
    <Dropdown>
      <Dropdown.Trigger
        accessibilityLabel={`Reply mode: ${label}`}
        className='flex-row items-center gap-2 rounded-full px-2 py-1 active:bg-foreground/5'
      >
        <Icon size={22} color={foreground} strokeWidth={2.2} />
        <ChevronDown size={18} color={foreground} strokeWidth={2.2} />
      </Dropdown.Trigger>

      <Dropdown.Content
        side='bottom'
        align='start'
        sideOffset={8}
        alignOffset={-8}
        edgePadding={8}
        minWidth={172}
        maxWidth={220}
        scrollable={false}
        overlayColor='rgba(0,0,0,0.02)'
        contentStyle={{ paddingVertical: 6 }}
        style={{
          backgroundColor: menuBackground,
          borderColor,
          borderWidth: 0.6,
          borderRadius: 4,
        }}
      >
        <Dropdown.Item
          label='Reply'
          onSelect={() => setReplyMode('reply')}
          style={itemStyle('reply')}
          labelStyle={{ fontSize: 18, lineHeight: 24 }}
        />
        <Dropdown.Item
          label='Reply to all'
          onSelect={() => setReplyMode('replyAll')}
          style={itemStyle('replyAll')}
          labelStyle={{ fontSize: 18, lineHeight: 24 }}
        />
      </Dropdown.Content>
    </Dropdown>
  );
}

function RecipientPill({ recipient }: { recipient: MailboxRecipient }): ReactElement {
  const avatarBg = getMailboxRecipientColor(recipient.email);
  const initial = getMailboxRecipientInitial(recipient);

  return (
    <View className='min-h-8 max-w-[260px] flex-row items-center overflow-hidden rounded-full border-[0.5px] border-foreground/35 p-[1px] pr-4'>
      <View className='mr-2 size-8 overflow-hidden rounded-full'>
        {recipient.userId ? (
          <Avatar
            userIds={[recipient.userId]}
            fallbackUsers={[
              {
                id: recipient.userId,
                name: recipient.name,
                picture: recipient.avatarUrl ?? null,
              },
            ]}
            size={32}
          />
        ) : recipient.avatarUrl ? (
          <Image source={{ uri: recipient.avatarUrl }} className='size-8' />
        ) : (
          <View
            className='size-8 items-center justify-center rounded-full'
            style={{ backgroundColor: avatarBg }}
          >
            <Text className='text-[18px] font-medium text-white'>{initial}</Text>
          </View>
        )}
      </View>

      <Text className='min-w-0 text-[16px] font-semibold text-foreground' numberOfLines={1}>
        {recipient.name}
      </Text>
    </View>
  );
}

type MailboxReplyFormatButtonConfig = {
  id: string;
  Icon: LucideIcon;
  activeKey: keyof OnChangeStateEvent;
  accessibilityLabel: string;
  onPress: (input: EnrichedTextInputInstance) => void;
};

const MAILBOX_REPLY_FORMAT_BUTTONS: readonly MailboxReplyFormatButtonConfig[] = [
  {
    id: 'bold',
    Icon: Bold,
    activeKey: 'bold',
    accessibilityLabel: 'Toggle bold',
    onPress: input => input.toggleBold(),
  },
  {
    id: 'italic',
    Icon: Italic,
    activeKey: 'italic',
    accessibilityLabel: 'Toggle italic',
    onPress: input => input.toggleItalic(),
  },
  {
    id: 'underline',
    Icon: Underline,
    activeKey: 'underline',
    accessibilityLabel: 'Toggle underline',
    onPress: input => input.toggleUnderline(),
  },
  {
    id: 'strike',
    Icon: Strikethrough,
    activeKey: 'strikeThrough',
    accessibilityLabel: 'Toggle strikethrough',
    onPress: input => input.toggleStrikeThrough(),
  },
  {
    id: 'unordered-list',
    Icon: List,
    activeKey: 'unorderedList',
    accessibilityLabel: 'Toggle bullet list',
    onPress: input => input.toggleUnorderedList(),
  },
  {
    id: 'ordered-list',
    Icon: ListOrdered,
    activeKey: 'orderedList',
    accessibilityLabel: 'Toggle numbered list',
    onPress: input => input.toggleOrderedList(),
  },
  {
    id: 'quote',
    Icon: Quote,
    activeKey: 'blockQuote',
    accessibilityLabel: 'Toggle quote',
    onPress: input => input.toggleBlockQuote(),
  },
  {
    id: 'inline-code',
    Icon: Code,
    activeKey: 'inlineCode',
    accessibilityLabel: 'Toggle inline code',
    onPress: input => input.toggleInlineCode(),
  },
];

function FormattingToolbar(): ReactElement {
  const insets = useSafeAreaInsets();
  const { formattingToolbarVisible, hideFormattingToolbar, bodyInputRef } = useMailboxReply();
  const foreground = useCSSVariable('--color-foreground') as string;

  const progress = useSharedValue(formattingToolbarVisible ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(formattingToolbarVisible ? 1 : 0, { duration: 180 });
  }, [formattingToolbarVisible, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  return (
    <KeyboardStickyView
      enabled={formattingToolbarVisible}
      offset={{ closed: 0, opened: insets.bottom - 10 }}
      pointerEvents={formattingToolbarVisible ? 'auto' : 'none'}
      style={KEYBOARD_STICKY_STYLE}
    >
      <Animated.View style={animatedStyle}>
        <View
          className='bg-neutral-100 px-4 pt-2 dark:bg-tabs-screen'
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}
        >
          <View className='flex-row items-center gap-3'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Close formatting toolbar'
              hitSlop={8}
              onPress={() => {
                hideFormattingToolbar();
                requestAnimationFrame(() => bodyInputRef.current?.blur());
              }}
              className='size-12 items-center justify-center rounded-full bg-foreground/5 active:bg-foreground/10'
            >
              <X size={24} color={foreground} strokeWidth={2.1} />
            </Pressable>

            <View className='min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/5 py-2'>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps='handled'
                contentContainerStyle={{
                  alignItems: 'center',
                  gap: 18,
                  paddingHorizontal: 14,
                }}
              >
                {MAILBOX_REPLY_FORMAT_BUTTONS.map(config => (
                  <FormattingToolbarButton key={config.id} config={config} />
                ))}
              </ScrollView>
            </View>
          </View>
        </View>
      </Animated.View>
    </KeyboardStickyView>
  );
}

function FormattingToolbarButton({
  config,
}: {
  config: MailboxReplyFormatButtonConfig;
}): ReactElement {
  const { bodyInputRef, bodyStyleState } = useMailboxReply();
  const foreground = useCSSVariable('--color-foreground') as string;
  const activeColor = useCSSVariable('--color-action-primary') as string;

  const activeState = bodyStyleState?.[config.activeKey] as
    { isActive?: boolean; isBlocking?: boolean } | undefined;
  const isActive = Boolean(activeState?.isActive);
  const disabled = Boolean(activeState?.isBlocking);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={config.accessibilityLabel}
      disabled={disabled}
      onPress={() => {
        const input = bodyInputRef.current;
        if (!input) return;

        config.onPress(input);
        requestAnimationFrame(() => input.focus());
      }}
      className={
        isActive
          ? 'size-9 items-center justify-center rounded-full bg-action-primary/15'
          : 'size-9 items-center justify-center rounded-full active:bg-foreground/10'
      }
      style={disabled ? { opacity: 0.35 } : undefined}
    >
      <config.Icon size={20} color={isActive ? activeColor : foreground} strokeWidth={2.2} />
    </Pressable>
  );
}

export const MailboxReply = Object.assign(MailboxReplyRoot, {
  Header,
  Form,
  BackButton,
  AttachmentButton,
  SendButton,
  From,
  To,
  Cc,
  Bcc,
  Subject,
  Body,
  FormattingToolbar,
});
