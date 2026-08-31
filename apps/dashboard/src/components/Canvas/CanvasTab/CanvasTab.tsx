import { ReactElement, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';
import { CollaborativeCanvasEditor } from '../CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { CanvasEditor } from '../CanvasEditor/CanvasEditor';
import type { PartialBlock } from '@blocknote/core';
import type {
  Canvas,
  CanvasEditorRef,
  CollaborativeCanvasEditorRef,
  CanvasFolder,
  CanvasParticipant,
} from '../Canvas.types';
import { useAuth } from '../../../hooks/useAuth';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { canvasService } from '../../../services/Canvas/canvasService';
import { toast } from 'sonner';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import Input from '../../ui/Input';
import { ChannelCanvasList } from '../ChannelCanvasList';
import { CanvasShareModal } from '../CanvasShareModal';
import {
  CanvasVersionDiffPanel,
  CanvasVersionHistory,
  type CanvasVersionRecord,
} from '../CanvasVersionHistory';
import { isBaselineCanvasType, CanvasRole, CanvasVisibility } from '@xyne/shared';
import {
  AudioLines,
  ArrowLeft,
  Archive,
  Folder,
  FolderPlus,
  GitCompare,
  History,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Star,
} from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { v4 as uuidv4 } from 'uuid';
import { queries } from '../../../zero/queries';
import { ReadonlyJSONObject } from '@rocicorp/zero';
import { PresentToolbar } from 'blocknote-layout-extensions';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useChannel } from '../../../hooks/useChannels';
import { useCurrentUserGroupIds } from '../../../hooks/useUserGroup';
import {
  filterExcludedCallGeneratedCanvases,
  filterExcludedRecordingGeneratedCanvases,
  getRecordingCanvasCallId,
  isExcludedRecordingGeneratedCanvas,
} from '../canvasFilters';
import { usePersistedCanvasPreferences } from '../../../hooks/usePersistedCanvasPreferences';
import { Switch } from '@/components/ui/Switch';
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
import { useNavigate } from '../../../hooks/useWorkspaceNavigate';
import { useCanvasArchiveToggle } from '../useCanvasArchiveToggle';

interface CanvasTabProps {
  channelId: string;
}

function isCanvasArray(value: unknown): value is Canvas[] {
  return Array.isArray(value);
}

function nextChannelFolderName(channelId: string, folders: CanvasFolder[]): string {
  const prefix = 'Untitled folder';
  const usedNumbers = new Set<number>();

  for (const folder of folders) {
    if (folder.channelId !== channelId) continue;
    const match = folder.name.match(/^Untitled folder (\d+)$/i);
    if (match?.[1]) usedNumbers.add(Number(match[1]));
  }

  let next = 1;
  while (usedNumbers.has(next)) next++;
  return `${prefix} ${next}`;
}

const getCanvasRolePriority = (role?: CanvasRole | null): number => {
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

const getStrongestCanvasRole = (
  roles: Array<CanvasRole | null | undefined>,
): CanvasRole | undefined =>
  roles.reduce<CanvasRole | undefined>((strongestRole, role) => {
    if (!role) return strongestRole;
    return getCanvasRolePriority(role) > getCanvasRolePriority(strongestRole)
      ? role
      : strongestRole;
  }, undefined);

const CanvasTab: React.FC<CanvasTabProps> = ({ channelId }): ReactElement => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();
  const z = useZero();
  const { filter: activeFilter, setFilter: setActiveFilter } = usePersistedCanvasPreferences();
  const [excludeCallGeneratedCanvases, setExcludeCallGeneratedCanvases] = useState(true);
  const [onlyRecordingGeneratedCanvases, setOnlyRecordingGeneratedCanvases] = useState(false);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [onlyArchivedCanvases, setOnlyArchivedCanvases] = useState(false);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const channel = useChannel(channelId);
  const currentUserGroupIds = useCurrentUserGroupIds();
  const [adminParticipations] = useCachedQuery(queries.myChannelParticipations({}));
  const isChannelAdmin = useMemo(
    () => (adminParticipations ?? []).some(participant => participant.channelId === channelId),
    [adminParticipations, channelId],
  );
  const [canvasList, canvasListDetails] = useCachedQuery(
    queries.hierarchyCanvases({
      scope: 'channel',
      channelId,
      onlyArchived: onlyArchivedCanvases,
    }),
    { enabled: view === 'list' },
  );
  const [zeroFolders] = useCachedQuery(
    queries.channelCanvasFolders({
      channelId,
    }),
  );
  const canvasItems = useMemo<Canvas[]>(
    () => (isCanvasArray(canvasList) ? canvasList : []),
    [canvasList],
  );
  const canvases = useMemo(
    () =>
      onlyRecordingGeneratedCanvases
        ? canvasItems.filter(isExcludedRecordingGeneratedCanvas)
        : filterExcludedRecordingGeneratedCanvases(
            filterExcludedCallGeneratedCanvases(canvasItems, excludeCallGeneratedCanvases),
            true,
          ),
    [canvasItems, excludeCallGeneratedCanvases, onlyRecordingGeneratedCanvases],
  );
  const folders = useMemo(() => (zeroFolders as CanvasFolder[] | undefined) ?? [], [zeroFolders]);
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [openCommentCount, setOpenCommentCount] = useState(0);
  useEffect(() => {
    setOpenCommentCount(0);
  }, [canvas?.id]);
  const [currentTitle, setCurrentTitle] = useState('Untitled Canvas');
  const titleRef = useRef('Untitled Canvas'); // Track title synchronously to avoid race conditions
  const [currentContent, setCurrentContent] = useState<PartialBlock[] | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const currentCanvasIdRef = useRef<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<CanvasVersionRecord | null>(null);
  const [showVersionDiff, setShowVersionDiff] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | undefined>(undefined);
  const [renamingVersionId, setRenamingVersionId] = useState<string | undefined>(undefined);
  const latestContentRef = useRef<PartialBlock[] | undefined>(undefined);
  const lastSavedContentRef = useRef('');
  const canvasRef = useRef<Canvas | null>(null);
  const canEditRef = useRef(false);
  const previewVersionRef = useRef<CanvasVersionRecord | null>(null);
  const pendingAutoVersionSnapshotsRef = useRef<Set<string>>(new Set());
  const saveCanvasExitSnapshotRef = useRef<(() => void) | null>(null);

  // Ref to CanvasEditor for presentation functionality
  const editorRef = useRef<CanvasEditorRef | CollaborativeCanvasEditorRef | null>(null);
  const canvasContentRef = useRef<HTMLDivElement | null>(null);
  const [selectedTheme, setSelectedTheme] = useState('white');

  const resolveCanvasAccessLevel = useCallback(
    (targetCanvas: Canvas | null | undefined): CanvasRole | undefined => {
      if (!targetCanvas) return undefined;

      const participants =
        (targetCanvas as Canvas & { participants?: CanvasParticipant[] }).participants ?? [];
      if (isChannelAdmin && isBaselineCanvasType(targetCanvas.sdlcArtifact?.artifactType)) {
        return CanvasRole.EDITOR;
      }
      const inheritedRoles = participants
        .filter(
          participant =>
            participant.userId === user?.id ||
            (!!participant.userGroupId && currentUserGroupIds.has(participant.userGroupId)) ||
            participant.channelId === channelId,
        )
        .map(participant => participant.role);

      return getStrongestCanvasRole([targetCanvas.accessLevel, ...inheritedRoles]);
    },
    [channelId, currentUserGroupIds, isChannelAdmin, user?.id],
  );

  // Reset state when channelId changes
  useEffect(() => {
    setCanvas(null);
    setCurrentTitle('Untitled Canvas');
    setCurrentContent(undefined);
    setView('list');
    setShowShareModal(false);
    setIsCreatingCanvas(false);
    setShowCreateFolderDialog(false);
    setNewFolderName('');
    setIsCreatingFolder(false);
    setShowVersionHistory(false);
    setPreviewVersion(null);
    setShowVersionDiff(false);
    setRenamingVersionId(undefined);
    latestContentRef.current = undefined;
    lastSavedContentRef.current = '';
    currentCanvasIdRef.current = null;
  }, [channelId]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!canvas?.id) {
        toast.error('Upload Failed', {
          description: 'Canvas not ready. Please try again.',
        });
        return '';
      }
      return await canvasService.uploadCanvasFile(canvas.id, file);
    },
    [canvas?.id],
  );

  const effectiveAccessLevel = resolveCanvasAccessLevel(canvas);
  const canEdit =
    !canvas?.isArchived &&
    (canvas?.createdBy === user?.id ||
      effectiveAccessLevel === CanvasRole.EDITOR ||
      effectiveAccessLevel === CanvasRole.OWNER);
  const canArchiveCanvas = canvas?.createdBy === user?.id;
  const handleRenameVersion = useCanvasVersionRename({
    canEdit,
    previewVersionRef,
    setPreviewVersion,
    setRenamingVersionId,
  });

  useEffect(() => {
    canvasRef.current = canvas;
    canEditRef.current = canEdit;
    previewVersionRef.current = previewVersion;
  }, [canvas, canEdit, previewVersion]);

  const isCanvasOwner = canvas?.createdBy === user?.id || effectiveAccessLevel === CanvasRole.OWNER;
  const isChannelArchived = !!channel?.isArchived;
  const recordingCallId = canvas ? getRecordingCanvasCallId(canvas) : null;

  const handleOpenRecordingNotes = useCallback((): void => {
    if (!recordingCallId) return;

    void navigate(`/recordings/${encodeURIComponent(recordingCallId)}?tab=notes`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  }, [location.pathname, location.search, navigate, recordingCallId]);

  useEffect(() => {
    previewVersionRef.current = null;
    setPreviewVersion(null);
    setShowVersionDiff(false);
    setRenamingVersionId(undefined);
    setShowVersionHistory(false);
  }, [canvas?.id]);

  const getDefaultVersionCanvas = useCallback(() => canvasRef.current, []);
  const saveCanvasVersion = useCanvasVersionSave<Canvas>({
    canEditRef,
    getDefaultCanvas: getDefaultVersionCanvas,
  });

  const persistCanvasExitContent = useCallback(
    (content: PartialBlock[], canvasToSave: Canvas): void => {
      const sanitizedBlocks = JSON.parse(
        JSON.stringify(content, (_key: string, value: unknown) =>
          value === undefined ? null : value,
        ),
      ) as ReadonlyJSONObject;

      z.mutate(
        mutators.canvas.update({
          id: canvasToSave.id,
          title: titleRef.current,
          content: sanitizedBlocks,
          timestamp: Date.now(),
        }),
      );
      lastSavedContentRef.current = JSON.stringify(content);
    },
    [z],
  );
  const saveCanvasExitSnapshot = useCanvasExitSnapshot<Canvas, PartialBlock[]>({
    canvasRef,
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

  useEffect(() => {
    return (): void => {
      saveCanvasExitSnapshotRef.current?.();
    };
  }, [channelId]);

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

  const getCanvasPath = useCallback(
    (id: string): string =>
      isMobile ? `/chat/canvas/${id}` : `${baseRoute}/${channelId}?tab=canvas&canvasId=${id}`,
    [baseRoute, channelId, isMobile],
  );

  const showArchivedChannelCreateError = useCallback((entity: 'canvas' | 'folder'): void => {
    toast.error(`Cannot create ${entity}`, {
      description: 'This channel is archived.',
    });
  }, []);

  const handleVersionCopyCreated = useCanvasVersionCopyCreatedHandler<
    Canvas,
    PartialBlock[],
    CanvasVersionRecord
  >({
    sourceCanvas: canvas,
    userId: user?.id,
    navigate,
    getCanvasRoute: getCanvasPath,
    getNavigationState: newCanvas =>
      isMobile ? { canvas: newCanvas, previousPath: location.pathname } : { canvas: newCanvas },
    setCanvas,
    canvasRef,
    editorRef,
    setCurrentTitle,
    titleRef,
    setCurrentContent,
    latestContentRef,
    lastSavedContentRef,
    currentCanvasIdRef,
    previewVersionRef,
    setPreviewVersion,
    setShowVersionDiff,
    setShowVersionHistory,
  });
  const { copyingVersionId, handleMakeCopyVersion } = useCanvasVersionCopy({
    canvas,
    isBlocked: isChannelArchived,
    onBlocked: () => showArchivedChannelCreateError('canvas'),
    onCreated: handleVersionCopyCreated,
  });

  const openCreateFolderDialog = useCallback((): void => {
    if (isChannelArchived) {
      showArchivedChannelCreateError('folder');
      return;
    }

    setNewFolderName(nextChannelFolderName(channelId, folders));
    setShowCreateFolderDialog(true);
  }, [channelId, folders, isChannelArchived, showArchivedChannelCreateError]);

  const handleCreateFolder = useCallback((): void => {
    if (isChannelArchived) {
      showArchivedChannelCreateError('folder');
      return;
    }

    const name = newFolderName.trim();
    if (!name) {
      toast.error('Folder name is required');
      return;
    }

    setIsCreatingFolder(true);
    void (async (): Promise<void> => {
      try {
        const result = z.mutate(
          mutators.canvasFolder.create({
            id: uuidv4(),
            channelId,
            name,
            timestamp: Date.now(),
          }),
        );
        const serverResult = await result.server;

        if (serverResult.type === 'error') {
          throw new Error(serverResult.error.message || 'Failed to create folder');
        }

        toast.success('Folder created');
        setShowCreateFolderDialog(false);
        setNewFolderName('');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create folder';
        toast.error(message);
      } finally {
        setIsCreatingFolder(false);
      }
    })();
  }, [channelId, isChannelArchived, newFolderName, showArchivedChannelCreateError, z]);

  const handleCreateCanvas = async (): Promise<void> => {
    if (isChannelArchived) {
      showArchivedChannelCreateError('canvas');
      return;
    }

    setIsCreatingCanvas(true);
    try {
      const newCanvasId = uuidv4();

      await canvasService.createCollaborativeCanvas({
        id: newCanvasId,
        title: 'Untitled Canvas',
        channelId,
      });

      // Optimistic update
      const now = Date.now();
      const newCanvas: Canvas = {
        id: newCanvasId,
        title: 'Untitled Canvas',
        channelId,
        createdBy: user?.id || '',
        visibility: CanvasVisibility.PRIVATE,
        isTemplate: false,
        isArchived: false,
        isCollaborative: true,
        isStarred: false,
        createdAt: now,
        updatedAt: now,
        accessLevel: CanvasRole.OWNER,
      };

      setCanvas(newCanvas);
      setCurrentTitle(newCanvas.title);
      titleRef.current = newCanvas.title;
      setCurrentContent([]);
      latestContentRef.current = [];
      lastSavedContentRef.current = JSON.stringify([]);

      currentCanvasIdRef.current = newCanvasId;
      setSelectedTheme('white');

      const canvasPath = getCanvasPath(newCanvasId);

      // Store the original path for back navigation on mobile
      if (isMobile) {
        void navigate(canvasPath, {
          state: {
            canvas: newCanvas,
            previousPath: location.pathname,
          },
        });
      } else {
        void navigate(canvasPath, {
          state: { canvas: newCanvas },
        });
      }
    } catch {
      toast.error('Error', {
        description: 'Failed to create canvas',
      });
    } finally {
      setIsCreatingCanvas(false);
    }
  };

  const handleCreateCanvasInFolder = async (folder: CanvasFolder): Promise<void> => {
    if (isChannelArchived) {
      showArchivedChannelCreateError('canvas');
      return;
    }

    setIsCreatingCanvas(true);
    try {
      const newCanvasId = uuidv4();

      await canvasService.createCollaborativeCanvas({
        id: newCanvasId,
        title: 'Untitled Canvas',
        channelId,
        folderId: folder.id,
        ...(folder.projectId ? { projectId: folder.projectId } : {}),
      });

      const now = Date.now();
      const newCanvas: Canvas = {
        id: newCanvasId,
        title: 'Untitled Canvas',
        channelId,
        folderId: folder.id,
        ...(folder.projectId ? { projectId: folder.projectId } : {}),
        createdBy: user?.id || '',
        visibility: CanvasVisibility.PRIVATE,
        isTemplate: false,
        isArchived: false,
        isCollaborative: true,
        isStarred: false,
        createdAt: now,
        updatedAt: now,
        accessLevel: CanvasRole.OWNER,
        folder,
      };

      setCanvas(newCanvas);
      setCurrentTitle(newCanvas.title);
      titleRef.current = newCanvas.title;
      setCurrentContent([]);
      latestContentRef.current = [];
      lastSavedContentRef.current = JSON.stringify([]);

      currentCanvasIdRef.current = newCanvasId;
      setSelectedTheme('white');

      const canvasPath = getCanvasPath(newCanvasId);

      if (isMobile) {
        void navigate(canvasPath, {
          state: {
            canvas: newCanvas,
            previousPath: location.pathname,
          },
        });
      } else {
        void navigate(canvasPath, {
          state: { canvas: newCanvas },
        });
      }
    } catch {
      toast.error('Error', {
        description: 'Failed to create canvas',
      });
    } finally {
      setIsCreatingCanvas(false);
    }
  };

  const handleSelectCanvas = (_e: React.MouseEvent | KeyboardEvent, selected: Canvas): void => {
    if (!navigator.onLine) {
      toast.info('Canvas Unavailable', {
        description: 'Canvases are available online only. Please check your connection.',
      });
      return;
    }

    if (canvasRef.current?.id && canvasRef.current.id !== selected.id) {
      saveCanvasExitSnapshot();
    }

    const selectedAccessLevel = resolveCanvasAccessLevel(selected);
    const selectedCanvas = selectedAccessLevel
      ? { ...selected, accessLevel: selectedAccessLevel }
      : selected;

    setCanvas(selectedCanvas);
    setCurrentTitle(selectedCanvas.title);
    titleRef.current = selectedCanvas.title;
    setCurrentContent(selectedCanvas.content);
    latestContentRef.current = selectedCanvas.content;
    lastSavedContentRef.current = JSON.stringify(selectedCanvas.content || []);
    currentCanvasIdRef.current = selectedCanvas.id;

    const canvasPath = getCanvasPath(selectedCanvas.id);

    // Store the original path for back navigation on mobile
    if (isMobile) {
      void navigate(canvasPath, {
        state: {
          previousPath: location.pathname,
        },
      });
    } else {
      void navigate(canvasPath);
    }
  };

  const handleToggleStar = useCallback(
    (selected: Canvas) => {
      try {
        z.mutate(
          mutators.canvasUserStatus.toggleStarred({
            id: uuidv4(),
            canvasId: selected.id,
            timestamp: Date.now(),
          }),
        );
      } catch {
        toast.error('Error', {
          description: 'Failed to update starred canvas. Please try again.',
        });
      }
    },
    [z],
  );

  const handleArchivedStateChange = useCallback((canvasId: string, isArchived: boolean): void => {
    setCanvas(current => (current?.id === canvasId ? { ...current, isArchived } : current));
  }, []);
  const handleArchiveToggleCanvas = useCanvasArchiveToggle({
    onArchivedStateChange: handleArchivedStateChange,
  });

  const handleUnarchiveCurrentCanvas = useCallback((): void => {
    if (!canvas) return;
    handleArchiveToggleCanvas({ ...canvas, isArchived: true });
  }, [canvas, handleArchiveToggleCanvas]);

  const handleContentChange = (blocks: PartialBlock[]): void => {
    latestContentRef.current = blocks;
    setCurrentContent(blocks);
    void handleSave(blocks);
  };

  const handleCollaborativeContentChange = useCallback((blocks: PartialBlock[]): void => {
    latestContentRef.current = blocks;
  }, []);

  const handleSave = (blocks: PartialBlock[]): void => {
    const performSave = (): void => {
      if (!canvas || isSaving) return;

      try {
        setIsSaving(true);

        const sanitizedBlocks = JSON.parse(
          JSON.stringify(blocks, (_key: string, value: unknown) =>
            value === undefined ? null : value,
          ),
        ) as ReadonlyJSONObject;

        z.mutate(
          mutators.canvas.update({
            id: canvas.id,
            title: titleRef.current,
            content: sanitizedBlocks,
            timestamp: Date.now(),
          }),
        );
        lastSavedContentRef.current = JSON.stringify(blocks);
      } catch {
        toast.error('Error', {
          description: 'Failed to save canvas',
        });
      } finally {
        setIsSaving(false);
      }
    };

    void performSave();
  };

  const handleTitleSave = useCallback((): void => {
    if (!canvas || !canEdit || currentTitle === canvas.title) return;

    z.mutate(
      mutators.canvas.update({
        id: canvas.id,
        title: titleRef.current,
        timestamp: Date.now(),
      }),
    );
  }, [canEdit, canvas, currentTitle, z]);

  const handlePreviewVersion = (version: CanvasVersionRecord): void => {
    if (!previewVersionRef.current) {
      const currentBlocks = editorRef.current?.getBlocks();
      if (currentBlocks) {
        latestContentRef.current = currentBlocks;
      }
    }
    previewVersionRef.current = version;
    setPreviewVersion(version);
    setShowVersionDiff(false);
  };

  const handleBackToCurrentVersion = (): void => {
    previewVersionRef.current = null;
    setPreviewVersion(null);
    setShowVersionDiff(false);
  };

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
      setCanvas,
      editorRef,
    },
  );

  const handleLeaveEditor = (): void => {
    saveCanvasExitSnapshot();

    if (isMobile) {
      const state = location.state as { previousPath?: string };
      const backPath = state?.previousPath ? state.previousPath : '/chat';
      void navigate(backPath);
    } else {
      setView('list');
    }
  };

  if (view === 'list') {
    return (
      <>
        <div className='flex flex-col h-full bg-background'>
          <div className='p-4 border-b border-border flex justify-between items-center'>
            <h3 className='text-lg font-semibold text-foreground' data-testid='canvas-list-header'>
              Channel Canvases
            </h3>
            <div className='flex items-center gap-2'>
              <Tooltip
                content={showStarredOnly ? 'Show all items' : 'Show starred only'}
                className='px-2 py-1 text-[10px]'
              >
                <button
                  className={`flex items-center justify-center rounded-md border p-1.5 transition-colors ${
                    showStarredOnly
                      ? 'border-amber-200 bg-amber-50 text-amber-600'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                  onClick={() => setShowStarredOnly(prev => !prev)}
                  data-track-category='CANVAS'
                  data-track-name='TOGGLE_CHANNEL_STARRED_CANVAS_FILTER'
                >
                  <Star
                    size={16}
                    className={showStarredOnly ? 'fill-amber-400 text-amber-500' : undefined}
                  />
                </button>
              </Tooltip>
              <Tooltip content='Hide system generated' className='px-2 py-1 text-[10px]'>
                <div className='origin-left scale-90'>
                  <Switch
                    id='exclude-channel-call-generated-canvases'
                    checked={excludeCallGeneratedCanvases}
                    onCheckedChange={setExcludeCallGeneratedCanvases}
                  />
                </div>
              </Tooltip>
              <Tooltip content='Only recording canvases' className='px-2 py-1 text-[10px]'>
                <div className='origin-left scale-90'>
                  <Switch
                    id='only-channel-recording-generated-canvases'
                    checked={onlyRecordingGeneratedCanvases}
                    onCheckedChange={setOnlyRecordingGeneratedCanvases}
                  />
                </div>
              </Tooltip>
              <Tooltip content='Only archived' className='px-2 py-1 text-[10px]'>
                <div className='flex origin-left scale-90 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-muted-foreground'>
                  <Archive size={14} />
                  <Switch
                    id='only-archived-channel-canvases'
                    checked={onlyArchivedCanvases}
                    onCheckedChange={setOnlyArchivedCanvases}
                  />
                </div>
              </Tooltip>
              <Button
                variant='outline'
                size='sm'
                onClick={openCreateFolderDialog}
                disabled={isCreatingFolder || isChannelArchived}
                data-track-category='CANVAS'
                data-track-name='Create_Channel_Folder'
                data-track-metadata={JSON.stringify({ channelId })}
              >
                {isCreatingFolder ? (
                  <Loader2 size={16} className='animate-spin' />
                ) : (
                  <Plus size={16} />
                )}
                {isCreatingFolder ? 'Creating...' : 'New Folder'}
              </Button>
              <Button
                variant='default'
                size='sm'
                onClick={() => void handleCreateCanvas()}
                disabled={isCreatingCanvas || isChannelArchived}
                data-track-category='CANVAS'
                data-track-name='Create_Canvas'
                data-track-metadata={JSON.stringify({ channelId })}
              >
                {isCreatingCanvas ? (
                  <Loader2 size={16} className='animate-spin' />
                ) : (
                  <Plus size={16} />
                )}
                {isCreatingCanvas ? 'Creating...' : 'New Canvas'}
              </Button>
            </div>
          </div>
          <div className='flex-1 overflow-hidden'>
            <ChannelCanvasList
              canvases={canvases}
              loading={canvasListDetails.type !== 'complete' && canvases.length === 0}
              folders={folders}
              onSelect={handleSelectCanvas}
              currentUserId={user?.id}
              onDelete={id => {
                const deleteCanvas = (): void => {
                  try {
                    z.mutate(mutators.canvas.delete({ id }));
                  } catch {
                    toast.error('Error', {
                      description: 'Failed to delete canvas',
                    });
                  }
                };
                void deleteCanvas();
              }}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              selectedCanvasId={canvas?.id}
              onCreateCanvasInFolder={folder => {
                void handleCreateCanvasInFolder(folder);
              }}
              isCreatingCanvas={isCreatingCanvas}
              showStarredOnly={showStarredOnly}
              onToggleStar={handleToggleStar}
              onArchiveToggle={handleArchiveToggleCanvas}
            />
          </div>
        </div>
        <Dialog
          open={showCreateFolderDialog}
          onOpenChange={open => {
            setShowCreateFolderDialog(open);
            if (!open) {
              setNewFolderName('');
            }
          }}
          title='Create Folder'
          description='Create a folder for this channel'
          className='max-w-lg'
        >
          <div className='space-y-5 p-5'>
            <div className='flex items-start gap-3'>
              <div className='flex h-10 w-10 items-center justify-center rounded-md bg-amber-100 text-amber-600'>
                <FolderPlus className='h-5 w-5' />
              </div>
              <div className='min-w-0 space-y-1'>
                <h3 className='text-base font-semibold text-foreground'>Create folder</h3>
              </div>
            </div>

            <div className='space-y-2'>
              <label htmlFor='channel-folder-name' className='text-sm font-medium text-foreground'>
                Folder name
              </label>
              <Input
                id='channel-folder-name'
                value={newFolderName}
                onChange={event => setNewFolderName(event.target.value)}
                placeholder='Untitled folder 1'
                className='h-10'
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCreateFolder();
                  }
                }}
              />
              <p className='text-xs text-muted-foreground'>
                Choose a name that will make sense for everyone in this channel.
              </p>
            </div>

            <div className='rounded-md border border-border bg-muted/40 p-3'>
              <div className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Preview
              </div>
              <div className='mt-2 flex items-center gap-2 text-sm text-foreground'>
                <Folder className='h-4 w-4 text-amber-500 shrink-0' />
                <span className='truncate'>{newFolderName.trim() || 'Untitled folder'}</span>
              </div>
              <div className='mt-1 text-xs text-muted-foreground'>
                {channel?.name || 'This channel'}
              </div>
            </div>

            <div className='flex justify-end gap-2 border-t border-border pt-4'>
              <Button
                variant='outline'
                onClick={() => {
                  setShowCreateFolderDialog(false);
                  setNewFolderName('');
                }}
                data-track-category='CANVAS'
                data-track-name='Cancel_Create_Channel_Folder'
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateFolder}
                disabled={isCreatingFolder || isChannelArchived}
                loading={isCreatingFolder}
                data-track-category='CANVAS'
                data-track-name='Confirm_Create_Channel_Folder'
              >
                {isCreatingFolder ? 'Creating...' : 'Create Folder'}
              </Button>
            </div>
          </div>
        </Dialog>
      </>
    );
  }

  const currentContentForVersionCompare =
    latestContentRef.current || currentContent || canvas?.content || [];
  const displayedContent = previewVersion
    ? (normalizeCanvasContent(previewVersion.content) as PartialBlock[])
    : currentContent || canvas?.content || [];
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

  return (
    <div className='relative flex h-full bg-background'>
      <div className='flex min-w-0 flex-1 flex-col'>
        {/* Canvas Title with Auto-save indicator */}
        <div className='border-b border-border py-2 px-2 md:px-4 flex items-center gap-1 md:gap-2 mx-2 md:mx-4 mb-4 sticky top-0 bg-background'>
          <Button
            variant='ghost'
            size='iconSm'
            onClick={handleLeaveEditor}
            aria-label='Go back'
            data-track-category='CANVAS'
            data-track-name='GoBackFromCanvasEditor'
            data-track-metadata={JSON.stringify({ canvasId: canvas?.id, channelId })}
          >
            <ArrowLeft size={16} />
          </Button>
          <Input
            type='text'
            value={currentTitle}
            onChange={e => {
              const newTitle = e.target.value;
              setCurrentTitle(newTitle);
              titleRef.current = newTitle;
            }}
            readOnly={!canEdit}
            onBlur={() => {
              handleTitleSave();
            }}
            className={`text-base md:text-xl font-semibold flex-1 border-none shadow-none focus:ring-0 focus-visible:ring-0 focus-visible:border-none px-2 py-1 h-auto rounded min-w-0 ${
              canEdit ? 'hover:bg-accent' : 'cursor-default'
            }`}
            placeholder='Untitled Canvas'
            data-testid='canvas-title-input'
            data-track-category='CANVAS'
            data-track-name='EDIT_CANVAS_TITLE'
            data-track-metadata={JSON.stringify({ canvasId: canvas?.id, channelId })}
          />

          {isSaving && (
            <span className='text-xs md:text-sm text-muted-foreground flex items-center gap-1 hidden md:flex'>
              <div className='animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600'></div>
              Saving...
            </span>
          )}
          {!isSaving && canvas && (
            <span className='text-xs md:text-sm text-muted-foreground hidden md:inline'>
              Auto-saved
            </span>
          )}

          {/* Presentation Toolbar - Hidden on mobile */}
          {canvas && (
            <div className='hidden md:block'>
              <PresentToolbar
                selectedTheme={selectedTheme}
                onThemeChange={e => {
                  setSelectedTheme(e.target.value);
                  editorRef.current?.handleThemeChange(e);
                }}
                onPresent={() => editorRef.current?.handlePresent()}
              />
            </div>
          )}

          {/* Share Button */}
          {canvas?.id && (
            <div className='ml-2 flex items-center gap-2'>
              {recordingCallId && (
                <Button
                  variant='secondary'
                  size='iconSm'
                  onClick={handleOpenRecordingNotes}
                  title='Open recording notes'
                  aria-label='Open recording notes'
                  data-track-category='CANVAS'
                  data-track-name='Open_Recording_Notes_From_Channel_Canvas'
                  data-track-metadata={JSON.stringify({
                    canvasId: canvas.id,
                    recordingId: recordingCallId,
                    channelId,
                  })}
                >
                  <AudioLines size={16} strokeWidth={2.2} />
                </Button>
              )}
              <Button
                variant='secondary'
                size='sm'
                onClick={() => setShowVersionHistory(true)}
                title='Version history'
                data-track-category='CANVAS'
                data-track-name='Open_Channel_Canvas_Version_History'
                data-track-metadata={JSON.stringify({ canvasId: canvas.id, channelId })}
              >
                <History size={16} />
                <span className='hidden lg:inline'>History</span>
              </Button>
              <Button
                variant='secondary'
                size='sm'
                onClick={() => editorRef.current?.toggleComments()}
                title='Comments'
                aria-label='Open comment activity'
                data-testid='canvas-comments-button'
                data-track-category='CANVAS'
                data-track-name='TOGGLE_CANVAS_COMMENT_ACTIVITY'
                data-track-metadata={JSON.stringify({ canvasId: canvas.id, channelId })}
              >
                <span className='relative inline-flex'>
                  <MessageSquare size={16} />
                  {openCommentCount > 0 && (
                    <span className='absolute -right-2 -top-2 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground'>
                      {openCommentCount > 99 ? '99+' : openCommentCount}
                    </span>
                  )}
                </span>
              </Button>
              <Button
                variant='default'
                size='sm'
                onClick={() => setShowShareModal(true)}
                data-testid='canvas-share-button'
                data-track-category='CANVAS'
                data-track-name='OPEN_CANVAS_SHARE_MODAL'
                data-track-metadata={JSON.stringify({ canvasId: canvas.id, channelId })}
              >
                Share
              </Button>
            </div>
          )}
        </div>

        {previewVersion && (
          <div className='mx-2 mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm md:mx-4'>
            <div className='min-w-0 text-muted-foreground'>
              Viewing version from{' '}
              <span className='font-medium text-foreground'>{previewUpdatedAtText}</span>
            </div>
            <div className='flex items-center gap-2'>
              <Button
                variant='secondary'
                size='sm'
                onClick={handleBackToCurrentVersion}
                data-track-category='CANVAS'
                data-track-name='BACK_TO_CURRENT_VERSION'
              >
                Back to current
              </Button>
              {hasVersionDiff && (
                <Button
                  variant={showVersionDiff ? 'default' : 'secondary'}
                  size='sm'
                  onClick={() => setShowVersionDiff(prev => !prev)}
                  data-track-category='CANVAS'
                  data-track-name='TOGGLE_VERSION_DIFF'
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
                  data-track-category='CANVAS'
                  data-track-name='RESTORE_CANVAS_VERSION'
                  loading={restoringVersionId === previewVersion.id}
                >
                  <RotateCcw size={14} />
                  Restore
                </Button>
              )}
            </div>
          </div>
        )}

        {canvas?.isArchived && (
          <div
            className='mx-2 mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:mx-4'
            data-testid='channel-canvas-archived-banner'
          >
            <div className='flex min-w-0 items-center gap-2'>
              <Archive size={16} className='shrink-0 text-amber-700' />
              <span className='truncate font-medium'>This canvas is archived</span>
            </div>
            {canArchiveCanvas && (
              <Button
                variant='secondary'
                size='sm'
                onClick={handleUnarchiveCurrentCanvas}
                data-track-category='CANVAS'
                data-track-name='UNARCHIVE_CHANNEL_CANVAS_FROM_BANNER'
                data-track-metadata={JSON.stringify({ canvasId: canvas.id, channelId })}
              >
                Unarchive
              </Button>
            )}
          </div>
        )}

        {previewVersion && showVersionDiff && hasVersionDiff && (
          <CanvasVersionDiffPanel parts={versionDiffParts} className='mx-2 mb-2 md:mx-4' />
        )}

        {/* Canvas Editor */}
        <div
          ref={canvasContentRef}
          className='flex-1 overflow-hidden mx-2 md:mx-4'
          data-testid='canvas-editor'
        >
          {previewVersion ? (
            <CanvasEditor
              key={`preview-${previewVersion.id}`}
              ref={editorRef}
              content={displayedContent}
              editable={false}
              placeholder='Start writing your canvas...'
              canvasId={canvas?.id}
              canvasTitle={currentTitle}
              onOpenCommentCountChange={setOpenCommentCount}
              autoFocus={false}
            />
          ) : canvas?.id && canvas.isCollaborative ? (
            <CollaborativeCanvasEditor
              key={canvas.id}
              ref={editorRef}
              canvasId={canvas.id}
              channelId={channelId}
              title={currentTitle}
              editable={canEdit}
              placeholder='Start writing your canvas...'
              onFileUpload={handleFileUpload}
              onChange={handleCollaborativeContentChange}
              onOpenCommentCountChange={setOpenCommentCount}
              autoFocus={true}
            />
          ) : (
            <CanvasEditor
              key={canvas?.id || 'new-canvas'}
              ref={editorRef}
              content={displayedContent}
              onChange={handleContentChange}
              onSave={handleSave}
              onFileUpload={handleFileUpload}
              editable={canEdit}
              placeholder='Start writing your canvas...'
              canvasId={canvas?.id}
              canvasTitle={currentTitle}
              onOpenCommentCountChange={setOpenCommentCount}
              autoFocus={true}
            />
          )}
        </div>
        {/* Share Modal */}
        {showShareModal && canvas && (
          <Dialog
            open={showShareModal}
            onOpenChange={open => !open && setShowShareModal(false)}
            title='Share Canvas'
            data-testid='canvas-share-modal'
          >
            <CanvasShareModal
              key={canvas.id}
              onClose={() => setShowShareModal(false)}
              canvas={canvas}
              isOwner={isCanvasOwner}
              isEditor={effectiveAccessLevel === CanvasRole.EDITOR}
              channelId={channelId}
            />
          </Dialog>
        )}
      </div>
      <CanvasVersionHistory
        canvasId={canvas?.id}
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
    </div>
  );
};

export default CanvasTab;
