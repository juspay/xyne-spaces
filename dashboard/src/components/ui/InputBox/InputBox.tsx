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
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension, InputRule, textblockTypeInputRule } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import {
  ArrowUp,
  AtSign,
  Plus,
  Loader2,
  X,
  DotIcon,
  ChevronDown,
  Ticket,
  FileText,
  Clock,
} from 'lucide-react';
import { Tooltip, TooltipSide } from '@juspay/blend-design-system';
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
import type { UploadedFile } from '../files/Files.types';
import { FilePreviewModal } from '../../FileViewer/FileViewerModal';
import type { MentionResult } from '../Selectors/Selectors.types';
import { MentionExtension, mentionPluginKey } from '../TipTapExtensions';
import { CommandsExtension, commandPluginKey } from '../TipTapExtensions';
import { EmojiSelectorExtension, emojiSelectorPluginKey } from '../TipTapExtensions';
import { ChannelMentionExtension, channelMentionPluginKey } from '../TipTapExtensions';
import { TableExtensions } from '../TipTapExtensions';
import { ColonEmojiExtension } from '../TipTapExtensions/ColonEmojiExtension';
import { TextEmoticonExtension } from '../TipTapExtensions/TextEmoticonExtension';
import type { InputBoxProps } from './InputBox.types';
import { formatTypingMessage } from './InputBox.utils';
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
import { Dialog } from '../Dialog';
import { CallTranscriptSelector } from '../../Chat/CallTranscriptSelector';
import { EmojiClickData } from 'emoji-picker-react';
import { InlineEmoji } from '../EditorToolbar/InlineEmoji';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';
import { LinkSyncPlugin } from '../TipTapExtensions/LinkSyncPlugin';
import { CanvasAttachmentModal, CanvasLinkPreview } from '../../Canvas';
import type { Canvas } from '../../Canvas';
import { CanvasVisibility } from '@xyne/shared';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { canvasService } from '../../../services/Canvas/canvasService';
import { v4 as uuidv4 } from 'uuid';
import { logger, Event } from '../../../utils/logger';
import { ScheduleMessageDialog } from '../ScheduleMessageDialog/ScheduleMessageDialog';

/** Extract file extension (e.g. ".pdf") from a filename. Returns empty string if none. */
const getFileExtension = (name: string): string => {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : '';
};
import { preloadEmojiData } from '../../../utils/emojiLookup';
import { useAuth } from '../../../hooks/useAuth';
import { useSelf } from '../../../hooks/useUsers';
import { addPendingMessage, removePendingMessage } from '../../../machines/pendingMessageMachine';
import type { PendingAttachment } from '../../../machines/pendingMessageMachine';
import { getFileDimensions } from '../utils/files';
import { untrackUploadingIds } from '../../../utils/attachmentUploadTracker';

const lowlight = createLowlight(common);

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
      onCreateTicket,
      onTranscriptSelect,
      onScheduleSend,
      hasTicket = false,
      disableEnterToSend = false,
      hideSendButton = false,
      sendDisabled = false,
    },

    ref,
  ) => {
    const {
      addDroppedFiles: providerAddDroppedFiles,
      removeDroppedFile: providerRemoveDroppedFile,
      clearDroppedFiles: providerClearDroppedFiles,
      clearDraftMessageOnly: providerClearDraftMessageOnly,
      getDroppedFilesForEntity,
    } = useDraftAttachments();
    const { enterSendsMessage } = useEnterSendsMessage();
    const shareableOrigin = useShareableOrigin();
    const [selectedFile, setSelectedFile] = useState<File | UploadedFile | null>(null);
    const [isViewerOpen, setIsViewerOpen] = useState(false);

    // State for attachments map (async loaded) - supports both File and UploadedFile
    const [attachmentsMap, setAttachmentsMap] = useState<Map<string, File | UploadedFile>>(
      new Map(),
    );

    // Ref to track if we're currently in the send process
    const isSendingRef = useRef(false);
    // Ref to skip onContentChange when clearing editor as part of send
    const skipNextContentChangeRef = useRef(false);

    // Load attachments from provider when channelId or conversationId changes
    React.useEffect(() => {
      const loadAttachments = () => {
        if (!channelId) {
          setAttachmentsMap(new Map());
          return;
        }

        // This prevents completed attachments from reappearing briefly
        if (isSendingRef.current) {
          return;
        }

        try {
          const map = getDroppedFilesForEntity(channelId, conversationId ?? null);
          setAttachmentsMap(map);
        } catch (error) {
          console.error('Failed to load attachments:', error);
          logger.error(Event.DRAFT_ATTACHMENTS_LOAD_FAILED, {
            error: error instanceof Error ? error.message : String(error),
            channelId,
            conversationId,
          });
        }
      };

      void loadAttachments();
    }, [channelId, conversationId, getDroppedFilesForEntity]);

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
    const [isSending, setIsSending] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [sendMode, setSendMode] = useState<'message' | 'ticket'>('message');
    const [isSendMenuOpen, setIsSendMenuOpen] = useState(false);
    const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
    const openScheduleDialog = useCallback((): void => setIsScheduleDialogOpen(true), []);
    const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
    const [isTranscriptSelectorOpen, setIsTranscriptSelectorOpen] = useState(false);
    const [emojiSizeClass, setEmojiSizeClass] = useState('text-sm');
    const [showMobileFormattingToolbar, setShowMobileFormattingToolbar] = useState(false);

    const [ticketCreated, setTicketCreated] = useState(false);

    // Canvas attachment state
    const [attachedCanvas, setAttachedCanvas] = useState<Canvas | null>(null);
    const [isCanvasAttachmentModalOpen, setIsCanvasAttachmentModalOpen] = useState(false);

    const { isMobile } = usePlatform();
    const { user } = useAuth();
    const selfUser = useSelf();

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

    const handleTyping = onTyping;

    // Ref to track pending upload promises
    const pendingUploadsRef = useRef<
      Map<
        string,
        Promise<{
          successful: Array<{ attachmentId: string; file: File }>;
          failed: Array<{ attachmentId: string; file: File; fileName: string; error: string }>;
          allSucceeded: boolean;
        }>
      >
    >(new Map());

    // Helper function to upload a single file as draft attachment
    const addDraftAttachments = useCallback(
      async (files: File[]) => {
        if (!channelId) {
          toast.error('Channel ID is required for file attachments');
          return;
        }

        // Store the promise so handleSend can await it
        // We use a unique key for this batch
        const batchId = `${Date.now()}-${Math.random()}`;
        let uploadPromise: Promise<{
          successful: Array<{ attachmentId: string; file: File }>;
          failed: Array<{ attachmentId: string; file: File; fileName: string; error: string }>;
          allSucceeded: boolean;
        }> | null = null;

        try {
          uploadPromise = providerAddDroppedFiles(files, channelId, conversationId);
          pendingUploadsRef.current.set(batchId, uploadPromise);

          const result = await uploadPromise;

          // Show toast for partial failures
          if (!result.allSucceeded && result.failed.length > 0) {
            const failedNames = result.failed.map(f => f.fileName).join(', ');
            toast.error(`Failed to upload: ${failedNames}`, {
              description: 'Some files could not be uploaded. Please try again.',
            });
          }

          return result;
        } catch (error) {
          console.error('Failed to upload file:', error);
          logger.error(Event.ATTACHMENT_UPLOAD_FAILED, {
            error: error instanceof Error ? error.message : String(error),
            channelId,
            conversationId,
          });
          toast.error('Failed to upload file', {
            description: error instanceof Error ? error.message : 'Unknown error',
          });
          throw error;
        } finally {
          // This prevents stale failed promises from blocking future sends
          pendingUploadsRef.current.delete(batchId);
        }
      },
      [providerAddDroppedFiles, channelId, conversationId],
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
          code: {
            HTMLAttributes: {
              class: 'bg-muted rounded px-1 py-0.5 text-foreground font-mono text-[0.85em]',
            },
          },
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
          HTMLAttributes: {
            class: 'bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto relative',
            style: 'padding: 0.75rem;',
          },
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
        }),
        ChannelMentionExtension,
        CommandsExtension,
        EmojiSelectorExtension,
        ...TableExtensions,
      ],
      content: value || '',
      editable: !isSending,
      onCreate: ({ editor }) => {
        setContent(editor.getText().trim());
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
        setContent(editor.getText().trim());
        setIsInCodeBlock(editor.isActive('codeBlock'));
        handleTyping?.();
        notifyTyping(); // Notify the typing state context

        // Skip notifying parent when we're clearing as part of send
        // to prevent race conditions with form state
        if (!skipNextContentChangeRef.current) {
          const htmlContent = sanitizeHtmlContent(editor.getHTML());
          onContentChange?.(htmlContent, editor.getText());
        }

        updateEmojiSizeClass(editor);
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

          // Shift+Enter: new line (default) OR send message (when enterSendsMessage is false)
          if (event.key === 'Enter' && event.shiftKey) {
            if (!enterSendsMessage && !isMobile && !disableEnterToSend) {
              const mentionState = mentionPluginKey.getState(view.state);
              const channelMentionState = channelMentionPluginKey.getState(view.state);
              const commandState = commandPluginKey.getState(view.state);
              const emojiSelectorState = emojiSelectorPluginKey.getState(view.state);
              if (
                (mentionState?.isOpen && mentionState.items.length > 0) ||
                (channelMentionState?.isOpen && channelMentionState.items.length > 0) ||
                (commandState?.isOpen && commandState.items.length > 0) ||
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

          if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
            return true;
          }

          // Enter key WITHOUT Shift: Send message or new line depending on preference
          if (event.key === 'Enter' && !event.shiftKey) {
            const mentionState = mentionPluginKey.getState(view.state);
            const channelMentionState = channelMentionPluginKey.getState(view.state);
            const commandState = commandPluginKey.getState(view.state);
            const emojiSelectorState = emojiSelectorPluginKey.getState(view.state);

            // If any menu is open, let it handle the Enter key
            if (
              (mentionState?.isOpen && mentionState.items.length > 0) ||
              (channelMentionState?.isOpen && channelMentionState.items.length > 0) ||
              (commandState?.isOpen && commandState.items.length > 0) ||
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
            void handleSend();
            return true;
          }

          return false;
        },
        handlePaste: (view, event) => {
          const clipboard = event.clipboardData;

          /** Handle File Pasting */
          const files = clipboard?.files ?? [];
          if (files.length > 0) {
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
            dispatch(state.tr.replaceSelectionWith(tableNode));
            view.dom.scrollTop = prevScrollTop;
          };

          const htmlContent = clipboard?.getData('text/html');
          if (htmlContent && htmlContent.includes('<table')) {
            event.preventDefault();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            const firstTable = doc.querySelector('table');
            if (firstTable) {
              const hasHeader =
                !!firstTable.querySelector('thead') || !!firstTable.querySelector('th');
              const rows = Array.from(firstTable.querySelectorAll('tr'))
                .map(tr =>
                  Array.from(tr.querySelectorAll('td, th')).map(
                    cell => cell.textContent?.trim() ?? '',
                  ),
                )
                .filter(row => row.length > 0);

              if (rows.length === 0 || rows[0]?.length === 0) return false;

              if (rows.reduce((sum, row) => sum + row.length, 0) > 500) {
                toast.error('Table content is too large', {
                  description: 'Please paste a smaller table or copy the data as text.',
                });
                return true;
              }
              insertTableAtCursor(rows, hasHeader);
              return true;
            }
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

          if (pastedText && pastedText.length > 11500) {
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
            editor?.commands.setContent('');
            setContent('');
            return true;
          }
          return false;
        },
      },
    });

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
        },
        clearTextOnly: (): void => {
          editor?.commands.setContent('');
          setContent('');
        },
        insertContent: (content: string): void => {
          editor?.commands.insertContent(content);
          editor?.commands.focus();
        },
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
      [editor, addFilesWithLimit, providerClearDroppedFiles, channelId, conversationId],
    );

    const handleSend = useCallback(async () => {
      if (!editor || isSending || sendDisabled) return;

      // Capture the editor instance at the start to use same
      // instance throughout the async operation, even if channel changes
      const activeEditor = editor;

      const plainText = activeEditor.getText().trim();
      const htmlContent = activeEditor.getHTML();

      if (!hasSendableContent) return;

      setIsSending(true);
      isSendingRef.current = true;

      const snapshotAttachments = [...allAttachments];

      // Pass attachmentIds so mutators don't need to query draft
      const attachmentIds = snapshotAttachments.map(a => a.attachmentId);

      const fileAttachments = snapshotAttachments.filter(({ file }) => file instanceof File);

      // Untrack all attachment IDs immediately when sending
      // to ensure InitialStateLoader userDraft query doesn't make
      // Pending attachments show up in InputBox after we've already pressed send
      const attachmentIdsToUntrack = fileAttachments.map(a => a.attachmentId);
      untrackUploadingIds(attachmentIdsToUntrack);

      // Snapshot the final message content (including any canvas link) BEFORE
      // clearing the editor to display it in the optimistic bubble.
      let snapshotHtml = htmlContent;
      let snapshotPlainText = plainText;
      if (attachedCanvas) {
        const canvasLink = `${window.location.origin}/chat/canvas/${attachedCanvas.viewAccessId || attachedCanvas.id}`;
        snapshotHtml = `${htmlContent} ${canvasLink}`;
        snapshotPlainText = `${plainText} ${canvasLink}`;
      }

      // Clear the editor immediately so user can compose new messages
      skipNextContentChangeRef.current = true;
      editor.commands.setContent('');
      setContent('');
      setAttachedCanvas(null);
      setAttachmentsMap(new Map());
      // Reset the flag after the update cycle
      requestAnimationFrame(() => {
        skipNextContentChangeRef.current = false;
      });

      // Clear only the draft message (not attachments) so new drafts don't get polluted.
      // The attachments are kept in Zero so the mutator can transfer them to the sent message.
      if (channelId) {
        await providerClearDraftMessageOnly(channelId, conversationId ?? null);
      }

      // Release the composer lock immediately after clearing the draft
      // so users can start composing their next message while uploads happen in background
      setIsSending(false);

      // Only show a pending bubble when there are file uploads AND we have a channelId
      // to scope the optimistic entry. Text-only sends via Zero are effectively instant
      // so they don't need an intermediate pending state.
      const hasUploadsToWait = fileAttachments.length > 0 && !!channelId;

      // Get pending upload promises for awaiting in the upload path
      const pendingUploadPromises = Array.from(pendingUploadsRef.current.values());

      let pendingMsgId: string | null = null;

      if (hasUploadsToWait) {
        pendingMsgId = uuidv4();

        const filesWithDimensions = await Promise.all(
          snapshotAttachments.map(async ({ attachmentId, file }) => {
            const dimensions = file instanceof File ? await getFileDimensions(file) : null;
            return { attachmentId, file, dimensions };
          }),
        );

        const pendingAttachments: PendingAttachment[] = filesWithDimensions.map(
          ({ attachmentId, file, dimensions }) => {
            // Create object URL for images AND videos so thumbnails are visible
            const objectUrl =
              file instanceof File &&
              (file.type.startsWith('image/') || file.type.startsWith('video/'))
                ? URL.createObjectURL(file)
                : undefined;
            const size = file instanceof File ? file.size : file.fileSize;
            return {
              id: attachmentId,
              name: file instanceof File ? file.name : file.originalName,
              mimeType: file instanceof File ? file.type : file.mimeType,
              ...(objectUrl !== undefined ? { objectUrl } : {}),
              ...(size !== undefined ? { size } : {}),
              ...(dimensions?.width !== undefined ? { width: dimensions.width } : {}),
              ...(dimensions?.height !== undefined ? { height: dimensions.height } : {}),
            };
          },
        );
        // Use selfUser (from state machine) for name as it has full user data, fall back to auth user
        const senderName =
          selfUser?.name?.trim() || selfUser?.email || user?.name?.trim() || user?.email || 'You';

        addPendingMessage({
          id: pendingMsgId,
          channelId,
          conversationId: conversationId ?? null,
          html: snapshotHtml,
          createdAt: Date.now(),
          senderId: selfUser?.id || user?.id || '',
          senderName,
          attachments: pendingAttachments,
        });

        try {
          // Wait for all pending uploads to complete
          const uploadResults = await Promise.all(pendingUploadPromises);

          // Check if all uploads succeeded
          const allSucceeded = uploadResults.every(result => result.allSucceeded);

          if (!allSucceeded) {
            toast.error('Failed to upload some files');
            // Remove the pending message since we couldn't send
            removePendingMessage(pendingMsgId);
            setIsSending(false);
            isSendingRef.current = false;
            return;
          }

          const filesToSend = snapshotAttachments
            .map(a => a.file)
            .filter((f): f is File => f instanceof File);

          await onSendMessage(
            snapshotPlainText,
            snapshotHtml,
            filesToSend,
            undefined,
            attachmentIds,
          );
          // Only focus if editor hasn't been destroyed (e.g., due to channel switch)
          if (!activeEditor.isDestroyed) {
            activeEditor.commands.focus();
          }
        } catch (error) {
          toast.error('Failed to send message with attachments', {
            description: error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          // Always remove the optimistic bubble, whether the send succeeded or failed.
          removePendingMessage(pendingMsgId);
          setIsSending(false);
          isSendingRef.current = false;
        }
        return;
      }

      // ----------------------------------------------------------------------------------
      // Normal path: when there are no uploads to wait for or when statuses are COMPLETED.
      // Behaviour is identical to the original implementation.
      // ----------------------------------------------------------------------------------
      else {
        try {
          const filesToSend = fileAttachments
            .map(a => a.file)
            .filter((f): f is File => f instanceof File);

          let finalHtmlContent = snapshotHtml;
          let finalPlainText = snapshotPlainText;

          if (attachedCanvas) {
            const canvasLink = `${shareableOrigin}/chat/canvas/${attachedCanvas.viewAccessId || attachedCanvas.id}`;
            finalHtmlContent = `${snapshotHtml} ${canvasLink}`;
            finalPlainText = `${snapshotPlainText} ${canvasLink}`;
          }

          await onSendMessage(
            finalPlainText,
            finalHtmlContent,
            filesToSend,
            undefined,
            attachmentIds,
          );
          // Only focus if editor hasn't been destroyed (e.g., due to channel switch)
          if (!activeEditor.isDestroyed) {
            activeEditor.commands.focus();
          }
        } catch (error) {
          toast.error('Failed to send message', {
            description: error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          setIsSending(false);
          isSendingRef.current = false;
        }
        return;
      }
    }, [
      editor,
      allAttachments,
      onSendMessage,
      isSending,
      attachedCanvas,
      hasSendableContent,
      sendDisabled,
      channelId,
      conversationId,
      user,
      providerClearDroppedFiles,
      shareableOrigin,
      selfUser,
    ]);

    // Canvas attachment handlers
    const handleCanvasSelect = useCallback((canvas: Canvas) => {
      setAttachedCanvas(canvas);
      setIsCanvasAttachmentModalOpen(false);
    }, []);

    const handleCreateNewCanvas = useCallback(async () => {
      // Create canvas immediately, attach to composer, then open canvas editor
      const newCanvasId = uuidv4();
      const viewAccessId = uuidv4();
      const now = Date.now();

      try {
        // Create the canvas via API
        await canvasService.createCollaborativeCanvas({
          id: newCanvasId,
          title: 'Untitled Canvas',
          viewAccessId,
          ...(channelId ? { channelId } : {}),
        });

        // Create canvas object and attach to composer
        const newCanvas: Canvas = {
          id: newCanvasId,
          title: 'Untitled Canvas',
          viewAccessId,
          createdBy: '',
          visibility: CanvasVisibility.PRIVATE,
          isTemplate: false,
          createdAt: now,
          updatedAt: now,
        };
        setAttachedCanvas(newCanvas);
        setIsCanvasAttachmentModalOpen(false);

        // Open canvas editor in new tab for editing
        const canvasUrl = `/chat/canvas/${newCanvasId}`;
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
    }, [channelId]);

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
        await providerRemoveDroppedFile(attachmentId);
        // Update local state immediately for responsiveness
        setAttachmentsMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(attachmentId);
          return newMap;
        });
      },
      [providerRemoveDroppedFile],
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

        <div
          className={`
            overflow-hidden transition-all flex flex-col relative
            ${isMobile ? 'bg-muted rounded-[26px] text-foreground shadow-sm' : 'bg-card rounded-2xl border text-foreground shadow-none'}
            ${!isMobile && isFocused ? 'border-ring' : !isMobile ? 'border-input' : ''}
            ${isSending ? 'opacity-60 pointer-events-none' : ''}
          `}
        >
          {/* Desktop: Editor Toolbar */}
          {features.richText && !isMobile && <EditorToolbar editor={editor} />}

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
                relative py-2 px-3
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
              {!content &&
                !isInCodeBlock &&
                !editor?.isActive('bulletList') &&
                !editor?.isActive('orderedList') &&
                !editor?.isActive('blockquote') && (
                  <div className='absolute inset-0 px-3 py-2 text-muted-foreground text-[14px] leading-6 pointer-events-none select-none flex items-center h-fit my-auto'>
                    {placeholder}
                  </div>
                )}
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

          {/* Show checkbox for "also send to channel" functionality */}
          {onAlsoSendToChannelChange && (
            <div className='flex items-center space-x-1.5 px-3 py-1'>
              <input
                type='checkbox'
                id='also-send-to-channel'
                checked={alsoSendToChannelChecked}
                onChange={e => {
                  onAlsoSendToChannelChange(e.target.checked);
                }}
                className='h-3 w-3 text-primary focus:ring-ring border-input rounded'
                disabled={disabled || isSending}
              />
              <label
                htmlFor='also-send-to-channel'
                className='text-xs text-muted-foreground cursor-pointer'
              >
                Also send to channel
              </label>
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
            <div className='flex items-center justify-between p-2'>
              <div className='flex items-center gap-1'>
                {features.fileAttachments && (
                  <DropdownMenu open={isPlusMenuOpen} onOpenChange={setIsPlusMenuOpen}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        className='p-1.5 bg-muted hover:bg-accent transition-all duration-200 ease-in-out rounded-full'
                        aria-label='Add content'
                        disabled={disabled || isSending}
                      >
                        <Plus className='h-4 w-4 text-muted-foreground' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side='top' align='start'>
                      <DropdownMenuItem
                        onClick={() => {
                          handleAttachClick();
                          setIsPlusMenuOpen(false);
                        }}
                      >
                        <Plus className='h-4 w-4' /> Upload Files
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setIsTranscriptSelectorOpen(true);
                          setIsPlusMenuOpen(false);
                        }}
                      >
                        <FileText className='h-4 w-4' /> Add Call Summary
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setIsCanvasAttachmentModalOpen(true);
                          setIsPlusMenuOpen(false);
                        }}
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

                <div className='h-3 w-px bg-border mx-1' aria-hidden='true' />

                {features.emojiPicker && (
                  // Inside InputBox.tsx -> EmojiPickerButton component
                  <EmojiPickerButton
                    onEmojiSelect={handleEmojiSelect}
                    disabled={disabled || isSending}
                  />
                )}

                {features.mentions && (
                  <Tooltip content='Mention user (@)' side={TooltipSide.TOP}>
                    <button
                      type='button'
                      onClick={() => {
                        editor?.chain().focus().insertContent('@').run();
                      }}
                      className='p-1.5 rounded hover:bg-accent transition-all duration-200 ease-in-out'
                      aria-label='Mention user'
                      data-testid='mention-user-btn'
                      disabled={disabled || isSending}
                    >
                      <AtSign className='h-4 w-4 text-muted-foreground' />
                    </button>
                  </Tooltip>
                )}

                <Tooltip content='Mention channel (#)' side={TooltipSide.TOP}>
                  <button
                    type='button'
                    onClick={() => {
                      editor?.chain().focus().insertContent('#').run();
                    }}
                    className='p-1.5 rounded hover:bg-accent transition-all duration-200 ease-in-out'
                    aria-label='Mention channel'
                    disabled={disabled || isSending}
                  >
                    <span className='text-muted-foreground font-semibold text-sm'>#</span>
                  </button>
                </Tooltip>
              </div>

              <div className='flex gap-2'>
                {onCancel && (
                  <Tooltip content='Cancel editing' side={TooltipSide.TOP}>
                    <button
                      type='button'
                      onClick={onCancel}
                      className='p-2 rounded-md bg-muted text-foreground hover:bg-border transition-all duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2'
                      aria-label='Cancel editing'
                    >
                      <X className='h-4 w-4' />
                    </button>
                  </Tooltip>
                )}

                {!hideSendButton && (
                  <div className='relative flex items-center'>
                    {onCreateTicket ? (
                      <div
                        className={`flex items-center rounded-md overflow-hidden transition-all duration-200 ease-in-out ${
                          (hasSendableContent || sendMode === 'ticket') && !sendDisabled
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                        }`}
                      >
                        <Tooltip
                          content={sendMode === 'message' ? 'Send message' : 'Create ticket'}
                          side={TooltipSide.TOP}
                        >
                          <button
                            type='button'
                            onClick={() => {
                              if (sendMode === 'message') {
                                void handleSend();
                              } else {
                                // Pass current editor content as description for the ticket
                                const currentContent = editor?.getText().trim() || '';
                                setSendMode('message');
                                onCreateTicket(currentContent);
                              }
                            }}
                            disabled={
                              disabled ||
                              sendDisabled ||
                              isSending ||
                              (sendMode === 'message' && !hasSendableContent)
                            }
                            className='p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2'
                            aria-label={sendMode === 'message' ? 'Send message' : 'Create ticket'}
                            data-testid='send-message-button'
                            data-track-category='CHAT_INPUT'
                            data-track-name={
                              sendMode === 'message' ? 'SEND_MESSAGE' : 'CREATE_TICKET_FROM_MESSAGE'
                            }
                            data-track-metadata={JSON.stringify({
                              ...(conversationId !== null ? { conversationId } : { channelId }),
                              message: editor?.getText().trim() || '',
                              hasAttachments: allAttachments.length > 0,
                            })}
                          >
                            {isSending ? (
                              <Loader2 className='h-4 w-4 animate-spin' />
                            ) : sendMode === 'message' ? (
                              <ArrowUp className='h-4 w-4' />
                            ) : (
                              <div className='flex items-center gap-2 px-1'>
                                <span className='text-xs font-medium whitespace-nowrap'>
                                  Create Ticket
                                </span>
                              </div>
                            )}
                          </button>
                        </Tooltip>
                        <div
                          className={`w-px h-4 ${
                            hasSendableContent || sendMode === 'ticket'
                              ? 'bg-background/20'
                              : 'bg-muted-foreground/20'
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
                              <ChevronDown className='h-3 w-3' />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side='top' align='end'>
                            {sendMode === 'message' && !(hasTicket || ticketCreated) && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setSendMode('ticket');
                                  setIsSendMenuOpen(false);
                                }}
                              >
                                <Ticket className='h-4 w-4' /> Create a ticket
                              </DropdownMenuItem>
                            )}
                            {sendMode === 'ticket' && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setSendMode('message');
                                  setIsSendMenuOpen(false);
                                }}
                              >
                                <ArrowUp className='h-4 w-4' /> Send as message
                              </DropdownMenuItem>
                            )}
                            {onScheduleSend && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setIsSendMenuOpen(false);
                                  openScheduleDialog();
                                }}
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
                            ? 'bg-primary text-white hover:bg-primary/90'
                            : 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                        }`}
                      >
                        <Tooltip content='Send message' side={TooltipSide.TOP}>
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
                              <ChevronDown className='h-3 w-3' />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side='top' align='end'>
                            <DropdownMenuItem
                              onClick={() => {
                                void handleSend();
                                setIsSendMenuOpen(false);
                              }}
                            >
                              <ArrowUp className='h-4 w-4' /> Send now
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setIsSendMenuOpen(false);
                                openScheduleDialog();
                              }}
                            >
                              <Clock className='h-4 w-4' /> Schedule message
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : (
                      <Tooltip content='Send message' side={TooltipSide.TOP}>
                        <button
                          type='button'
                          onClick={() => void handleSend()}
                          disabled={disabled || sendDisabled || isSending || !hasSendableContent}
                          className={`p-2 rounded-md transition-all duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4F4F] focus-visible:outline-offset-2 ${
                            hasSendableContent && !disabled && !sendDisabled
                              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                              : 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                          }`}
                          aria-label='Send message'
                          data-testid='send-message-button'
                          data-track-category='CHAT_INPUT'
                          data-track-name={
                            sendMode === 'message' ? 'SEND_MESSAGE' : 'CREATE_TICKET_FROM_MESSAGE'
                          }
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

        {/* Typing Indicator - Always reserve space to prevent layout shift */}
        <div className='mt-1 h-4 flex items-baseline justify-start px-1 mb-1 absolute -bottom-1 right-0 left-0 translate-y-full'>
          {showTypingIndicator && typingUsers.length > 0 && (
            <small className='text-[10px] text-muted-foreground flex items-baseline'>
              {formatTypingMessage(typingUsers)}
              <span className='flex items-center ml-1'>
                <span className='animate-[loading-dots_1.4s_infinite_0.2s]'>
                  <DotIcon className='size-2 text-muted-foreground' />
                </span>
                <span className='animate-[loading-dots_1.4s_infinite_0.4s]'>
                  <DotIcon className='size-2 text-muted-foreground' />
                </span>
                <span className='animate-[loading-dots_1.4s_infinite_0.6s]'>
                  <DotIcon className='size-2 text-muted-foreground' />
                </span>
              </span>
            </small>
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
      </div>
    );
  },
);

InputBox.displayName = 'InputBox';
