import { logger, Event as LogEvent } from '../../../utils/logger';
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import type { Editor } from '@tiptap/react';
import DOMPurify from 'dompurify';
import {
  ArrowUp,
  Check,
  ChevronDown,
  CornerUpLeft,
  Eraser,
  Loader2,
  Minimize2,
  ExternalLink,
  Paperclip,
  PencilLine,
  RefreshCw,
  ReplyAll,
  Send,
  Signature,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Tooltip from '../../ui/Tooltip';
import { AttachmentPreview } from '../../ui/files/AttachmentPreview';
import { MediaViewer } from '../../ui/files';
import type { UploadedFile } from '../../ui/files/Files.types';
import { cn } from '../../../utils/classNames';
import type { DraftSource } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import {
  attachmentViewerActor,
  type AttachmentRef,
} from '../../../machines/attachmentViewerMachine';
import { threadCitationStore } from '../ThreadCitationModal/ThreadCitationModal';

import { apiInstance, BASE_URL } from '../../../services/clients/apiClient';
import { markdownToHtml } from '../../../utils/clipboardUtils';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useUsers } from '../../../hooks/useUsers';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useComposeSubjectAI } from '../../../hooks/useComposeSubjectAI';
import { AutoDraftStatus, type EmailChannelPreference } from '@xyne/shared';
import { useEmailDraftOperations, type EmailDraftRecord } from '../../../hooks/useEmailDraft';
import { useComposeDraftOperations, type ComposeDraftRecord } from '../../../hooks/useComposeDraft';
import { useDeskAIDraft } from '../../../hooks/useDeskAIDraft';
import { useDeskContacts } from '../../../hooks/useDeskContacts';
import { useChannelClawAgents } from '../../../hooks/useChannelClawAgents';

import { DraftCard } from '../DraftCard/DraftCard';
import { EmailEditor } from '../EmailEditor/EmailEditor';
import { AIComposerPanel, AIRefineDropdown } from '../AIComposerPanel/AIComposerPanel';
import {
  appendCitationBlock,
  stripCitationBlock,
  stripCitationMarks,
} from '../../ui/TipTapExtensions/CitationMark';
import { RecipientPillExtension } from '../../ui/TipTapExtensions';
import { Popover } from '../../ui/Popover/Popover';
import { RecipientMentionSelector } from './RecipientMentionSelector';
import { RecipientField as RecipientFieldRow } from './RecipientField';
import { Button } from '../../ui/Button/Button';

import {
  buildContactPool,
  buildSuggestions,
  makeRecipientKeyDownHandler,
  splitAndValidateEmails,
  type RecipientField,
  type ComposerEmail,
} from './recipients';
import { useComposerResize, COMPOSER_MAX_HEIGHT_PX } from './useComposerResize';
import { useComposerDragDrop } from './useComposerDragDrop';
import {
  MAX_EMAIL_ATTACHMENT_FILES,
  MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES,
  parseFromField,
  sanitizeSignatureHtml,
  stripHtml,
} from './helpers';

export const COMPOSER_RESIZE_STEP_PX = 20;

/**
 * Per-feature toggles. Reply and compose enable different subsets — keep this
 * data-driven instead of sprinkling `mode === 'compose'` checks throughout the
 * JSX. Defaults are derived from `mode` (see {@link resolveFeatures}); pass
 * a partial `features` prop to override individual flags from the call site.
 */
export interface EmailComposerFeatures {
  /** Show the collapsed "Reply to" pill state (replaces the editor when collapsed). */
  collapsible: boolean;
  /** Show the chevron-back icon next to "To" that triggers collapse. */
  showCollapseIcon: boolean;
  /** Render a Subject input row (compose only — reply inherits subject from thread). */
  showSubject: boolean;
  /** Show AI features: Quick rewrite + Ask AI buttons, draft trigger, draft/AI panel cards. */
  showAI: boolean;
  /** Show the signature picker dropdown. */
  showSignature: boolean;
  /** Show the Minimize2 button in the bottom toolbar (modal owns its own minimize in compose). */
  showMinimizeButton: boolean;
  /** Show the Trash2 discard button in the bottom toolbar (modal close acts as discard in compose). */
  showDiscardButton: boolean;
  /** Render the top drag-grip strip for resizing the composer height. */
  showResizeGrip: boolean;
  /** Wrap the composer in `p-4` + a rounded bordered card. Off when the parent already provides the frame (e.g. modal). */
  showCardWrap: boolean;
}

const REPLY_FEATURES: EmailComposerFeatures = {
  collapsible: true,
  showCollapseIcon: true,
  showSubject: false,
  showAI: true,
  showSignature: true,
  showMinimizeButton: true,
  showDiscardButton: true,
  showResizeGrip: true,
  showCardWrap: true,
};

type AIPanelMode = 'quick-rewrite' | 'ask-ai';
const aiPanelModeByConv = new Map<string, AIPanelMode>();

const COMPOSE_FEATURES: EmailComposerFeatures = {
  collapsible: false,
  showCollapseIcon: false,
  showSubject: true,
  showAI: true,
  showSignature: true,
  showMinimizeButton: false,
  // Compose mode now saves on X (close = save draft), so we need an explicit
  // discard button so users can still throw away a draft they don't want.
  showDiscardButton: true,
  showResizeGrip: false,
  showCardWrap: false,
};

const resolveFeatures = (
  mode: 'reply' | 'compose',
  overrides?: Partial<EmailComposerFeatures>,
): EmailComposerFeatures => ({
  ...(mode === 'compose' ? COMPOSE_FEATURES : REPLY_FEATURES),
  ...overrides,
});

const sameEmailList = (a: string[] | null | undefined, b: string[] | null | undefined): boolean => {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

interface EmailComposerProps {
  conversationId?: string | null | undefined;
  drafts?: readonly EmailDraftRecord[];
  composeDrafts?: readonly ComposeDraftRecord[];
  composeDraftsLoaded?: boolean;
  channelConnectedEmail: string;
  emails?: ReadonlyArray<ComposerEmail> | undefined;
  onClose?: () => void;
  onDiscard?: () => void;
  isAIPanelOpen?: boolean;
  onToggleAIPanel?: () => void;
  onOpenAskAISidebarFresh?: () => void;
  channelId?: string;
  ticketId?: string | null | undefined;
  replyToEmailId?: string | null;
  replyMode?: 'reply' | 'replyAll';
  setReplyMode?: (mode: 'reply' | 'replyAll') => void;
  mode?: 'reply' | 'compose';
  /** Ticket title from Xyne Desk — sent as the reply subject so Gmail reflects the current ticket name. */
  ticketSubject?: string | null;
  /** Override individual feature toggles. Defaults are derived from `mode`. */
  features?: Partial<EmailComposerFeatures>;
  /**
   * Unique ID for scoping the compose-mode localStorage draft.
   * When provided (multi-compose scenario), the draft key becomes
   * `xyne:composeDraft:${userID}:${composeDraftId}` instead of the default
   * `xyne:composeDraft:${userID}:${channelId}`. This lets multiple compose
   * windows for the same channel each maintain independent drafts.
   */
  composeDraftId?: string;
  onDraftSourcesChange?: (sources: DraftSource[]) => void;
  onCitationOrderChange?: (orderedRefs: string[]) => void;
  onSeeSources?: (sessionId?: string) => void;
  hasAutoDraft?: boolean;
  /** Pre-fill the To field when the composer mounts (draft restoration takes precedence). */
  initialTo?: string[];
  channelPreference: EmailChannelPreference | undefined;
  channelPreferenceLoaded: boolean;
}

export const EmailComposer = ({
  conversationId,
  drafts,
  composeDrafts = [],
  composeDraftsLoaded = false,
  channelConnectedEmail,
  emails: propEmails,
  onClose,
  onDiscard,
  isAIPanelOpen: _isAIPanelOpen,
  onToggleAIPanel,
  onOpenAskAISidebarFresh,
  channelId,
  ticketId,
  replyToEmailId,
  replyMode = 'reply',
  setReplyMode,
  mode = 'reply',
  features: featureOverrides,
  composeDraftId,
  ticketSubject,
  onDraftSourcesChange,
  onCitationOrderChange,
  onSeeSources,
  hasAutoDraft = false,
  initialTo,
  channelPreference,
  channelPreferenceLoaded,
}: EmailComposerProps): ReactElement => {
  const isComposeMode = mode === 'compose';
  const features = resolveFeatures(mode, featureOverrides);
  // Current user — used to scope localStorage compose drafts so two users
  // sharing the same browser don't see each other's in-flight drafts.
  const { userID } = useAuthContextValues();
  // One-shot AI helper for the wand button next to the Subject field.
  const subjectAI = useComposeSubjectAI(channelId ?? null);
  const emails = propEmails;
  const channelAliasEmail = channelPreference?.sendAsEmail ?? null;
  const clawAgents = useChannelClawAgents(channelId || null);
  const draftAgentName =
    clawAgents.find(a => a.slug === channelPreference?.autoDraftAgentSlug)?.name ?? 'Xyne AI';
  const deskContacts = useDeskContacts(channelId);
  const {
    saveDraft,
    saveRecipients,
    deleteDraft,
    draftId,
    draft: ownDraft,
    latestDraft: draft,
  } = useEmailDraftOperations(conversationId, channelId, drafts);
  const isAutoDraftGenerating =
    !isComposeMode && draft?.autoDraftStatus === AutoDraftStatus.GENERATING;
  const [emailContent, setEmailContent] = useState<string>('');
  // Subject is only meaningful in compose mode — reply inherits from the thread.
  const [composeSubject, setComposeSubject] = useState<string>('');

  const [aiPanelMode, setAIPanelModeState] = useState<AIPanelMode | null>(() =>
    conversationId ? (aiPanelModeByConv.get(conversationId) ?? null) : null,
  );
  useEffect(() => {
    if (!conversationId) {
      setAIPanelModeState(null);
      return;
    }
    setAIPanelModeState(aiPanelModeByConv.get(conversationId) ?? null);
  }, [conversationId]);
  const setAIPanelMode = useCallback(
    (next: AIPanelMode | null): void => {
      setAIPanelModeState(next);
      if (conversationId) {
        if (next) aiPanelModeByConv.set(conversationId, next);
        else aiPanelModeByConv.delete(conversationId);
      }
    },
    [conversationId],
  );

  const [aiPromptOpen, setAiPromptOpen] = useState<boolean>(false);
  const [aiPromptText, setAiPromptText] = useState<string>('');
  const aiPromptInputRef = useRef<HTMLInputElement | null>(null);

  // AI draft pane toggle — your draft always shows as plain text above it.
  const [aiPaneOpen, setAiPaneOpen] = useState(true);
  // Scroll container of the draft-mode view — kept pinned to the bottom so the
  // AI draft card and its actions stay in view while the draft streams in.
  const draftScrollRef = useRef<HTMLDivElement | null>(null);
  // How the active AI draft was produced — picks the accept default:
  // 'write' (new writing) → Insert appends; 'rewrite' (quick changes) → Replace overwrites.
  const lastAskInstructionRef = useRef<string | null>(null);

  const isInlineAIPanelOpen = aiPanelMode !== null;
  const setIsInlineAIPanelOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(aiPanelMode !== null) : next;
      if (resolved) {
        if (aiPanelMode === null) setAIPanelMode('quick-rewrite');
      } else {
        setAIPanelMode(null);
      }
    },
    [aiPanelMode, setAIPanelMode],
  );
  const [isSending, setIsSending] = useState<boolean>(false);
  // Two-step send: when the channel has it enabled, the first Send click opens a
  // review/confirm dialog and the actual send only fires after the user confirms.
  const twoStepSendEnabled = channelPreference?.twoStepSendEnabled ?? false;
  const [showSendConfirm, setShowSendConfirm] = useState<boolean>(false);
  const aiActiveRef = useRef<boolean>(false);
  const users = useUsers();
  const [signatures] = useCachedQuery(queries.userEmailSignatures());
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null | undefined>(
    undefined,
  );
  const composerNavigate = useNavigate();
  const { workspaceId: routeWorkspaceId } = useParams<{ workspaceId?: string }>();
  const supportBase = routeWorkspaceId ? `/${routeWorkspaceId}/support` : '/support';
  const signatureAutoAppend = localStorage.getItem('signature-auto-append-enabled') !== 'false';
  const suppressNextReplyAutosaveRef = useRef(false);

  useEffect(() => {
    if (
      signatures &&
      signatures.length > 0 &&
      signatureAutoAppend &&
      selectedSignatureId === undefined
    ) {
      const defaultSig = signatures.find(s => s.isDefault);
      setSelectedSignatureId(defaultSig?.id ?? signatures[0]?.id ?? null);
    }
  }, [signatures, signatureAutoAppend, selectedSignatureId]);

  type ComposerAttachment = {
    file: File | UploadedFile;
    attachmentId?: string;
    tempId?: string;
  };

  type PersistedComposeAttachment = {
    attachmentId: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
  };

  const toPersistedComposeAttachment = (
    attachment: ComposerAttachment,
  ): PersistedComposeAttachment | null => {
    if (!attachment.attachmentId) return null;
    return {
      attachmentId: attachment.attachmentId,
      originalName:
        'originalName' in attachment.file ? attachment.file.originalName : attachment.file.name,
      fileSize: 'fileSize' in attachment.file ? attachment.file.fileSize : attachment.file.size,
      mimeType: 'mimeType' in attachment.file ? attachment.file.mimeType : attachment.file.type,
    };
  };

  const toUploadedAttachmentFile = (attachment: PersistedComposeAttachment): UploadedFile => ({
    id: attachment.attachmentId,
    originalName: attachment.originalName,
    fileName: attachment.originalName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    fileUrl: '',
  });

  const isBrowserFile = (file: File | UploadedFile): file is File => 'slice' in file;

  // Attachment state - tracks files with their uploaded attachment IDs
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  attachmentsRef.current = attachments;
  const [isUploadingAttachments, setIsUploadingAttachments] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [bodyEditor, setBodyEditor] = useState<Editor | null>(null);
  // Tracks the conversation draft for which we have already performed the initial
  // attachment restore. Prevents subsequent Zero reactive updates (e.g. after
  // an autosave changes `updatedAt`) from re-running the restore and clearing
  // attachments the user has added during the current session.
  const restoredAttachmentsForDraftRef = useRef<string | null>(null);
  // Tracks the conversation whose recipients we've already hydrated from defaults
  // (localStorage / thread). Once hydrated, the user's recipient edits — including clearing
  // every field — are authoritative and must not be re-derived by a later draft re-emit.
  const recipientsHydratedRef = useRef<string | null>(null);
  // replyMode recipients were last derived for; a change forces re-derivation.
  const lastDerivedReplyModeRef = useRef<'reply' | 'replyAll' | null>(null);

  // Reset all composer state when switching conversations
  useEffect(() => {
    setAttachments([]);
    setPreviewFile(null);
    setIsPreviewOpen(false);
    restoredAttachmentsForDraftRef.current = null;
    recipientsHydratedRef.current = null;
    lastDerivedReplyModeRef.current = null;
  }, [conversationId]);

  const lastLoadedContentRef = React.useRef<string>('');
  const justLoadedDraftRef = React.useRef(false);
  const isDirty = emailContent !== lastLoadedContentRef.current;
  const hydratedConversationRef = React.useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (isComposeMode) return;
    const draftKey = conversationId ?? null;
    if (hydratedConversationRef.current === draftKey && isDirty) return;
    const next = draft?.draftContent ?? '';
    setEmailContent(next);
    lastLoadedContentRef.current = next;
    justLoadedDraftRef.current = true;
    hydratedConversationRef.current = draftKey;
  }, [draft?.draftContent, conversationId, isComposeMode, isDirty]);

  const handleEditorChange = useCallback((html: string): void => {
    setEmailContent(html);
    if (justLoadedDraftRef.current) {
      lastLoadedContentRef.current = html;
      justLoadedDraftRef.current = false;
    }
  }, []);

  const hasEmailBody = useMemo(() => stripHtml(emailContent).trim().length > 0, [emailContent]);
  const hasInlineImages = useMemo(
    () =>
      /\sdata-att-id=["']/i.test(emailContent) ||
      /\/attachments\/[^/"'\s]+\/download/i.test(emailContent),
    [emailContent],
  );

  const toInputRef = React.useRef<HTMLInputElement>(null);
  const ccInputRef = React.useRef<HTMLInputElement>(null);
  const bccInputRef = React.useRef<HTMLInputElement>(null);
  // Anchor the suggestion dropdowns to the row container, not the input — the
  // input is `flex-1 min-w-[80px]` and shrinks to a narrow strip once a few
  // tags are added, which would drag the dropdown's width and X with it.
  const toRowRef = React.useRef<HTMLDivElement>(null);
  const ccRowRef = React.useRef<HTMLDivElement>(null);
  const bccRowRef = React.useRef<HTMLDivElement>(null);
  const [toInputValue, setToInputValue] = useState<string>('');
  const [ccInputValue, setCcInputValue] = useState<string>('');
  const [bccInputValue, setBccInputValue] = useState<string>('');

  // Recipient state
  const [toEmails, setToEmails] = useState<string[]>(initialTo ?? []);
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [bccEmails, setBccEmails] = useState<string[]>([]);
  const [showCc, setShowCc] = useState<boolean>(true);
  const [showBcc, setShowBcc] = useState<boolean>(false);
  const [isToExpanded, setIsToExpanded] = useState(false);
  const [isCcExpanded, setIsCcExpanded] = useState(false);
  const [isBccExpanded, setIsBccExpanded] = useState(false);
  const onRemoveRecipientFromBodyRef = useRef<(email: string) => void>(() => undefined);
  const onAddRecipientToFromBodyRef = useRef<(email: string) => void>(() => undefined);

  const applyRecipients = useCallback(
    (next: { to: string[]; cc: string[]; bcc: string[] }): void => {
      setToEmails(next.to);
      setCcEmails(next.cc);
      setBccEmails(next.bcc);
    },
    [],
  );

  const applyUserRecipients = useCallback(
    (next: { to: string[]; cc: string[]; bcc: string[] }): void => {
      applyRecipients(next);
      if (!isComposeMode) saveRecipients(next.to, next.cc, next.bcc);
    },
    [applyRecipients, isComposeMode, saveRecipients],
  );

  const saveReplyDraft = useCallback(
    (content: string, attachmentIds?: string[]): string | null =>
      saveDraft(content, attachmentIds, {
        to: toEmails,
        cc: ccEmails,
        bcc: bccEmails,
      }),
    [saveDraft, toEmails, ccEmails, bccEmails],
  );

  // Body pill -> To sync only. To chip add/remove does not touch the editor body.
  const handleRemoveRecipientFromBody = useCallback(
    (email: string): void => {
      const lower = email.toLowerCase().trim();
      applyUserRecipients({
        to: toEmails.filter(e => e.toLowerCase().trim() !== lower),
        cc: ccEmails,
        bcc: bccEmails,
      });
    },
    [applyUserRecipients, toEmails, ccEmails, bccEmails],
  );

  const handleAddRecipientFromBody = useCallback(
    (email: string): void => {
      const lower = email.toLowerCase().trim();
      if (toEmails.some(e => e.toLowerCase().trim() === lower)) return;
      applyUserRecipients({
        to: [...toEmails, email],
        cc: ccEmails,
        bcc: bccEmails,
      });
    },
    [applyUserRecipients, toEmails, ccEmails, bccEmails],
  );

  onRemoveRecipientFromBodyRef.current = handleRemoveRecipientFromBody;
  onAddRecipientToFromBodyRef.current = handleAddRecipientFromBody;

  const recipientExtensions = useMemo(
    () => [
      RecipientPillExtension.configure({
        onRemoveRecipient: (email: string) => onRemoveRecipientFromBodyRef.current(email),
      }),
    ],
    [],
  );

  const anyFieldExpanded = isToExpanded || isCcExpanded || isBccExpanded;

  // Auto-collapse expanded recipient fields when clicking outside them or focusing the editor.
  useEffect(() => {
    if (!anyFieldExpanded) return undefined;
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      // Don't collapse if the click is inside any recipient field row, chip container,
      // or the floating suggestion dropdown (rendered via React portal).
      const insideTo = toRowRef.current?.contains(target);
      const insideCc = ccRowRef.current?.contains(target);
      const insideBcc = bccRowRef.current?.contains(target);
      const insideDropdown =
        target instanceof Element && target.closest('.recipient-suggestions-dropdown');
      if (insideTo || insideCc || insideBcc || insideDropdown) return;
      setIsToExpanded(false);
      setIsCcExpanded(false);
      setIsBccExpanded(false);
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [anyFieldExpanded]);

  const clearRecipientsForDraft = useCallback(
    (storageKeys: Array<string | null | undefined>): void => {
      try {
        for (const storageKey of storageKeys) {
          if (storageKey) localStorage.removeItem(storageKey);
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // Persist / clear attachment metadata to localStorage so they survive the Zero
  // reactive-cache limitation with json() columns (see restore effect above).
  // Stores { id, name, mimeType } so the extension badge renders correctly on restore.
  type PersistedReplyAttachment = { id: string; name: string; mimeType: string };

  const persistAttachmentsForDraft = useCallback(
    (storageKey: string, attachments: PersistedReplyAttachment[]): void => {
      try {
        if (attachments.length === 0) {
          localStorage.removeItem(storageKey);
          return;
        }
        localStorage.setItem(storageKey, JSON.stringify(attachments));
      } catch {
        /* ignore quota errors */
      }
    },
    [],
  );

  const clearAttachmentsForDraft = useCallback(
    (storageKeys: Array<string | null | undefined>): void => {
      try {
        for (const storageKey of storageKeys) {
          if (storageKey) localStorage.removeItem(storageKey);
        }
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const currentUserEmail = users?.find(u => u.id === userID)?.email ?? null;
  const aiDraft = useDeskAIDraft({
    channelId: channelId || '',
    conversationId: conversationId || '',
    ticketId: ticketId ?? null,
    mode,
    headers: {
      from: channelAliasEmail || channelConnectedEmail || currentUserEmail || null,
      to: toEmails,
      cc: ccEmails,
      signatureWillBeAppended: !!selectedSignatureId,
    },
    agentSlug: channelPreference?.autoDraftAgentSlug ?? 'draft-agent',
  });

  const contentWithDraftCitations = useCallback(
    (content: string): string =>
      appendCitationBlock(content, aiDraft.draftContent || draft?.draftContent),
    [aiDraft.draftContent, draft?.draftContent],
  );

  const displayEmailContent = useMemo(() => stripCitationBlock(emailContent), [emailContent]);

  useEffect(() => {
    onDraftSourcesChange?.(aiDraft.draftSources);
  }, [aiDraft.draftSources, onDraftSourcesChange]);

  // Clear stale editor ref when the body EmailEditor unmounts (e.g. draft pane collapsed).
  useEffect(() => {
    const bodyEditorMounted = !aiDraft.isDraftActive && aiPanelMode === null;
    if (!bodyEditorMounted) {
      setBodyEditor(null);
    }
  }, [aiDraft.isDraftActive, aiPanelMode]);

  const [composeSources, setComposeSources] = useState<DraftSource[]>([]);

  const openSourcePreview = useCallback(
    (ref: string): void => {
      const sourcePool = aiDraft.draftSources.length > 0 ? aiDraft.draftSources : composeSources;
      const source = sourcePool.find(s => s.prefixedRef === ref);
      if (!source) return;

      if (source.entityType === 'attachment' && source.entityId) {
        const pageMatch = source.chunkText?.match(/^\[Pages?\s+(\d+)/i);
        const initialPage = pageMatch?.[1] ? Number(pageMatch[1]) : source.chunkPos;
        const attachment: AttachmentRef = {
          attachmentId: source.entityId,
          fileName: source.fileName ?? source.entityId,
          fileUrl: `/attachments/${source.entityId}/download`,
          mimeType: source.mimeType ?? 'application/octet-stream',
          fileSize: 0,
          ...(initialPage !== undefined && initialPage !== null && { initialPage }),
        };
        attachmentViewerActor.send({ type: 'OPEN', attachments: [attachment], startIndex: 0 });
        return;
      }

      if (source.entityType === 'ticket' && source.entityId) {
        threadCitationStore.open({
          ticketId: source.entityId,
          ...(source.channelId && { channelId: source.channelId }),
          ...(source.messageId && { messageId: source.messageId }),
        });
        return;
      }

      if (source.entityType === 'message' && source.conversationId) {
        threadCitationStore.open({
          conversationId: source.conversationId,
          ...(source.channelId && { channelId: source.channelId }),
          ...((source.messageId || source.entityId) && {
            messageId: source.messageId || source.entityId!,
          }),
        });
        return;
      }

      if (source.entityType === 'canvas' && source.canvasId && routeWorkspaceId) {
        void composerNavigate(`/${routeWorkspaceId}/chat/canvas/${source.canvasId}`);
        return;
      }

      if ((source.entityType === 'web_search' || source.isExternal) && source.externalUrl) {
        window.open(source.externalUrl, '_blank', 'noopener,noreferrer');
      }
    },
    [aiDraft.draftSources, composeSources, routeWorkspaceId, composerNavigate],
  );

  const [isExpandedState, setIsExpanded] = useState<boolean>(true);
  // Compose mode is always expanded — there's no reply-thread to collapse to.
  const isExpanded = isComposeMode ? true : isExpandedState;

  const {
    composerHeight,
    setComposerHeight,
    handlePointerDown: handleComposerResizePointerDown,
    resizeTargetRef,
    minHeight,
  } = useComposerResize({
    enabled: isExpanded && !isSending,
    useTallMinHeight: aiDraft.isDraftActive || isInlineAIPanelOpen,
    recipientExpanded: anyFieldExpanded,
    initialHeight: 480,
    defaultMinHeight: 360,
  });

  const runAskAIRefine = useCallback(
    (instruction: string): void => {
      lastAskInstructionRef.current = instruction;
      setAiPaneOpen(true);
      aiDraft.askAIRefine(instruction, stripHtml(emailContent));
    },
    [aiDraft, emailContent],
  );

  useEffect(() => {
    if (aiDraft.isStreaming) setAiPaneOpen(true);
  }, [aiDraft.isStreaming]);

  // Keep the AI draft card fully in view: scroll to the bottom when the card
  // opens and stay pinned there while the draft streams in.
  useEffect(() => {
    if (!aiDraft.isDraftActive || !aiPaneOpen) return;
    const el = draftScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aiDraft.isDraftActive, aiPaneOpen, aiDraft.draftContent]);

  // Drag-and-drop chips between To / Cc / Bcc.
  const [dragOverField, setDragOverField] = useState<RecipientField | null>(null);
  const DRAG_MIME = 'application/x-xd-recipient';

  const moveRecipient = useCallback(
    (from: RecipientField, to: RecipientField, email: string): void => {
      if (from === to) return;
      const current = {
        to: toEmails,
        cc: ccEmails,
        bcc: bccEmails,
      };
      const next = {
        ...current,
        [from]: current[from].filter(e => e !== email),
        [to]: current[to].includes(email) ? current[to] : [...current[to], email],
      };
      applyUserRecipients(next);
    },
    [applyUserRecipients, toEmails, ccEmails, bccEmails],
  );

  const handleChipDragStart = useCallback(
    (field: RecipientField, email: string) =>
      (e: DragEvent<HTMLDivElement>): void => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ field, email }));
        // Plaintext fallback so OS-level drag indicators show something sensible.
        e.dataTransfer.setData('text/plain', email);
        setShowCc(true);
        setShowBcc(true);
        if (field === 'to') setIsToExpanded(true);
        if (field === 'cc') setIsCcExpanded(true);
        if (field === 'bcc') setIsBccExpanded(true);
      },
    [],
  );

  const handleChipDragEnd = useCallback((): void => {
    setDragOverField(null);
  }, []);

  const handleFieldDragOver = useCallback(
    (field: RecipientField) =>
      (e: DragEvent<HTMLDivElement>): void => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverField(prev => (prev === field ? prev : field));
      },
    [],
  );

  const handleFieldDragLeave = useCallback(
    (field: RecipientField) =>
      (e: DragEvent<HTMLDivElement>): void => {
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        setDragOverField(prev => (prev === field ? null : prev));
      },
    [],
  );

  const handleFieldDrop = useCallback(
    (toField: RecipientField) =>
      (e: DragEvent<HTMLDivElement>): void => {
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        e.preventDefault();
        try {
          const parsed = JSON.parse(raw) as { field: RecipientField; email: string };
          if (parsed.email && parsed.field) {
            moveRecipient(parsed.field, toField, parsed.email);
          }
        } catch {
          // ignore — payload not ours
        }
        setDragOverField(null);
      },
    [moveRecipient],
  );

  const recipientsStorageKey =
    !isComposeMode && conversationId ? `xyne:emailDraft:recipients:${conversationId}` : null;

  // Compose drafts are persisted server-side (synced across devices) in `email_drafts`
  // with `conversationId IS NULL`, keyed by the compose-window id (reused as the row id)
  // — or the channelId for a non-multi composer. The server row carries subject + body +
  // recipients + attachmentIds; a small localStorage cache (composeMetaKey) holds only the
  // attachment display metadata + AI sources for same-device fidelity (the row stores ids).
  const composeDraftServerId = isComposeMode ? (composeDraftId ?? channelId ?? null) : null;
  const composeMetaKey =
    isComposeMode && userID && composeDraftServerId
      ? `xyne:composeDraftMeta:${userID}:${composeDraftServerId}`
      : null;

  const { saveComposeDraft, deleteComposeDraft: deleteComposeDraftRow } =
    useComposeDraftOperations(channelId);
  const serverComposeDraft = useMemo<ComposeDraftRecord | undefined>(() => {
    if (!composeDraftServerId) return undefined;
    return composeDrafts.find(d => d.id === composeDraftServerId);
  }, [composeDrafts, composeDraftServerId]);

  // Restore compose draft on mount
  const [composeDraftLoaded, setComposeDraftLoaded] = useState(false);
  // Snapshot of the last-persisted compose content, so the autosave can skip a write
  // when nothing actually changed (e.g. a no-edit reopen) instead of bumping updatedAt
  // and reshuffling the Drafts list. Seeded by the load effect.
  const lastSavedComposeSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    setComposeDraftLoaded(false);
    lastSavedComposeSnapshotRef.current = null;
  }, [composeDraftServerId]);
  useEffect(() => {
    if (isComposeMode && aiDraft.draftSources.length > 0) {
      setComposeSources(aiDraft.draftSources);
    }
  }, [isComposeMode, aiDraft.draftSources]);
  useEffect(() => {
    if (!isComposeMode || composeDraftLoaded || !composeDraftServerId) return;
    // Wait until the compose-drafts query has settled, otherwise an as-yet-unloaded
    // row would be mistaken for "no draft" and we'd mark the composer loaded too early.
    if (!composeDraftsLoaded) return;
    const okEmail = (s: unknown): s is string => typeof s === 'string' && s.includes('@');
    let snapshotTo: string[] = [];
    let snapshotCc: string[] = [];
    let snapshotBcc: string[] = [];
    let snapshotAttachmentIds: string[] = [];
    if (serverComposeDraft) {
      const to = Array.isArray(serverComposeDraft.toRecipients)
        ? serverComposeDraft.toRecipients.filter(okEmail)
        : [];
      const cc = Array.isArray(serverComposeDraft.ccRecipients)
        ? serverComposeDraft.ccRecipients.filter(okEmail)
        : [];
      const bcc = Array.isArray(serverComposeDraft.bccRecipients)
        ? serverComposeDraft.bccRecipients.filter(okEmail)
        : [];
      snapshotTo = to;
      snapshotCc = cc;
      snapshotBcc = bcc;
      if (serverComposeDraft.subject) setComposeSubject(serverComposeDraft.subject);
      if (serverComposeDraft.draftContent) setEmailContent(serverComposeDraft.draftContent);
      if (to.length > 0) setToEmails(to);
      if (cc.length > 0) {
        setCcEmails(cc);
        setShowCc(true);
      }
      if (bcc.length > 0) {
        setBccEmails(bcc);
        setShowBcc(true);
      }
      // The SERVER row's attachmentIds are the source of truth for which attachments the
      // draft carries; the local cache (composeMetaKey) only enriches them with display
      // metadata (name/size/type) and is absent on other devices / after eviction. We must
      // rebuild `attachments` from the server ids regardless of the cache — otherwise the
      // autosave would persist an empty attachmentIds (wiping them) and the send would drop
      // them. AI sources are display-only and come from the cache.
      const metaById = new Map<string, PersistedComposeAttachment>();
      try {
        if (composeMetaKey) {
          const raw = localStorage.getItem(composeMetaKey);
          if (raw) {
            const meta = JSON.parse(raw) as {
              attachments?: PersistedComposeAttachment[];
              sources?: DraftSource[];
            };
            if (meta.sources && meta.sources.length > 0) setComposeSources(meta.sources);
            for (const a of meta.attachments ?? []) metaById.set(a.attachmentId, a);
          }
        }
      } catch {
        /* ignore corrupt cache */
      }
      snapshotAttachmentIds = Array.isArray(serverComposeDraft.attachmentIds)
        ? serverComposeDraft.attachmentIds.filter((x): x is string => typeof x === 'string')
        : [];
      if (snapshotAttachmentIds.length > 0) {
        setAttachments(
          snapshotAttachmentIds.map(id => {
            const persisted: PersistedComposeAttachment = metaById.get(id) ?? {
              attachmentId: id,
              originalName: 'Attachment',
              fileSize: 0,
              mimeType: 'application/octet-stream',
            };
            return { attachmentId: id, file: toUploadedAttachmentFile(persisted) };
          }),
        );
      }
    }
    // Seed the dirty snapshot with exactly what we just loaded so an unedited reopen is a
    // no-op (no redundant write / updatedAt bump). Must mirror the autosave's snapshot shape.
    lastSavedComposeSnapshotRef.current = JSON.stringify({
      subject: serverComposeDraft?.subject ?? '',
      body: serverComposeDraft?.draftContent ?? '',
      to: snapshotTo,
      cc: snapshotCc,
      bcc: snapshotBcc,
      attachmentIds: snapshotAttachmentIds,
    });
    setComposeDraftLoaded(true);
  }, [
    isComposeMode,
    composeDraftLoaded,
    composeDraftServerId,
    composeDraftsLoaded,
    serverComposeDraft,
    composeMetaKey,
  ]);

  // Seed default CC from channel preference when opening a fresh compose (no
  // saved draft). Uses a ref keyed by composeDraftServerId so it fires at most once
  // per compose session — this handles the race where channelPreference loads
  // after composeDraftLoaded has already been set to true.
  const defaultCcSeededKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isComposeMode) return;
    if (!composeDraftLoaded) return;
    if (!composeDraftServerId) return;
    // Already seeded for this compose session.
    if (defaultCcSeededKeyRef.current === composeDraftServerId) return;
    // Preference query hasn't settled yet — wait for next render.
    if (!channelPreferenceLoaded) return;
    // Only seed when the user hasn't already entered CC (saved draft or manual).
    if (ccEmails.length > 0) {
      defaultCcSeededKeyRef.current = composeDraftServerId;
      return;
    }
    if (channelPreference?.defaultCc) {
      const parsed = splitAndValidateEmails(channelPreference.defaultCc, []);
      if (parsed.length > 0) {
        setCcEmails(parsed);
        setShowCc(true);
      }
    }
    defaultCcSeededKeyRef.current = composeDraftServerId;
  }, [
    isComposeMode,
    composeDraftLoaded,
    composeDraftServerId,
    channelPreference?.defaultCc,
    channelPreferenceLoaded,
    ccEmails.length,
  ]);

  // Save compose draft on change. Persists to the server (synced); empties delete the
  // row. The attachment metadata + AI sources are cached locally for same-device display
  // fidelity. A snapshot guard skips no-op writes (e.g. a no-edit reopen) so updatedAt
  // isn't bumped and the Drafts list doesn't reshuffle. (One mutation per keystroke while
  // actively typing — matching the prior localStorage behavior — is acceptable here.)
  useEffect(() => {
    if (!isComposeMode || !composeDraftLoaded || !composeDraftServerId) return;
    const persistedAttachments = attachments
      .map(toPersistedComposeAttachment)
      .filter((attachment): attachment is PersistedComposeAttachment => attachment !== null);
    const isEmpty =
      composeSubject.trim().length === 0 &&
      stripHtml(emailContent).trim().length === 0 &&
      toEmails.length === 0 &&
      ccEmails.length === 0 &&
      bccEmails.length === 0 &&
      persistedAttachments.length === 0;
    const snapshot = JSON.stringify({
      subject: composeSubject,
      body: emailContent,
      to: toEmails,
      cc: ccEmails,
      bcc: bccEmails,
      attachmentIds: persistedAttachments.map(att => att.attachmentId),
    });
    // Unchanged since the last persist/load — don't write (and, for a never-saved blank
    // compose, don't fire a spurious delete against a row that doesn't exist).
    if (snapshot === lastSavedComposeSnapshotRef.current) return;
    if (isEmpty) {
      deleteComposeDraftRow(composeDraftServerId);
      lastSavedComposeSnapshotRef.current = snapshot;
      if (composeMetaKey) {
        try {
          localStorage.removeItem(composeMetaKey);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    saveComposeDraft(composeDraftServerId, {
      subject: composeSubject,
      draftContent: emailContent,
      toRecipients: toEmails,
      ccRecipients: ccEmails,
      bccRecipients: bccEmails,
      attachmentIds: persistedAttachments.map(att => att.attachmentId),
    });
    lastSavedComposeSnapshotRef.current = snapshot;
    if (composeMetaKey) {
      try {
        if (persistedAttachments.length > 0 || composeSources.length > 0) {
          localStorage.setItem(
            composeMetaKey,
            JSON.stringify({
              attachments: persistedAttachments,
              ...(composeSources.length > 0 && { sources: composeSources }),
            }),
          );
        } else {
          localStorage.removeItem(composeMetaKey);
        }
      } catch {
        /* ignore quota */
      }
    }
  }, [
    isComposeMode,
    composeDraftLoaded,
    composeDraftServerId,
    composeMetaKey,
    composeSubject,
    emailContent,
    toEmails,
    ccEmails,
    bccEmails,
    attachments,
    composeSources,
    saveComposeDraft,
    deleteComposeDraftRow,
  ]);

  // Auto-grow the composer the first time the AI draft card OR the AI
  // panel opens, so the side-by-side layout has room. Only bumps on the
  // false → true edge so a user-shrunk size isn't overridden.
  useEffect(() => {
    const sideBySideActive = (aiDraft.isDraftActive || isInlineAIPanelOpen) && hasEmailBody;
    if (sideBySideActive && !aiActiveRef.current) {
      setComposerHeight(h => Math.max(h, 520));
    }
    aiActiveRef.current = sideBySideActive;
  }, [aiDraft.isDraftActive, isInlineAIPanelOpen, hasEmailBody]);

  useEffect(() => {
    if (
      aiPanelMode === 'quick-rewrite' &&
      !hasEmailBody &&
      !isComposeMode &&
      !aiDraft.isDraftActive
    ) {
      setAIPanelMode(null);
    }
  }, [hasEmailBody, aiPanelMode, isComposeMode, aiDraft.isDraftActive, setAIPanelMode]);

  useEffect(() => {
    // In compose mode there's no thread to derive recipients from — start blank.
    if (isComposeMode) return;
    if (!channelPreferenceLoaded) return;
    const replyModeChanged =
      lastDerivedReplyModeRef.current !== null && lastDerivedReplyModeRef.current !== replyMode;
    // Prefer recipients persisted on the draft in the DB (synced across devices). Fall
    // back to legacy localStorage (in-flight drafts saved before this change), then derive
    // from the thread.
    if (!replyModeChanged && ownDraft && Array.isArray(ownDraft.toRecipients)) {
      // The draft carries explicitly-persisted recipients — the source of truth, even when the
      // lists are all empty (the user cleared them). Always re-sync from it: the saveRecipients
      // equality guard keeps this from looping, and respecting an empty list is what makes
      // "clear recipients" actually stick instead of being re-derived from the thread below.
      const ok = (s: unknown): s is string => typeof s === 'string' && s.includes('@');
      const dbTo = (ownDraft.toRecipients ?? []).filter(ok);
      const dbCc = (ownDraft.ccRecipients ?? []).filter(ok);
      const dbBcc = (ownDraft.bccRecipients ?? []).filter(ok);
      if (!sameEmailList(toEmails, dbTo)) setToEmails(dbTo);
      if (!sameEmailList(ccEmails, dbCc)) setCcEmails(dbCc);
      if (!sameEmailList(bccEmails, dbBcc)) setBccEmails(dbBcc);
      setShowCc(dbCc.length > 0);
      setShowBcc(dbBcc.length > 0);
      recipientsHydratedRef.current = conversationId ?? null;
      lastDerivedReplyModeRef.current = replyMode;
      return;
    }
    // Defaults below (localStorage, then thread) are derived ONCE per conversation. After that,
    // the user's recipient edits are authoritative — a later thread update or draft re-emit must
    // not re-derive over them. (A draft with persisted recipients always wins, handled above.)
    if (!replyModeChanged && recipientsHydratedRef.current === conversationId) return;
    if (!replyModeChanged && recipientsStorageKey) {
      try {
        const raw = localStorage.getItem(recipientsStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            to?: string[];
            cc?: string[];
            bcc?: string[];
          };
          if (parsed && Array.isArray(parsed.to)) {
            // Validate: only keep strings that look like email addresses.
            // Stale/corrupted localStorage can contain non-email strings
            // (e.g. labels, names) that blow up the recipient fields.
            const isEmailLike = (s: unknown): s is string =>
              typeof s === 'string' && s.includes('@');
            setToEmails(parsed.to.filter(isEmailLike));
            setCcEmails((parsed.cc ?? []).filter(isEmailLike));
            setBccEmails((parsed.bcc ?? []).filter(isEmailLike));
            setShowCc((parsed.cc ?? []).filter(isEmailLike).length > 0);
            setShowBcc((parsed.bcc ?? []).filter(isEmailLike).length > 0);
            recipientsHydratedRef.current = conversationId ?? null;
            lastDerivedReplyModeRef.current = replyMode;
            return;
          }
        }
      } catch {
        // ignore storage errors (quota, parse) and fall through to compute
      }
    }
    if (emails && emails.length > 0) {
      const sortedEmailsAsc = [...emails].sort((a, b) => {
        const aTime = a.createdAt || 0;
        const bTime = b.createdAt || 0;
        return aTime - bTime;
      });
      const initialEmail = sortedEmailsAsc[0];

      const sortedEmailsDesc = [...emails].sort((a, b) => {
        const aTime = a.createdAt || 0;
        const bTime = b.createdAt || 0;
        return bTime - aTime;
      });
      const latestEmail = sortedEmailsDesc[0];

      const targetEmail = replyToEmailId
        ? emails.find(e => e.id === replyToEmailId) || latestEmail
        : latestEmail;

      if (targetEmail && initialEmail && latestEmail) {
        // Email-address comparator: pulls the bare address out of `"Name" <a@b>`
        // and lowercases it so a single user with mixed-case headers / display
        // names still dedups against themself.
        const extractEmail = (raw: string): string => {
          const m = raw.match(/<([^>]+)>/);
          return (m ? (m[1] ?? raw) : raw).trim().toLowerCase();
        };
        const keyOf = (addr: string): string => extractEmail(addr);
        const selfEmails = new Set(
          [channelConnectedEmail, channelAliasEmail]
            .filter((s): s is string => !!s)
            .map(s => s.trim().toLowerCase()),
        );
        const isSelf = (addr: string): boolean => selfEmails.has(extractEmail(addr));

        let nextTo: string[] = [];
        const nextCc: string[] = [];
        const nextBcc: string[] = [];

        if (replyMode === 'replyAll') {
          // Reply-all is anchored on the email the user clicked Reply All on
          // (`targetEmail`) — that's how Gmail / Outlook do it. Defaults to
          // the latest message when no specific email is targeted, but if
          // the user clicked Reply All on E2 in a 4-email thread, we want
          // E2's recipients, not E4's. Two cases, both produce the right
          // result via the same path because we dedup against `selfEmail`
          // and skip duplicates:
          //
          //   (a) Target is OURS (we sent it):
          //       from   = us            → skipped by isSelf filter
          //       to     = [recipients]  → become nextTo
          //       cc     = [ccs]         → become nextCc
          //
          //   (b) Target is THEIRS:
          //       from   = sender        → first nextTo entry
          //       to     = [us, others]  → us filtered, others appended to nextTo
          //       cc     = [ccs]         → become nextCc
          //
          // Either way: never include ourselves in To, never duplicate.
          // CC is left un-self-filtered — a CC'd address is a deliberate
          // recipient, not an artifact of who's sending.
          const source = targetEmail;
          const seen = new Set<string>();
          const addUnique = (
            target: string[],
            list: ReadonlyArray<string>,
            opts: { filterSelf: boolean },
          ): void => {
            for (const addr of list) {
              if (opts.filterSelf && isSelf(addr)) continue;
              const key = keyOf(addr);
              if (seen.has(key)) continue;
              seen.add(key);
              target.push(addr);
            }
          };

          // Sender first (prefer all Reply-To addresses over From for list-relayed emails).
          if (source.replyTo?.length) addUnique(nextTo, source.replyTo, { filterSelf: true });
          else if (source.from) addUnique(nextTo, [source.from], { filterSelf: true });
          // All original To recipients of the latest message.
          addUnique(nextTo, source.to || [], { filterSelf: true });
          addUnique(nextCc, source.cc || [], { filterSelf: false });
        } else {
          // Plain reply: target the sender of the message the user clicked
          // (or the latest if none was clicked). Same two cases:
          //
          //   (a) That message was OURS — reply to its To list (excluding us).
          //   (b) That message was from someone else — reply to that sender.
          const senderIsSelf = !!targetEmail.from && isSelf(targetEmail.from);
          if (senderIsSelf) {
            nextTo = (targetEmail.to || []).filter(addr => !isSelf(addr));
          } else if (targetEmail.replyTo?.length) {
            nextTo = [...targetEmail.replyTo];
          } else if (targetEmail.from) {
            nextTo = [targetEmail.from];
          }
        }

        // Merge defaultCc from channel preference, skipping duplicates already
        // in nextTo or nextCc (keyed by bare lowercase address).
        if (channelPreference?.defaultCc) {
          const existingBare = [...nextTo, ...nextCc].map(addr => extractEmail(addr));
          const defaultCcAddresses = splitAndValidateEmails(
            channelPreference.defaultCc,
            existingBare,
          );
          nextCc.push(...defaultCcAddresses);
        }

        setToEmails(nextTo);
        setCcEmails(nextCc);
        setBccEmails(nextBcc);

        setShowCc(true);
        setShowBcc(nextBcc.length > 0);
        recipientsHydratedRef.current = conversationId ?? null;
        lastDerivedReplyModeRef.current = replyMode;
      }
    }
  }, [
    emails,
    conversationId,
    channelConnectedEmail,
    channelAliasEmail,
    replyToEmailId,
    replyMode,
    recipientsStorageKey,
    isComposeMode,
    channelPreference?.defaultCc,
    channelPreferenceLoaded,
    ownDraft,
  ]);

  // Upload attachments
  const uploadAttachments = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    if (isComposeMode ? !channelId : !conversationId) return [];

    setIsUploadingAttachments(true);
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));

      const url = isComposeMode
        ? `/email/channels/${channelId}/upload-attachments`
        : `/email/${conversationId}/upload-attachments`;

      const response = await apiInstance.post<{
        attachmentIds: string[];
        failures?: Array<{ filename: string; error: string }>;
      }>(url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data?.failures && response.data.failures.length > 0) {
        const message = response.data.failures
          .map(failure => `${failure.filename}: ${failure.error}`)
          .join('; ');
        throw new Error(message);
      }

      if ((response.data?.attachmentIds?.length ?? 0) !== files.length) {
        throw new Error(
          `Attachment upload incomplete: expected ${files.length}, got ${response.data?.attachmentIds?.length ?? 0}`,
        );
      }

      return response.data?.attachmentIds || [];
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload attachments');
      throw error;
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const uploadAndInsertInlineImages = useCallback(
    async (images: File[]): Promise<void> => {
      if (images.length === 0) return;
      const editor = editorRef.current;
      if (!editor) return;
      try {
        const ids = await uploadAttachments(images);
        if (ids.length === 0) return;
        let chain = editor.chain().focus();
        ids.forEach((id, i) => {
          const file = images[i];
          chain = chain.setImage({
            src: `${BASE_URL}/attachments/${id}/download`,
            alt: file?.name ?? 'image',
            dataAttId: id,
            width: 480,
          });
        });
        chain.run();
        editor.commands.splitBlock();
      } catch {
        // uploadAttachments already toasts on error; nothing else to do here.
      }
    },
    [uploadAttachments, isComposeMode, channelId, conversationId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleDropAttachmentIntoEditor = useCallback(
    (data: { attachmentId: string; name: string; mimeType: string }): void => {
      const editor = editorRef.current;
      if (!editor) return;

      // Validate the attachment exists in the current list before removing/inserting.
      // Use ref for synchronous read; setAttachments updater is queued by React
      // so relying on a variable mutated inside it would be a race condition.
      const exists = attachmentsRef.current.some(att => att.attachmentId === data.attachmentId);
      if (!exists) return;

      setAttachments(prev => prev.filter(att => att.attachmentId !== data.attachmentId));

      // Insert as an inline image with the proper attachment ID.
      editor
        .chain()
        .focus()
        .setImage({
          src: `${BASE_URL}/attachments/${data.attachmentId}/download`,
          alt: data.name,
          dataAttId: data.attachmentId,
          width: 480,
        })
        .run();
      editor.commands.splitBlock();
    },
    [],
  );

  const handleSendEmail = async (): Promise<void> => {
    const hasContent = hasEmailBody;
    const hasAttachments = attachments.length > 0;
    if (
      (!hasContent && !hasAttachments && !hasInlineImages) ||
      isSending ||
      toEmails.length === 0
    ) {
      return;
    }
    if (isComposeMode) {
      if (!channelId || composeSubject.trim().length === 0) return;
    } else if (!conversationId) {
      return;
    }
    // Two-step send — first click only opens the confirm dialog; the real send
    // happens when the dialog's "Send" button calls this again after confirming.
    if (twoStepSendEnabled && !showSendConfirm) {
      setShowSendConfirm(true);
      return;
    }
    setShowSendConfirm(false);
    setIsSending(true);
    try {
      // Separate attachments: those with IDs already uploaded vs those needing upload
      const attachmentsWithIds = attachments.filter(att => att.attachmentId);
      const attachmentsWithoutIds = attachments.filter(att => !att.attachmentId);

      let regularAttachmentIds: string[] = attachmentsWithIds.map(att => att.attachmentId!);

      if (attachmentsWithoutIds.length > 0) {
        const newlyUploadedIds = await uploadAttachments(
          attachmentsWithoutIds.map(att => att.file).filter(isBrowserFile),
        );
        regularAttachmentIds = [...regularAttachmentIds, ...newlyUploadedIds];
      }

      const inlineIdsFromBody = new Set<string>();
      const imgRe = /<img\b[^>]*>/gi;
      let imgMatch: RegExpExecArray | null;
      while ((imgMatch = imgRe.exec(emailContent)) !== null) {
        const attMatch = /data-att-id="([^"]+)"/i.exec(imgMatch[0]);
        if (attMatch?.[1]) {
          inlineIdsFromBody.add(attMatch[1]);
          continue;
        }
        const srcMatch = /\ssrc="[^"]*\/attachments\/([^/"]+)\/download[^"]*"/i.exec(imgMatch[0]);
        if (srcMatch?.[1]) inlineIdsFromBody.add(srcMatch[1]);
      }
      const attachmentIds = Array.from(new Set([...regularAttachmentIds, ...inlineIdsFromBody]));

      const activeSig = selectedSignatureId
        ? signatures?.find(s => s.id === selectedSignatureId)
        : null;
      const bodyContent = hasContent || hasInlineImages ? stripCitationMarks(emailContent) : '';
      const composedBody = activeSig
        ? `${bodyContent}${bodyContent ? '<br>' : ''}${activeSig.content}`
        : bodyContent;
      const uniqueToken = `<span style="font-size:1px;color:transparent;display:inline-block;line-height:0;">${
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      }</span>`;
      const bodyHtml = `${composedBody}${uniqueToken}`;

      if (isComposeMode) {
        const response = await apiInstance.post<{
          success: boolean;
          sent?: boolean;
          ticketXyneId?: string;
          conversationId?: string;
          channelId: string;
          warning?: string;
        }>(`/email/compose`, {
          channelId,
          subject: composeSubject.trim(),
          body: bodyHtml,
          to: toEmails,
          cc: ccEmails,
          bcc: bccEmails,
          ...(attachmentIds.length > 0 && { attachmentIds }),
        });

        setEmailContent('');
        setComposeSubject('');
        setAttachments([]);
        setToEmails([]);
        setCcEmails([]);
        setBccEmails([]);
        if (composeDraftServerId) {
          deleteComposeDraftRow(composeDraftServerId);
          if (composeMetaKey) {
            try {
              localStorage.removeItem(composeMetaKey);
            } catch {
              /* ignore */
            }
          }
        }
        // If the backend sent the mail but couldn't record it locally, it
        // returns 200 with `warning`. Still treat as success UX-wise (the
        // recipient got the mail) — surface the warning so the agent knows
        // the ticket might not show up immediately.
        if (response.data.warning) {
          toast.warning('Email sent', { description: response.data.warning });
        } else {
          toast.success('Email sent');
        }
        onClose?.();
        const xyneId = response.data.ticketXyneId;
        const ch = response.data.channelId;
        if (xyneId && ch) {
          void composerNavigate(`${supportBase}/${ch}/${xyneId}`);
        }
        return;
      }

      await apiInstance.post(`/email/${conversationId}/reply`, {
        body: bodyHtml,
        type: 'REPLY_ALL',
        to: toEmails,
        cc: ccEmails,
        bcc: bccEmails,
        ...(draftId ? { draftId } : {}),
        ...(attachmentIds.length > 0 && { attachmentIds }),
        ...(replyToEmailId && { replyToEmailId }),
        ...(ticketSubject?.trim() && { subject: ticketSubject.trim() }),
      });

      setEmailContent('');
      if (draftId) {
        deleteDraft();
        clearRecipientsForDraft([
          conversationId ? `xyne:emailDraft:recipients:${conversationId}` : null,
          `xyne:emailDraft:recipients:${draftId}`,
        ]);
        clearAttachmentsForDraft([
          conversationId ? `xyne:emailDraft:attachments:${conversationId}` : null,
          `xyne:emailDraft:attachments:${draftId}`,
        ]);
      }
      setAttachments([]);
      setToEmails([]);
      setCcEmails([]);
      setBccEmails([]);
      toast.success('Reply sent');
      onClose?.();
    } catch (error) {
      // Surface the backend's error.response.data.message when present;
      // fall back to the generic Error message; final fallback is a stock
      // string so the user never sees nothing happen.
      const backendMessage =
        (error as { response?: { data?: { message?: string; error?: string } } })?.response?.data
          ?.message ||
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const message =
        backendMessage ||
        (error instanceof Error ? error.message : null) ||
        (isComposeMode ? 'Failed to send email' : 'Failed to send reply');
      toast.error(message);
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('Failed to send email:'),
        context: [error],
      });
    } finally {
      setIsSending(false);
    }
  };

  // Fire-and-forget wrapper for handleSendEmail that surfaces any rejection
  // that escapes its internal try/catch instead of swallowing it. Used by the
  // onClick handler below; never call handleSendEmail() with a
  // bare `void` — a rejection there becomes an unhandled promise rejection.
  const runSendEmail = (): void => {
    handleSendEmail().catch(error => {
      toast.error('Failed to send');
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to send email:'),
        error: error,
      });
    });
  };

  const addFilesToAttachments = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;

      const allFiles: File[] = [];

      const rejectedTooLarge: string[] = [];
      for (const file of files) {
        if (file.size > MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES) {
          rejectedTooLarge.push(file.name);
          continue;
        }
        allFiles.push(file);
      }

      if (rejectedTooLarge.length > 0) {
        toast.error(
          `Skipped ${rejectedTooLarge.length} file${rejectedTooLarge.length > 1 ? 's' : ''} over ${MAX_EMAIL_ATTACHMENT_FILE_SIZE_BYTES / (1024 * 1024)}MB: ${rejectedTooLarge.join(', ')}`,
        );
      }

      if (allFiles.length > 0) {
        let availableSlots = MAX_EMAIL_ATTACHMENT_FILES - attachments.length;
        const acceptedFiles: File[] = [];
        let droppedForCount = 0;

        for (const file of allFiles) {
          if (availableSlots <= 0) {
            droppedForCount++;
            continue;
          }
          acceptedFiles.push(file);
          availableSlots--;
        }

        if (droppedForCount > 0) {
          toast.error(
            `You can attach at most ${MAX_EMAIL_ATTACHMENT_FILES} files per email. Dropped ${droppedForCount}.`,
          );
        }

        if (acceptedFiles.length === 0) return;

        // Generate temporary IDs to track which attachments we're adding
        const tempIds = acceptedFiles.map(() => `temp-${Date.now()}-${Math.random()}`);

        // Add files to state with temporary IDs
        setAttachments(prev => [
          ...prev,
          ...acceptedFiles.map((file, i) => ({ file, tempId: tempIds[i]! })),
        ]);

        // Upload them immediately and update with real IDs
        try {
          const uploadedIds = await uploadAttachments(acceptedFiles);

          // Compute the full set of attachment IDs for the draft save *before*
          // calling setAttachments. `attachments` here is fresh (addFilesToAttachments
          // is recreated every render since uploadAttachments is not memoized).
          // We take the already-uploaded IDs from existing state and add the new ones.
          const existingPersistedAttachments = attachments
            .filter(att => att.attachmentId)
            .map(att => ({
              id: att.attachmentId!,
              name: isBrowserFile(att.file) ? att.file.name : att.file.originalName,
              mimeType: isBrowserFile(att.file) ? att.file.type : att.file.mimeType,
            }));
          const newPersistedAttachments = acceptedFiles.map((file, i) => ({
            id: uploadedIds[i]!,
            name: file.name,
            mimeType: file.type,
          }));
          const allPersistedAttachments = [
            ...existingPersistedAttachments,
            ...newPersistedAttachments,
          ];
          const allAttachmentIds = allPersistedAttachments.map(a => a.id);

          setAttachments(prev => {
            let uploadIndex = 0;
            return prev.map(att => {
              // Match by tempId to ensure we update the right attachments
              if (
                'tempId' in att &&
                att.tempId &&
                tempIds.includes(att.tempId) &&
                uploadIndex < uploadedIds.length
              ) {
                const { tempId: _, ...rest } = att;
                return { ...rest, attachmentId: uploadedIds[uploadIndex++]! };
              }
              return att;
            });
          });

          // Auto-save the reply draft after upload so attachment IDs are
          // persisted even when the editor never re-blurs (the most common
          // case: user clicks the attachment button → editor blurs before any
          // file is attached → file selected → upload completes → no blur fires).
          if (!isComposeMode && allAttachmentIds.length > 0 && conversationId) {
            const nextDraftId = saveReplyDraft(emailContent, allAttachmentIds);
            if (nextDraftId) {
              persistAttachmentsForDraft(
                `xyne:emailDraft:attachments:${conversationId}`,
                allPersistedAttachments,
              );
            }
          }
        } catch {
          // uploadAttachments already toasts; leave attachments without IDs
          // Remove tempIds on failure
          setAttachments(prev =>
            prev.filter(att => !('tempId' in att && att.tempId && tempIds.includes(att.tempId))),
          );
        }
      }
    },
    [
      uploadAttachments,
      isComposeMode,
      conversationId,
      attachments,
      saveDraft,
      emailContent,
      persistAttachmentsForDraft,
    ],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    void addFilesToAttachments(files);
  };

  const handleRemoveAttachment = (index: number): void => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handlePreviewAttachment = (attachment: ComposerAttachment): void => {
    if (isBrowserFile(attachment.file)) {
      setPreviewFile(attachment.file);
    }
    setIsPreviewOpen(true);
  };

  // ─── Recipient suggestions (org users + past thread participants) ─────────
  const [activeSuggestField, setActiveSuggestField] = useState<RecipientField | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState<number>(0);

  const contactPool = useMemo(
    () => buildContactPool(users, deskContacts, emails, [channelConnectedEmail, channelAliasEmail]),
    [users, deskContacts, emails, channelConnectedEmail, channelAliasEmail],
  );

  const toSuggestions = useMemo(
    () => buildSuggestions(contactPool, toInputValue, toEmails),
    [contactPool, toInputValue, toEmails],
  );
  const ccSuggestions = useMemo(
    () => buildSuggestions(contactPool, ccInputValue, ccEmails),
    [contactPool, ccInputValue, ccEmails],
  );
  const bccSuggestions = useMemo(
    () => buildSuggestions(contactPool, bccInputValue, bccEmails),
    [contactPool, bccInputValue, bccEmails],
  );

  const handleSuggestionSelect = (field: RecipientField, email: string): void => {
    const lower = email.toLowerCase();
    const isDup = (list: ReadonlyArray<string>): boolean =>
      list.some(e => e.toLowerCase() === lower);
    if (field === 'to') {
      if (!isDup(toEmails)) {
        applyUserRecipients({ to: [...toEmails, email], cc: ccEmails, bcc: bccEmails });
      }
      setToInputValue('');
    } else if (field === 'cc') {
      if (!isDup(ccEmails)) {
        applyUserRecipients({ to: toEmails, cc: [...ccEmails, email], bcc: bccEmails });
      }
      setCcInputValue('');
    } else {
      if (!isDup(bccEmails)) {
        applyUserRecipients({ to: toEmails, cc: ccEmails, bcc: [...bccEmails, email] });
      }
      setBccInputValue('');
    }
    setSuggestionIndex(0);
  };

  const focusSuggest = (field: RecipientField): void => {
    setActiveSuggestField(field);
    setSuggestionIndex(0);
  };
  const blurSuggest = (field: RecipientField): void => {
    setTimeout(() => {
      setActiveSuggestField(curr => (curr === field ? null : curr));
    }, 0);
  };

  const closeSuggestions = (): void => setActiveSuggestField(null);
  const handleToKeyDown = makeRecipientKeyDownHandler({
    field: 'to',
    inputValue: toInputValue,
    emails: toEmails,
    setEmails: setToEmails,
    onEmailsChange: nextTo => applyUserRecipients({ to: nextTo, cc: ccEmails, bcc: bccEmails }),
    setInputValue: setToInputValue,
    suggestions: toSuggestions,
    suggestionIndex,
    setSuggestionIndex,
    activeSuggestField,
    closeSuggestions,
    onSuggestionSelect: handleSuggestionSelect,
  });

  const handleToBlur = (): void => {
    const newEmails = splitAndValidateEmails(toInputValue, toEmails);
    if (newEmails.length > 0) {
      applyUserRecipients({ to: [...toEmails, ...newEmails], cc: ccEmails, bcc: bccEmails });
      setToInputValue('');
    }
    blurSuggest('to');
  };

  const collapsedDisplay = useMemo(() => {
    const MAX_VISIBLE = 2;
    const allUniqueEmails = Array.from(new Set([...toEmails, ...ccEmails, ...bccEmails]));
    const visibleEmails = allUniqueEmails.slice(0, MAX_VISIBLE);
    const remainingCount = allUniqueEmails.length - MAX_VISIBLE;
    return { visibleEmails, remainingCount: remainingCount > 0 ? remainingCount : 0 };
  }, [toEmails, ccEmails, bccEmails]);

  const handleBodyEditorReady = useCallback((editor: Editor): void => {
    editorRef.current = editor;
    setBodyEditor(editor);
  }, []);

  // Clear the email body via TipTap's native clearContent
  const handleClearBody = useCallback((): void => {
    editorRef.current?.chain().focus().clearContent().run();
  }, []);

  const recipientMentionPicker = (
    <RecipientMentionSelector
      editor={bodyEditor}
      contactPool={contactPool}
      users={users}
      toEmails={toEmails}
      onAddToRecipient={(email: string) => onAddRecipientToFromBodyRef.current(email)}
    />
  );

  const handleCcKeyDown = makeRecipientKeyDownHandler({
    field: 'cc',
    inputValue: ccInputValue,
    emails: ccEmails,
    setEmails: setCcEmails,
    onEmailsChange: nextCc => applyUserRecipients({ to: toEmails, cc: nextCc, bcc: bccEmails }),
    setInputValue: setCcInputValue,
    suggestions: ccSuggestions,
    suggestionIndex,
    setSuggestionIndex,
    activeSuggestField,
    closeSuggestions,
    onSuggestionSelect: handleSuggestionSelect,
  });

  const handleBccKeyDown = makeRecipientKeyDownHandler({
    field: 'bcc',
    inputValue: bccInputValue,
    emails: bccEmails,
    setEmails: setBccEmails,
    onEmailsChange: nextBcc => applyUserRecipients({ to: toEmails, cc: ccEmails, bcc: nextBcc }),
    setInputValue: setBccInputValue,
    suggestions: bccSuggestions,
    suggestionIndex,
    setSuggestionIndex,
    activeSuggestField,
    closeSuggestions,
    onSuggestionSelect: handleSuggestionSelect,
  });

  const handleCcBlur = (): void => {
    const newEmails = splitAndValidateEmails(ccInputValue, ccEmails);
    if (newEmails.length > 0) {
      applyUserRecipients({ to: toEmails, cc: [...ccEmails, ...newEmails], bcc: bccEmails });
      setCcInputValue('');
    }
    blurSuggest('cc');
  };

  const handleBccBlur = (): void => {
    const newEmails = splitAndValidateEmails(bccInputValue, bccEmails);
    if (newEmails.length > 0) {
      applyUserRecipients({ to: toEmails, cc: ccEmails, bcc: [...bccEmails, ...newEmails] });
      setBccInputValue('');
    }
    blurSuggest('bcc');
  };

  const handleExpand = (): void => {
    setIsExpanded(true);
    if (ccEmails.length > 0) {
      setShowCc(true);
    }
    if (bccEmails.length > 0) {
      setShowBcc(true);
    }
  };

  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onClose) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const target = e.target as Node | null;
      if (!target || !composerRef.current?.contains(target)) return;

      if (anyFieldExpanded) {
        e.preventDefault();
        e.stopPropagation();
        setIsToExpanded(false);
        setIsCcExpanded(false);
        setIsBccExpanded(false);
        return;
      }

      if (isInlineAIPanelOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsInlineAIPanelOpen(false);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      if (hasEmailBody && isDirty) saveReplyDraft(emailContent);
      onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [
    onClose,
    emailContent,
    saveReplyDraft,
    isInlineAIPanelOpen,
    setIsInlineAIPanelOpen,
    hasEmailBody,
    isDirty,
    anyFieldExpanded,
  ]);

  const {
    isDraggingFiles,
    dragHandlers,
    reset: resetDragState,
  } = useComposerDragDrop(addFilesToAttachments);

  const handleAttachmentDragStart = useCallback((e: React.DragEvent<HTMLSpanElement>) => {
    const target = e.currentTarget;
    const dragData = target.getAttribute('data-inline-attachment');
    if (!dragData) return;
    if ((e.target as HTMLElement).tagName !== 'IMG') return;
    e.dataTransfer.setData('application/x-xd-inline-attachment', dragData);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const composerFooter = (
    <>
      {attachments.length > 0 && (
        <div className='px-4 pb-3'>
          <div className='flex flex-wrap gap-2'>
            {attachments.map((attachment, index) => {
              const fileName = isBrowserFile(attachment.file)
                ? attachment.file.name
                : attachment.file.originalName;
              const fileSize = isBrowserFile(attachment.file)
                ? attachment.file.size
                : attachment.file.fileSize;
              const mimeType = isBrowserFile(attachment.file)
                ? attachment.file.type
                : attachment.file.mimeType;
              const isImageByMimeType = mimeType.startsWith('image/');
              const isImageByExtension = /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif)$/i.test(
                fileName,
              );
              const isImage = isImageByMimeType || isImageByExtension;
              const dragData =
                attachment.attachmentId && isImage
                  ? JSON.stringify({
                      attachmentId: attachment.attachmentId,
                      name: fileName,
                      mimeType,
                    })
                  : undefined;
              return (
                <span
                  key={
                    attachment.attachmentId ??
                    attachment.tempId ??
                    `${fileName}-${fileSize}-${index}`
                  }
                  data-inline-attachment={dragData}
                  onDragStart={dragData ? handleAttachmentDragStart : undefined}
                >
                  <AttachmentPreview
                    file={attachment.file}
                    onRemove={() => handleRemoveAttachment(index)}
                    onPreview={() => handlePreviewAttachment(attachment)}
                    isUploading={isUploadingAttachments && index === attachments.length - 1}
                  />
                </span>
              );
            })}
          </div>
        </div>
      )}
      {selectedSignatureId &&
        (() => {
          const activeSig = signatures?.find(s => s.id === selectedSignatureId);
          if (!activeSig) return null;
          const sigName = activeSig.name?.trim() || 'Default';
          return (
            <div className='px-3 pb-1'>
              <Popover
                trigger={
                  <button
                    type='button'
                    className='inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 px-2 py-1 rounded-md border border-border/60 transition-colors max-w-full'
                    aria-label={`Signature ${sigName}. Click to preview`}
                  >
                    <Signature size={12} className='shrink-0' />
                    <span className='font-medium'>Signature</span>
                    <span className='text-muted-foreground/60' aria-hidden='true'>
                      ·
                    </span>
                    <span className='truncate max-w-[160px]'>{sigName}</span>
                  </button>
                }
                side='top'
                align='start'
                sideOffset={6}
                className='p-3 w-[min(420px,90vw)]'
              >
                <div className='space-y-2'>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-xs font-medium text-foreground truncate'>{sigName}</span>
                    <span className='text-[10px] uppercase tracking-wide text-muted-foreground shrink-0'>
                      Preview
                    </span>
                  </div>
                  <div className='border-t border-border pt-2 max-h-[280px] overflow-auto'>
                    <p className='text-xs text-muted-foreground mb-1'>--</p>
                    <div
                      className='text-sm text-foreground/80 prose prose-sm dark:prose-invert max-w-none'
                      dangerouslySetInnerHTML={{ __html: sanitizeSignatureHtml(activeSig.content) }}
                    />
                  </div>
                </div>
              </Popover>
            </div>
          );
        })()}
    </>
  );

  return (
    <div
      className={cn('w-full', features.showCardWrap ? 'px-4 py-3' : 'h-full flex flex-col')}
      ref={composerRef}
    >
      <div
        ref={resizeTargetRef}
        className={cn(
          'relative flex flex-col overflow-y-auto overscroll-contain bg-background',
          features.showCardWrap ? 'rounded-2xl border border-border shadow-lg' : 'flex-1 min-h-0',
          isSending && 'pointer-events-none',
        )}
        style={isExpanded && features.showCardWrap ? { height: `${composerHeight}px` } : undefined}
        {...dragHandlers}
      >
        {isDraggingFiles && (
          <div className='absolute inset-0 z-30 flex items-center justify-center pointer-events-none rounded-xl border-2 border-dashed border-violet-400 bg-violet-50/70 dark:bg-violet-950/40'>
            <span className='text-sm font-medium text-violet-700 dark:text-violet-200'>
              Drop files to attach
            </span>
          </div>
        )}
        {showSendConfirm && (
          <div className='fixed inset-0 z-[9999] flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm'>
            <div className='flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl'>
              <div className='flex flex-shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4'>
                <div className='flex flex-col gap-0.5'>
                  <h2 className='text-base font-semibold leading-tight text-foreground'>
                    Review &amp; send
                  </h2>
                  <p className='text-xs text-muted-foreground'>
                    Make sure everything looks right before this email goes out.
                  </p>
                </div>
                <button
                  type='button'
                  onClick={() => setShowSendConfirm(false)}
                  className='-mr-1.5 flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  aria-label='Close review dialog'
                  data-track-category='Support'
                  data-track-name='CloseTwoStepSendReview'
                >
                  <X size={16} />
                </button>
              </div>

              <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
                <div className='divide-y divide-border/60 border-b border-border'>
                  <div className='flex gap-3 px-5 py-2.5'>
                    <span className='w-12 flex-shrink-0 pt-px text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                      To
                    </span>
                    <span className='flex-1 break-words text-sm text-foreground [overflow-wrap:anywhere]'>
                      {toEmails.join(', ')}
                    </span>
                  </div>
                  {ccEmails.length > 0 && (
                    <div className='flex gap-3 px-5 py-2.5'>
                      <span className='w-12 flex-shrink-0 pt-px text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                        Cc
                      </span>
                      <span className='flex-1 break-words text-sm text-foreground [overflow-wrap:anywhere]'>
                        {ccEmails.join(', ')}
                      </span>
                    </div>
                  )}
                  {bccEmails.length > 0 && (
                    <div className='flex gap-3 px-5 py-2.5'>
                      <span className='w-12 flex-shrink-0 pt-px text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                        Bcc
                      </span>
                      <span className='flex-1 break-words text-sm text-foreground [overflow-wrap:anywhere]'>
                        {bccEmails.join(', ')}
                      </span>
                    </div>
                  )}
                  {(isComposeMode ? composeSubject.trim() : ticketSubject?.trim()) && (
                    <div className='flex gap-3 px-5 py-2.5'>
                      <span className='w-12 flex-shrink-0 pt-px text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                        Subject
                      </span>
                      <span className='flex-1 break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]'>
                        {isComposeMode ? composeSubject.trim() : ticketSubject?.trim()}
                      </span>
                    </div>
                  )}
                </div>

                <div className='px-5 py-4'>
                  {hasEmailBody ? (
                    <div
                      className='prose prose-sm dark:prose-invert max-w-none break-words text-sm text-foreground [overflow-wrap:anywhere]'
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(emailContent),
                      }}
                    />
                  ) : (
                    <p className='text-sm italic text-muted-foreground'>No message body.</p>
                  )}
                  {(() => {
                    const activeSig = selectedSignatureId
                      ? signatures?.find(s => s.id === selectedSignatureId)
                      : null;
                    if (!activeSig) return null;
                    return (
                      <div
                        className='prose prose-sm dark:prose-invert mt-4 break-words border-t border-border pt-4 text-sm text-muted-foreground [overflow-wrap:anywhere]'
                        dangerouslySetInnerHTML={{
                          __html: sanitizeSignatureHtml(activeSig.content),
                        }}
                      />
                    );
                  })()}
                </div>

                {attachments.length > 0 && (
                  <div className='border-t border-border px-5 py-4'>
                    <p className='mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                      {attachments.length} attachment{attachments.length > 1 ? 's' : ''}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                      {attachments.map((attachment, index) => (
                        <AttachmentPreview
                          key={attachment.attachmentId ?? attachment.tempId ?? index}
                          file={attachment.file}
                          onRemove={() => handleRemoveAttachment(index)}
                          onPreview={() => handlePreviewAttachment(attachment)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className='flex flex-shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3.5'>
                <span className='text-xs text-muted-foreground'>
                  {toEmails.length} recipient{toEmails.length === 1 ? '' : 's'}
                </span>
                <div className='flex items-center gap-2'>
                  <button
                    type='button'
                    onClick={() => setShowSendConfirm(false)}
                    className='rounded-lg px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted'
                    data-track-category='Support'
                    data-track-name='CancelTwoStepSend'
                  >
                    Back to edit
                  </button>
                  <Button
                    type='button'
                    variant='default'
                    onClick={runSendEmail}
                    disabled={isSending}
                    className='inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60'
                    data-track-category='Support'
                    data-track-name='ConfirmTwoStepSend'
                    trackId='send_email_confirm'
                  >
                    {isSending ? (
                      <Loader2 size={14} className='animate-spin' />
                    ) : (
                      <Send size={14} />
                    )}
                    {isSending ? 'Sending…' : 'Send email'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        {isExpanded && features.showResizeGrip && (
          <div
            className='h-4 flex-shrink-0 flex items-center justify-center cursor-row-resize touch-none'
            onPointerDown={handleComposerResizePointerDown}
            onKeyDown={e => {
              if (!isExpanded || isSending) return;
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setComposerHeight(h =>
                  Math.min(h + COMPOSER_RESIZE_STEP_PX, COMPOSER_MAX_HEIGHT_PX),
                );
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setComposerHeight(h => Math.max(h - COMPOSER_RESIZE_STEP_PX, minHeight));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setComposerHeight(minHeight);
              } else if (e.key === 'End') {
                e.preventDefault();
                setComposerHeight(COMPOSER_MAX_HEIGHT_PX);
              }
            }}
            role='button'
            tabIndex={0}
            aria-label='Resize composer. Arrow Up to grow, Arrow Down to shrink, Home for minimum, End for maximum.'
          >
            <div className='h-1 w-14 rounded-full bg-muted-foreground/30' />
          </div>
        )}
        <div className='px-3 pb-1'>
          {!isExpanded ? (
            <button
              type='button'
              className='w-full flex items-center gap-2 cursor-pointer text-left py-1'
              onClick={handleExpand}
              data-track-category='SUPPORT'
              data-track-name='ExpandReplyComposer'
              data-track-metadata={JSON.stringify({
                toCount: toEmails.length,
                ccCount: ccEmails.length,
                bccCount: bccEmails.length,
                conversationId,
                draftEmailId: draftId,
              })}
            >
              <ReplyAll size={16} className='text-foreground flex-shrink-0' />
              <span className='text-sm text-foreground font-medium flex-shrink-0'>Reply to</span>
              <div className='flex items-center gap-1.5 flex-wrap flex-1 min-w-0'>
                {collapsedDisplay.visibleEmails.map(raw => {
                  const parsed = parseFromField(raw);
                  const displayName = parsed.email ? parsed.name : raw;
                  const initial = (displayName.charAt(0) || '?').toUpperCase();
                  const tooltip = parsed.email ? `${parsed.name} <${parsed.email}>` : raw;
                  return (
                    <span
                      key={raw}
                      className='inline-flex items-center gap-1.5 bg-muted/60 rounded-md px-1.5 py-0.5 max-w-full'
                      title={tooltip}
                    >
                      <span className='w-4 h-4 rounded-[3px] bg-border flex items-center justify-center flex-shrink-0'>
                        <span className='text-[9px] font-medium text-muted-foreground'>
                          {initial}
                        </span>
                      </span>
                      <span className='text-sm text-foreground truncate'>{displayName}</span>
                    </span>
                  );
                })}
                {collapsedDisplay.remainingCount > 0 && (
                  <span className='text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded hover:bg-border'>
                    +{collapsedDisplay.remainingCount}
                  </span>
                )}
              </div>
            </button>
          ) : (
            <>
              {!isComposeMode && setReplyMode && (
                <div className='flex items-center mb-1'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        className='flex items-center gap-2 pb-1 pt-1 rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors'
                        aria-label={`Switch reply mode. Current: ${replyMode === 'replyAll' ? 'Reply all' : 'Reply'}`}
                        data-track-category='SUPPORT'
                        data-track-name='ComposerReplyModeDropdown'
                      >
                        <div className='flex items-center gap-1'>
                          {replyMode === 'replyAll' ? (
                            <ReplyAll size={16} className='text-foreground' />
                          ) : (
                            <CornerUpLeft size={16} className='text-foreground' />
                          )}
                          <span className='font-medium text-[13px] leading-[18px] text-foreground whitespace-nowrap'>
                            {replyMode === 'replyAll' ? 'Reply all' : 'Reply'}
                          </span>
                        </div>
                        <ChevronDown size={14} className='text-foreground shrink-0' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='start'
                      side='bottom'
                      sideOffset={6}
                      className='min-w-[160px]'
                    >
                      <DropdownMenuItem
                        onSelect={e => {
                          e.preventDefault();
                          setReplyMode('reply');
                        }}
                        className='flex items-center gap-2 cursor-pointer'
                      >
                        <CornerUpLeft size={14} className='text-muted-foreground' />
                        <span className='flex-1'>Reply</span>
                        {replyMode === 'reply' && <Check size={14} className='text-foreground' />}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={e => {
                          e.preventDefault();
                          setReplyMode('replyAll');
                        }}
                        className='flex items-center gap-2 cursor-pointer'
                      >
                        <ReplyAll size={14} className='text-muted-foreground' />
                        <span className='flex-1'>Reply all</span>
                        {replyMode === 'replyAll' && (
                          <Check size={14} className='text-foreground' />
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              <div className='flex items-start gap-2'>
                {features.showCollapseIcon && !setReplyMode && (
                  <button
                    type='button'
                    onClick={() => setIsExpanded(false)}
                    className='flex-shrink-0 p-0.5 hover:bg-muted rounded transition-colors mt-0.5'
                    title='Collapse'
                    data-track-category='SUPPORT'
                    data-track-name='CollapseReplyComposer'
                    data-track-metadata={JSON.stringify({
                      toEmails: toEmails,
                      ccEmails: ccEmails,
                      bccEmails: bccEmails,
                      conversationId,
                      draftEmailId: draftId,
                    })}
                  >
                    <ReplyAll size={16} className='text-muted-foreground' />
                  </button>
                )}
                <RecipientFieldRow
                  className='flex-1 min-w-0'
                  field='to'
                  label='To'
                  emails={toEmails}
                  inputRef={toInputRef}
                  rowRef={toRowRef}
                  inputValue={toInputValue}
                  expanded={isToExpanded}
                  onExpandedChange={setIsToExpanded}
                  onEmailsChange={nextTo =>
                    applyUserRecipients({ to: nextTo, cc: ccEmails, bcc: bccEmails })
                  }
                  onInputValueChange={setToInputValue}
                  suggestions={toSuggestions}
                  activeSuggestField={activeSuggestField}
                  highlightedIndex={suggestionIndex}
                  onSuggestionSelect={handleSuggestionSelect}
                  onHighlight={setSuggestionIndex}
                  disabled={isSending}
                  users={users}
                  dragOverField={dragOverField}
                  handleChipDragStart={handleChipDragStart}
                  handleChipDragEnd={handleChipDragEnd}
                  handleFieldDragOver={handleFieldDragOver}
                  handleFieldDragLeave={handleFieldDragLeave}
                  handleFieldDrop={handleFieldDrop}
                  handleKeyDown={handleToKeyDown}
                  handleBlur={handleToBlur}
                  focusSuggest={focusSuggest}
                  trackName='FocusToField'
                  trackMetadata={{
                    toEmails,
                    ccEmails,
                    bccEmails,
                    conversationId,
                    draftEmailId: draftId,
                  }}
                  actions={
                    <>
                      {!showCc && (
                        <button
                          onClick={() => setShowCc(true)}
                          className='text-sm text-muted-foreground hover:text-foreground px-1 transition-colors'
                          data-track-category='SUPPORT'
                          data-track-name='ShowCcField'
                          data-track-metadata={JSON.stringify({
                            ccMails: ccEmails,
                            bccCount: bccEmails.length,
                            conversationId,
                            draftEmailId: draftId,
                          })}
                        >
                          Cc
                        </button>
                      )}
                      {!showBcc && (
                        <button
                          onClick={() => setShowBcc(true)}
                          className='text-sm text-muted-foreground hover:text-foreground px-1 transition-colors'
                          data-track-category='SUPPORT'
                          data-track-name='ShowBccField'
                          data-track-metadata={JSON.stringify({
                            ccCount: ccEmails.length,
                            bccEmails: bccEmails,
                            conversationId,
                            draftEmailId: draftId,
                          })}
                        >
                          Bcc
                        </button>
                      )}
                      {onClose && features.showDiscardButton && (
                        <Button
                          type='button'
                          variant='ghost'
                          onMouseDown={() => {
                            if (!isComposeMode) suppressNextReplyAutosaveRef.current = true;
                          }}
                          onClick={() => {
                            if (!isComposeMode && draftId) {
                              deleteDraft();
                              clearRecipientsForDraft([
                                conversationId
                                  ? `xyne:emailDraft:recipients:${conversationId}`
                                  : null,
                                `xyne:emailDraft:recipients:${draftId}`,
                              ]);
                              clearAttachmentsForDraft([
                                conversationId
                                  ? `xyne:emailDraft:attachments:${conversationId}`
                                  : null,
                                `xyne:emailDraft:attachments:${draftId}`,
                              ]);
                            }
                            if (!isComposeMode && !draftId) {
                              clearRecipientsForDraft([
                                conversationId
                                  ? `xyne:emailDraft:recipients:${conversationId}`
                                  : null,
                              ]);
                              clearAttachmentsForDraft([
                                conversationId
                                  ? `xyne:emailDraft:attachments:${conversationId}`
                                  : null,
                              ]);
                              setEmailContent('');
                              setAttachments([]);
                              setToEmails([]);
                              setCcEmails([]);
                              setBccEmails([]);
                              onClose();
                              return;
                            }
                            if (isComposeMode) {
                              deleteDraft();
                            }
                            if (composeDraftServerId) {
                              deleteComposeDraftRow(composeDraftServerId);
                              if (composeMetaKey) {
                                try {
                                  localStorage.removeItem(composeMetaKey);
                                } catch {
                                  /* ignore quota/access errors */
                                }
                              }
                            }
                            setEmailContent('');
                            setAttachments([]);
                            setToEmails([]);
                            setCcEmails([]);
                            setBccEmails([]);
                            if (isComposeMode) {
                              onDiscard?.();
                            } else {
                              onClose?.();
                            }
                          }}
                          disabled={isSending}
                          className='size-6 ml-0.5 flex items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors disabled:opacity-50'
                          aria-label='Discard draft'
                          title='Discard draft'
                          data-track-category='Support'
                          data-track-name='DiscardComposerDraft'
                          trackId='discard_composer_draft'
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                      {onClose && features.showMinimizeButton && (
                        <button
                          type='button'
                          onClick={() => {
                            if (hasEmailBody && isDirty) saveReplyDraft(emailContent);
                            onClose();
                          }}
                          disabled={isSending}
                          className='size-6 ml-0.5 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50'
                          aria-label='Minimize reply'
                          title='Minimize (keeps draft)'
                          data-track-category='Support'
                          data-track-name='MinimizeReplyComposer'
                        >
                          <Minimize2 size={14} />
                        </button>
                      )}
                    </>
                  }
                />
              </div>

              {showCc && (
                <RecipientFieldRow
                  field='cc'
                  label='Cc'
                  emails={ccEmails}
                  inputRef={ccInputRef}
                  rowRef={ccRowRef}
                  inputValue={ccInputValue}
                  expanded={isCcExpanded}
                  onExpandedChange={setIsCcExpanded}
                  onEmailsChange={nextCc =>
                    applyUserRecipients({ to: toEmails, cc: nextCc, bcc: bccEmails })
                  }
                  onInputValueChange={setCcInputValue}
                  suggestions={ccSuggestions}
                  activeSuggestField={activeSuggestField}
                  highlightedIndex={suggestionIndex}
                  onSuggestionSelect={handleSuggestionSelect}
                  onHighlight={setSuggestionIndex}
                  disabled={isSending}
                  users={users}
                  dragOverField={dragOverField}
                  handleChipDragStart={handleChipDragStart}
                  handleChipDragEnd={handleChipDragEnd}
                  handleFieldDragOver={handleFieldDragOver}
                  handleFieldDragLeave={handleFieldDragLeave}
                  handleFieldDrop={handleFieldDrop}
                  handleKeyDown={handleCcKeyDown}
                  handleBlur={handleCcBlur}
                  focusSuggest={focusSuggest}
                  trackName='FocusCcField'
                  trackMetadata={{
                    ccCount: ccEmails.length,
                    bccCount: bccEmails.length,
                    conversationId,
                    draftEmailId: draftId,
                  }}
                />
              )}

              {showBcc && (
                <RecipientFieldRow
                  field='bcc'
                  label='Bcc'
                  emails={bccEmails}
                  inputRef={bccInputRef}
                  rowRef={bccRowRef}
                  inputValue={bccInputValue}
                  expanded={isBccExpanded}
                  onExpandedChange={setIsBccExpanded}
                  onEmailsChange={nextBcc =>
                    applyUserRecipients({ to: toEmails, cc: ccEmails, bcc: nextBcc })
                  }
                  onInputValueChange={setBccInputValue}
                  suggestions={bccSuggestions}
                  activeSuggestField={activeSuggestField}
                  highlightedIndex={suggestionIndex}
                  onSuggestionSelect={handleSuggestionSelect}
                  onHighlight={setSuggestionIndex}
                  disabled={isSending}
                  users={users}
                  dragOverField={dragOverField}
                  handleChipDragStart={handleChipDragStart}
                  handleChipDragEnd={handleChipDragEnd}
                  handleFieldDragOver={handleFieldDragOver}
                  handleFieldDragLeave={handleFieldDragLeave}
                  handleFieldDrop={handleFieldDrop}
                  handleKeyDown={handleBccKeyDown}
                  handleBlur={handleBccBlur}
                  focusSuggest={focusSuggest}
                  trackName='FocusBccField'
                  trackMetadata={{
                    bccCount: bccEmails,
                    conversationId,
                    draftEmailId: draftId,
                  }}
                />
              )}
            </>
          )}
        </div>

        {features.showSubject && (
          <div className='flex items-center gap-2 px-3 py-1.5'>
            <span className='text-sm text-foreground font-medium flex-shrink-0'>Subject</span>
            <input
              type='text'
              value={composeSubject}
              onChange={e => setComposeSubject(e.target.value)}
              placeholder='Subject'
              className='flex-1 text-sm py-1 outline-none bg-transparent'
              disabled={isSending}
              aria-label='Subject'
              data-track-category='SUPPORT'
              data-track-name='EditComposeSubject'
            />
            {/* AI subject suggestion — disabled until the body has content
                since the model needs the email text to ground the subject. */}
            {features.showAI && (
              <Tooltip
                content={
                  hasEmailBody ? 'Suggest subject from email body' : 'Write some email body first'
                }
                side='bottom'
                delayDuration={300}
              >
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => {
                    void (async (): Promise<void> => {
                      const suggested = await subjectAI.generate(stripHtml(emailContent));
                      if (suggested) setComposeSubject(suggested);
                    })();
                  }}
                  disabled={isSending || !hasEmailBody || subjectAI.isGenerating}
                  className='size-7 flex-shrink-0 flex items-center justify-center rounded-full text-primary hover:bg-violet-50 hover:text-violet-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                  aria-label='Suggest subject with AI'
                  data-track-category='Support'
                  data-track-name='SuggestComposeSubject'
                  trackId='generate_compose_subject'
                >
                  {subjectAI.isGenerating ? (
                    <RefreshCw size={14} className='animate-spin' />
                  ) : (
                    <Wand2 size={14} />
                  )}
                </Button>
              </Tooltip>
            )}
          </div>
        )}

        <div className='flex-1 flex flex-col' style={{ minHeight: '180px' }}>
          {((): ReactElement => {
            const draftActive = aiDraft.isDraftActive;
            const toolbarRightSlot = isAutoDraftGenerating ? (
              <Tooltip delayDuration={300} content='Generating AI draft…'>
                <span
                  className='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-sm bg-violet-100 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
                  aria-label='Generating AI draft'
                >
                  <Loader2 size={10} className='animate-spin' />
                  Drafting…
                </span>
              </Tooltip>
            ) : undefined;

            const draftCard = draftActive ? (
              <DraftCard
                draftContent={aiDraft.draftContent}
                toolInvocations={aiDraft.draftToolInvocations}
                isStreaming={aiDraft.isStreaming}
                onAccept={() => {
                  const content = aiDraft.acceptDraft();
                  void (async (): Promise<void> => {
                    const html = content ? await markdownToHtml(stripCitationMarks(content)) : '';
                    setEmailContent(html);
                    if (html) saveReplyDraft(html);
                  })();
                }}
                onCollapse={() => setAiPaneOpen(false)}
                onReject={() => {
                  aiDraft.rejectDraft();
                }}
                onRefine={(instruction: string, options?: { selectedText?: string }) => {
                  void aiDraft.refineDraft(instruction, options);
                }}
                onQuickRefine={action => {
                  void aiDraft.quickRewrite(action, aiDraft.draftContent);
                }}
                selectedTextForRefine={aiDraft.selectedTextForRefine}
                onClearSelectedText={aiDraft.clearSelectedTextForRefine}
                {...(onSeeSources && {
                  onSeeSources: () => onSeeSources(aiDraft.sessionId ?? undefined),
                })}
              />
            ) : null;

            if (draftActive) {
              return (
                <div ref={draftScrollRef} className='flex-1 min-h-0 overflow-y-auto px-4 pt-2 pb-3'>
                  {/* Your draft rendered as plain text above the inline AI card (Gmail-style). */}
                  {hasEmailBody && (
                    <div
                      className='px-1 pb-3 text-sm leading-relaxed text-foreground/90 break-words [&_p]:my-1'
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailContent) }}
                    />
                  )}
                  {aiPaneOpen ? (
                    draftCard
                  ) : (
                    <button
                      type='button'
                      onClick={() => setAiPaneOpen(true)}
                      className='flex items-center gap-2 self-start pl-1 pr-3 py-1 rounded-full border border-border bg-background hover:bg-muted transition-colors flex-shrink-0'
                      aria-label='Open AI draft'
                      data-track-category='Support'
                      data-track-name='ExpandAIDraft'
                    >
                      <span
                        className='flex items-center justify-center w-5 h-5 rounded-md'
                        style={{ background: '#F87171' }}
                      >
                        <Sparkles size={11} className='text-white' />
                      </span>
                      <span className='text-[13px] font-medium text-foreground'>AI Draft</span>
                      <ChevronDown size={13} className='text-muted-foreground' />
                    </button>
                  )}
                </div>
              );
            }

            if (aiPanelMode !== null) {
              return (
                <div className='flex-1 min-h-0 flex flex-col px-4 pt-2 pb-3'>
                  <AIComposerPanel
                    disabled={aiDraft.isStreaming}
                    onAskAISubmit={instruction => {
                      runAskAIRefine(instruction);
                    }}
                    {...((onOpenAskAISidebarFresh || onToggleAIPanel) && {
                      onOpenAskAISidebar: (): void => {
                        if (onOpenAskAISidebarFresh) {
                          onOpenAskAISidebarFresh();
                        } else {
                          onToggleAIPanel?.();
                        }
                        setAIPanelMode(null);
                      },
                    })}
                    onClose={() => setAIPanelMode(null)}
                  />
                </div>
              );
            }

            return (
              <>
                <EmailEditor
                  value={displayEmailContent}
                  onChange={handleEditorChange}
                  onAddFiles={addFilesToAttachments}
                  uploadAndInsertInlineImages={uploadAndInsertInlineImages}
                  extraExtensions={recipientExtensions}
                  onEditorReady={handleBodyEditorReady}
                  onDropAttachmentIntoEditor={handleDropAttachmentIntoEditor}
                  onFileDropHandled={resetDragState}
                  onBlur={() => {
                    if (!isComposeMode && hasEmailBody && isDirty) saveReplyDraft(emailContent);
                  }}
                  onFocus={() => {
                    setIsToExpanded(false);
                    setIsCcExpanded(false);
                    setIsBccExpanded(false);
                  }}
                  onCitationClick={openSourcePreview}
                  {...(onCitationOrderChange && { onCitationOrderChange })}
                  disabled={isSending}
                  className='flex-1 min-h-0'
                  footerSlot={composerFooter}
                  toolbarRightSlot={toolbarRightSlot}
                  bubbleToolbar
                />
                {recipientMentionPicker}
              </>
            );
          })()}
        </div>

        {aiPromptOpen && !aiDraft.isDraftActive && !aiDraft.isStreaming && (
          <div className='px-3 pb-2 pt-1'>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className='xyne-ai-prompt-border-wrap'
            >
              <div className='flex items-center gap-3 h-12 pl-4 pr-2 rounded-full bg-muted'>
                <PencilLine size={16} className='text-muted-foreground shrink-0' />
                <input
                  ref={aiPromptInputRef}
                  type='text'
                  value={aiPromptText}
                  onChange={e => setAiPromptText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && aiPromptText.trim().length > 0) {
                      e.preventDefault();
                      const instruction = aiPromptText.trim();
                      runAskAIRefine(instruction);
                      setAiPromptOpen(false);
                      setAiPromptText('');
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setAiPromptOpen(false);
                      setAiPromptText('');
                    }
                  }}
                  placeholder={`Tell ${draftAgentName} what to write…`}
                  className='flex-1 min-w-0 bg-transparent outline-none text-[15px] text-foreground placeholder:text-muted-foreground/70'
                  data-track-category='Support'
                  data-track-name='AIPromptInput'
                  aria-label={`Tell ${draftAgentName} what to write`}
                />
                <button
                  type='button'
                  onClick={() => {
                    setAiPromptOpen(false);
                    setAiPromptText('');
                  }}
                  className='text-[14px] text-muted-foreground hover:text-foreground font-medium px-3 py-1.5 rounded-full transition-colors'
                  data-track-category='Support'
                  data-track-name='AIPromptCancel'
                >
                  Cancel
                </button>
                <button
                  type='button'
                  onClick={() => {
                    if (aiPromptText.trim().length === 0) return;
                    const instruction = aiPromptText.trim();
                    runAskAIRefine(instruction);
                    setAiPromptOpen(false);
                    setAiPromptText('');
                  }}
                  disabled={aiPromptText.trim().length === 0}
                  className={cn(
                    'h-8 px-4 rounded-full text-[14px] font-medium transition-colors',
                    aiPromptText.trim().length === 0
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90',
                  )}
                  data-track-category='Support'
                  data-track-name='AIPromptCreate'
                >
                  Create
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Bottom toolbar — hidden while the AI draft card or the AI prompt bar is active. */}
        {!aiDraft.isDraftActive && !aiPromptOpen && (
          <div className='px-2 py-1.5 flex items-center justify-between'>
            <div className='flex items-center gap-0.5'>
              {/* Attachment button */}
              <div>
                <input
                  ref={fileInputRef}
                  type='file'
                  multiple
                  className='hidden'
                  onChange={handleFileSelect}
                  disabled={isSending || isUploadingAttachments}
                />
                <Tooltip content='Attach files' side='top' delayDuration={300}>
                  <button
                    type='button'
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending || isUploadingAttachments}
                    className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                    aria-label='Attach files'
                    data-track-category='SUPPORT'
                    data-track-name='AddEmailAttachment'
                    data-track-metadata={JSON.stringify({
                      conversationId,
                      attachmentCount: attachments.length,
                    })}
                  >
                    <Paperclip size={14} />
                  </button>
                </Tooltip>
              </div>

              {/* Signature selector */}
              {features.showSignature && signatures.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                      title={
                        selectedSignatureId
                          ? (signatures.find(s => s.id === selectedSignatureId)?.name ??
                            'Signature')
                          : 'No signature'
                      }
                      data-track-category='email-compose'
                      data-track-name='select-signature'
                    >
                      <Signature size={14} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='start' side='top'>
                    <DropdownMenuItem
                      onClick={() => {
                        const base = channelId ? `${supportBase}/${channelId}` : supportBase;
                        void composerNavigate(`${base}?openSettings=signatures`);
                      }}
                      data-track-category='Support'
                      data-track-name='OPEN_SUPPORT_FROM_COMPOSER'
                      className='text-xs text-muted-foreground'
                    >
                      Manage signatures
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setSelectedSignatureId(null)}
                      data-track-category='Support'
                      data-track-name='CLEAR_EMAIL_SIGNATURE'
                      className={!selectedSignatureId ? 'font-medium' : ''}
                    >
                      No signature
                    </DropdownMenuItem>
                    {signatures.map(sig => (
                      <DropdownMenuItem
                        key={sig.id}
                        onClick={() => setSelectedSignatureId(sig.id)}
                        data-track-category='Support'
                        data-track-name='SELECT_EMAIL_SIGNATURE'
                        className={selectedSignatureId === sig.id ? 'font-medium' : ''}
                      >
                        {sig.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : features.showSignature ? (
                <Tooltip content='Add signature' side='top' delayDuration={300}>
                  <button
                    type='button'
                    onClick={() => {
                      const base = channelId ? `${supportBase}/${channelId}` : supportBase;
                      void composerNavigate(`${base}?openSettings=signatures`);
                    }}
                    className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                    aria-label='Add signature'
                    data-track-category='email-compose'
                    data-track-name='add-signature'
                  >
                    <Signature size={14} />
                  </button>
                </Tooltip>
              ) : null}
              <Tooltip content='Clear body (Ctrl+Z to undo)' side='top' delayDuration={300}>
                <button
                  type='button'
                  onClick={handleClearBody}
                  disabled={isSending || !hasEmailBody || aiDraft.isDraftActive}
                  className='size-7 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
                  aria-label='Clear email body'
                  data-track-category='Support'
                  data-track-name='ClearEmailBody'
                >
                  <Eraser size={14} />
                </button>
              </Tooltip>
              {features.showAI && (
                <AIRefineDropdown
                  onQuickRewrite={action => {
                    const source = aiDraft.isDraftActive
                      ? aiDraft.draftContent
                      : contentWithDraftCitations(emailContent);
                    void aiDraft.quickRewrite(action, source);
                  }}
                  onAskAI={() => {
                    setAIPanelMode(null);
                    setAiPromptOpen(true);
                    requestAnimationFrame(() => aiPromptInputRef.current?.focus());
                  }}
                  onRerunDraft={() => {
                    const instruction = lastAskInstructionRef.current;
                    if (instruction) {
                      runAskAIRefine(instruction);
                    } else {
                      setAiPaneOpen(true);
                      aiDraft.triggerDraft();
                    }
                  }}
                  agentName={draftAgentName}
                  showQuickRewrite={hasEmailBody || aiDraft.isDraftActive}
                  disabled={aiDraft.isStreaming}
                />
              )}
            </div>
            <div className='flex items-center gap-1'>
              {onSeeSources && (!!aiDraft.sessionId || hasAutoDraft) && (
                <Tooltip delayDuration={300} content='See how this draft was written'>
                  <button
                    type='button'
                    className='h-7 flex items-center gap-1.5 px-2 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                    onClick={() => onSeeSources(aiDraft.sessionId ?? undefined)}
                    aria-label='See sources'
                    data-track-category='Support'
                    data-track-name='SeeDraftSources'
                  >
                    <ExternalLink size={14} />
                    <span className='text-xs font-medium'>See sources</span>
                  </button>
                </Tooltip>
              )}
              <Button
                variant='default'
                className='size-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors'
                onClick={runSendEmail}
                disabled={
                  (!hasEmailBody && attachments.length === 0 && !hasInlineImages) ||
                  (isComposeMode
                    ? !channelId || composeSubject.trim().length === 0
                    : !conversationId) ||
                  isSending ||
                  toEmails.length === 0 ||
                  aiDraft.isDraftActive
                }
                aria-label='Send email'
                title={aiDraft.isDraftActive ? 'Accept the AI draft to enable Send' : 'Send'}
                data-track-category='Support'
                data-track-name='SendEmailReply'
                data-track-metadata={JSON.stringify({
                  conversationId,
                  attachmentCount: attachments.length,
                })}
                trackId='send_email'
              >
                {isSending ? (
                  <RefreshCw size={16} className='animate-spin' />
                ) : (
                  <ArrowUp size={16} />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Media viewer for attachment preview */}
      {previewFile && (
        <MediaViewer
          file={previewFile}
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
};
