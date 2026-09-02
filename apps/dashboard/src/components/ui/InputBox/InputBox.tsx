import React, {
  useState,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
  useEffect,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { NodeType as PMNodeType, Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Extension, InputRule, textblockTypeInputRule, Mark } from '@tiptap/core';

const VoiceShimmerMark = Mark.create({
  name: 'voiceShimmer',
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ['span', { class: 'voice-shimmer' }, 0];
  },
});
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { all, createLowlight } from 'lowlight';
import { Plus, Loader2, X, Ticket, FileText, Clock } from 'lucide-react';
import { ArrowUp, AtMark, ChevronBigDown, FontAa, Hashtag, PaperclipSlant } from '@xyne/icons';
import Tooltip from '../Tooltip/Tooltip';
import { ShortcutHint } from '../ShortcutHint';
import Avatar from '../Avatar/Avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu';

import { toast } from 'sonner';
import { EditorToolbar } from '../EditorToolbar';
import { EmojiPickerButton } from '../EditorToolbar';
import { MentionSelector } from '../Selectors';
import { CommandSelector } from '../Selectors';
import { EmojiSelector } from '../Selectors';
import { AttachmentPreview } from '../files';
import { useOverlayZIndex } from '../../../contexts/OverlayZIndexContext';
import type { UploadedFile } from '../files/Files.types';
import { FilePreviewModal } from '../../FileViewer/FileViewerModal';
import type { MentionResult } from '@xyne/shared';
import { MentionExtension, mentionPluginKey } from '../TipTapExtensions';
import { CommandsExtension, commandPluginKey } from '../TipTapExtensions';
import { EmojiSelectorExtension, emojiSelectorPluginKey } from '../TipTapExtensions';
import { ChannelMentionExtension, channelMentionPluginKey } from '../TipTapExtensions';
import { TableExtensions } from '../TipTapExtensions';
import { FormattingShortcutsExtension } from '../TipTapExtensions';
import { ColonEmojiExtension } from '../TipTapExtensions/ColonEmojiExtension';
import { TextEmoticonExtension } from '../TipTapExtensions/TextEmoticonExtension';
import type { InputBoxProps } from './InputBox.types';
import { formatTypingMessage, resolveCommandTextFromHtml } from './InputBox.utils';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { sanitizeHtmlContent } from '../../Chat/ChatInput/ChatInput.utils';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import { useDraftAttachments } from '../../../hooks/useDraft';
import { MediaViewer } from '../files';
import { usePlatform } from '../../../hooks/usePlatform';
import { MobileEditor } from './MobileEditor';
import { useTypingState } from '../../../contexts/TypingStateContext';
import { validateFile } from '../utils/files';
import { useScope, useShortcutById } from '../../../shortcuts';
import { useEnterSendsMessage } from '../../../hooks/useEnterSendsMessage';
import { posthogService } from '../../../services/Analytics/posthogService';
import { useDefaultFormattingToolbarOpen } from '../../../hooks/useDefaultFormattingToolbarOpen';
import { Preferences } from '../../Settings/Preferences';
import { Dialog } from '../Dialog';
import { CallTranscriptSelector } from '../../Chat/CallTranscriptSelector';
import { EmojiClickData } from 'emoji-picker-react';
import { InlineEmoji } from '../EditorToolbar/InlineEmoji';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { LinkSyncPlugin } from '../TipTapExtensions/LinkSyncPlugin';
import { CanvasAttachmentModal, CanvasLinkPreview } from '../../Canvas';
import type { Canvas } from '../../Canvas';
import { CanvasVisibility, getSlashCommandArtifactDefinition } from '@xyne/shared';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { canvasService } from '../../../services/Canvas/canvasService';
import { VoiceInput } from './VoiceInput';
import type { VoiceInputHandle } from './VoiceInput';
import { v4 as uuidv4 } from 'uuid';
import { logger, Event } from '../../../utils/logger';
import { ScheduleMessageDialog } from '../ScheduleMessageDialog/ScheduleMessageDialog';
import { Checkbox } from '../Checkbox/Checkbox';

/** Extract file extension (e.g. ".pdf") from a filename. Returns empty string if none. */
const getFileExtension = (name: string): string => {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : '';
};
import { preloadEmojiData } from '../../../utils/emojiLookup';

const lowlight = createLowlight(all);

const MAX_LIST_DEPTH = 5;
const LIST_TYPES = new Set(['bulletList', 'orderedList']);

const getMaxListDepth = (doc: PMNode): number => {
  let maxDepth = 0;
  const stack: { node: PMNode; depth: number }[] = [{ node: doc, depth: 0 }];

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    const currentDepth = LIST_TYPES.has(node.type.name) ? depth + 1 : depth;

    if (currentDepth > maxDepth) {
      maxDepth = currentDepth;
    }

    node.content.forEach(child => {
      stack.push({ node: child, depth: currentDepth });
    });
  }

  return maxDepth;
};

const MaxListDepthPlugin = Extension.create({
  name: 'maxListDepth',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('maxListDepth'),
        filterTransaction: transaction => {
          if (!transaction.docChanged) return true;
          const maxDepth = getMaxListDepth(transaction.doc);
          return maxDepth <= MAX_LIST_DEPTH;
        },
      }),
    ];
  },
});

// Eagerly start loading emoji data so it's ready for sync lookups
preloadEmojiData();

export const InputBox = forwardRef<InputBoxHandle, InputBoxProps>(
  (
    {
      autoFocus = null,
      id,
      channelId,
      conversationId,
      onSendMessage,
      onContentChange,
      onCancel,
      mentionItems = [],
      voiceMentionItems = [],
      onMentionSearch,
      onMentionSelect,
      channelItems = [],
      onChannelSearch,
      onChannelSelect,
      commandItems = [],
      onCommandSelect,
      isLoadingCommands = false,
      onTyping,
      typingUsers = [],
      showTypingIndicator = true,
      agentSlot,
      hasAgentActivity = false,
      placeholder = 'Type a message...',
      value,
      disabled = false,
      className = '',
      features = {
        richText: true,
        mentions: true,
        commands: true,
        fileAttachments: true,
        emojiPicker: true,
      },
      blockedExtensions,
      maxFiles = 10,
      onAlsoSendToChannelChange,
      alsoSendToChannelChecked = false,
      preserveThreadRoute = false,
      isDMThread = false,
      onCreateTicket,
      onCreateCanvas,
      onTranscriptSelect,
      onScheduleSend,
      hasTicket = false,
      disableEnterToSend = false,
      hideSendButton = false,
      hideComposerTools = false,
      hideVoiceInput = false,
      compact = false,
      sendDisabled = false,
      bottomLeftSlot,
      disableDraftUpload = false,
      dockSlot,
      slashCommandArtifactCommand,
      slashCommandArtifactChannelLabel,
      onCancelSlashCommandArtifact,
    },

    ref,
  ) => {
    const {
      addDroppedFiles: providerAddDroppedFiles,
      removeDroppedFile: providerRemoveDroppedFile,
      clearDroppedFiles: providerClearDroppedFiles,
      getDroppedFilesForEntity,
    } = useDraftAttachments();
    const { enterSendsMessage } = useEnterSendsMessage();
    const { defaultFormattingToolbarOpen } = useDefaultFormattingToolbarOpen();
    const shareableOrigin = useShareableOrigin();
    const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | UploadedFile | null>(null);
    const [isViewerOpen, setIsViewerOpen] = useState(false);

    const alsoSendToChannelLabel = isDMThread ? 'Send as direct message' : 'Send to channel';

    // Activity bar rotation: the human typing indicator and the agent pill share ONE
    // slot above the input. When both are active they can't fit together, so flip
    // between them every 2s. When only one is active it simply stays shown.
    const hasTypingActivity = showTypingIndicator && typingUsers.length > 0;
    const bothActive = hasTypingActivity && hasAgentActivity;
    const [showAgentTurn, setShowAgentTurn] = useState(false);
    useEffect(() => {
      if (!bothActive) {
        setShowAgentTurn(false);
        return;
      }
      const id = setInterval(() => setShowAgentTurn(v => !v), 2000);
      return () => clearInterval(id);
    }, [bothActive]);
    const typingVisible = bothActive ? !showAgentTurn : hasTypingActivity;
    const agentVisible = bothActive ? showAgentTurn : hasAgentActivity;

    // State for attachments map (async loaded) - supports both File and UploadedFile
    const [attachmentsMap, setAttachmentsMap] = useState<Map<string, File | UploadedFile>>(
      new Map(),
    );

    // Load attachments from provider when channelId or conversationId changes
    React.useEffect(() => {
      const loadAttachments = () => {
        if (disableDraftUpload) return;

        if (!channelId) {
          setAttachmentsMap(new Map());
          return;
        }

        try {
          const map = getDroppedFilesForEntity(channelId, conversationId ?? null);
          setAttachmentsMap(map);
        } catch (error) {
          logger.error(Event.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Failed to load attachments:'),
            error: error,
          });
          logger.error(Event.DRAFT_ATTACHMENTS_LOAD_FAILED, {
            error: error instanceof Error ? error.message : String(error),
            channelId,
            conversationId,
          });
        }
      };

      void loadAttachments();
    }, [channelId, conversationId, getDroppedFilesForEntity, disableDraftUpload]);

    // Convert Map to array for rendering (keep attachmentId for removal)
    const allAttachments = React.useMemo(() => {
      return Array.from(attachmentsMap.entries()).map(([attachmentId, file]) => ({
        attachmentId,
        file,
      }));
    }, [attachmentsMap]);
    const [isFocused, setIsFocused] = useState(false);
    const [isInCodeBlock, setIsInCodeBlock] = useState(false);
    const [content, setContent] = useState('');
    const debouncedUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastAppliedValueRef = useRef(value ?? '');
    // When ⌘⇧V / Ctrl+Shift+V is pressed, flag the next paste to insert plain text only.
    const plainPasteRef = useRef(false);
    const [isSending, setIsSending] = useState(false);
    // Voice recording state — driven by VoiceInput component via onStateChange
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);
    const [isVoiceTranscribing, setIsVoiceTranscribing] = useState(false);
    const voiceInputRef = React.useRef<VoiceInputHandle>(null);
    const handleVoiceStateChange = useCallback(
      ({ isRecording, isTranscribing }: { isRecording: boolean; isTranscribing: boolean }) => {
        setIsVoiceRecording(isRecording);
        setIsVoiceTranscribing(isTranscribing);
      },
      [],
    );
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Cleanup debounce timer on unmount to prevent post-unmount callbacks
    useEffect(() => {
      return () => {
        if (debouncedUpdateTimer.current) {
          clearTimeout(debouncedUpdateTimer.current);
        }
      };
    }, []);

    const [isSendMenuOpen, setIsSendMenuOpen] = useState(false);
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
    const openScheduleDialog = useCallback((): void => setIsScheduleDialogOpen(true), []);
    const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
    const [showFormatToolbar, setShowFormatToolbar] = useState(defaultFormattingToolbarOpen);
    const [isTranscriptSelectorOpen, setIsTranscriptSelectorOpen] = useState(false);
    const [emojiSizeClass, setEmojiSizeClass] = useState('text-sm');
    const [showMobileFormattingToolbar, setShowMobileFormattingToolbar] = useState(
      defaultFormattingToolbarOpen,
    );

    useEffect(() => {
      setShowFormatToolbar(defaultFormattingToolbarOpen);
      setShowMobileFormattingToolbar(defaultFormattingToolbarOpen);
    }, [defaultFormattingToolbarOpen]);

    const [ticketCreated, setTicketCreated] = useState(false);

    // Canvas attachment state
    const [attachedCanvas, setAttachedCanvas] = useState<Canvas | null>(null);
    const [isCanvasAttachmentModalOpen, setIsCanvasAttachmentModalOpen] = useState(false);

    const { isMobile } = usePlatform();
    // z-index for portaled overlays (attachment menu). Raised when the composer
    // lives inside a high-z surface like the Cmd+K dialog; defaults to `z-50`.
    const overlayZIndex = useOverlayZIndex();

    const hasSendableContent = React.useMemo(
      () => !!content || allAttachments.length > 0 || !!attachedCanvas,
      [content, allAttachments.length, attachedCanvas],
    );

    const { notifyTyping } = useTypingState();

    useScope('composer', isFocused && !disabled && !isSending);

    useShortcutById(
      'composer.attach',
      () => {
        if (!fileInputRef.current) return;
        fileInputRef.current.click();
      },
      {
        enabled: Boolean(features.fileAttachments) && !disabled && !isSending,
      },
    );

    useShortcutById('composer.voiceInput', () => voiceInputRef.current?.toggle());

    useEffect(() => {
      if (!isVoiceRecording) return;
      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          voiceInputRef.current?.toggle();
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isVoiceRecording]);

    const artifactComposerDefinition = getSlashCommandArtifactDefinition(
      slashCommandArtifactCommand,
    );

    useEffect(() => {
      if (!artifactComposerDefinition || !onCancelSlashCommandArtifact) return;
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancelSlashCommandArtifact();
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [artifactComposerDefinition, onCancelSlashCommandArtifact]);

    const handleTyping = onTyping;

    // Helper function to upload a single file as draft attachment
    const addDraftAttachments = useCallback(
      async (files: File[]) => {
        if (disableDraftUpload) {
          // Generate temporary attachment IDs for local tracking
          const newAttachments = files.map(file => ({
            attachmentId: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file,
          }));

          // Update local state directly
          setAttachmentsMap(prev => {
            const newMap = new Map(prev);
            newAttachments.forEach(({ attachmentId, file }) => {
              newMap.set(attachmentId, file);
            });
            return newMap;
          });
          return;
        }

        if (!channelId) {
          toast.error('Channel ID is required for file attachments');
          return;
        }

        try {
          await providerAddDroppedFiles(files, channelId, conversationId);
        } catch (error) {
          logger.error(Event.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Failed to upload file:'),
            error: error,
          });
          logger.error(Event.ATTACHMENT_UPLOAD_FAILED, {
            error: error instanceof Error ? error.message : String(error),
            channelId,
            conversationId,
          });
          toast.error('Failed to upload file', {
            description: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
      [providerAddDroppedFiles, channelId, conversationId, disableDraftUpload],
    );

    // Helper function to add files with limit and validation
    const addFilesWithLimit = useCallback(
      async (files: File[] | FileList) => {
        const filesArray = Array.from(files);
        const availableSlots = maxFiles - allAttachments.length;

        if (availableSlots <= 0) {
          logger.warn(Event.ATTACHMENT_LIMIT_REACHED, {
            maxFiles,
            currentCount: allAttachments.length,
            attemptedCount: filesArray.length,
          });
          toast.error('Cannot add more files', {
            description: `Maximum ${maxFiles} files allowed`,
          });
          return;
        }

        const filesToValidate = filesArray.slice(0, availableSlots);
        const validFiles: File[] = [];
        const rejectedFiles: Array<{ name: string; reason: string }> = [];

        // Validate each file
        filesToValidate.forEach(file => {
          const validationOptions: { maxSize?: number; blockedExtensions?: readonly string[] } = {
            maxSize: 1024 * 1024 * 1024, // 1GB
          };

          if (blockedExtensions && blockedExtensions.length > 0) {
            validationOptions.blockedExtensions = blockedExtensions;
          }

          const validation = validateFile(file, validationOptions);

          if (validation.isValid) {
            validFiles.push(file);
          } else {
            rejectedFiles.push({
              name: file.name,
              reason: validation.error || 'Unknown error',
            });
          }
        });

        // Add valid files with upload logic
        await addDraftAttachments(validFiles);

        // Log file selection with metadata
        if (filesArray.length > 0) {
          logger.info(Event.ATTACHMENT_FILES_SELECTED, {
            fileCount: filesArray.length,
            validCount: validFiles.length,
            rejectedCount: rejectedFiles.length,
            extensions: filesArray.map(f => getFileExtension(f.name)),
            fileTypes: filesArray.map(f => f.type || 'unknown'),
            totalSizeBytes: filesArray.reduce((sum, f) => sum + f.size, 0),
          });
        }

        // Log each rejected file
        rejectedFiles.forEach(({ name, reason }) => {
          logger.warn(Event.ATTACHMENT_VALIDATION_FAILED, {
            extension: getFileExtension(name),
            reason,
          });
        });

        // Show error for rejected files
        if (rejectedFiles.length > 0) {
          const firstRejection = rejectedFiles[0];
          if (firstRejection) {
            const moreCount = rejectedFiles.length - 1;

            toast.error('File upload rejected', {
              description:
                moreCount > 0
                  ? `${firstRejection.name}: ${firstRejection.reason} (and ${moreCount} more)`
                  : `${firstRejection.name}: ${firstRejection.reason}`,
            });
          }
        }
      },
      [maxFiles, allAttachments.length, addDraftAttachments, blockedExtensions],
    );

    const updateEmojiSizeClass = useCallback((editor: ReturnType<typeof useEditor>): void => {
      if (!editor) return;
      const htmlContent = sanitizeHtmlContent(editor.getHTML());
      const sizeClass = getEmojiFontSizeClass(htmlContent);
      setEmojiSizeClass(sizeClass);
    }, []);

    const { data: customEmojis } = useCustomEmojis();

    // Use ref to hold current emojis for the extension to access
    const customEmojisRef = React.useRef(customEmojis);
    useEffect(() => {
      customEmojisRef.current = customEmojis;
    }, [customEmojis]);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          trailingNode: false,
          bold: {
            HTMLAttributes: {
              class: 'font-semibold',
            },
          },
          italic: {
            HTMLAttributes: {
              class: 'italic',
            },
          },
          strike: {
            HTMLAttributes: {
              class: 'line-through',
            },
          },
          code: false,
          blockquote: {
            HTMLAttributes: {
              class: 'border-l-4 border-muted-foreground pl-4 text-foreground',
            },
          },
          bulletList: {
            HTMLAttributes: {
              class: 'pl-6 my-2',
            },
          },
          orderedList: {
            HTMLAttributes: {
              class: 'my-2',
            },
          },
          listItem: {
            HTMLAttributes: {
              class: 'my-1',
            },
          },
          paragraph: {
            HTMLAttributes: {
              class: 'm-0 leading-6',
            },
          },
        }),
        Code.extend({
          excludes: '',
        }).configure({
          HTMLAttributes: {
            class: 'bg-muted rounded px-1 py-0.5 text-foreground font-mono text-[0.85em]',
          },
        }),
        MaxListDepthPlugin,
        InlineEmoji,
        ColonEmojiExtension.configure({
          getCustomEmojis: () => customEmojisRef.current || [],
        }),
        TextEmoticonExtension,
        CodeBlockLowlight.extend({
          addInputRules() {
            return [
              // Empty paragraph: ``` → empty code block
              textblockTypeInputRule({
                find: /^```$/,
                type: this.type,
              }),
              // Text before ```: keep existing text as-is, split and create a new empty code block after
              new InputRule({
                find: /^(.+)```$/,
                handler: ({ range, chain }) => {
                  chain()
                    .deleteRange({ from: range.to - 3, to: range.to })
                    .splitBlock()
                    .setNode(this.type)
                    .run();
                },
              }),
            ];
          },
        }).configure({
          lowlight,
          defaultLanguage: 'plaintext',
        }),
        LinkExtension.extend({
          inclusive: false,
        }).configure({
          openOnClick: false,
          HTMLAttributes: {
            class: 'text-link-color hover:text-link-hover-color underline cursor-text',
            rel: 'noopener noreferrer',
          },
        }),
        LinkSyncPlugin,
        Placeholder.configure({
          placeholder: typeof placeholder === 'string' ? placeholder : '',
        }),
        MentionExtension.configure({
          userActions: [],
          groupActions: [],
          preserveThreadRoute,
        }),
        ChannelMentionExtension,
        CommandsExtension,
        EmojiSelectorExtension,
        VoiceShimmerMark,
        FormattingShortcutsExtension,
        ...TableExtensions,
      ],
      content: value || '',
      editable: !isSending,
      onCreate: ({ editor }) => {
        const initialText = editor.getText().trim();
        setContent(initialText.length > 0 ? 'has-content' : '');
        updateEmojiSizeClass(editor);
      },
      autofocus: autoFocus ? autoFocus : null,
      onFocus: () => {
        setIsFocused(true);
      },
      onBlur: () => {
        setIsFocused(false);
      },
      onSelectionUpdate: ({ editor }) => {
        setIsInCodeBlock(editor.isActive('codeBlock'));
      },
      onUpdate: ({ editor }) => {
        const textContent = editor.getText().trim();
        setContent(prev => {
          const next = textContent.length > 0 ? 'has-content' : '';
          return prev === next ? prev : next;
        });
        setIsInCodeBlock(editor.isActive('codeBlock'));
        handleTyping?.();
        notifyTyping();

        // Quick emoji size reset: if text clearly has non-emoji chars, switch to
        // small immediately so the user doesn't see large text while typing.
        // The full getHTML()-based check runs in the debounce for pure-emoji detection.
        if (/[a-zA-Z0-9]/.test(textContent)) {
          setEmojiSizeClass('text-sm');
        }

        // Debounce heavy work: getHTML(), sanitize, draft save, emoji size.
        // These don't need to run synchronously on every keystroke.
        if (debouncedUpdateTimer.current) clearTimeout(debouncedUpdateTimer.current);
        debouncedUpdateTimer.current = setTimeout(() => {
          const htmlContent = sanitizeHtmlContent(editor.getHTML());
          lastAppliedValueRef.current = htmlContent;
          onContentChange?.(htmlContent, editor.getText());
          updateEmojiSizeClass(editor);
        }, 300);
      },
      editorProps: {
        attributes: {
          class: 'tiptap chat-input-editor prose prose-sm focus:outline-none',
          style: 'min-height: 20px; max-height: 200px; overflow-y: auto;',
          'aria-label': 'Message input',
          'data-testid': 'message-input',
          role: 'textbox',
          'aria-multiline': 'true',
          spellcheck: 'true',
          autocorrect: 'on',
          autocapitalize: 'sentences',
          autocomplete: 'on',
        },
        handleKeyDown: (view, event) => {
          // Check if screen width is below 500px
          const isMobile = window.innerWidth < 500;

          // Cmd/Ctrl+Shift+Enter: toggle a code block (Slack "create snippet"
          // parity). Handled here — ahead of the Enter send/newline branch and
          // the TipTap keymap — because editorProps.handleKeyDown runs first, so
          // the branch below would otherwise consume this combo as send/newline.
          if (event.key === 'Enter' && event.shiftKey && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            editor?.chain().focus().toggleCodeBlock().run();
            return true;
          }

          // Shift+Enter / Cmd+Enter: new line (default) OR send message (when enterSendsMessage is false)
          if (event.key === 'Enter' && (event.shiftKey || event.metaKey)) {
            if (!enterSendsMessage && !isMobile && !disableEnterToSend) {
              const mentionState = mentionPluginKey.getState(view.state);
              const channelMentionState = channelMentionPluginKey.getState(view.state);
              const commandState = commandPluginKey.getState(view.state);
              const emojiSelectorState = emojiSelectorPluginKey.getState(view.state);
              if (commandState?.isOpen && commandState.items.length > 0) {
                event.preventDefault();
                view.dispatch(
                  view.state.tr.setMeta(commandPluginKey, {
                    shouldSelect: true,
                  }),
                );
                return true;
              }
              if (
                (mentionState?.isOpen && mentionState.items.length > 0) ||
                (channelMentionState?.isOpen && channelMentionState.items.length > 0) ||
                (emojiSelectorState?.isOpen && emojiSelectorState.items.length > 0)
              ) {
                return false;
              }
              if (
                editor?.isActive('bulletList') ||
                editor?.isActive('orderedList') ||
                editor?.isActive('codeBlock') ||
                editor?.isActive('blockquote')
              ) {
                return false;
              }
              event.preventDefault();
              // Keyboard sends are invisible to autocapture (click/change/submit
              // only); emit it explicitly so keyboard vs button sends are visible.
              posthogService.capture('message_send', {
                trigger: 'keyboard',
                keyCombo: event.metaKey ? 'mod_enter' : 'shift_enter',
              });
              void handleSend();
              return true;
            }
            event.preventDefault();
            if (editor?.isActive('blockquote')) {
              editor.chain().focus().splitBlock().lift('blockquote').run();
            } else if (editor?.isActive('bulletList') || editor?.isActive('orderedList')) {
              // For lists, exit the list on a new line (similar to pressing Enter twice)
              editor?.chain().focus().splitListItem('listItem').liftListItem('listItem').run();
              return true;
            } else {
              editor?.chain().focus().splitBlock().run();
            }
            return true;
          }

          // Handle backspace to prevent unwanted list item lifting
          if (
            event.key === 'Backspace' &&
            (editor?.isActive('bulletList') || editor?.isActive('orderedList'))
          ) {
            const { state } = view;
            const { selection } = state;
            const { $from } = selection;

            // Check if cursor is at the start of a list item
            if ($from.parentOffset === 0) {
              // Check if we're not at the first list item
              const listItemPos = $from.before($from.depth);
              if (listItemPos > 0) {
                return false;
              }
            }
          }

          // Empty-table cleanup. prosemirror-tables refuses to delete a table
          // via Backspace from inside a cell, so once a user erases all the text
          // from a pasted table they are left with an empty, undeletable table
          // box (editor.isEmpty is even true, so the placeholder/empty logic
          // treats the input as empty while the table node lingers). Detect that
          // state and remove the whole table on Backspace.
          if (event.key === 'Backspace' && editor) {
            const { selection } = view.state;
            const { $from } = selection;

            // Case A: the cursor/selection sits inside a table whose cells are
            // all blank -> delete the entire table. Guarded on the whole table
            // being empty so normal editing of a populated table is untouched.
            for (let depth = $from.depth; depth > 0; depth--) {
              const ancestor = $from.node(depth);
              if (ancestor.type.spec['tableRole'] === 'table') {
                if (ancestor.textContent.trim() === '') {
                  event.preventDefault();
                  editor.chain().focus().deleteTable().run();
                  return true;
                }
                break;
              }
            }

            // Case B: the cursor is at the very start of the block immediately
            // after an empty table (e.g. the trailing paragraph a pasted table
            // leaves behind) -> remove that empty table.
            if (selection.empty && $from.parentOffset === 0) {
              const blockStart = $from.before($from.depth);
              const nodeBefore = view.state.doc.resolve(blockStart).nodeBefore;
              if (
                nodeBefore &&
                nodeBefore.type.spec['tableRole'] === 'table' &&
                nodeBefore.textContent.trim() === ''
              ) {
                event.preventDefault();
                const from = blockStart - nodeBefore.nodeSize;
                editor.chain().focus().deleteRange({ from, to: blockStart }).run();
                return true;
              }
            }
          }

          if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
            return true;
          }

          // Inline code (⌘⇧C), Strikethrough (⌘⇧X) and Clear Formatting (⌘\)
          // are registered via FormattingShortcutsExtension's TipTap keymap.

          // Plain-text paste: ⌘⇧V (Mac) / Ctrl+Shift+V (Windows/Linux).
          // ClipboardEvent carries no modifier state, so flag the intent here and
          // consume it in handlePaste. Reset shortly after in case no paste fires.
          if (
            (event.key === 'v' || event.key === 'V') &&
            event.shiftKey &&
            (event.metaKey || event.ctrlKey)
          ) {
            plainPasteRef.current = true;
            setTimeout(() => {
              plainPasteRef.current = false;
            }, 100);
            return false;
          }

          // Enter key WITHOUT Shift/Cmd: Send message or new line depending on preference
          if (event.key === 'Enter' && !event.shiftKey && !event.metaKey) {
            const mentionState = mentionPluginKey.getState(view.state);
            const channelMentionState = channelMentionPluginKey.getState(view.state);
            const commandState = commandPluginKey.getState(view.state);
            const emojiSelectorState = emojiSelectorPluginKey.getState(view.state);

            // editorProps.handleKeyDown runs before extension plugins. Select the
            // highlighted slash command here and consume Enter so it cannot fall
            // through to the message-send branch.
            if (commandState?.isOpen && commandState.items.length > 0) {
              event.preventDefault();
              view.dispatch(
                view.state.tr.setMeta(commandPluginKey, {
                  shouldSelect: true,
                }),
              );
              return true;
            }

            // If any menu is open, let it handle the Enter key
            if (
              (mentionState?.isOpen && mentionState.items.length > 0) ||
              (channelMentionState?.isOpen && channelMentionState.items.length > 0) ||
              (emojiSelectorState?.isOpen && emojiSelectorState.items.length > 0)
            ) {
              return false;
            }

            // If in special formatting context, allow default behavior
            if (
              editor?.isActive('bulletList') ||
              editor?.isActive('orderedList') ||
              editor?.isActive('codeBlock') ||
              editor?.isActive('blockquote')
            ) {
              return false;
            }

            // On mobile or when Enter-to-send is disabled, create new line
            if (isMobile || disableEnterToSend) {
              return false;
            }

            // When enterSendsMessage is false, Enter creates a new line
            if (!enterSendsMessage) {
              return false;
            }

            // On desktop with enterSendsMessage enabled: Send the message
            event.preventDefault();
            // Keyboard sends are invisible to autocapture (click/change/submit
            // only); emit it explicitly so keyboard vs button sends are visible.
            posthogService.capture('message_send', {
              trigger: 'keyboard',
              keyCombo: 'enter',
            });
            void handleSend();
            return true;
          }

          return false;
        },
        handlePaste: (view, event) => {
          const clipboard = event.clipboardData;

          // Plain-text paste (⌘⇧V / Ctrl+Shift+V): strip all source formatting.
          // Must run before the table/TSV detection below so a copied table pasted
          // with Shift is inserted as plain text rather than rebuilt as a table.
          if (plainPasteRef.current) {
            plainPasteRef.current = false;
            const plainText = clipboard?.getData('text/plain') ?? '';
            if (plainText) {
              event.preventDefault();
              editor?.commands.insertContent(plainText);
              return true;
            }
          }

          /** Handle File Pasting */
          const files = clipboard?.files ?? [];
          if (features.fileAttachments && files.length > 0) {
            logger.info(Event.ATTACHMENT_PASTE_DETECTED, {
              fileCount: files.length,
              fileTypes: Array.from(files).map(f => f.type || 'unknown'),
              extensions: Array.from(files).map(f => getFileExtension(f.name)),
            });
            void addFilesWithLimit(files);
          }

          /** Insert a table at the cursor by building ProseMirror nodes programmatically.
           *
           * Bypasses PMDOMParser entirely — creates table/tableRow/tableCell nodes
           * directly from schema node types, the same way TipTap's own `insertTable`
           * command does.  This guarantees correct node structure without any risk of
           * HTML parsing flattening the table into bare paragraphs.
           */
          const insertTableAtCursor = (rows: string[][], hasHeader: boolean): void => {
            const { state, dispatch } = view;
            const { schema } = state;

            // Resolve table node types by their tableRole spec property (mirrors
            // TipTap's internal getTableNodeTypes helper).
            const byRole: Record<string, PMNodeType> = {};
            Object.keys(schema.nodes).forEach(type => {
              const node = schema.nodes[type];
              if (!node) return;
              const spec = node.spec as { tableRole?: string };
              if (spec.tableRole) byRole[spec.tableRole] = node;
            });

            const tableType = byRole['table'];
            const rowType = byRole['row'];
            const cellType = byRole['cell'];
            const headerType = byRole['header_cell'] ?? cellType;

            if (!tableType || !rowType || !cellType) return;

            const makeCell = (text: string, isHeader: boolean) => {
              const t = isHeader ? headerType : cellType;
              const para = text
                ? schema.nodes['paragraph']!.create(null, schema.text(text))
                : schema.nodes['paragraph']!.create();
              return t!.createChecked(null, para);
            };

            const pmRows = rows.map((cellTexts, rowIndex) => {
              const isHeaderRow = hasHeader && rowIndex === 0;
              return rowType.createChecked(
                null,
                cellTexts.map(text => makeCell(text, isHeaderRow)),
              );
            });

            const tableNode = tableType.createChecked(null, pmRows);
            const prevScrollTop = view.dom.scrollTop;
            const transaction = state.tr.replaceSelectionWith(tableNode);
            const findInsertedTablePosition = (): number | null => {
              let position: number | null = null;
              transaction.doc.descendants((node, nodePosition) => {
                if (position === null && node === tableNode) {
                  position = nodePosition;
                  return false;
                }
                return position === null;
              });
              return position;
            };
            const tablePosition = findInsertedTablePosition();

            if (tablePosition !== null) {
              const paragraphType = schema.nodes['paragraph'];
              if (paragraphType) {
                const afterTable = tablePosition + tableNode.nodeSize;
                transaction.insert(afterTable, paragraphType.create());
                transaction.setSelection(TextSelection.create(transaction.doc, afterTable + 1));
              }
            }

            dispatch(transaction);
            view.dom.scrollTop = prevScrollTop;
          };

          const htmlContent = clipboard?.getData('text/html');
          if (htmlContent && htmlContent.includes('<table')) {
            event.preventDefault();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            doc.querySelectorAll<HTMLElement>('.xyne-code-block').forEach(codeBlock => {
              const pre = codeBlock.querySelector(':scope > pre');
              if (pre) codeBlock.replaceWith(pre);
            });

            const cellCount = Array.from(doc.querySelectorAll('table')).reduce(
              (count, table) => count + table.querySelectorAll('td, th').length,
              0,
            );
            if (cellCount > 500) {
              toast.error('Table content is too large', {
                description: 'Please paste a smaller table or copy the data as text.',
              });
              return true;
            }

            editor?.commands.insertContent(doc.body.innerHTML);
            return true;
          }

          const pastedText = clipboard?.getData('text');

          /** Handle tab-separated data paste (no HTML table available in clipboard) */
          if (pastedText && !(htmlContent && htmlContent.includes('<table'))) {
            const lines = pastedText.split('\n').filter(l => l.trim() !== '');
            if (lines.length >= 2 && lines.every(l => l.includes('\t'))) {
              event.preventDefault();
              const rows = lines.map(l => l.split('\t').map(c => c.trim()));
              if (!rows[0] || rows[0].length === 0) return false;
              insertTableAtCursor(rows, true);
              return true;
            }
          }

          // Convert oversized pasted text to a file attachment, but only when there's
          // a channel to attach it to. Without a channelId (e.g. the DM-compose panel,
          // before the conversation exists) fall through to normal inline paste.
          if (pastedText && pastedText.length > 11500 && channelId) {
            event.preventDefault();

            // Check if attachment limit has been reached before adding text file
            if (allAttachments.length >= maxFiles) {
              return true;
            }

            // Try to parse as JSON to determine file type
            let fileName: string;
            let fileType: string;
            let blobContent: Blob;

            try {
              // Attempt to parse the text as JSON
              JSON.parse(pastedText);
              // If successful, create a JSON file
              fileName = `pasted-text-${Date.now()}.json`;
              fileType = 'application/json';
              blobContent = new Blob([pastedText], { type: fileType });
            } catch {
              // If parsing fails, create a text file
              fileName = `pasted-text-${Date.now()}.txt`;
              fileType = 'text/plain';
              blobContent = new Blob([pastedText], { type: fileType });
            }

            const file = new File([blobContent], fileName, { type: fileType });
            logger.info(Event.ATTACHMENT_LARGE_TEXT_CONVERTED, {
              charCount: pastedText.length,
              convertedExtension: getFileExtension(fileName),
            });
            void addDraftAttachments([file]);
            return true;
          }
          return false;
        },
      },
    });

    useEffect(() => {
      editor?.setEditable(!disabled && !isSending, false);
    }, [editor, disabled, isSending]);

    // Keep mounted, non-focused editors in sync when another InputBox updates
    // the shared draft value for this lookup id. Skip focused editors where change is happening.
    useEffect(() => {
      if (!editor || editor.isFocused || value === undefined) return;

      const nextValue = value;
      if (lastAppliedValueRef.current === nextValue) return;

      const currentHtml = sanitizeHtmlContent(editor.getHTML());
      if (currentHtml === nextValue) {
        lastAppliedValueRef.current = nextValue;
        return;
      }

      editor.commands.setContent(nextValue, { emitUpdate: false });
      lastAppliedValueRef.current = nextValue;

      const nextText = editor.getText().trim();
      setContent(nextText.length > 0 ? 'has-content' : '');
      updateEmojiSizeClass(editor);
    }, [editor, value, updateEmojiSizeClass]);

    // Expose imperative API for drag and drop and clearing content
    useImperativeHandle(
      ref,
      () => ({
        addFiles: (files: File[]): void => {
          if (files.length > 0) {
            void addFilesWithLimit(files);
          }
          // Focus the editor after adding files via drag and drop
          editor?.commands.focus();
        },
        clearContent: (): void => {
          editor?.commands.setContent('');
          setContent('');
          if (channelId) {
            void providerClearDroppedFiles(channelId, conversationId ?? null);
          }
          if (disableDraftUpload) {
            setAttachmentsMap(new Map());
          }
        },
        clearTextOnly: (): void => {
          editor?.commands.setContent('');
          setContent('');
        },
        insertContent: (content: string): void => {
          editor?.commands.insertContent(content);
          editor?.commands.focus();
        },
        getHtml: (): string => editor?.getHTML() ?? '',
        isSuggestionOpen: (): boolean => {
          if (!editor) return false;
          const state = editor.state;
          const mentionState = mentionPluginKey.getState(state);
          const channelMentionState = channelMentionPluginKey.getState(state);
          const commandState = commandPluginKey.getState(state);
          return (
            ((mentionState?.isOpen && mentionState.items.length > 0) ||
              (channelMentionState?.isOpen && channelMentionState.items.length > 0) ||
              (commandState?.isOpen && commandState.items.length > 0)) ??
            false
          );
        },
        focus: (): void => {
          editor?.commands.focus();
        },
      }),
      [
        editor,
        addFilesWithLimit,
        providerClearDroppedFiles,
        channelId,
        conversationId,
        disableDraftUpload,
      ],
    );

    const handleSend = useCallback(async () => {
      if (!editor || isSending || sendDisabled) return;

      // If a voice stream is active, finalize it for send first: this strips any
      // unfinalized interim text and aborts the stream (discarding in-flight results)
      // BEFORE we read the editor, so only committed text is sent and nothing leaks
      // into the next message. No-op when no stream is active.
      voiceInputRef.current?.abortForSend();

      // The voice "shimmer" highlight is a transient editor-only decoration that
      // auto-clears after ~1.4s; strip it across the doc so a quick send can't bake
      // the orange highlight (a <span class="voice-shimmer">) into the sent message.
      if (editor.schema.marks['voiceShimmer']) {
        editor
          .chain()
          .setTextSelection({ from: 0, to: editor.state.doc.content.size })
          .unsetMark('voiceShimmer')
          .run();
      }

      // Flush pending debounced content update before sending so that
      // onContentChange consumers (e.g. ComposeDmPanel form state) receive
      // the latest content before handleSubmit reads from the form.
      if (debouncedUpdateTimer.current) {
        clearTimeout(debouncedUpdateTimer.current);
        debouncedUpdateTimer.current = null;
        const htmlContent = sanitizeHtmlContent(editor.getHTML());
        lastAppliedValueRef.current = htmlContent;
        onContentChange?.(htmlContent, editor.getText());
      }

      const plainText = editor.getText().trim();
      const htmlContent = editor.getHTML();

      if (!hasSendableContent) return;

      // Detect if the entire content is a slash command (e.g. "/sell" or "/sell AAPL").
      // If so, dispatch it to the app instead of sending it as a chat message.
      const commandMatch = plainText.match(/^\/([\w-]+)(?:\s+(.*))?$/);
      if (commandMatch && onCommandSelect) {
        const cmdName = commandMatch[1] ?? '';
        // Resolve mention spans from the HTML content so @user → <userid:xyneId>
        // and @group → <groupid:xyneId> instead of bare display names.
        const cmdText = resolveCommandTextFromHtml(htmlContent, cmdName);
        const matchedCmd = commandItems.find(c => c.name.toLowerCase() === cmdName.toLowerCase());
        if (matchedCmd && matchedCmd.kind !== 'slash-command-artifact') {
          editor.commands.setContent('');
          setContent('');
          editor.commands.focus();
          void onCommandSelect(matchedCmd, cmdText);
          return;
        }
      }

      setIsSending(true);
      try {
        // Filter to only send actual File objects
        // UploadedFile metadata-only attachments are already stored and referenced by ID
        const filesToSend = allAttachments
          .map(a => a.file)
          .filter((f): f is File => f instanceof File);

        // Insert canvas link into editor if attached
        if (attachedCanvas) {
          const canvasLink = `${shareableOrigin}/chat/canvas/${attachedCanvas.id}`;
          // Insert as plain link - platform will unfurl to show preview
          editor?.commands.insertContent(` ${canvasLink}`);
        }

        // Get fresh content after inserting link
        const finalHtmlContent = editor?.getHTML() || htmlContent;
        const finalPlainText = editor?.getText().trim() || plainText;

        await onSendMessage(finalPlainText, finalHtmlContent, filesToSend);

        editor.commands.setContent('');
        setContent('');
        setAttachedCanvas(null);
        if (disableDraftUpload) {
          setAttachmentsMap(new Map());
        }
        editor.commands.focus();
      } finally {
        setIsSending(false);
      }
    }, [
      editor,
      allAttachments,
      onSendMessage,
      isSending,
      attachedCanvas,
      hasSendableContent,
      sendDisabled,
      commandItems,
      onCommandSelect,
      disableDraftUpload,
    ]);

    // Canvas attachment handlers
    const handleCanvasSelect = useCallback((canvas: Canvas) => {
      setAttachedCanvas(canvas);
      setIsCanvasAttachmentModalOpen(false);
    }, []);

    const handleCreateNewCanvas = useCallback(async () => {
      if (onCreateCanvas) {
        setIsCanvasAttachmentModalOpen(false);
        onCreateCanvas(editor?.getHTML() ?? '');
        return;
      }

      // Create canvas immediately, attach to composer, then open canvas editor
      const newCanvasId = uuidv4();
      const now = Date.now();

      try {
        // Create the canvas via API
        await canvasService.createCollaborativeCanvas({
          id: newCanvasId,
          title: 'Untitled Canvas',
          ...(channelId ? { channelId } : {}),
        });

        // Create canvas object and attach to composer
        const newCanvas: Canvas = {
          id: newCanvasId,
          title: 'Untitled Canvas',
          createdBy: '',
          visibility: CanvasVisibility.PRIVATE,
          isTemplate: false,
          isStarred: false,
          createdAt: now,
          updatedAt: now,
        };
        setAttachedCanvas(newCanvas);
        setIsCanvasAttachmentModalOpen(false);

        // Open canvas editor in new tab for editing
        const canvasUrl = `${shareableOrigin}/chat/canvas/${newCanvasId}`;
        window.open(canvasUrl, '_blank');
      } catch (error) {
        logger.error(Event.CANVAS_CREATE_FAILED, {
          canvasId: newCanvasId,
          channelId,
          error: error instanceof Error ? error.message : String(error),
        });
        toast.error('Failed to create canvas', {
          description: 'Please try again.',
        });
      }
    }, [channelId, editor, onCreateCanvas, shareableOrigin]);

    const handleRemoveAttachedCanvas = useCallback(() => {
      setAttachedCanvas(null);
    }, [setAttachedCanvas]);

    const handleFileSelect = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(e.target.files || []);
        if (selectedFiles.length > 0) {
          void addFilesWithLimit(selectedFiles);
        }
        e.target.value = '';
        editor?.commands.focus();
      },
      [addFilesWithLimit, editor, isMobile, channelId, conversationId, getDroppedFilesForEntity],
    );

    const handleAttachClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    // Reset ticketCreated when hasTicket prop changes or id changes (different conversation)
    useEffect(() => {
      if (hasTicket) {
        setTicketCreated(true);
      } else {
        setTicketCreated(false);
      }
    }, [hasTicket, id]);

    const handleRemoveAttachment = useCallback(
      async ({ attachmentId }: { attachmentId: string; file: File | UploadedFile }) => {
        if (!disableDraftUpload) {
          await providerRemoveDroppedFile(attachmentId);
        }
        // Update local state immediately for responsiveness
        setAttachmentsMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(attachmentId);
          return newMap;
        });
      },
      [providerRemoveDroppedFile, disableDraftUpload],
    );

    const handlePreview = (file: File | UploadedFile): void => {
      setSelectedFile(file);
      setIsViewerOpen(true);
    };

    const handleCloseViewer = (): void => {
      setIsViewerOpen(false);
      setSelectedFile(null);
    };

    // Convert channelItems to MentionResult format for the MentionSelector
    const channelMentionItems: MentionResult[] = channelItems.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: 'channel' as const,
      isPrivate: channel.isPrivate,
      ...(channel.description !== undefined && { description: channel.description }),
    }));

    // Wrap the onChannelSelect callback to match MentionResult type
    const handleChannelSelect = useCallback(
      (mention: MentionResult) => {
        if (mention.type === 'channel' && onChannelSelect) {
          onChannelSelect({
            id: mention.id,
            name: mention.name,
            isPrivate: mention.isPrivate ?? false,
            ...(mention.description !== undefined && { description: mention.description }),
          });
        }
      },
      [onChannelSelect],
    );

    const handleEmojiSelect = useCallback(
      (emojiData: EmojiClickData) => {
        if (!editor) return;

        const { from } = editor.state.selection;
        const textBefore = from > 0 ? editor.state.doc.textBetween(from - 1, from) : '';
        let chain = editor.chain().focus();

        if (textBefore === '@') {
          chain = chain.deleteRange({ from: from - 1, to: from });
        }

        if (emojiData.isCustom) {
          chain
            .insertContent({
              type: 'inlineEmoji',
              attrs: {
                emojiId: emojiData.emoji,
                src: emojiData.imageUrl,
                alt: `:${emojiData.names[0]}:`,
                title: emojiData.names[0],
              },
            })
            .run();
        } else {
          chain.insertContent(emojiData.emoji).run();
        }
      },
      [editor],
    );

    return (
      <div className={`flex-shrink-0 relative ${className}`} data-input-id={id}>
        {features.mentions && (
          <MentionSelector
            editor={editor}
            mentionItems={mentionItems}
            {...(onMentionSearch && { onMentionSearch })}
            {...(onMentionSelect && { onMentionSelect })}
          />
        )}

        {features.commands && (
          <CommandSelector
            editor={editor}
            commandItems={commandItems}
            isLoadingCommands={isLoadingCommands}
            onCommandSelect={onCommandSelect}
          />
        )}

        <MentionSelector
          editor={editor}
          mentionItems={channelMentionItems}
          triggerChar='#'
          {...(onChannelSearch && { onMentionSearch: onChannelSearch })}
          {...(onChannelSelect && { onMentionSelect: handleChannelSelect })}
        />

        {features.emojiPicker && (
          <EmojiSelector editor={editor} customEmojis={customEmojis ?? []} />
        )}

        {/* Activity bar — absolutely positioned above the input box so showing/hiding
            never shifts the chat layout. The typing indicator and the agent pill share
            this single (left) slot; when both are active they alternate every 2s (see
            the flip effect above). The bar is transparent and each chip carries its own
            bg, so it's invisible when nothing is active. The agent slot stays mounted
            (display-toggled) so its progress subscription isn't torn down on each flip.
            Composers set --composer-px to their own horizontal padding so the bar bleeds back
            out to the full container width; unset (0px) it stays flush with the input box. */}
        <div className='absolute top-0 -translate-y-full flex items-center left-[calc(var(--composer-px,0px)*-1)] right-[calc(var(--composer-px,0px)*-1)]'>
          {hasTypingActivity && (
            <div
              className='flex items-center gap-1.5 h-5 bg-background w-full px-[var(--composer-px)]'
              style={{ display: typingVisible ? 'flex' : 'none' }}
            >
              <div className='flex items-center -space-x-1'>
                {typingUsers.slice(0, 4).map(u => (
                  <Avatar
                    key={u.userId}
                    userId={u.userId}
                    size='xs'
                    rounded
                    showActiveStatus={false}
                    className='size-3 ring-2 ring-background'
                  />
                ))}
              </div>
              <small className='typing-shimmer text-[10px] tracking-tight'>
                {`${formatTypingMessage(typingUsers)}...`}
              </small>
            </div>
          )}
          <div
            className='flex items-center min-w-0'
            style={{ display: agentVisible ? 'flex' : 'none' }}
          >
            {agentSlot}
          </div>
        </div>

        {dockSlot}

        <div
          className={isVoiceRecording ? 'xyne-voice-border-wrap' : undefined}
          style={isVoiceRecording && isMobile ? { borderRadius: '28px' } : undefined}
        >
          <div
            className={`
            overflow-hidden transition-all flex flex-col relative
            ${isMobile ? 'bg-background rounded-[26px] text-foreground shadow-sm' : 'bg-background rounded-2xl border text-foreground shadow-none'}
            ${
              !isMobile && artifactComposerDefinition
                ? 'border-orange-500 ring-1 ring-orange-500'
                : !isMobile && isFocused
                  ? 'border-chat-composer-border-active'
                  : !isMobile
                    ? 'border-chat-composer-border'
                    : ''
            }
            ${isSending ? 'opacity-60 pointer-events-none' : ''}
          `}
          >
            {artifactComposerDefinition && (
              <div className='flex h-11 items-center justify-between border-b border-orange-200 bg-orange-50/80 px-3 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300'>
                <div className='flex min-w-0 items-center gap-2 text-sm font-semibold'>
                  <span className='rounded bg-orange-500 px-2 py-0.5 text-xs font-bold text-white'>
                    {artifactComposerDefinition.badge}
                  </span>
                  <span className='truncate'>
                    {artifactComposerDefinition.composerLabel}
                    {slashCommandArtifactChannelLabel
                      ? ` in ${slashCommandArtifactChannelLabel}`
                      : ''}
                  </span>
                </div>
                <button
                  type='button'
                  onClick={onCancelSlashCommandArtifact}
                  className='ml-3 flex shrink-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground'
                  aria-label={`Cancel ${artifactComposerDefinition.badge} declaration`}
                >
                  <span className='hidden sm:inline'>esc to cancel</span>
                  <X className='size-3.5' />
                </button>
              </div>
            )}
            {/* VoiceInput — always mounted so ref works on mobile too; headless on mobile since MobileEditor has its own mic button */}
            {isMobile && !hideVoiceInput && (
              <VoiceInput
                ref={voiceInputRef}
                headless
                editor={editor}
                mentionItems={mentionItems}
                voiceMentionItems={voiceMentionItems}
                disabled={disabled}
                isSending={isSending}
                onStateChange={handleVoiceStateChange}
              />
            )}

            {/* Electron update notices live inside the composer, above the formatting toolbar. */}
            {features.richText && !isMobile && <div data-electron-update-nudge-slot />}

            {/* Desktop: Editor Toolbar */}
            {features.richText && !isMobile && showFormatToolbar && (
              <EditorToolbar editor={editor} />
            )}

            {/* Conditionally render mobile or desktop layout */}
            {isMobile ? (
              <MobileEditor
                editor={editor}
                content={content}
                allAttachments={allAttachments
                  .map(a => a.file)
                  .filter((f): f is File => f instanceof File)}
                isSending={isSending}
                disabled={disabled}
                emojiSizeClass={emojiSizeClass}
                onAttachClick={handleAttachClick}
                onSend={() => void handleSend()}
                placeholder={placeholder}
                showMentions={features.mentions}
                showFormattingToolbar={showMobileFormattingToolbar}
                onMentionClick={() => {
                  editor?.chain().focus().run();
                }}
                onChannelClick={() => {
                  editor?.chain().focus().run();
                }}
                onShowFormattingToolbar={() => setShowMobileFormattingToolbar(true)}
                onCloseFormattingToolbar={() => setShowMobileFormattingToolbar(false)}
                showEmojiPicker={features.emojiPicker}
                onEmojiSelect={handleEmojiSelect}
                hideSendButton={hideSendButton}
                showAttachButton={!!features.fileAttachments}
                showVoiceInput={!hideVoiceInput}
                isVoiceRecording={isVoiceRecording}
                isVoiceTranscribing={isVoiceTranscribing}
                onVoiceToggle={() => voiceInputRef.current?.toggle()}
                attachmentPreviewComponent={
                  (features.fileAttachments && allAttachments.length > 0) || attachedCanvas ? (
                    <div className='px-3 pb-2 flex flex-wrap gap-3'>
                      {allAttachments.map(({ attachmentId, file }, index) => (
                        <AttachmentPreview
                          key={`file-${attachmentId}-${index}`}
                          file={file}
                          onRemove={() => void handleRemoveAttachment({ attachmentId, file })}
                          onPreview={() => handlePreview(file)}
                          isUploading={false}
                        />
                      ))}
                      {attachedCanvas && (
                        <CanvasLinkPreview
                          canvas={attachedCanvas}
                          onRemove={handleRemoveAttachedCanvas}
                        />
                      )}
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <div
                className={`
                relative ${compact ? 'py-0.5 pl-3 pr-11' : 'px-3 pt-1 pb-1'}
                ${isSending ? '[&_.ProseMirror]:caret-transparent' : ''}
              `}
              >
                <EditorContent
                  editor={editor}
                  className={`
                  chat-input-field w-full resize-none border-0 outline-none bg-transparent leading-6 break-words
                  text-foreground placeholder:text-muted-foreground
                  [&_a]:pointer-events-none
                  [&_p.is-editor-empty:before]:hidden
                  ${emojiSizeClass}
                `}
                />
                {!editor?.getText().length &&
                  !isInCodeBlock &&
                  !editor?.isActive('bulletList') &&
                  !editor?.isActive('orderedList') &&
                  !editor?.isActive('blockquote') &&
                  (isVoiceRecording ? (
                    <div
                      className={`absolute inset-0 pointer-events-none select-none flex items-center gap-3 h-fit my-auto ${
                        compact ? 'py-1 pl-3 pr-11' : 'px-3 py-2'
                      }`}
                    >
                      <div className='flex items-end gap-[3px]' style={{ height: 18 }}>
                        {([0, 120, 60, 180, 90] as const).map((delay, i) => (
                          <div
                            key={i}
                            className='voice-wave-bar'
                            style={{
                              height: [10, 18, 14, 18, 10][i],
                              animationDelay: `${delay}ms`,
                            }}
                          />
                        ))}
                      </div>
                      <span className='text-[13px] text-muted-foreground'>Listening...</span>
                    </div>
                  ) : (
                    <div
                      className={`absolute inset-0 text-muted-foreground text-[14px] leading-6 pointer-events-none select-none flex items-center h-fit my-auto ${
                        compact ? 'py-1 pl-3 pr-11' : 'px-3 py-2'
                      }`}
                    >
                      {placeholder}
                    </div>
                  ))}
              </div>
            )}

            {/* Desktop: Render attachments after editor content */}
            {!isMobile && features.fileAttachments && allAttachments.length > 0 && (
              <div className='px-3 pb-2 flex flex-wrap gap-3'>
                {allAttachments.map(({ attachmentId, file }) => (
                  <AttachmentPreview
                    key={attachmentId}
                    file={file}
                    onRemove={() => void handleRemoveAttachment({ attachmentId, file })}
                    onPreview={() => handlePreview(file)}
                    isUploading={false}
                  />
                ))}
              </div>
            )}

            {/* Attached Canvas Preview */}
            {attachedCanvas && (
              <div className='px-3 pb-2'>
                <CanvasLinkPreview canvas={attachedCanvas} onRemove={handleRemoveAttachedCanvas} />
              </div>
            )}

            {/* Full-screen Viewer - Use MediaViewer for File objects, FilePreviewModal for UploadedFile */}
            {selectedFile && (
              <>
                {selectedFile instanceof File ? (
                  <MediaViewer
                    file={selectedFile}
                    isOpen={isViewerOpen}
                    onClose={handleCloseViewer}
                  />
                ) : (
                  <FilePreviewModal
                    isOpen={isViewerOpen}
                    onClose={handleCloseViewer}
                    fileName={selectedFile.originalName}
                    fileUrl={`/attachments/${selectedFile.id}/download`}
                    mimeType={selectedFile.mimeType}
                    fileSize={selectedFile.fileSize}
                    attachmentId={selectedFile.id}
                  />
                )}
              </>
            )}

            {/* "Send to channel" — on desktop this lives inline in the footer actions
                row beside the formatting (Aa) toggle; on mobile there is no footer row
                (MobileEditor owns the actions), so it keeps its own row here. */}
            {onAlsoSendToChannelChange && isMobile && (
              <div className='flex items-center px-3 py-1'>
                <Checkbox
                  size='sm'
                  checked={alsoSendToChannelChecked ?? false}
                  onChange={onAlsoSendToChannelChange}
                  disabled={disabled || isSending}
                  label={alsoSendToChannelLabel}
                />
              </div>
            )}

            {/* Hidden file input - always rendered for both mobile and desktop */}
            {features.fileAttachments && (
              <input
                ref={fileInputRef}
                type='file'
                multiple
                onChange={handleFileSelect}
                className='hidden'
                aria-label='File attachment input'
              />
            )}

            {/* Desktop Footer Actions */}
            {!isMobile && (
              <div
                className={`flex items-center justify-between gap-2 ${
                  compact ? 'absolute right-2 top-1/2 -translate-y-1/2 px-0 py-0' : 'px-2 pb-2 pt-1'
                }`}
              >
                {/* min-w-0 lets this group shrink below its content width so the
                    "Send to channel" label ellipsizes instead of pushing the send
                    controls out of the row. The icon buttons keep their size via
                    min-width:auto (fixed-size svg children). */}
                <div className='flex min-w-0 items-center gap-1'>
                  {!hideComposerTools && features.fileAttachments && (
                    <DropdownMenu open={isPlusMenuOpen} onOpenChange={setIsPlusMenuOpen}>
                      <Tooltip
                        content={
                          <span className='flex items-center gap-2'>
                            Attach files
                            <ShortcutHint keys='mod+o' />
                          </span>
                        }
                        side='top'
                        delayDuration={300}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type='button'
                            className='p-1.5 rounded hover:bg-accent transition-all duration-200 ease-in-out'
                            aria-label='Add content'
                            disabled={disabled || isSending}
                          >
                            <PaperclipSlant className='h-4 w-4 text-muted-foreground' />
                          </button>
                        </DropdownMenuTrigger>
                      </Tooltip>
                      <DropdownMenuContent side='top' align='start' className={overlayZIndex}>
                        <DropdownMenuItem
                          onClick={() => {
                            handleAttachClick();
                            setIsPlusMenuOpen(false);
                          }}
                          data-track-category='CHAT_INPUT'
                          data-track-name='ATTACH_FILE'
                        >
                          <Plus className='h-4 w-4' /> Upload Files
                          <ShortcutHint keys='mod+o' className='ml-auto pl-6' />
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setIsTranscriptSelectorOpen(true);
                            setIsPlusMenuOpen(false);
                          }}
                          data-track-category='CHAT_INPUT'
                          data-track-name='ATTACH_TRANSCRIPT'
                        >
                          <FileText className='h-4 w-4' /> Add Call Summary
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setIsCanvasAttachmentModalOpen(true);
                            setIsPlusMenuOpen(false);
                          }}
                          data-track-category='CHAT_INPUT'
                          data-track-name='ATTACH_CANVAS'
                        >
                          <FileText className='h-4 w-4' /> Canvas
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  <Dialog
                    open={isTranscriptSelectorOpen}
                    onOpenChange={setIsTranscriptSelectorOpen}
                    className='max-w-[900px] w-full !p-0 border-none bg-transparent shadow-none overflow-visible'
                    {...(overlayZIndex && { zIndexClassName: overlayZIndex })}
                  >
                    <CallTranscriptSelector
                      onSelect={transcript => {
                        if (onTranscriptSelect) {
                          onTranscriptSelect(transcript);
                        } else {
                          editor?.commands.insertContent(transcript);
                        }
                        setIsTranscriptSelectorOpen(false);
                      }}
                      onAttach={file => {
                        void addDraftAttachments([file]);
                        setIsTranscriptSelectorOpen(false);
                        editor?.commands.focus();
                      }}
                      onClose={() => setIsTranscriptSelectorOpen(false)}
                    />
                  </Dialog>

                  {!hideComposerTools && features.emojiPicker && (
                    // Inside InputBox.tsx -> EmojiPickerButton component
                    <EmojiPickerButton
                      onEmojiSelect={handleEmojiSelect}
                      disabled={disabled || isSending}
                    />
                  )}

                  {!hideComposerTools && features.mentions && (
                    <Tooltip
                      content='Mention user (@)'
                      side='top'
                      delayDuration={1000}
                      skipDelayDuration={1000}
                    >
                      <button
                        type='button'
                        onClick={() => {
                          editor?.chain().focus().insertContent('@').run();
                        }}
                        data-track-category='CHAT_INPUT'
                        data-track-name='INSERT_USER_MENTION'
                        className='p-1.5 rounded hover:bg-accent transition-all duration-200 ease-in-out'
                        aria-label='Mention user'
                        data-testid='mention-user-btn'
                        disabled={disabled || isSending}
                      >
                        <AtMark className='h-4 w-4 text-muted-foreground' />
                      </button>
                    </Tooltip>
                  )}

                  {!hideComposerTools && (
                    <Tooltip
                      content='Mention channel (#)'
                      side='top'
                      delayDuration={1000}
                      skipDelayDuration={1000}
                    >
                      <button
                        type='button'
                        onClick={() => {
                          editor?.chain().focus().insertContent('#').run();
                        }}
                        data-track-category='CHAT_INPUT'
                        data-track-name='INSERT_CHANNEL_MENTION'
                        className='p-1.5 rounded hover:bg-accent transition-all duration-200 ease-in-out'
                        aria-label='Mention channel'
                        disabled={disabled || isSending}
                      >
                        <Hashtag className='h-4 w-4 text-muted-foreground' />
                      </button>
                    </Tooltip>
                  )}

                  {!hideComposerTools && features.richText && (
                    <Tooltip
                      content={showFormatToolbar ? 'Hide formatting' : 'Show formatting'}
                      side='top'
                      delayDuration={1000}
                      skipDelayDuration={1000}
                    >
                      <button
                        type='button'
                        onClick={() => setShowFormatToolbar(prev => !prev)}
                        data-track-category='CHAT_INPUT'
                        data-track-name='TOGGLE_FORMAT_TOOLBAR'
                        className={`p-1.5 rounded transition-all duration-200 ease-in-out ${
                          showFormatToolbar
                            ? 'bg-accent text-foreground'
                            : 'hover:bg-accent text-muted-foreground'
                        }`}
                        aria-label='Toggle formatting toolbar'
                        aria-pressed={showFormatToolbar}
                        data-testid='toggle-format-toolbar-btn'
                        disabled={disabled || isSending}
                      >
                        <FontAa className='h-4 w-4' />
                      </button>
                    </Tooltip>
                  )}

                  {onAlsoSendToChannelChange && (
                    <div className='flex min-w-0 items-center pl-1'>
                      <Checkbox
                        size='sm'
                        truncateLabel
                        checked={alsoSendToChannelChecked ?? false}
                        onChange={onAlsoSendToChannelChange}
                        disabled={disabled || isSending}
                        label={alsoSendToChannelLabel}
                      />
                    </div>
                  )}

                  {!hideComposerTools && bottomLeftSlot}
                </div>

                <div className='flex shrink-0 items-center gap-2'>
                  {onCancel && (
                    <Tooltip
                      content='Cancel editing'
                      side='top'
                      delayDuration={1000}
                      skipDelayDuration={1000}
                    >
                      <button
                        type='button'
                        onClick={onCancel}
                        data-track-category='CHAT_INPUT'
                        data-track-name='CANCEL_EDITING'
                        className='p-2 rounded-md bg-muted text-foreground hover:bg-border transition-all duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2'
                        aria-label='Cancel editing'
                      >
                        <X className='h-4 w-4' />
                      </button>
                    </Tooltip>
                  )}

                  {!hideVoiceInput && (
                    <VoiceInput
                      ref={voiceInputRef}
                      editor={editor}
                      mentionItems={mentionItems}
                      voiceMentionItems={voiceMentionItems}
                      disabled={disabled}
                      isSending={isSending}
                      onStateChange={handleVoiceStateChange}
                    />
                  )}

                  {!hideSendButton && (
                    <div className='relative flex items-center'>
                      {onCreateTicket ? (
                        <div
                          className={`flex items-center rounded-md overflow-hidden transition-all duration-200 ease-in-out ${
                            hasSendableContent && !sendDisabled
                              ? artifactComposerDefinition
                                ? 'bg-orange-500 text-white hover:bg-orange-600'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90'
                              : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                          }`}
                        >
                          <Tooltip
                            content='Send message'
                            side='top'
                            delayDuration={1000}
                            skipDelayDuration={1000}
                          >
                            <button
                              type='button'
                              onClick={() => void handleSend()}
                              disabled={
                                disabled || sendDisabled || isSending || !hasSendableContent
                              }
                              className='p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2'
                              aria-label='Send message'
                              data-testid='send-message-button'
                              data-track-category='CHAT_INPUT'
                              data-track-name='SEND_MESSAGE'
                              data-track-metadata={JSON.stringify({
                                ...(conversationId !== null ? { conversationId } : { channelId }),
                                message: editor?.getText().trim() || '',
                                hasAttachments: allAttachments.length > 0,
                              })}
                            >
                              {isSending ? (
                                <Loader2 className='h-4 w-4 animate-spin' />
                              ) : (
                                <ArrowUp className='h-4 w-4' />
                              )}
                            </button>
                          </Tooltip>
                          <div
                            className={`w-px h-4 ${
                              hasSendableContent ? 'bg-background/20' : 'bg-muted-foreground/20'
                            }`}
                          ></div>
                          <DropdownMenu open={isSendMenuOpen} onOpenChange={setIsSendMenuOpen}>
                            <DropdownMenuTrigger asChild>
                              <button
                                type='button'
                                disabled={disabled || sendDisabled || isSending}
                                className='p-1.5 hover:bg-black/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2'
                                data-testid='send-options-menu'
                              >
                                <ChevronBigDown className='h-3 w-3' />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side='top' align='end'>
                              {!(hasTicket || ticketCreated) && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setIsSendMenuOpen(false);
                                    onCreateTicket(editor?.getText().trim() || '');
                                  }}
                                  data-track-category='CHAT_INPUT'
                                  data-track-name='CREATE_TICKET_FROM_INPUT'
                                >
                                  <Ticket className='h-4 w-4' /> Create a ticket
                                </DropdownMenuItem>
                              )}
                              {onScheduleSend && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setIsSendMenuOpen(false);
                                    openScheduleDialog();
                                  }}
                                  data-track-category='CHAT_INPUT'
                                  data-track-name='OPEN_SCHEDULE_DIALOG'
                                >
                                  <Clock className='h-4 w-4' /> Schedule message
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : onScheduleSend ? (
                        // No ticket creation but schedule send is available — split button
                        <div
                          className={`flex items-center rounded-md overflow-hidden transition-all duration-200 ease-in-out ${
                            hasSendableContent
                              ? artifactComposerDefinition
                                ? 'bg-orange-500 text-white hover:bg-orange-600'
                                : 'bg-primary text-white hover:bg-primary/90'
                              : 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                          }`}
                        >
                          <Tooltip
                            content='Send message'
                            side='top'
                            delayDuration={1000}
                            skipDelayDuration={1000}
                          >
                            <button
                              type='button'
                              onClick={() => void handleSend()}
                              disabled={disabled || isSending || !hasSendableContent}
                              className='p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2'
                              aria-label='Send message'
                              data-testid='send-message-button'
                              data-track-category='CHAT_INPUT'
                              data-track-name='SEND_MESSAGE'
                              data-track-metadata={JSON.stringify({
                                ...(conversationId !== null ? { conversationId } : { channelId }),
                                hasAttachments: allAttachments.length > 0,
                              })}
                            >
                              {isSending ? (
                                <Loader2 className='h-4 w-4 animate-spin' />
                              ) : (
                                <ArrowUp className='h-4 w-4' />
                              )}
                            </button>
                          </Tooltip>
                          <div
                            className={`w-px h-4 ${hasSendableContent ? 'bg-background/20' : 'bg-muted-foreground/20'}`}
                          ></div>
                          <DropdownMenu open={isSendMenuOpen} onOpenChange={setIsSendMenuOpen}>
                            <DropdownMenuTrigger asChild>
                              <button
                                type='button'
                                disabled={disabled || isSending}
                                className='p-1.5 hover:bg-black/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2'
                                data-testid='send-options-menu'
                              >
                                <ChevronBigDown className='h-3 w-3' />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side='top' align='end'>
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleSend();
                                  setIsSendMenuOpen(false);
                                }}
                                data-track-category='CHAT_INPUT'
                                data-track-name='SEND_FROM_MENU'
                              >
                                <ArrowUp className='h-4 w-4' /> Send now
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setIsSendMenuOpen(false);
                                  openScheduleDialog();
                                }}
                                data-track-category='CHAT_INPUT'
                                data-track-name='OPEN_SCHEDULE_DIALOG'
                              >
                                <Clock className='h-4 w-4' /> Schedule message
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : (
                        <Tooltip
                          content='Send message'
                          side='top'
                          delayDuration={1000}
                          skipDelayDuration={1000}
                        >
                          <button
                            type='button'
                            onClick={() => void handleSend()}
                            disabled={disabled || sendDisabled || isSending || !hasSendableContent}
                            className={`${compact ? 'flex size-8 items-center justify-center rounded-full p-0' : 'rounded-md p-2'} transition-all duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2 ${
                              hasSendableContent && !disabled && !sendDisabled
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                            }`}
                            aria-label='Send message'
                            data-testid='send-message-button'
                            data-track-category='CHAT_INPUT'
                            data-track-name='SEND_MESSAGE'
                            data-track-metadata={JSON.stringify({
                              ...(conversationId !== null ? { conversationId } : { channelId }),
                              hasAttachments: allAttachments.length > 0,
                            })}
                          >
                            {isSending ? (
                              <Loader2 className='h-4 w-4 animate-spin' />
                            ) : (
                              <ArrowUp className='h-4 w-4' />
                            )}
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Enter-behavior hint - Always reserve space to prevent layout shift */}
        <div className='mt-1 h-4 flex items-baseline justify-end gap-2 px-1 mb-1 absolute -bottom-1 right-0 left-0 translate-y-full'>
          {!isMobile && !disableEnterToSend && hasSendableContent && (
            <button
              type='button'
              onClick={() => setIsPreferencesOpen(true)}
              className='text-[10px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap shrink-0'
              title='Change message send behavior'
              data-track-category='CHAT_INPUT'
              data-track-name='OpenMessagingPreferences'
            >
              <span className='font-semibold'>Shift / ⌘ + Return</span>{' '}
              {enterSendsMessage ? 'to add a new line' : 'to send'}
            </button>
          )}
        </div>

        {/* Canvas Attachment Modal */}
        {isCanvasAttachmentModalOpen && (
          <CanvasAttachmentModal
            isOpen={isCanvasAttachmentModalOpen}
            onClose={() => setIsCanvasAttachmentModalOpen(false)}
            onSelectCanvas={handleCanvasSelect}
            onCreateNewCanvas={handleCreateNewCanvas}
          />
        )}

        {/* Schedule send dialog */}
        {onScheduleSend && (
          <ScheduleMessageDialog
            open={isScheduleDialogOpen}
            onOpenChange={setIsScheduleDialogOpen}
            onConfirm={scheduledFor => {
              const html = editor?.getHTML() ?? '';
              const files = allAttachments
                .map(a => a.file)
                .filter((f): f is File => f instanceof File);
              void onScheduleSend(scheduledFor, html, files);
              editor?.commands.clearContent(true);
            }}
          />
        )}

        {/* Messaging preferences (Enter-to-send behavior) */}
        {isPreferencesOpen && (
          <Preferences
            open
            initialSection='messaging'
            onClose={() => setIsPreferencesOpen(false)}
          />
        )}
      </div>
    );
  },
);

InputBox.displayName = 'InputBox';
