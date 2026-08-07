import {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  DefaultReactSuggestionItem,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  PartialBlock,
  StyleSchema,
} from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { en } from '@blocknote/core/locales';
import { PresentationModal, usePresentation } from 'blocknote-layout-extensions';

import {
  useCanvasYjsProvider,
  type CollaboratorInfo,
  generateUserColor,
} from '../../../hooks/useCanvasYjsProvider';
import { useAuth } from '../../../hooks/useAuth';
import { useSelf, useUsers, searchUsers } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { logger, Event } from '../../../utils/logger';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import {
  resolveFileUrl,
  extractHeadingsFromBlocks,
  scrollToHeading,
} from '../../../utils/canvasUtils';
import {
  exportCanvasAsMarkdown,
  exportCanvasAsPDF,
  type CanvasExportEditor,
} from '../../../utils/canvasExport';
import { apiInstance } from '../../../services/clients/apiClient';
import type { CanvasParticipant, CollaborativeCanvasEditorRef } from '../Canvas.types';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { getWhiteboardSlashMenuItems } from 'blocknote-layout-extensions';
import { insertGroupMention } from 'blocknote-layout-extensions';
import { buildMentionProps, CanvasMentionContext } from '../CanvasMentionSpec';
import { canvasSchema, canvasTableOptions, canvasTiptapOptions } from '../canvasSchema';
import { createElement } from 'react';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import { RiGroupLine } from 'react-icons/ri';
import Avatar from '../../ui/Avatar/Avatar';
import { TableOfContents, TocHeading } from '../TableOfContents';
import { CanvasSearch } from '../CanvasSearch/CanvasSearch';
import { SelectionAskAI } from '../SelectionAskAI';
import { CanvasCodeCopyButton } from '../CanvasCodeCopyButton';
import { useCanvasTableFilters } from '../useCanvasTableFilters';
import { useScope, useShortcutById } from '../../../shortcuts';
import { useTheme } from '../../../hooks/useTheme';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useSelector } from '@xstate/react';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { useCanvasEditorMentionSharing } from '@/hooks/useCanvasEditorMentionSharing';
import { CanvasRole } from '@xyne/shared';
import Button from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip';
import { CanvasCommentsPanel } from '../CanvasCommentsPanel/CanvasCommentsPanel';
import { createCanvasFormattingToolbar } from '../CanvasFormattingToolbar/CanvasFormattingToolbar';
import { useCanvasCommentEditorBridge } from '../useCanvasCommentEditorBridge';

const canvasDictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Write something, or press '/' for commands",
    emptyDocument: "Write something, or press '/' for commands",
  },
};

interface CollaborativeCanvasEditorProps {
  canvasId: string;
  channelId?: string | undefined;
  title?: string | undefined;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  onFileUpload?: (file: File) => Promise<string>;
  onChange?: (blocks: PartialBlock[]) => void;
  onSave?: (blocks: PartialBlock[]) => void;
  onCollaboratorsChange?: (collaborators: CollaboratorInfo[]) => void;
  initialLegacyContent?: PartialBlock[] | undefined;
  /** When set, focus and scroll to this block on load (e.g. from activity notification) */
  initialBlockIdToFocus?: string | undefined;
  /** When set with initialBlockIdToFocus, open the matching comment thread on load. */
  initialCommentThreadId?: string | undefined;
  /** Auto-focus the editor on mount */
  autoFocus?: boolean;
  /** Optional preloaded canvas participants to avoid duplicate query */
  canvasParticipants?: CanvasParticipant[] | undefined;
  /** Optional preloaded canvas creator */
  canvasCreatedBy?: string | undefined;
  /** Effective role of current user on this canvas */
  currentUserRole?: CanvasRole | null;
}

export const CollaborativeCanvasEditor = forwardRef<
  CollaborativeCanvasEditorRef,
  CollaborativeCanvasEditorProps
>(
  (
    {
      canvasId,
      channelId,
      title,
      editable = true,
      placeholder: _placeholder,
      className = '',
      onFileUpload,
      onChange,
      onSave,
      onCollaboratorsChange,
      initialLegacyContent,
      initialBlockIdToFocus,
      initialCommentThreadId,
      autoFocus,
      canvasParticipants: preloadedParticipants,
      canvasCreatedBy,
      currentUserRole,
    },
    ref,
  ) => {
    const [isEditorReady, setIsEditorReady] = useState(false);
    const { user: authUser } = useAuth();
    const selfUser = useSelf();
    const user = selfUser || authUser;
    const { theme } = useTheme();
    const isXyneAIOpen = useSelector(xyneAIActor, state => state.matches('open'));
    const z = useZero();
    const currentUserId = (user?.id as string) || '';
    const [queriedParticipants = []] = useCachedQuery(queries.canvasParticipants({ canvasId }), {
      enabled: Boolean(canvasId) && !preloadedParticipants,
    });
    const canvasParticipants = preloadedParticipants ?? queriedParticipants;
    const currentUserName =
      (user?.name ? String(user.name) : undefined) ||
      (user?.email ? String(user.email).split('@')[0] : undefined) ||
      'Anonymous';
    const currentUserColor = generateUserColor(currentUserId);

    const { fragment, provider, awareness, collaborators, connectionStatus, isReadOnly } =
      useCanvasYjsProvider({
        canvasId,
        userId: currentUserId,
        userName: currentUserName,
        userColor: currentUserColor,
        channelId,
        title,
      });

    useEffect(() => {
      onCollaboratorsChange?.(collaborators);
    }, [collaborators, onCollaboratorsChange]);

    const isCollaborationReady = !!(
      provider &&
      fragment &&
      awareness &&
      connectionStatus === 'connected'
    );

    const hasCollaborationInitializedRef = useRef(false);
    if (isCollaborationReady && !hasCollaborationInitializedRef.current) {
      hasCollaborationInitializedRef.current = true;
    }

    const shouldUseCollaboration = hasCollaborationInitializedRef.current || isCollaborationReady;

    const editorOptions = {
      schema: canvasSchema,
      dictionary: canvasDictionary,
      ...(onFileUpload ? { uploadFile: onFileUpload } : {}),
      resolveFileUrl,
      tables: canvasTableOptions,
      _tiptapOptions: canvasTiptapOptions,
      ...(shouldUseCollaboration
        ? {
            collaboration: {
              fragment,
              user: {
                id: currentUserId,
                name: currentUserName,
                color: currentUserColor,
              },
              provider,
            },
          }
        : {}),
    };

    const editor = useCreateBlockNote(editorOptions as Parameters<typeof useCreateBlockNote>[0], [
      canvasId,
      awareness,
      shouldUseCollaboration,
    ]);

    // Presentation state and handlers
    const {
      selectedTheme,
      showPresentation,
      generatedSlides,
      handleThemeChange,
      handlePresent,
      closePresentation,
    } = usePresentation({ editor });

    // Auto-focus the editor on mount if requested (fire only once, cursor at end)
    // BlockNoteView's autoFocus prop is disabled — this effect is the single source of truth.
    const hasAutoFocusedRef = useRef(false);
    const setCursorToEnd = useCallback((): boolean => {
      if (!editor || hasAutoFocusedRef.current || isXyneAIOpen) return true; // already done or nothing to do
      try {
        const editorTyped = editor as unknown as BlockNoteEditor<
          BlockSchema,
          InlineContentSchema,
          StyleSchema
        >;
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
      // Retry until content is actually present (collab sync / migration may be pending)
      const interval = setInterval(() => {
        if (setCursorToEnd()) {
          clearInterval(interval);
        }
      }, 50);
      return () => clearInterval(interval);
    }, [autoFocus, editor, isXyneAIOpen, setCursorToEnd]);

    // Get custom slash menu items (whiteboard)
    const customSlashItems = useMemo(() => {
      if (!editor) return [];
      const whiteboardItems = getWhiteboardSlashMenuItems(
        editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
      );

      return [...whiteboardItems];
    }, [editor]);

    // Get slash menu items with custom blocks
    const getSlashMenuItems = useCallback(
      (query: string): Promise<DefaultReactSuggestionItem[]> => {
        if (!editor) return Promise.resolve([]);
        const defaultItems = getDefaultReactSlashMenuItems(
          editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
        );
        return Promise.resolve(
          filterSuggestionItems([...defaultItems, ...customSlashItems], query),
        );
      },
      [editor, customSlashItems],
    );

    const users = useUsers();
    const allUserGroups = useUserGroups();

    // Get mention suggestion menu items – event-based: notify on @ selection (blockId for redirect)
    // Users can mention anyone; backend handles permission checks for notifications
    const getMentionItems = useMemo(() => {
      if (!editor) return (): Promise<DefaultReactSuggestionItem[]> => Promise.resolve([]);
      const editorTyped = editor as unknown as BlockNoteEditor<
        BlockSchema,
        InlineContentSchema,
        StyleSchema
      >;
      const onMentionInsert = (params: { type: 'user' | 'group'; id: string; blockId: string }) => {
        if (!canvasId || !title) return;
        // Construct Slack URL using generic redirect route - CanvasRedirectPage will handle redirect
        const path = params.blockId
          ? `redirected?type=canvas&canvasId=${encodeURIComponent(canvasId)}&blockId=${encodeURIComponent(params.blockId)}`
          : `redirected?type=canvas&canvasId=${encodeURIComponent(canvasId)}`;
        const slackUrl = `${window.location.origin}/launch?path=${encodeURIComponent(path)}`;
        apiInstance
          .post(`/canvas/${canvasId}/mentions`, {
            mentionType: params.type,
            mentionId: params.id,
            blockId: params.blockId,
            canvasTitle: title,
            slackUrl,
          })
          .catch(error => {
            logger.error(Event.CANVAS_MENTION_DEBUG, {
              message: 'Failed to send mention notification',
              error: error instanceof Error ? error.message : String(error),
            });
          });
      };
      return (query: string): Promise<DefaultReactSuggestionItem[]> => {
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
                message: 'User mention onItemClick fired',
                canvasId,
                title,
                userId: u.id,
              });
              // Get block id before insert - cursor is in the block that will contain the mention
              let blockId: string | undefined;
              try {
                blockId = editorTyped.getTextCursorPosition().block?.id;
              } catch (e) {
                logger.warn(Event.CANVAS_MENTION_DEBUG, {
                  message: 'getTextCursorPosition failed',
                  error: e instanceof Error ? e.message : String(e),
                });
              }
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
              if (blockId && canvasId && title && u.id !== currentUserId) {
                logger.info(Event.CANVAS_MENTION_DEBUG, {
                  message: 'Calling API',
                  blockId,
                  userId: u.id,
                });
                onMentionInsert({ type: 'user', id: u.id, blockId });
              } else {
                logger.warn(Event.CANVAS_MENTION_DEBUG, {
                  message: 'Skipping API - missing',
                  blockId: !!blockId,
                  canvasId: !!canvasId,
                  title: !!title,
                });
              }
            },
          };
        });
        const queryLower = query.toLowerCase().trim();
        // Include all groups, show deactivated indicator
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
            if (blockId && canvasId && title) {
              onMentionInsert({ type: 'group', id: g.id, blockId });
            }
          },
        }));
        return Promise.resolve([...customUserItems, ...groupItems]);
      };
    }, [
      editor,
      users,
      currentUserId,
      allUserGroups,
      canvasId,
      title,
      canvasParticipants,
      canvasCreatedBy,
    ]);

    // Expose presentation methods via ref
    useImperativeHandle(
      ref,
      () => ({
        handlePresent,
        handleThemeChange,
        getBlocks: () => JSON.parse(JSON.stringify(editor.document)) as PartialBlock[],
        replaceContent: (blocks: PartialBlock[]) => {
          const editorTyped = editor as unknown as BlockNoteEditor<
            BlockSchema,
            InlineContentSchema,
            StyleSchema
          >;
          const nextBlocks = JSON.parse(JSON.stringify(blocks)) as Parameters<
            typeof editorTyped.replaceBlocks
          >[1];
          editorTyped.replaceBlocks(editorTyped.document, nextBlocks);
        },
        exportMarkdown: (title: string) =>
          exportCanvasAsMarkdown(
            editor as unknown as CanvasExportEditor,
            title,
            containerRef.current,
          ),
        exportPDF: (title: string) =>
          exportCanvasAsPDF(editor as unknown as CanvasExportEditor, title, containerRef.current),
        selectedTheme,
      }),
      [editor, handlePresent, handleThemeChange, selectedTheme],
    );

    useEffect(() => {
      if (!editor) return;

      if (editor.document) {
        setIsEditorReady(true);
      }
    }, [editor]);

    const hasMigratedContentRef = useRef(false);

    useEffect(() => {
      if (
        !editor ||
        !isEditorReady ||
        !isCollaborationReady ||
        !initialLegacyContent ||
        initialLegacyContent.length === 0 ||
        hasMigratedContentRef.current
      ) {
        return;
      }

      const currentBlocks = editor.document;
      const firstBlock = currentBlocks[0];
      const isDocumentEmpty =
        currentBlocks.length === 0 ||
        (currentBlocks.length === 1 &&
          firstBlock?.type === 'paragraph' &&
          (!firstBlock.content ||
            (Array.isArray(firstBlock.content) && firstBlock.content.length === 0)));

      if (isDocumentEmpty) {
        editor.replaceBlocks(currentBlocks, initialLegacyContent);
        hasMigratedContentRef.current = true;
        // Reset auto-focus so cursor-at-end logic runs again after content is loaded
        hasAutoFocusedRef.current = false;
      } else {
        hasMigratedContentRef.current = true;
      }
    }, [editor, isEditorReady, isCollaborationReady, initialLegacyContent]);

    const [tocHeadings, setTocHeadings] = useState<TocHeading[]>([]);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    useCanvasTableFilters(containerRef);
    const getCanvasCommentEditor = useCallback(
      () =>
        editor
          ? (editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>)
          : null,
      [editor],
    );
    const {
      isCommentsOpen,
      setIsCommentsOpen,
      activeCommentBlockId,
      activeCommentThreadId,
      activeCommentAnchor,
      refreshCommentHighlights,
      openCommentsForCurrentBlock,
      focusCommentBlock,
      applyCommentAnchorStyle,
      removeCommentAnchorStyle,
    } = useCanvasCommentEditorBridge({
      canvasId,
      containerRef,
      getEditor: getCanvasCommentEditor,
      initialBlockIdToFocus,
      initialCommentThreadId,
      ready: isEditorReady,
    });

    useScope('canvas', isFocused);

    const extractHeadings = useCallback(() => {
      if (!editor) return;
      const headings = extractHeadingsFromBlocks(
        editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
      );
      setTocHeadings(headings);
    }, [editor]);

    const debouncedExtractHeadings = useCallback(() => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        extractHeadings();
      }, 1000);
    }, [extractHeadings]);

    const handleCollaborativeChange = useCallback(() => {
      refreshCommentHighlights();
      debouncedExtractHeadings();
      onChange?.(editor.document as PartialBlock[]);
    }, [debouncedExtractHeadings, editor, onChange, refreshCommentHighlights]);

    const handleHeadingClick = useCallback((id: string) => {
      scrollToHeading(id, containerRef.current);
    }, []);

    const canvasFormattingToolbar = useMemo(
      () => createCanvasFormattingToolbar(openCommentsForCurrentBlock),
      [openCommentsForCurrentBlock],
    );

    useEffect((): (() => void) | void => {
      if (isEditorReady && editor) {
        const timer = setTimeout(extractHeadings, 100);
        return (): void => clearTimeout(timer);
      }
    }, [isEditorReady, editor, extractHeadings]);

    useEffect(() => {
      return (): void => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
      };
    }, []);

    const handleFocusCapture = useCallback(() => {
      setIsFocused(true);
    }, []);

    const handleBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget) {
        const activeElement = document.activeElement;
        if (!activeElement || !containerRef.current?.contains(activeElement)) {
          setIsFocused(false);
        }
        return;
      }

      if (!containerRef.current || !containerRef.current.contains(nextTarget)) {
        setIsFocused(false);
      }
    }, []);

    const handleSave = useCallback((): void => {
      if (!onSave || !editor) return;
      onSave(JSON.parse(JSON.stringify(editor.document)) as PartialBlock[]);
    }, [editor, onSave]);

    useShortcutById('canvas.save', handleSave, {
      enabled: Boolean(onSave && editor && editable && !isReadOnly),
    });

    useShortcutById('canvas.search', () => {
      setIsSearchOpen(true);
    });

    const { mentionContextValue } = useCanvasEditorMentionSharing({
      canvasId,
      z,
      canvasParticipants,
      canvasCreatedBy,
      currentUserId,
      currentUserRole: currentUserRole ?? null,
    });

    return (
      <div
        ref={containerRef}
        className={`canvas-surface flex flex-col h-full bg-background overflow-hidden ${className} ${!editable || isReadOnly ? 'read-only-canvas' : ''}`}
        // Disable native browser context menu to prevent conflicts with BlockNote's custom menus (Slash menu, Format menu, etc.)
        onContextMenu={(e): void => e.preventDefault()}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
        role='application'
        tabIndex={-1}
        data-testid='canvas-editor'
      >
        <div className='flex min-h-0 flex-1 overflow-hidden'>
          <div
            className='thin-scrollbar relative min-h-0 flex-1 overflow-auto pt-8'
            style={{
              maxWidth: '100%',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            <div className='absolute right-4 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-background/95 p-1 shadow-sm backdrop-blur'>
              {editable && !isReadOnly && (
                <Tooltip content='Add comment'>
                  <Button
                    variant='ghost'
                    size='iconSm'
                    onClick={openCommentsForCurrentBlock}
                    aria-label='Add comment'
                  >
                    <MessageSquarePlus className='size-4' />
                  </Button>
                </Tooltip>
              )}
              <Tooltip content='Comments'>
                <Button
                  variant={isCommentsOpen ? 'secondary' : 'ghost'}
                  size='iconSm'
                  onClick={() => setIsCommentsOpen(open => !open)}
                  aria-label='Comments'
                >
                  <MessageSquare className='size-4' />
                </Button>
              </Tooltip>
            </div>

            <div
              className='blocknote-editor-wrapper w-full max-w-full'
              style={{
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {editor && (
                <CanvasMentionContext.Provider value={mentionContextValue}>
                  <BlockNoteView
                    editor={
                      editor as unknown as BlockNoteEditor<
                        BlockSchema,
                        InlineContentSchema,
                        StyleSchema
                      >
                    }
                    editable={editable && !isReadOnly}
                    theme={theme === 'midnight' ? 'dark' : 'light'}
                    formattingToolbar={false}
                    tableHandles={editable && !isReadOnly}
                    slashMenu={false}
                    onChange={handleCollaborativeChange}
                  >
                    <FormattingToolbarController formattingToolbar={canvasFormattingToolbar} />
                    <SuggestionMenuController triggerCharacter='/' getItems={getSlashMenuItems} />
                    <SuggestionMenuController triggerCharacter='@' getItems={getMentionItems} />
                  </BlockNoteView>
                </CanvasMentionContext.Provider>
              )}
            </div>
          </div>

          {isCommentsOpen && (
            <CanvasCommentsPanel
              canvasId={canvasId}
              canvasTitle={title}
              channelId={channelId}
              activeBlockId={activeCommentBlockId}
              activeThreadId={activeCommentThreadId}
              activeAnchor={activeCommentAnchor}
              editable={editable && !isReadOnly}
              onClose={() => setIsCommentsOpen(false)}
              onSelectBlock={focusCommentBlock}
              onBeforeCreateThread={applyCommentAnchorStyle}
              onCreateThreadFailed={removeCommentAnchorStyle}
            />
          )}
        </div>

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
            editor={
              editor as unknown as BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>
            }
            containerRef={containerRef}
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
          />
        )}

        {/* Selection Ask AI Button */}
        <SelectionAskAI
          {...(title && { canvasTitle: title })}
          {...(canvasId && { canvasId })}
          containerRef={containerRef}
        />

        {/* Copy button overlay for code blocks */}
        <CanvasCodeCopyButton containerRef={containerRef} />
      </div>
    );
  },
);

CollaborativeCanvasEditor.displayName = 'CollaborativeCanvasEditor';
