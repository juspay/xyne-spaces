import { ReactElement, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePath } from '../../../hooks/usePath';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { CollaborativeCanvasEditor } from '../CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { CanvasEditor } from '../CanvasEditor/CanvasEditor';
import { CanvasList } from '../CanvasList';
import { CanvasShareModal } from '../CanvasShareModal';
import {
  CanvasVersionDiffPanel,
  CanvasVersionHistory,
  type CanvasVersionRecord,
} from '../CanvasVersionHistory';
import { toast } from 'sonner';
import { Button } from '../../ui/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui/dropdown-menu';
import { Dialog } from '../../ui/Dialog';
import Input from '../../ui/Input';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import {
  ArrowLeft,
  CheckCircle,
  Download,
  FileDown,
  FileText,
  GitCompare,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react';
import type { CollaboratorInfo } from '../../../hooks/useCanvasYjsProvider';
import { generateUserColor } from '../../../hooks/useCanvasYjsProvider';
import { DocumentNotFoundIcon } from '../../icons';
import { useUsers } from '../../../hooks/useUsers';
import { CanvasParticipantsTray, type ParticipantItem } from '../CanvasParticipantsTray';

import type {
  Canvas,
  CanvasParticipant,
  KnowledgeCanvasMetadata,
  CanvasEditorRef,
  CollaborativeCanvasEditorRef,
} from '../Canvas.types';
import type { PartialBlock } from '@blocknote/core';
import { PresentToolbar } from 'blocknote-layout-extensions';
import { useAuth } from '../../../hooks/useAuth';
import { usePlatform } from '../../../hooks/usePlatform';
import { useZero } from '../../../hooks/useZero';
import { MessageType, CanvasVisibility, CanvasRole } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { v4 as uuidv4 } from 'uuid';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { approveKnowledgeCanvas } from '../../../services/Knowledge/knowledgeService';
import { canvasService } from '../../../services/Canvas/canvasService';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useCurrentUserGroupIds } from '../../../hooks/useUserGroup';
import { logger, Event } from '../../../utils/logger';
import { apiInstance } from '../../../services/clients/apiClient';
import { xyneAIActor, type CanvasInfo } from '../../../machines/xyneAIMachine';
import { useAllVisibleChannels } from '@xyne/shared/hooks';
import { usePersistedCanvasPreferences } from '../../../hooks/usePersistedCanvasPreferences';
import {
  createCanvasContentTextDiff,
  isVisibleCanvasContentDiffPart,
  normalizeCanvasContent,
  stableStringifyCanvasContent,
  useCanvasExitSnapshot,
  useCanvasVersionCopy,
  useCanvasVersionCopyCreatedHandler,
  useCanvasVersionRename,
  useCanvasVersionRestore,
  useCanvasVersionSave,
} from '../../../utils/canvasVersioning';

interface LocationState {
  mode?: 'edit-message' | 'create-message';
  messageId?: string;
  initialContent?: PartialBlock[];
  channelId?: string;
  conversationId?: string;
  canvas?: Canvas;
}

interface CanvasScreenProps {
  canvasId?: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const getCanvasRolePriority = (role: CanvasRole): number => {
  switch (role) {
    case CanvasRole.OWNER:
      return 3;
    case CanvasRole.EDITOR:
      return 2;
    case CanvasRole.VIEWER:
      return 1;
    default:
      return 0;
  }
};

const getDirectoryFromPath = (filePath: string): string => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex > -1 ? normalizedPath.slice(0, lastSlashIndex) : filePath;
};

const CanvasScreen: React.FC<CanvasScreenProps> = ({
  canvasId: propCanvasId,
  isFullscreen = false,
  onToggleFullscreen,
}): ReactElement => {
  const { canvasId: paramsCanvasId } = useParams<{ canvasId?: string }>();
  const canvasId = propCanvasId || paramsCanvasId;
  const navigate = useNavigate();
  const shareableOrigin = useShareableOrigin();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const blockIdFromUrl = searchParams.get('blockId') ?? undefined;
  const skipAutoFocus = searchParams.get('nofocus') === '1';
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();

  // Determine if we're on /chat/canvas (full-screen canvas page)
  const isOnChatCanvasPage = usePath().startsWith('/chat/canvas');
  const state = location.state as LocationState | null;
  const isEditingMessage = state?.mode === 'edit-message';
  const isCreatingMessage = state?.mode === 'create-message';
  const { user } = useAuth();
  const z = useZero();
  const queryClient = useQueryClient();

  const [singleCanvas, singleCanvasDetails] = useCachedQuery(
    queries.getCanvas({ canvasId: canvasId && canvasId !== 'new' ? canvasId : '' }),
    { enabled: !!canvasId },
  );

  // XYNE-1514: Canvas Participants in the tray
  type CanvasWithParticipants = Canvas & { participants?: CanvasParticipant[] };

  const canvasWithParticipants = singleCanvas as CanvasWithParticipants | undefined;
  const canvasParticipants = canvasWithParticipants?.participants;
  const currentUserGroupIds = useCurrentUserGroupIds();
  const visibleChannels = useAllVisibleChannels();
  const currentUserChannelIds = useMemo(
    () => new Set(visibleChannels.map(channel => channel.id).filter(Boolean)),
    [visibleChannels],
  );

  // Fetch message with attachments when editing a message
  const [messageData] = useCachedQuery(
    queries.getMessageForActivityV2({ messageId: state?.messageId || '' }),
    { enabled: !!state?.messageId },
  );

  const [selectedCanvas, setSelectedCanvas] = useState<Canvas | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [currentTitle, setCurrentTitle] = useState('Untitled Canvas');
  const [currentContent, setCurrentContent] = useState<PartialBlock[] | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState('white');
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [showParticipantsTray, setShowParticipantsTray] = useState(false);
  const {
    filter: activeFilter,
    setFilter: setActiveFilter,
    lastCanvasId,
    setLastCanvasId,
  } = usePersistedCanvasPreferences();
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<CanvasVersionRecord | null>(null);
  const [showVersionDiff, setShowVersionDiff] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | undefined>(undefined);
  const [renamingVersionId, setRenamingVersionId] = useState<string | undefined>(undefined);
  const lastUpdatedText = selectedCanvas?.updatedAt
    ? `Last updated ${new Date(selectedCanvas.updatedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : null;

  // Ref for CanvasEditor to access presentation methods
  const editorRef = useRef<CanvasEditorRef | CollaborativeCanvasEditorRef | null>(null);
  const canvasContentRef = useRef<HTMLDivElement | null>(null);

  // Refs to track state for reliable saving on unmount/timer
  const latestContentRef = useRef<PartialBlock[] | undefined>(undefined);
  const lastSavedContentRef = useRef<string>(''); // Stringify to compare deep equality easily
  const latestHtmlRef = useRef<string>('');
  const titleRef = useRef(currentTitle);
  const selectedCanvasRef = useRef(selectedCanvas);
  const isCreatingRef = useRef(isCreating);
  const isSavingRef = useRef(isSaving);
  const isEditingMessageRef = useRef(isEditingMessage);
  const canEditRef = useRef(false);
  const previewVersionRef = useRef<CanvasVersionRecord | null>(null);
  const pendingAutoVersionSnapshotsRef = useRef<Set<string>>(new Set());
  const saveCanvasExitSnapshotRef = useRef<(() => void) | null>(null);
  const hasPendingSaveRef = useRef(false);
  const currentCanvasIdRef = useRef<string | null>(null); // Track the current canvas ID for file uploads
  const initializedCanvasIdRef = useRef<string | null>(null); // Track which canvas has been initialized to avoid overwriting local edits
  const previousAccessLevelRef = useRef<CanvasRole | undefined>(undefined);
  const isFirstAccessLevelComputeRef = useRef(true);

  useEffect(() => {
    titleRef.current = currentTitle;
    selectedCanvasRef.current = selectedCanvas;
    isCreatingRef.current = isCreating;
    isSavingRef.current = isSaving;
    isEditingMessageRef.current = isEditingMessage;
    previewVersionRef.current = previewVersion;
  }, [currentTitle, selectedCanvas, isCreating, isSaving, isEditingMessage, previewVersion]);

  useEffect(() => {
    previewVersionRef.current = null;
    setPreviewVersion(null);
    setShowVersionDiff(false);
    setRenamingVersionId(undefined);
    setShowVersionHistory(false);
  }, [selectedCanvas?.id]);

  // Handle single canvas data sync
  useEffect(() => {
    // Use canvas from navigation state if available (for newly created canvases)
    const canvasFromState = (state as LocationState)?.canvas;
    const shouldUseState = canvasFromState && canvasFromState.id === canvasId && !singleCanvas;

    if (shouldUseState) {
      const isNewCanvas = initializedCanvasIdRef.current !== canvasFromState.id;
      setSelectedCanvas(canvasFromState);
      if (isNewCanvas) {
        setCurrentTitle(canvasFromState.title);
        titleRef.current = canvasFromState.title;
        setCurrentContent(canvasFromState.content);
        latestContentRef.current = canvasFromState.content;
        lastSavedContentRef.current = JSON.stringify(canvasFromState.content || []);
        initializedCanvasIdRef.current = canvasFromState.id;
      }
      setIsCreating(false);
      currentCanvasIdRef.current = canvasFromState.id;
      setSelectedTheme('white');
      return;
    }

    if (singleCanvas) {
      const canvasData = singleCanvas as unknown as Canvas & {
        participants: {
          userId?: string | null;
          userGroupId?: string | null;
          channelId?: string | null;
          role: CanvasRole;
        }[];
      };

      const userParticipant = canvasData.participants?.find(p => p.userId === user?.id);
      let accessLevel = userParticipant?.role;

      if (!accessLevel) {
        const inheritedRoles = [
          ...(canvasData.participants
            ?.filter(
              participant =>
                Boolean(participant.userGroupId) &&
                currentUserGroupIds.has(participant.userGroupId as string),
            )
            .map(participant => participant.role) ?? []),
          ...(canvasData.participants
            ?.filter(
              participant =>
                Boolean(participant.channelId) &&
                currentUserChannelIds.has(participant.channelId as string),
            )
            .map(participant => participant.role) ?? []),
        ];
        if (inheritedRoles.length > 0) {
          accessLevel = inheritedRoles.reduce((highestRole, role) =>
            getCanvasRolePriority(role) > getCanvasRolePriority(highestRole) ? role : highestRole,
          );
        }
      }

      const canvas: Canvas = {
        ...canvasData,
        ...(accessLevel ? { accessLevel } : {}),
      };

      setSelectedCanvas(canvas);

      const isNewCanvas = initializedCanvasIdRef.current !== canvas.id;
      if (isNewCanvas) {
        setCurrentTitle(canvas.title);
        titleRef.current = canvas.title;
        setCurrentContent(canvas.content);
        latestContentRef.current = canvas.content;
        lastSavedContentRef.current = JSON.stringify(canvas.content || []);
        initializedCanvasIdRef.current = canvas.id;
      }
      setIsCreating(false);

      currentCanvasIdRef.current = canvas.id;

      // Check if this is a knowledge canvas and set approval state
      const metadata = canvas.metadata as KnowledgeCanvasMetadata | undefined;
      if (metadata?.source === 'workflow_knowledge') {
        setIsApproved(!!metadata.approvedAt);
      } else {
        setIsApproved(false);
      }
      setSelectedTheme('white');
      if (
        !isFirstAccessLevelComputeRef.current &&
        previousAccessLevelRef.current !== accessLevel &&
        canvasId
      ) {
        void queryClient.invalidateQueries({ queryKey: ['ysweet-auth', canvasId] });
      }
      isFirstAccessLevelComputeRef.current = false;
      previousAccessLevelRef.current = accessLevel;
    }
  }, [
    singleCanvas,
    user?.id,
    canvasId,
    state,
    currentUserGroupIds,
    currentUserChannelIds,
    queryClient,
  ]);

  useEffect(() => {
    if (
      canvasId &&
      canvasId !== 'new' &&
      canvasId === lastCanvasId &&
      singleCanvasDetails.type === 'complete' &&
      !singleCanvas
    ) {
      setLastCanvasId(null);
      const canvasRoute = isOnChatCanvasPage ? '/chat/canvas' : `${baseRoute}/canvas`;
      void navigate(canvasRoute, { replace: true });
    }
  }, [
    baseRoute,
    canvasId,
    isOnChatCanvasPage,
    lastCanvasId,
    navigate,
    setLastCanvasId,
    singleCanvas,
    singleCanvasDetails.type,
  ]);

  useEffect(() => {
    if (canvasId === 'new') {
      setIsCreating(true);
      const createNewCanvas = async (): Promise<void> => {
        const newCanvasId = uuidv4();
        const now = Date.now();

        let title = 'Untitled Canvas';
        let content: PartialBlock[] = [];

        if ((isEditingMessage || isCreatingMessage) && state?.initialContent) {
          title = isEditingMessage ? 'Editing Message' : 'New Message Canvas';

          // Include attachments from the message if available
          let contentWithAttachments = [...state.initialContent];
          if (messageData?.attachments && messageData.attachments.length > 0) {
            // Add attachment blocks to the content
            const attachmentBlocks: PartialBlock[] = messageData.attachments.map(attachment => {
              const isImage = attachment.mimetype.startsWith('image/');
              if (isImage) {
                return {
                  type: 'image',
                  props: {
                    url: `${attachment.id}`,
                    caption: attachment.originalFilename,
                  },
                } as PartialBlock;
              }
              return {
                type: 'file',
                props: {
                  url: `${attachment.id}`,
                  name: attachment.originalFilename,
                },
              } as PartialBlock;
            });
            contentWithAttachments = [...contentWithAttachments, ...attachmentBlocks];
          }
          content = contentWithAttachments;
        }

        try {
          await canvasService.createCollaborativeCanvas({
            id: newCanvasId,
            title,
            ...(state?.channelId ? { channelId: state.channelId } : {}),
          });

          const newCanvas: Canvas = {
            id: newCanvasId,
            title,
            content: content,
            ...(state?.channelId ? { channelId: state.channelId } : {}),
            createdBy: user?.id || '',
            visibility: CanvasVisibility.PRIVATE,
            isTemplate: false,
            isCollaborative: true,
            isStarred: false,
            createdAt: now,
            updatedAt: now,
            accessLevel: CanvasRole.OWNER,
          };

          setSelectedCanvas(newCanvas);
          setCurrentTitle(title);
          titleRef.current = title;
          setCurrentContent(content);
          latestContentRef.current = content;
          lastSavedContentRef.current = JSON.stringify(content);
          setIsCreating(false);

          currentCanvasIdRef.current = newCanvasId;
          initializedCanvasIdRef.current = newCanvasId;

          // Navigate based on current route context
          const canvasRoute = isOnChatCanvasPage
            ? `/chat/canvas/${newCanvasId}`
            : `${baseRoute}/canvas/${newCanvasId}`;
          void navigate(canvasRoute, { replace: true, state: state });
        } catch (error) {
          logger.error(Event.CANVAS_CREATE_FAILED, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          toast.error('Error', {
            description: 'Failed to create canvas. Please try again.',
          });
          setIsCreating(false);
        }
      };

      void createNewCanvas();
      return;
    }

    if (!canvasId) {
      setIsCreating(false);
      setSelectedCanvas(null);
      return;
    }
  }, [
    canvasId,
    isEditingMessage,
    isCreatingMessage,
    state?.initialContent,
    messageData,
    navigate,
    state,
    user?.id,
    baseRoute,
    isOnChatCanvasPage,
  ]);

  const handleCreateCanvas = (): void => {
    setIsCreating(true);
    setSelectedCanvas(null);
    setCurrentTitle('Untitled Canvas');
    setCurrentContent(undefined);
    latestContentRef.current = undefined;
    lastSavedContentRef.current = '';

    // Navigate based on current route context
    const newCanvasRoute = isOnChatCanvasPage ? '/chat/canvas/new' : `${baseRoute}/canvas/new`;
    void navigate(newCanvasRoute);
  };

  const handleDone = (): void => {
    if (latestContentRef.current) {
      performSave(latestContentRef.current, selectedCanvas, latestHtmlRef.current);
    }
    // Show confirmation dialog
    setShowSendConfirmation(true);
  };

  const handleBack = useCallback((): void => {
    if (isMobile && !isEditingMessage && !isCreatingMessage) {
      const canvasRoute = isOnChatCanvasPage ? '/chat/canvas' : `${baseRoute}/canvas`;
      void navigate(canvasRoute);
      return;
    }

    void navigate(-1);
  }, [baseRoute, isCreatingMessage, isEditingMessage, isMobile, isOnChatCanvasPage, navigate]);

  const handleConfirmSend = (): void => {
    if (!selectedCanvas || !state?.channelId) return;

    const canvasLink = `${shareableOrigin}/chat/canvas/${selectedCanvas.id}`;
    const contentWithLink = canvasLink;

    if (isEditingMessage && state.messageId) {
      void z.mutate(
        mutators.messages.update({
          messageId: state.messageId,
          content: contentWithLink,
        }),
      );
    } else if (isCreatingMessage) {
      if (state.conversationId) {
        void z.mutate(
          mutators.messages.send({
            conversationId: state.conversationId,
            content: contentWithLink,
            type: MessageType.USER,
            timestamp: Date.now(),
            messageId: uuidv4(),
          }),
        );
      } else {
        void z.mutate(
          mutators.conversations.send({
            channelId: state.channelId,
            content: contentWithLink,
            type: MessageType.USER,
            conversationId: uuidv4(),
            messageId: uuidv4(),
            timestamp: Date.now(),
          }),
        );
      }
    }

    setShowSendConfirmation(false);
    void navigate(-1);
  };

  const canEdit =
    isCreating ||
    isEditingMessage ||
    isCreatingMessage ||
    selectedCanvas?.accessLevel === CanvasRole.EDITOR ||
    selectedCanvas?.accessLevel === CanvasRole.OWNER ||
    selectedCanvas?.createdBy === user?.id;
  const handleRenameVersion = useCanvasVersionRename({
    canEdit,
    previewVersionRef,
    setPreviewVersion,
    setRenamingVersionId,
  });
  const handleVersionCopyCreated = useCanvasVersionCopyCreatedHandler<
    Canvas,
    PartialBlock[],
    CanvasVersionRecord
  >({
    sourceCanvas: selectedCanvas,
    userId: user?.id,
    navigate,
    getCanvasRoute: id => (isOnChatCanvasPage ? `/chat/canvas/${id}` : `${baseRoute}/canvas/${id}`),
    setCanvas: setSelectedCanvas,
    canvasRef: selectedCanvasRef,
    editorRef,
    setCurrentTitle,
    titleRef,
    setCurrentContent,
    latestContentRef,
    lastSavedContentRef,
    currentCanvasIdRef,
    initializedCanvasIdRef,
    previewVersionRef,
    setPreviewVersion,
    setShowVersionDiff,
    setShowVersionHistory,
  });
  const { copyingVersionId, handleMakeCopyVersion } = useCanvasVersionCopy({
    canvas: selectedCanvas,
    onCreated: handleVersionCopyCreated,
  });

  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);

  const performSave = useCallback(
    (blocks: PartialBlock[], canvas: Canvas | null, _html?: string): void => {
      // Prevent concurrent saves, but queue the latest state
      if (isSavingRef.current) {
        hasPendingSaveRef.current = true;
        return;
      }

      // Always read the latest title from ref to prevent stale state
      const titleToSave = titleRef.current;

      try {
        setIsSaving(true);

        if (canvas) {
          z.mutate(
            mutators.canvas.update({
              id: canvas.id,
              title: titleToSave,
              content: blocks as ReadonlyJSONValue,
              timestamp: Date.now(),
            }),
          );

          // Update saved state tracker
          lastSavedContentRef.current = JSON.stringify(blocks);

          // Mention notifications are now event-based (on @ selection), not on save
        }
      } catch {
        toast.error('Error', {
          description: 'Failed to save canvas. Please check your connection and try again.',
        });
      } finally {
        setIsSaving(false);

        // If changes occurred while saving, save again immediately
        if (hasPendingSaveRef.current && latestContentRef.current) {
          hasPendingSaveRef.current = false;
          void performSave(latestContentRef.current, selectedCanvasRef.current);
        }
      }
    },
    [canvasId, z],
  );

  const getDefaultVersionCanvas = useCallback(() => selectedCanvasRef.current, []);
  const saveCanvasVersion = useCanvasVersionSave<Canvas>({
    canEditRef,
    getDefaultCanvas: getDefaultVersionCanvas,
  });

  const handleSave = useCallback(
    (blocks: PartialBlock[], html?: string): void => {
      void performSave(blocks, selectedCanvas, html);
    },
    [performSave, selectedCanvas],
  );

  const handleTitleSave = useCallback((): void => {
    if (!selectedCanvas?.id || !canEdit || currentTitle === selectedCanvas.title) return;

    z.mutate(
      mutators.canvas.update({
        id: selectedCanvas.id,
        title: titleRef.current,
        timestamp: Date.now(),
      }),
    );
  }, [canEdit, currentTitle, selectedCanvas, z]);

  const persistCanvasExitContent = useCallback(
    (content: PartialBlock[], canvasToSave: Canvas): void => {
      void performSave(content, canvasToSave, latestHtmlRef.current);
    },
    [performSave],
  );
  const saveCanvasExitSnapshot = useCanvasExitSnapshot<Canvas, PartialBlock[]>({
    canvasRef: selectedCanvasRef,
    previewVersionRef,
    latestContentRef,
    editorRef,
    lastSavedContentRef,
    currentCanvasIdRef,
    pendingSnapshotsRef: pendingAutoVersionSnapshotsRef,
    persistCanvasContent: persistCanvasExitContent,
    saveCanvasVersion,
  });

  saveCanvasExitSnapshotRef.current = saveCanvasExitSnapshot;

  const handleContentChange = (blocks: PartialBlock[], html?: string): void => {
    // Immediately update ref for unmount safety
    latestContentRef.current = blocks;
    if (html) latestHtmlRef.current = html;
    setCurrentContent(blocks);

    void handleSave(blocks, html);
  };

  const handleCollaborativeContentChange = useCallback((blocks: PartialBlock[]): void => {
    latestContentRef.current = blocks;
  }, []);

  useEffect(() => {
    return (): void => {
      saveCanvasExitSnapshotRef.current?.();
    };
  }, [selectedCanvas?.id]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const contentElement = canvasContentRef.current;
      const target = event.target;

      if (!contentElement || !(target instanceof Node)) return;
      if (contentElement.contains(target)) return;

      saveCanvasExitSnapshotRef.current?.();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return (): void => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  const handlePreviewVersion = useCallback((version: CanvasVersionRecord): void => {
    if (!previewVersionRef.current) {
      const currentBlocks = editorRef.current?.getBlocks();
      if (currentBlocks) {
        latestContentRef.current = currentBlocks;
      }
    }
    previewVersionRef.current = version;
    setPreviewVersion(version);
    setShowVersionDiff(false);
  }, []);

  const handleBackToCurrentVersion = useCallback((): void => {
    previewVersionRef.current = null;
    setPreviewVersion(null);
    setShowVersionDiff(false);
  }, []);

  const handleRestoreVersion = useCanvasVersionRestore<Canvas, PartialBlock[], CanvasVersionRecord>(
    {
      canEdit,
      userId: user?.id,
      setRestoringVersionId,
      previewVersionRef,
      setPreviewVersion,
      setShowVersionDiff,
      setCurrentContent,
      latestContentRef,
      lastSavedContentRef,
      setCanvas: setSelectedCanvas,
      editorRef,
    },
  );

  const handleLeaveCanvas = useCallback((): void => {
    saveCanvasExitSnapshot();
    handleBack();
  }, [handleBack, saveCanvasExitSnapshot]);

  // Check if this is a knowledge canvas
  const isKnowledgeCanvas =
    selectedCanvas?.metadata &&
    (selectedCanvas.metadata as KnowledgeCanvasMetadata).source === 'workflow_knowledge';

  // Handle knowledge approval
  const handleApproveKnowledge = async (): Promise<void> => {
    if (!selectedCanvas?.id || isApproving || isApproved) return;

    setIsApproving(true);
    try {
      const result = await approveKnowledgeCanvas(selectedCanvas.id);

      if (result.success) {
        setIsApproved(true);
        toast.success(result.alreadyApproved ? 'Already Approved' : 'Success', {
          description: result.alreadyApproved
            ? 'This knowledge has already been approved to the knowledge base.'
            : 'Knowledge has been approved and added to the knowledge base.',
        });
      } else {
        toast.error('Error', {
          description: 'Failed to approve knowledge. Please try again.',
        });
      }
    } catch {
      toast.error('Error', {
        description: 'Failed to approve knowledge. Please try again.',
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!selectedCanvas?.id) {
        toast.error('Upload Failed', {
          description: 'Canvas not ready. Please try again.',
        });
        return '';
      }
      return await canvasService.uploadCanvasFile(selectedCanvas.id, file);
    },
    [selectedCanvas?.id],
  );

  const handleCollaboratorsChange = useCallback((newCollaborators: CollaboratorInfo[]) => {
    setCollaborators(newCollaborators);
  }, []);

  const handleMentionInsert = useCallback(
    (params: { type: 'user' | 'group'; id: string; blockId: string }) => {
      const canvas = selectedCanvasRef.current;
      if (!canvas?.id) return;
      const title = titleRef.current;
      // Construct Slack URL using generic redirect route - CanvasRedirectPage will handle redirect
      const path = params.blockId
        ? `redirected?type=canvas&canvasId=${encodeURIComponent(canvas.id)}&blockId=${encodeURIComponent(params.blockId)}`
        : `redirected?type=canvas&canvasId=${encodeURIComponent(canvas.id)}`;
      const slackUrl = `${window.location.origin}/launch?path=${encodeURIComponent(path)}`;
      apiInstance
        .post(`/canvas/${canvas.id}/mentions`, {
          mentionType: params.type,
          mentionId: params.id,
          blockId: params.blockId,
          canvasTitle: title,
          slackUrl,
        })
        .catch(error => {
          logger.error(Event.API_CALL_FAILED, {
            reason: error,
            context: 'canvas_mention',
          });
        });
    },
    [],
  );

  const allUsers = useUsers();
  const collaboratorUserIds = [
    user?.id,
    ...collaborators.map(c => c.id).filter(id => id !== user?.id),
  ].filter((id): id is string => !!id);

  const trayParticipants: ParticipantItem[] = collaboratorUserIds.map(userId => {
    const collaborator = collaborators.find(c => c.id === userId);
    const userData = allUsers.find(u => u.id === userId);
    const isCurrentUser = userId === user?.id;

    const displayName = userData?.name || (isCurrentUser ? user?.name : undefined) || 'Unknown';
    const displayEmail = userData?.email || (isCurrentUser ? user?.email : undefined);

    return {
      id: userId,
      userId,
      user: {
        name: displayName,
        ...(displayEmail && { email: displayEmail }),
      },
      color: collaborator?.color || generateUserColor(userId),
    };
  });

  // Participants from database (canvas_participants table) for the participants tray
  const dbParticipants: ParticipantItem[] = (canvasParticipants || [])
    .filter((participant): participant is CanvasParticipant & { userId: string } =>
      Boolean(participant.userId),
    )
    .map(p => ({
      id: p.id,
      userId: p.userId,
      role: p.role,
    }));

  // Check if current user is the owner
  const isCanvasOwner =
    selectedCanvas?.createdBy === user?.id ||
    dbParticipants.some(p => p.userId === user?.id && p.role === CanvasRole.OWNER);
  const currentContentForVersionCompare =
    latestContentRef.current || currentContent || selectedCanvas?.content || [];
  const displayedContent = previewVersion
    ? (normalizeCanvasContent(previewVersion.content) as PartialBlock[])
    : currentContent || selectedCanvas?.content || [];
  const isPreviewSameAsCurrent = previewVersion
    ? stableStringifyCanvasContent(previewVersion.content) ===
      stableStringifyCanvasContent(currentContentForVersionCompare)
    : false;
  const versionDiffParts = previewVersion
    ? createCanvasContentTextDiff(currentContentForVersionCompare, previewVersion.content)
    : [];
  const hasVersionDiff = versionDiffParts.some(isVisibleCanvasContentDiffPart);
  const previewUpdatedAtText = previewVersion
    ? new Date(previewVersion.updatedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  // Handle Ask AI - Open XyneAI with canvas context using canvas id
  const handleAskAI = (): void => {
    const canvasIdForAI = selectedCanvas?.id;
    if (!canvasIdForAI) return;

    // Create canvas info for context
    const canvasInfo: CanvasInfo = {
      canvasId: canvasIdForAI,
      title: currentTitle,
    };

    // Open XyneAI with canvas context
    xyneAIActor.send({
      type: 'OPEN',
      canvasInfo,
    });
  };

  const handleExportMarkdown = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        const result = await editorRef.current?.exportMarkdown(titleRef.current || currentTitle);
        if (result?.saved) {
          if (result.filePath) {
            toast.success('Markdown saved successfully', {
              description: `Saved to ${getDirectoryFromPath(result.filePath)}`,
            });
          } else {
            toast.success('Markdown download started');
          }
        }
      } catch (err) {
        toast.error('Failed to export canvas as Markdown');
        logger.error(Event.CANVAS_MENTION_DEBUG, {
          message: 'Canvas markdown export failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [currentTitle]);

  const handleExportPdf = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        const result = await editorRef.current?.exportPDF(titleRef.current || currentTitle);
        if (result?.saved) {
          if (result.filePath) {
            toast.success('PDF saved successfully', {
              description: `Saved to ${getDirectoryFromPath(result.filePath)}`,
            });
          } else {
            toast.success('PDF export started');
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to export canvas as PDF');
        logger.error(Event.CANVAS_MENTION_DEBUG, {
          message: 'Canvas PDF export failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [currentTitle]);

  return (
    <div className='relative h-full bg-muted flex' data-component='CanvasScreen'>
      {/* Main Content Area */}
      <main className='flex-1 overflow-hidden flex flex-col'>
        {isCreating || selectedCanvas ? (
          <>
            {/* Canvas Header */}
            <div
              className={`bg-background border-b border-border p-2 md:p-4 flex justify-between items-center gap-1 md:gap-2 sticky top-0 ${baseRoute === '/chat/activity' ? 'md:border-b-0' : ''}`}
              data-testid='canvas-header'
            >
              <div className='flex items-start gap-1 md:gap-2 flex-1 min-w-0'>
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={handleLeaveCanvas}
                  aria-label='Go back'
                  data-track-category='CANVAS'
                  data-track-name='Go_Back_From_Canvas'
                  data-track-metadata={JSON.stringify({ canvasId: selectedCanvas?.id })}
                >
                  <ArrowLeft size={16} />
                </Button>

                <div className='flex min-w-0 flex-1 flex-col'>
                  <Input
                    type='text'
                    aria-label='Canvas title'
                    value={currentTitle}
                    data-testid='canvas-title-input'
                    onChange={e => {
                      const newTitle = e.target.value;
                      setCurrentTitle(newTitle);
                      titleRef.current = newTitle;
                    }}
                    readOnly={!canEdit}
                    onBlur={() => {
                      handleTitleSave();
                    }}
                    className={`text-base md:text-xl font-bold flex-1 border-none shadow-none focus:ring-0 focus-visible:ring-0 focus-visible:border-none px-0 py-0 h-auto ${!canEdit ? 'cursor-default' : ''}`}
                    placeholder='Untitled Canvas'
                  />
                  {lastUpdatedText && (
                    <div className='mt-1 truncate text-[11px] text-muted-foreground md:text-xs'>
                      {lastUpdatedText}
                    </div>
                  )}
                </div>
              </div>

              <div className='flex items-center justify-end gap-1 shrink-0'>
                <div className='text-xs md:text-sm text-muted-foreground whitespace-nowrap hidden md:block'>
                  {isSaving ? 'Saving...' : 'Saved'}
                </div>

                {/* Slideshow Presentation Toolbar - Hidden on mobile */}
                <div className='ml-2 pl-4 border-l border-border hidden md:block'>
                  <PresentToolbar
                    selectedTheme={selectedTheme}
                    onThemeChange={e => {
                      setSelectedTheme(e.target.value);
                      editorRef.current?.handleThemeChange(e);
                    }}
                    onPresent={() => {
                      editorRef.current?.handlePresent();
                    }}
                    height={32}
                  />
                </div>

                {/* Approve to Knowledge Base Button (Only for Knowledge Canvases) */}
                {isKnowledgeCanvas && selectedCanvas?.id && (
                  <div className='ml-2'>
                    {isApproved ? (
                      <Button variant='secondary' size='sm' disabled>
                        <CheckCircle size={16} className='text-green-600' />
                        Approved
                      </Button>
                    ) : (
                      <Button
                        variant='default'
                        size='sm'
                        onClick={() => void handleApproveKnowledge()}
                        disabled={isApproving}
                        data-track-category='CANVAS'
                        data-track-name='APPROVE_KNOWLEDGE'
                        data-track-metadata={JSON.stringify({ canvasId: selectedCanvas?.id })}
                      >
                        {isApproving ? (
                          <Loader2 size={16} className='animate-spin' />
                        ) : (
                          <CheckCircle size={16} />
                        )}
                        {isApproving ? 'Approving...' : 'Approve to Knowledge Base'}
                      </Button>
                    )}
                  </div>
                )}

                {selectedCanvas?.id && (
                  <div className='flex items-center gap-3 ml-2'>
                    <Button
                      variant='secondary'
                      size='sm'
                      onClick={() => setShowVersionHistory(true)}
                      title='Version history'
                      data-track-category='CANVAS'
                      data-track-name='Open_Version_History'
                      data-track-metadata={JSON.stringify({ canvasId: selectedCanvas.id })}
                    >
                      <History size={16} />
                      <span className='hidden lg:inline'>History</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='secondary'
                          size='sm'
                          title='Export canvas'
                          data-testid='canvas-export-button'
                          data-track-category='CANVAS'
                          data-track-name='Open_Export_Menu'
                          data-track-metadata={JSON.stringify({ canvasId: selectedCanvas.id })}
                        >
                          <Download size={16} />
                          <span className='hidden lg:inline'>Export</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-52'>
                        <DropdownMenuItem
                          onClick={handleExportMarkdown}
                          data-testid='canvas-export-markdown'
                        >
                          <FileText size={16} className='mr-2' />
                          Export as Markdown
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleExportPdf} data-testid='canvas-export-pdf'>
                          <FileDown size={16} className='mr-2' />
                          Export as PDF
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Fullscreen Toggle Button - Hidden on mobile */}
                    {onToggleFullscreen && (
                      <Button
                        variant='secondary'
                        size='sm'
                        onClick={onToggleFullscreen}
                        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        className='hidden md:inline-flex'
                        data-track-category='CANVAS'
                        data-track-name={isFullscreen ? 'Exit_Fullscreen' : 'Enter_Fullscreen'}
                        data-track-metadata={JSON.stringify({ canvasId: selectedCanvas?.id })}
                      >
                        {isFullscreen ? (
                          <>
                            <Minimize2 size={16} />
                          </>
                        ) : (
                          <>
                            <Maximize2 size={16} />
                          </>
                        )}
                      </Button>
                    )}
                    {/* Participants/Collaborators button */}
                    <button
                      onClick={() => setShowParticipantsTray(true)}
                      className='inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3'
                      aria-label={
                        selectedCanvas.isCollaborative ? 'View collaborators' : 'View participants'
                      }
                      data-track-category='CANVAS'
                      data-track-name='SHOW_PARTICIPANTS_TRAY'
                      data-track-metadata={JSON.stringify({
                        canvasId: selectedCanvas.id,
                        isCollaborative: selectedCanvas.isCollaborative,
                      })}
                    >
                      <AvatarGroup
                        userIds={
                          selectedCanvas.isCollaborative
                            ? collaboratorUserIds
                            : dbParticipants.map(p => p.userId)
                        }
                        size='sm'
                        count={3}
                      />
                      {selectedCanvas.isCollaborative && (
                        <span className='text-xs text-green-600'>Live</span>
                      )}
                    </button>
                    {/* Ask AI Button */}
                    {selectedCanvas.id && (
                      <Button variant='secondary' size='sm' onClick={handleAskAI} title='Ask AI'>
                        <img
                          alt='AI'
                          width='16'
                          height='16'
                          src='/svgs/icons/ai-bot-gradient-star.svg'
                        />
                      </Button>
                    )}
                    <Button
                      variant='default'
                      size='sm'
                      onClick={() => setShowShareModal(true)}
                      data-testid='canvas-share-button'
                      data-track-category='CANVAS'
                      data-track-name='Open_Share_Modal'
                      data-track-metadata={JSON.stringify({ canvasId: selectedCanvas.id })}
                    >
                      Share
                    </Button>
                  </div>
                )}

                {(isEditingMessage || isCreatingMessage) && (
                  <div className='ml-4 border-l border-border pl-4'>
                    <Button
                      variant='default'
                      size='sm'
                      onClick={() => void handleDone()}
                      data-track-category='CANVAS'
                      data-track-name='Done_Editing_Canvas'
                      data-track-metadata={JSON.stringify({ canvasId: selectedCanvas?.id })}
                    >
                      Done
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {baseRoute === '/chat/activity' && (
              <div className='hidden h-[27px] shrink-0 border-b border-border bg-background md:block' />
            )}

            {previewVersion && (
              <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm md:px-4'>
                <div className='min-w-0 text-muted-foreground'>
                  Viewing version from{' '}
                  <span className='font-medium text-foreground'>{previewUpdatedAtText}</span>
                </div>
                <div className='flex items-center gap-2'>
                  <Button variant='secondary' size='sm' onClick={handleBackToCurrentVersion}>
                    Back to current
                  </Button>
                  {hasVersionDiff && (
                    <Button
                      variant={showVersionDiff ? 'default' : 'secondary'}
                      size='sm'
                      onClick={() => setShowVersionDiff(prev => !prev)}
                      aria-pressed={showVersionDiff}
                    >
                      <GitCompare size={14} />
                      Diff
                    </Button>
                  )}
                  {canEdit && !isPreviewSameAsCurrent && (
                    <Button
                      variant='default'
                      size='sm'
                      onClick={() => void handleRestoreVersion(previewVersion)}
                      loading={restoringVersionId === previewVersion.id}
                    >
                      <RotateCcw size={14} />
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            )}

            {previewVersion && showVersionDiff && hasVersionDiff && (
              <CanvasVersionDiffPanel parts={versionDiffParts} />
            )}

            {/* Canvas Editor */}
            <div ref={canvasContentRef} className='flex-1 overflow-hidden'>
              {isCreating && !selectedCanvas ? (
                <div className='flex items-center justify-center h-full'>
                  <div className='flex flex-col items-center gap-3'>
                    <Loader2 className='w-8 h-8 animate-spin text-blue-600' />
                    <span className='text-sm text-muted-foreground'>Creating canvas...</span>
                  </div>
                </div>
              ) : previewVersion ? (
                <CanvasEditor
                  key={`preview-${previewVersion.id}`}
                  ref={editorRef}
                  content={displayedContent}
                  editable={false}
                  placeholder='Start writing your canvas...'
                  channelId={selectedCanvas?.channelId || state?.channelId}
                  canvasId={selectedCanvas?.id}
                  canvasTitle={currentTitle}
                  initialBlockIdToFocus={blockIdFromUrl}
                  canvasParticipants={canvasParticipants}
                  canvasCreatedBy={selectedCanvas?.createdBy}
                  currentUserRole={selectedCanvas?.accessLevel ?? null}
                />
              ) : selectedCanvas?.id &&
                selectedCanvas.isCollaborative &&
                !isEditingMessage &&
                !isCreatingMessage ? (
                <CollaborativeCanvasEditor
                  key={selectedCanvas.id}
                  ref={editorRef}
                  canvasId={selectedCanvas.id}
                  channelId={selectedCanvas.channelId || state?.channelId}
                  title={currentTitle}
                  editable={canEdit}
                  placeholder='Start writing your canvas...'
                  onFileUpload={handleFileUpload}
                  onChange={handleCollaborativeContentChange}
                  onCollaboratorsChange={handleCollaboratorsChange}
                  initialLegacyContent={selectedCanvas.content}
                  initialBlockIdToFocus={blockIdFromUrl}
                  autoFocus={!skipAutoFocus}
                  canvasParticipants={canvasParticipants}
                  canvasCreatedBy={selectedCanvas.createdBy}
                  currentUserRole={selectedCanvas.accessLevel ?? null}
                />
              ) : (
                <CanvasEditor
                  key={selectedCanvas?.id || canvasId || 'new-canvas'}
                  ref={editorRef}
                  content={displayedContent}
                  onChange={handleContentChange}
                  onSave={handleSave}
                  onFileUpload={handleFileUpload}
                  editable={canEdit}
                  placeholder='Start writing your canvas...'
                  channelId={selectedCanvas?.channelId || state?.channelId}
                  canvasId={selectedCanvas?.id}
                  canvasTitle={currentTitle}
                  onMentionInsert={handleMentionInsert}
                  initialBlockIdToFocus={blockIdFromUrl}
                  autoFocus={!skipAutoFocus}
                  canvasParticipants={canvasParticipants}
                  canvasCreatedBy={selectedCanvas?.createdBy}
                  currentUserRole={selectedCanvas?.accessLevel ?? null}
                />
              )}
            </div>
          </>
        ) : !canvasId ? (
          <div className='flex-1 overflow-hidden flex flex-col bg-background'>
            <div
              className='p-4 border-b border-border flex justify-between items-center bg-background'
              data-testid='canvas-list-header'
            >
              <h3 className='text-lg font-semibold text-foreground'>All Canvases</h3>
              <Button
                variant='default'
                size='sm'
                onClick={handleCreateCanvas}
                data-track-category='CANVAS'
                data-track-name='Create_Canvas'
              >
                New Canvas
              </Button>
            </div>
            <CanvasList
              onSelect={(e, c) => {
                if (!navigator.onLine) {
                  toast.info('Canvas Unavailable', {
                    description:
                      'Canvases are available online only. Please check your connection.',
                  });
                  return;
                }
                const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);
                // Navigate based on current route context
                const canvasRoute = isOnChatCanvasPage
                  ? `/chat/canvas/${c.id}`
                  : `${baseRoute}/canvas/${c.id}`;

                // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
                if (!isMobile && isCmdClick) {
                  window.open(canvasRoute, '_blank');
                } else {
                  void navigate(canvasRoute);
                }
              }}
              currentUserId={user?.id}
              onDelete={id => {
                const deleteCanvas = (): void => {
                  try {
                    z.mutate(mutators.canvas.delete({ id }));
                  } catch {
                    toast.error('Error', {
                      description: 'Failed to delete canvas. Please try again.',
                    });
                  }
                };
                void deleteCanvas();
              }}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              paginated={true}
            />
          </div>
        ) : (
          <div
            className='h-full w-full flex items-center justify-center bg-muted'
            data-testid='canvas-screen-not-found'
          >
            <div className='text-center max-w-md mx-auto flex flex-col items-center'>
              <div className='text-muted-foreground'>
                <DocumentNotFoundIcon color='currentColor' size={64} />
              </div>
              <h3 className='text-xl font-semibold text-foreground mb-2'>Canvas Not Found</h3>
              <p className='text-muted-foreground mb-6'>
                The canvas you are looking for does not exist or you do not have permission to view
                it.
              </p>
              <div className='flex justify-center w-full gap-3'>
                <Button
                  variant='secondary'
                  size='default'
                  onClick={() => void navigate(-1)}
                  data-track-category='CANVAS'
                  data-track-name='Go_Back_Not_Found'
                  data-track-metadata={JSON.stringify({ canvasId })}
                >
                  <ArrowLeft size={16} />
                  Back
                </Button>
                <Button
                  variant='default'
                  size='default'
                  onClick={() => {
                    // Navigate based on current route context
                    const canvasRoute = isOnChatCanvasPage ? '/chat/canvas' : `${baseRoute}/canvas`;
                    void navigate(canvasRoute);
                  }}
                  data-track-category='CANVAS'
                  data-track-name='Go_To_Canvases'
                  data-track-metadata={JSON.stringify({ canvasId })}
                >
                  Go to Canvases
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
      <CanvasVersionHistory
        canvasId={selectedCanvas?.id}
        open={showVersionHistory}
        activeVersionId={previewVersion?.id}
        canRestore={Boolean(canEdit)}
        restoringVersionId={restoringVersionId}
        renamingVersionId={renamingVersionId}
        copyingVersionId={copyingVersionId}
        onClose={() => setShowVersionHistory(false)}
        onPreview={handlePreviewVersion}
        onRestore={version => void handleRestoreVersion(version)}
        onRename={handleRenameVersion}
        onMakeCopy={version => void handleMakeCopyVersion(version)}
      />
      <Dialog open={showSendConfirmation} onOpenChange={setShowSendConfirmation}>
        <div className='p-6'>
          <h2 className='text-lg font-semibold mb-2'>Send to Channel?</h2>
          <p className='text-muted-foreground mb-6'>
            Do you want to send this canvas link to the channel?
          </p>
          <div className='flex justify-end gap-3'>
            <Button
              variant='secondary'
              onClick={() => setShowSendConfirmation(false)}
              data-track-category='CANVAS'
              data-track-name='Cancel_Send_To_Channel'
              data-track-metadata={JSON.stringify({ canvasId: selectedCanvas?.id })}
            >
              Cancel
            </Button>
            <Button
              variant='default'
              onClick={() => void handleConfirmSend()}
              data-track-category='CANVAS'
              data-track-name='Confirm_Send_To_Channel'
              data-track-metadata={JSON.stringify({ canvasId: selectedCanvas?.id })}
            >
              Send
            </Button>
          </div>
        </div>
      </Dialog>

      {showShareModal && selectedCanvas && (
        <Dialog
          open={showShareModal}
          onOpenChange={open => !open && setShowShareModal(false)}
          title='Share Canvas'
        >
          <CanvasShareModal
            key={selectedCanvas.id}
            canvas={selectedCanvas}
            isOwner={
              selectedCanvas.createdBy === user?.id ||
              selectedCanvas.accessLevel === CanvasRole.OWNER
            }
            isEditor={selectedCanvas.accessLevel === CanvasRole.EDITOR}
            participants={canvasParticipants}
            {...(selectedCanvas.channelId && { channelId: selectedCanvas.channelId })}
          />
        </Dialog>
      )}

      <Dialog
        open={showParticipantsTray}
        onOpenChange={open => !open && setShowParticipantsTray(false)}
        title={selectedCanvas?.isCollaborative ? 'Active Collaborators' : 'Canvas Participants'}
      >
        <CanvasParticipantsTray
          title={selectedCanvas?.isCollaborative ? 'Active Collaborators' : 'Canvas Participants'}
          onClose={() => setShowParticipantsTray(false)}
          participants={selectedCanvas?.isCollaborative ? trayParticipants : dbParticipants}
          showRole={!selectedCanvas?.isCollaborative}
          showColor={selectedCanvas?.isCollaborative ?? false}
          canvasId={selectedCanvas?.id ?? undefined}
          isCollaborative={selectedCanvas?.isCollaborative ?? false}
          isOwner={isCanvasOwner}
        />
      </Dialog>
    </div>
  );
};

CanvasScreen.displayName = 'CanvasScreen';

export default CanvasScreen;
