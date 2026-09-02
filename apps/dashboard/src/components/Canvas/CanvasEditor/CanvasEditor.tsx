import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import type { FocusEvent } from 'react';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  FormattingToolbarController,
  FilePanelController,
  LinkToolbarController,
  getDefaultReactSlashMenuItems,
  DefaultReactSuggestionItem,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { getDiagramSlashMenuItems } from '@blocknote/diagram-block';
import { getMathSlashMenuItems } from '@blocknote/math-block';
import {
  InlineContentSchema,
  PartialBlock,
  type BlockSchema,
  type StyleSchema,
  type CustomBlockNoteSchema,
} from '@blocknote/core';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { en } from '@blocknote/core/locales';
import { PresentationModal, usePresentation } from 'blocknote-layout-extensions';
import { getWhiteboardSlashMenuItems } from 'blocknote-layout-extensions';
import { getMentionSuggestionMenuItems, insertGroupMention } from 'blocknote-layout-extensions';
import { asBlockNoteEditorForView } from 'blocknote-layout-extensions';
import { buildMentionProps, CanvasMentionContext } from '../CanvasMentionSpec';
import { useCanvasBlockShortcuts, withBlockShortcutBadges } from '../canvasBlockShortcuts';
import { withHeadingsTogether } from '../canvasSlashMenu';
import { CanvasLinkToolbar, CanvasPastedLinkToolbar } from '../CanvasLinkToolbar';
import { CanvasFilePanel } from '../CanvasFilePanel/CanvasFilePanel';
import {
  canvasSchema,
  canvasTableOptions,
  canvasTiptapOptions,
  knownCanvasBlockTypes,
} from '../canvasSchema';
import { createElement } from 'react';
import { RiGroupLine } from 'react-icons/ri';
import Avatar from '../../ui/Avatar/Avatar';
import { CanvasEditorProps, CanvasEditorRef } from '../Canvas.types';
import {
  resolveFileUrl,
  extractHeadingsFromBlocks,
  scrollToHeading,
  removeUnknownBlocks,
} from '../../../utils/canvasUtils';
import {
  exportCanvasAsMarkdown,
  exportCanvasAsPDF,
  type CanvasExportEditor,
} from '../../../utils/canvasExport';
import { toast } from 'sonner';
import { TableOfContents, TocHeading } from '../TableOfContents';
import { CanvasSearch } from '../CanvasSearch/CanvasSearch';
import { CanvasCodeCopyButton } from '../CanvasCodeCopyButton';
import { useCanvasTableFilters } from '../useCanvasTableFilters';
import { useScope, useShortcutById } from '../../../shortcuts';
import { useAuth } from '../../../hooks/useAuth';
import { useUsers, useSelf, searchUsers } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useTheme } from '../../../hooks/useTheme';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '@xyne/shared/hooks';
import { queries } from '@xyne/shared/zero/queries';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { logger, Event } from '../../../utils/logger';
import { useSelector } from '@xstate/react';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { useCanvasEditorMentionSharing } from '@/hooks/useCanvasEditorMentionSharing';
import { CanvasCommentsPanel } from '../CanvasCommentsPanel/CanvasCommentsPanel';
import { AnimatePresence } from 'framer-motion';

import { CanvasInlineCommentThread } from '../CanvasInlineCommentThread/CanvasInlineCommentThread';
import { createCanvasFormattingToolbar } from '../CanvasFormattingToolbar/CanvasFormattingToolbar';
import { useCanvasCommentEditorBridge } from '../useCanvasCommentEditorBridge';
import { useCanvasTicketEditorBridge } from '../useCanvasTicketEditorBridge';
import { CanvasTicketCreationFlow } from '../CanvasTicketCreationFlow/CanvasTicketCreationFlow';

const canvasDictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Write something, or press '/' for commands",
    emptyDocument: "Write something, or press '/' for commands",
  },
};

// Content size limit in bytes
const CONTENT_SIZE_MAX_THRESHOLD = 100 * 1024; // 100KB - block save

// Helper to calculate content size in bytes
const getContentSizeBytes = (blocks: PartialBlock[]): number => {
  try {
    return new Blob([JSON.stringify(blocks)]).size;
  } catch {
    // Fallback to approximate size
    return JSON.stringify(blocks).length * 2; // UTF-16 approximate
  }
};

// Format bytes to human readable
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// Helper to deep clone blocks to prevent mutation of the original editor state.
const deepCloneBlocks = (blocks: PartialBlock[]): PartialBlock[] => {
  return JSON.parse(JSON.stringify(blocks)) as PartialBlock[];
};

export const CanvasEditor = forwardRef<CanvasEditorRef, CanvasEditorProps>(
  (
    {
      content,
      onChange,
      onSave,
      onFileUpload,
      editable = true,
      placeholder: _placeholder = 'Start writing your canvas...',
      className = '',
      channelId,
      canvasId,
      canvasTitle: _canvasTitle,
      onMentionInsert,
      initialBlockIdToFocus,
      initialCommentThreadId,
      onOpenCommentCountChange,
      autoFocus,
      canvasParticipants: preloadedParticipants,
      canvasCreatedBy,
      currentUserRole,
    },
    ref,
  ) => {
    const users = useUsers();
    const allUserGroups = useUserGroups();
    const { user: authUser } = useAuth();
    const selfUser = useSelf();
    const currentUser = selfUser || authUser;
    const { theme } = useTheme();
    const isXyneAIOpen = useSelector(xyneAIActor, state => state.matches('open'));
    const z = useZero();
    const [queriedParticipants = []] = useCachedQuery(
      queries.canvasParticipants({ canvasId: canvasId || '' }),
      {
        enabled: Boolean(canvasId) && !preloadedParticipants,
      },
    );
    const canvasParticipants = preloadedParticipants ?? queriedParticipants;

    // Create BlockNote editor instance with custom schema (cast so extended schema is accepted)
    const editor = useCreateBlockNote({
      schema: canvasSchema as unknown as CustomBlockNoteSchema<
        BlockSchema,
        InlineContentSchema,
        StyleSchema
      >,
      ...(content && content.length > 0
        ? {
            initialContent: removeUnknownBlocks(content, knownCanvasBlockTypes),
          }
        : {}),
      ...(onFileUpload ? { uploadFile: onFileUpload } : {}),
      resolveFileUrl,
      dictionary: canvasDictionary,
      tables: canvasTableOptions,
      _tiptapOptions: canvasTiptapOptions,
    });

    // Auto-focus the editor on mount if requested (fire only once, cursor at end)
    // BlockNoteView's autoFocus prop is disabled — this effect is the single source of truth.
    const hasAutoFocusedRef = useRef(false);
    const setCursorToEnd = useCallback((): boolean => {
      if (!editor || hasAutoFocusedRef.current || isXyneAIOpen) return true;
      try {
        const editorTyped = asBlockNoteEditorForView(editor);
        const blocks = editorTyped.document;
        if (!blocks || blocks.length === 0) return false;
        const lastBlock = blocks.at(-1);
        if (!lastBlock) return false;
        editorTyped.focus();
        editorTyped.setTextCursorPosition(lastBlock.id, 'end');
        hasAutoFocusedRef.current = true;
        return true;
      } catch {
        return false;
      }
    }, [editor, isXyneAIOpen]);

    useEffect(() => {
      if (!autoFocus || !editor || hasAutoFocusedRef.current || isXyneAIOpen) return;
      // Retry until content is actually present
      const interval = setInterval(() => {
        if (setCursorToEnd()) {
          clearInterval(interval);
        }
      }, 50);
      return () => clearInterval(interval);
    }, [autoFocus, editor, isXyneAIOpen, setCursorToEnd]);

    // Presentation state and handlers
    const {
      selectedTheme,
      showPresentation,
      generatedSlides,
      handleThemeChange,
      handlePresent,
      closePresentation,
    } = usePresentation({ editor });

    // Get custom slash menu items (whiteboard and genius)
    const customSlashItems = useMemo(() => {
      if (!editor) return [];
      const editorTyped = asBlockNoteEditorForView(editor);
      const whiteboardItems = getWhiteboardSlashMenuItems(editorTyped);
      const mathItems = getMathSlashMenuItems(editorTyped);
      const diagramItems = getDiagramSlashMenuItems(editorTyped);
      return [...whiteboardItems, ...mathItems, ...diagramItems];
    }, [editor]);

    // Every slash item, each already showing the key that reaches it.
    const allSlashItems = useMemo(() => {
      if (!editor) return [];
      const defaultItems = getDefaultReactSlashMenuItems(asBlockNoteEditorForView(editor));
      return withBlockShortcutBadges(withHeadingsTogether([...defaultItems, ...customSlashItems]));
    }, [editor, customSlashItems]);

    const getSlashMenuItems = useCallback(
      (query: string): Promise<DefaultReactSuggestionItem[]> =>
        Promise.resolve(filterSuggestionItems(allSlashItems, query)),
      [allSlashItems],
    );

    useCanvasBlockShortcuts(editor, allSlashItems);

    // Get mention suggestion menu items for '@' trigger – same list as DM/channel: users + user groups
    // Event-based: on mention selection, insert + notify (blockId for activity redirect)
    const getMentionItems = useMemo(() => {
      if (!editor) return (): Promise<DefaultReactSuggestionItem[]> => Promise.resolve([]);
      return async (query: string): Promise<DefaultReactSuggestionItem[]> => {
        const editorTyped = asBlockNoteEditorForView(editor);
        const userItems: DefaultReactSuggestionItem[] = await getMentionSuggestionMenuItems(
          editorTyped,
          query,
          {
            onUserSearch: (q: string) => {
              const results = searchUsers(users, q, 10);
              return Promise.resolve(
                results.map(u => {
                  const displayName = getUserDisplayName(u);
                  return {
                    id: u.id,
                    username: displayName,
                    email: u.email ?? '',
                    ...(u.picture !== undefined && u.picture !== null && { picture: u.picture }),
                  };
                }),
              );
            },
            ...(currentUser?.id !== undefined && { currentUserId: currentUser.id }),
          },
        );
        // The library hardcodes a generic person glyph; swap in the user's avatar.
        // Items only carry the email, so resolve the id from it.
        const idByEmail = new Map<string, string>();
        for (const u of users) {
          if (u.email) idByEmail.set(u.email, u.id);
        }
        for (const item of userItems) {
          const userId = item.subtext ? idByEmail.get(item.subtext) : undefined;
          if (userId) {
            item.icon = createElement(Avatar, {
              userId,
              size: 'sm',
              rounded: true,
              showActiveStatus: false,
            });
          }
        }
        // User groups - include deactivated with indicator
        const queryLower = query.toLowerCase().trim();
        const filteredGroups = (
          !queryLower
            ? [...allUserGroups].sort((a, b) => a.name.localeCompare(b.name))
            : allUserGroups
                .filter(
                  g =>
                    g.name.toLowerCase().includes(queryLower) ||
                    (g.alias && g.alias.toLowerCase().includes(queryLower)),
                )
                .sort((a, b) => a.name.localeCompare(b.name))
        ).slice(0, 10);
        const groupItems: DefaultReactSuggestionItem[] = filteredGroups.map(g => ({
          title: g.isActive === false ? `${g.name} (Deactivated)` : g.name,
          subtext: g.alias ?? '',
          group: 'Groups',
          icon: createElement(RiGroupLine, {
            size: 18,
            className: g.isActive === false ? 'text-muted-foreground' : undefined,
          }),
          onItemClick: () => {
            const blockId = editorTyped.getTextCursorPosition().block?.id;
            insertGroupMention(editorTyped, { id: g.id, name: g.name, alias: g.alias });
            if (blockId && onMentionInsert) {
              onMentionInsert({ type: 'group', id: g.id, blockId });
            }
          },
        }));
        // For user items we need userId in the item - getMentionSuggestionMenuItems doesn't add it
        // Build user items ourselves so we have the id for onMentionInsert
        if (canvasId && onMentionInsert) {
          const userSearchResults = searchUsers(users, query, 10);
          const customUserItems: DefaultReactSuggestionItem[] = userSearchResults.map(u => {
            const displayName = getUserDisplayName(u);
            const user = {
              id: u.id,
              username: displayName,
              email: u.email ?? '',
              picture: u.picture,
            };
            return {
              title: displayName,
              subtext: u.email ?? '',
              group: 'Users',
              icon: createElement(Avatar, {
                userId: u.id,
                size: 'sm',
                rounded: true,
                showActiveStatus: false,
              }),
              onItemClick: () => {
                logger.info(Event.CANVAS_MENTION_DEBUG, {
                  message: 'CanvasEditor user mention onItemClick',
                  canvasId,
                  hasOnMentionInsert: !!onMentionInsert,
                });
                const blockId = editorTyped.getTextCursorPosition().block?.id;
                editorTyped.insertInlineContent([
                  {
                    type: 'mention' as const,
                    props: buildMentionProps({
                      userId: user.id,
                      username: user.username,
                      userEmail: user.email,
                    }),
                  } as unknown as Parameters<typeof editorTyped.insertInlineContent>[0][number],
                  ' ',
                ]);
                if (blockId && onMentionInsert && u.id !== currentUser?.id) {
                  logger.info(Event.CANVAS_MENTION_DEBUG, {
                    message: 'CanvasEditor calling API',
                  });
                  onMentionInsert({ type: 'user', id: u.id, blockId });
                } else {
                  logger.warn(Event.CANVAS_MENTION_DEBUG, {
                    message: 'CanvasEditor skip API',
                    blockId: !!blockId,
                    hasOnMentionInsert: !!onMentionInsert,
                  });
                }
              },
            };
          });
          return [...customUserItems, ...groupItems];
        }
        logger.info(Event.CANVAS_MENTION_DEBUG, {
          message: 'CanvasEditor using default userItems (no API)',
        });
        return [...userItems, ...groupItems];
      };
    }, [editor, users, currentUser?.id, allUserGroups, canvasId, onMentionInsert, canvasCreatedBy]);

    const [tocHeadings, setTocHeadings] = useState<TocHeading[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFocused, setIsFocused] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    useCanvasTableFilters(containerRef);
    const getCanvasCommentEditor = useCallback(
      () => (editor ? asBlockNoteEditorForView(editor) : null),
      [editor],
    );
    const {
      isCommentsOpen,
      setIsCommentsOpen,
      inlineCommentThread,
      activeCommentBlockId,
      activeCommentThreadId,
      activeCommentAnchor,
      refreshCommentHighlights,
      openCommentsForCurrentBlock,
      focusCommentBlock,
      clearActiveCommentAnchor,
      closeInlineCommentThread,
      applyCommentAnchorStyle,
      removeCommentAnchorStyle,
    } = useCanvasCommentEditorBridge({
      canvasId,
      containerRef,
      getEditor: getCanvasCommentEditor,
      initialBlockIdToFocus,
      initialCommentThreadId,
      onOpenCommentCountChange,
    });
    const {
      activeTicketAnchor,
      isTicketChannelArchived,
      openTicketForCurrentSelection,
      closeTicketModal,
      handleTicketCreated,
    } = useCanvasTicketEditorBridge({
      channelId,
      containerRef,
      getEditor: getCanvasCommentEditor,
    });

    // Expose presentation and comment drawer methods via ref
    useImperativeHandle(
      ref,
      () => ({
        handlePresent,
        handleThemeChange,
        getBlocks: () => deepCloneBlocks(editor.document as PartialBlock[]),
        replaceContent: (blocks: PartialBlock[]) => {
          const currentBlocks = editor.document;
          const nextBlocks = deepCloneBlocks(
            removeUnknownBlocks(blocks, knownCanvasBlockTypes),
          ) as Parameters<typeof editor.replaceBlocks>[1];
          editor.replaceBlocks(currentBlocks, nextBlocks);
        },
        exportMarkdown: (title: string) =>
          exportCanvasAsMarkdown(
            editor as unknown as CanvasExportEditor,
            title,
            containerRef.current,
          ),
        exportPDF: (title: string) =>
          exportCanvasAsPDF(editor as unknown as CanvasExportEditor, title, containerRef.current),
        toggleComments: () => setIsCommentsOpen(open => !open),
        selectedTheme,
      }),
      [editor, handlePresent, handleThemeChange, selectedTheme, setIsCommentsOpen],
    );

    useScope('canvas', isFocused);

    const handleFocusCapture = useCallback(() => {
      setIsFocused(true);
    }, []);

    const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget) {
        const activeElement = document.activeElement;
        if (!activeElement || !containerRef.current?.contains(activeElement)) {
          setIsFocused(false);
        }
        return;
      }

      // Check if focus is moving within the component
      if (!containerRef.current || !containerRef.current.contains(nextTarget)) {
        setIsFocused(false);
      }
    }, []);

    const extractHeadings = useCallback(() => {
      if (!editor) return;
      const headings = extractHeadingsFromBlocks(asBlockNoteEditorForView(editor));
      setTocHeadings(headings);
    }, [editor]);

    const handleHeadingClick = useCallback((id: string) => {
      scrollToHeading(id, containerRef.current);
    }, []);

    // Debounce timer ref
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Track if we've shown the exceeded message (to avoid spamming)
    const hasShownExceededRef = useRef(false);

    // Handle content changes with debouncing
    const handleChange = useCallback((): void => {
      refreshCommentHighlights();
      if (onChange && editor) {
        // Clear existing timer
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        // Set new timer for debounced execution
        debounceTimerRef.current = setTimeout(() => {
          const blocks = editor.document;

          // Check content size before saving
          const sizeBytes = getContentSizeBytes(blocks as PartialBlock[]);
          const isExceeded = sizeBytes >= CONTENT_SIZE_MAX_THRESHOLD;

          // Block save if content exceeds max limit
          if (isExceeded) {
            if (!hasShownExceededRef.current) {
              hasShownExceededRef.current = true;
              toast.error('Content Too Large', {
                description: `Canvas content (${formatBytes(sizeBytes)}) exceeds the maximum size of ${formatBytes(CONTENT_SIZE_MAX_THRESHOLD)}. Please reduce content size or use new canvas for better performance.`,
              });
            }
            return; // Don't save
          }

          // Reset exceeded flag if size goes back down
          if (!isExceeded) {
            hasShownExceededRef.current = false;
          }

          const clonedBlocks = deepCloneBlocks(blocks as PartialBlock[]);

          extractHeadings();

          onChange(clonedBlocks);
        }, 500); // 500ms debounce delay
      }
    }, [editor, onChange, extractHeadings, refreshCommentHighlights]);

    // Cleanup debounce timer on unmount
    useEffect(() => {
      return (): void => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
      };
    }, []);

    useEffect((): (() => void) | void => {
      if (editor && content) {
        const timer = setTimeout(extractHeadings, 100);
        return (): void => clearTimeout(timer);
      }
    }, [editor, content, extractHeadings]);

    const canvasFormattingToolbar = useMemo(
      () =>
        createCanvasFormattingToolbar(openCommentsForCurrentBlock, {
          ...(canvasId && { canvasId }),
          ...(_canvasTitle && { canvasTitle: _canvasTitle }),
          canComment: editable,
          canCreateTicket: editable && !isTicketChannelArchived,
          onCreateTicket: openTicketForCurrentSelection,
        }),
      [
        _canvasTitle,
        canvasId,
        editable,
        isTicketChannelArchived,
        openCommentsForCurrentBlock,
        openTicketForCurrentSelection,
      ],
    );

    const handleSave = useCallback((): void => {
      if (!onSave || !editor) return;
      const blocks = editor.document;
      const clonedBlocks = deepCloneBlocks(blocks as PartialBlock[]);
      onSave(clonedBlocks);
    }, [editor, onSave]);

    useShortcutById('canvas.save', handleSave, {
      enabled: Boolean(onSave && editor),
    });

    useShortcutById('canvas.search', () => {
      setIsSearchOpen(true);
    });

    const { mentionContextValue } = useCanvasEditorMentionSharing({
      canvasId,
      z,
      canvasParticipants,
      canvasCreatedBy,
      currentUserId: currentUser?.id ?? '',
      currentUserRole: currentUserRole ?? null,
    });

    return (
      <div
        ref={containerRef}
        className={`canvas-surface flex flex-col h-full bg-background overflow-hidden relative ${className}`}
        onContextMenu={e => e.preventDefault()}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
        data-testid='canvas-editor'
      >
        <div className='relative flex min-h-0 flex-1 overflow-hidden'>
          <div className='thin-scrollbar relative min-h-0 flex-1 overflow-auto pt-8'>
            <CanvasMentionContext.Provider value={mentionContextValue}>
              <BlockNoteView
                editor={asBlockNoteEditorForView(editor)}
                editable={editable}
                onChange={handleChange}
                theme={theme === 'midnight' ? 'dark' : 'light'}
                formattingToolbar={false}
                tableHandles={editable}
                slashMenu={false}
                linkToolbar={false}
                filePanel={false}
              >
                <FormattingToolbarController formattingToolbar={canvasFormattingToolbar} />
                <LinkToolbarController linkToolbar={CanvasLinkToolbar} />
                <CanvasPastedLinkToolbar />
                <FilePanelController filePanel={CanvasFilePanel} />
                <SuggestionMenuController triggerCharacter='/' getItems={getSlashMenuItems} />
                <SuggestionMenuController triggerCharacter='@' getItems={getMentionItems} />
              </BlockNoteView>
            </CanvasMentionContext.Provider>
          </div>

          <AnimatePresence>
            {canvasId && isCommentsOpen && (
              <CanvasCommentsPanel
                canvasId={canvasId}
                canvasTitle={_canvasTitle}
                channelId={channelId}
                activeBlockId={activeCommentBlockId}
                activeThreadId={activeCommentThreadId}
                activeAnchor={activeCommentAnchor}
                editable={editable}
                onClose={() => setIsCommentsOpen(false)}
                onSelectBlock={focusCommentBlock}
                onBeforeCreateThread={applyCommentAnchorStyle}
                onCreateThreadCreated={clearActiveCommentAnchor}
                onCreateThreadFailed={removeCommentAnchorStyle}
              />
            )}
          </AnimatePresence>

          {canvasId && inlineCommentThread && (
            <CanvasInlineCommentThread
              canvasId={canvasId}
              canvasTitle={_canvasTitle}
              channelId={channelId}
              {...(inlineCommentThread.mode === 'thread' && {
                thread: inlineCommentThread.thread,
              })}
              {...(inlineCommentThread.mode === 'create' && {
                activeAnchor: inlineCommentThread.anchor,
              })}
              anchorRect={inlineCommentThread.rect}
              editable={editable}
              onClose={closeInlineCommentThread}
              onBeforeCreateThread={applyCommentAnchorStyle}
              onCreateThreadCreated={clearActiveCommentAnchor}
              onCreateThreadFailed={removeCommentAnchorStyle}
            />
          )}
        </div>

        <CanvasTicketCreationFlow
          anchor={activeTicketAnchor}
          channelId={channelId}
          onClose={closeTicketModal}
          onTicketCreated={handleTicketCreated}
        />

        {/* Presentation Modal */}
        {showPresentation && (
          <PresentationModal
            slides={generatedSlides}
            theme={selectedTheme}
            onClose={closePresentation}
          />
        )}

        {/* Table of Contents */}
        <TableOfContents headings={tocHeadings} onHeadingClick={handleHeadingClick} />

        {/* Search Overlay */}
        {editor && (
          <CanvasSearch
            editor={asBlockNoteEditorForView(editor)}
            containerRef={containerRef}
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
          />
        )}

        {/* Copy button overlay for code blocks */}
        {editor && (
          <CanvasCodeCopyButton
            containerRef={containerRef}
            editor={asBlockNoteEditorForView(editor)}
          />
        )}
      </div>
    );
  },
);

CanvasEditor.displayName = 'CanvasEditor';
