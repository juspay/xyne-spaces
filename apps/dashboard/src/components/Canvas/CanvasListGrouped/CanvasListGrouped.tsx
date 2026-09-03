import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Folder } from 'lucide-react';
import type { CanvasChannel, CanvasFolder, CanvasProject } from '../Canvas.types';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import Input from '../../ui/Input';
import { Button } from '../../ui/Button/Button';
import { Dialog } from '../../ui/Dialog';
import { CanvasDeleteModal } from '../CanvasDeleteModal';
import { canvasService } from '../../../services/Canvas/canvasService';
import type { CanvasListGroupedProps } from './CanvasListGrouped.utils';
import { getChannelDisplayName, nextFolderName } from './CanvasListGrouped.utils';
import { useCanvasListGroupedData } from './useCanvasListGroupedData';
import { CanvasListGroupedContent } from './CanvasListGroupedContent';
import { useNavigate } from '../../../hooks/useWorkspaceNavigate';

export const CanvasListGrouped: React.FC<CanvasListGroupedProps> = ({
  onSelect,
  currentUserId,
  selectedCanvasId,
  onDelete,
  onDuplicate,
  onArchiveToggle,
  isPersonalSectionCollapsed,
  onSetPersonalSectionCollapsed,
  excludeCallGeneratedCanvases = true,
  excludeRecordingGeneratedCanvases = true,
  showStarredOnly = false,
  includeArchived = false,
  onlyArchived = false,
  onToggleStar,
  searchQuery = '',
}) => {
  const z = useZero();
  const navigate = useNavigate();
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [collapsedChannels, setCollapsedChannels] = useState<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState('');
  const [channelCreateTarget, setChannelCreateTarget] = useState<CanvasChannel | null>(null);
  const [channelFoldersForTarget, setChannelFoldersForTarget] = useState<CanvasFolder[]>([]);
  const [newChannelFolderName, setNewChannelFolderName] = useState('');
  const [deletingFolder, setDeletingFolder] = useState<CanvasFolder | null>(null);
  const initializedProjectIdsRef = useRef<Set<string>>(new Set());
  const initializedChannelIdsRef = useRef<Set<string>>(new Set());
  const initializedFolderIdsRef = useRef<Set<string>>(new Set());
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearchActive = normalizedSearchQuery.length > 0;

  const {
    usersById: activeUsersById,
    adminChannelIds: activeAdminChannelIds,
    projectGroups: activeProjectGroups,
    personalFolderGroups: activePersonalFolderGroups,
    personalCanvases: activePersonalCanvases,
    projectIds: lazyProjectIds,
    loadedChannelIds: lazyChannelIds,
    loadedFolderIds: lazyFolderIds,
    isEmpty: activeIsEmpty,
    isLoading: activeIsLoading,
  } = useCanvasListGroupedData({
    currentUserId,
    collapsedProjects,
    excludeCallGeneratedCanvases,
    excludeRecordingGeneratedCanvases,
    showStarredOnly,
    includeArchived,
    onlyArchived,
    forceExpandProjects: isSearchActive,
  });

  const showArchivedChannelCreateError = useCallback((entity: 'canvas' | 'folder'): void => {
    toast.error(`Cannot create ${entity}`, {
      description: 'This channel is archived.',
    });
  }, []);

  const registerCollapsedFolderIds = useCallback((folderIds: readonly string[]): void => {
    const newFolderIds = folderIds.filter(id => !initializedFolderIdsRef.current.has(id));
    if (newFolderIds.length === 0) return;

    newFolderIds.forEach(id => initializedFolderIdsRef.current.add(id));
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      newFolderIds.forEach(id => next.add(id));
      return next;
    });
  }, []);

  useEffect(() => {
    const newProjectIds = lazyProjectIds.filter(id => !initializedProjectIdsRef.current.has(id));
    if (newProjectIds.length === 0) return;

    newProjectIds.forEach(id => initializedProjectIdsRef.current.add(id));
    setCollapsedProjects(prev => new Set([...prev, ...newProjectIds]));
  }, [lazyProjectIds]);

  useEffect(() => {
    const newChannelIds = lazyChannelIds.filter(id => !initializedChannelIdsRef.current.has(id));
    if (newChannelIds.length === 0) return;

    newChannelIds.forEach(id => initializedChannelIdsRef.current.add(id));
    setCollapsedChannels(prev => new Set([...prev, ...newChannelIds]));
  }, [lazyChannelIds]);

  useEffect(() => {
    registerCollapsedFolderIds(lazyFolderIds);
  }, [lazyFolderIds, registerCollapsedFolderIds]);

  const resolvedChannelTargetName = channelCreateTarget
    ? getChannelDisplayName(channelCreateTarget, currentUserId, activeUsersById)
    : '';

  const toggleSet = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string): void => {
      setter(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const handleToggleProject = useCallback(
    (projectId: string) => {
      toggleSet(setCollapsedProjects, projectId);
    },
    [toggleSet],
  );

  const handleToggleChannel = useCallback(
    (channelId: string) => {
      toggleSet(setCollapsedChannels, channelId);
    },
    [toggleSet],
  );

  const handleToggleFolder = useCallback(
    (folderId: string) => {
      toggleSet(setCollapsedFolders, folderId);
    },
    [toggleSet],
  );

  const createFolder = useCallback(
    async (
      projectId: string | null,
      options?: {
        channelId?: string | null;
        name?: string;
        startRename?: boolean;
      },
    ): Promise<{
      id: string;
      name: string;
      projectId: string | null;
      channelId: string | null;
    } | null> => {
      const channelId = options?.channelId ?? null;
      const name = options?.name?.trim() || 'Untitled folder';
      const folderId = uuidv4();

      try {
        const result = z.mutate(
          mutators.canvasFolder.create({
            id: folderId,
            ...(projectId ? { projectId } : {}),
            ...(channelId ? { channelId } : {}),
            name,
            timestamp: Date.now(),
          }),
        );
        const serverResult = await result.server;

        if (serverResult.type === 'error') {
          throw new Error(serverResult.error.message || 'Failed to create folder');
        }

        initializedFolderIdsRef.current.add(folderId);

        if (projectId) {
          setCollapsedProjects(prev => {
            const next = new Set(prev);
            next.delete(projectId);
            return next;
          });
        }

        if (channelId) {
          setCollapsedChannels(prev => {
            const next = new Set(prev);
            next.delete(channelId);
            return next;
          });
        }

        if (!projectId && !channelId) {
          onSetPersonalSectionCollapsed(false);
        }

        setCollapsedFolders(prev => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });

        if (options?.startRename) {
          setRenamingFolderId(folderId);
          setRenamingFolderName(name);
        }

        toast.success('Folder created');
        return { id: folderId, name, projectId, channelId };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create folder';
        toast.error(message);
        return null;
      }
    },
    [onSetPersonalSectionCollapsed, z],
  );

  const handleCreateFolder = useCallback(
    (projectId: string | null, existingFolders: CanvasFolder[] = []) => {
      void createFolder(projectId, {
        name: nextFolderName(projectId, existingFolders, null),
        startRename: true,
      });
    },
    [createFolder],
  );

  const ensureDefaultProjectFolder = useCallback(
    async (projectId: string, projectFolders: CanvasFolder[]): Promise<string> => {
      const loadedDefaultFolder = projectFolders.find(folder => folder.name === 'Default');
      if (loadedDefaultFolder) {
        return loadedDefaultFolder.id;
      }

      const createdFolder = await createFolder(projectId, { name: 'Default' });
      if (!createdFolder) {
        throw new Error('Failed to create default folder');
      }

      return createdFolder.id;
    },
    [createFolder],
  );

  const handleCreatePersonalCanvas = useCallback(async () => {
    const canvasId = uuidv4();
    setIsCreatingCanvas(true);
    onSetPersonalSectionCollapsed(false);

    try {
      await canvasService.createCollaborativeCanvas({
        id: canvasId,
        title: 'Untitled Canvas',
      });

      void navigate(`/chat/canvas/${canvasId}`);
    } catch {
      toast.error('Failed to create canvas');
    } finally {
      setIsCreatingCanvas(false);
    }
  }, [navigate, onSetPersonalSectionCollapsed]);

  const handleCreateCanvasInProject = useCallback(
    async (project: CanvasProject, projectFolders: CanvasFolder[]) => {
      const canvasId = uuidv4();
      setIsCreatingCanvas(true);

      try {
        const targetFolderId = await ensureDefaultProjectFolder(project.id, projectFolders);

        await canvasService.createCollaborativeCanvas({
          id: canvasId,
          title: 'Untitled Canvas',
          projectId: project.id,
          ...(targetFolderId ? { folderId: targetFolderId } : {}),
        });

        setCollapsedProjects(prev => {
          const next = new Set(prev);
          next.delete(project.id);
          return next;
        });

        if (targetFolderId) {
          setCollapsedFolders(prev => {
            const next = new Set(prev);
            next.delete(targetFolderId);
            return next;
          });
        }

        void navigate(`/chat/canvas/${canvasId}`);
      } catch {
        toast.error('Failed to create canvas');
      } finally {
        setIsCreatingCanvas(false);
      }
    },
    [ensureDefaultProjectFolder, navigate],
  );

  const handleOpenChannelCreateDialog = useCallback(
    (channel: CanvasChannel, channelFolders: CanvasFolder[]) => {
      if (channel.isArchived) {
        showArchivedChannelCreateError('folder');
        return;
      }

      setChannelCreateTarget(channel);
      setChannelFoldersForTarget(channelFolders);
      setNewChannelFolderName(nextFolderName(channel.projectId, channelFolders, channel.id));
      setCollapsedProjects(prev => {
        const next = new Set(prev);
        next.delete(channel.projectId);
        return next;
      });
      setCollapsedChannels(prev => {
        const next = new Set(prev);
        next.delete(channel.id);
        return next;
      });
    },
    [showArchivedChannelCreateError],
  );

  const handleCloseChannelCreateDialog = useCallback(() => {
    setChannelCreateTarget(null);
    setChannelFoldersForTarget([]);
    setNewChannelFolderName('');
  }, []);

  const handleCreateChannelFolder = useCallback(() => {
    if (!channelCreateTarget) return;
    if (channelCreateTarget.isArchived) {
      showArchivedChannelCreateError('folder');
      return;
    }

    void (async (): Promise<void> => {
      const createdFolder = await createFolder(channelCreateTarget.projectId, {
        channelId: channelCreateTarget.id,
        name: newChannelFolderName,
      });

      if (!createdFolder) return;
      handleCloseChannelCreateDialog();
    })();
  }, [
    channelCreateTarget,
    createFolder,
    handleCloseChannelCreateDialog,
    newChannelFolderName,
    showArchivedChannelCreateError,
  ]);

  const handleStartRenameFolder = useCallback((folder: CanvasFolder) => {
    setRenamingFolderId(folder.id);
    setRenamingFolderName(folder.name);
  }, []);

  const handleCancelRenameFolder = useCallback(() => {
    setRenamingFolderId(null);
    setRenamingFolderName('');
  }, []);

  const handleConfirmRenameFolder = useCallback(
    (folder: CanvasFolder) => {
      const name = renamingFolderName.trim();
      if (!name || name === folder.name) {
        handleCancelRenameFolder();
        return;
      }

      void (async (): Promise<void> => {
        try {
          const result = z.mutate(
            mutators.canvasFolder.update({
              id: folder.id,
              name,
              timestamp: Date.now(),
            }),
          );
          const serverResult = await result.server;

          if (serverResult.type === 'error') {
            throw new Error(serverResult.error.message || 'Failed to rename folder');
          }

          toast.success('Folder renamed');
          handleCancelRenameFolder();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to rename folder';
          toast.error(message);
        }
      })();
    },
    [handleCancelRenameFolder, renamingFolderName, z],
  );

  const handleDeleteFolder = useCallback((folder: CanvasFolder, canvasCount: number) => {
    if (canvasCount > 0) {
      toast.error('Move or delete canvases in this folder first');
      return;
    }
    setDeletingFolder(folder);
  }, []);

  const handleConfirmDeleteFolder = useCallback(() => {
    if (!deletingFolder) return;

    void (async (): Promise<void> => {
      try {
        const result = z.mutate(mutators.canvasFolder.delete({ id: deletingFolder.id }));
        const serverResult = await result.server;

        if (serverResult.type === 'error') {
          throw new Error(serverResult.error.message || 'Failed to delete folder');
        }

        setCollapsedFolders(prev => {
          const next = new Set(prev);
          next.delete(deletingFolder.id);
          return next;
        });
        toast.success('Folder deleted');
        setDeletingFolder(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete folder';
        toast.error(message);
      }
    })();
  }, [deletingFolder, z]);

  const handleCloseDeleteFolderDialog = useCallback(() => {
    setDeletingFolder(null);
  }, []);

  const handleCreateCanvasInFolder = useCallback(
    async (folder: CanvasFolder) => {
      const canvasId = uuidv4();
      const folderProjectId = folder.projectId;
      setIsCreatingCanvas(true);

      try {
        await canvasService.createCollaborativeCanvas({
          id: canvasId,
          title: 'Untitled Canvas',
          folderId: folder.id,
          ...(folderProjectId ? { projectId: folderProjectId } : {}),
          ...(folder.channelId ? { channelId: folder.channelId } : {}),
        });

        if (folderProjectId) {
          setCollapsedProjects(prev => {
            const next = new Set(prev);
            next.delete(folderProjectId);
            return next;
          });
        }

        if (folder.channelId) {
          setCollapsedChannels(prev => {
            const next = new Set(prev);
            next.delete(folder.channelId as string);
            return next;
          });
        }

        setCollapsedFolders(prev => {
          const next = new Set(prev);
          next.delete(folder.id);
          return next;
        });

        void navigate(`/chat/canvas/${canvasId}`);
      } catch {
        toast.error('Failed to create canvas');
      } finally {
        setIsCreatingCanvas(false);
      }
    },
    [navigate],
  );

  const handleCreateCanvasInChannel = useCallback(
    async (channel: CanvasChannel) => {
      if (channel.isArchived) {
        showArchivedChannelCreateError('canvas');
        return;
      }

      const canvasId = uuidv4();
      setIsCreatingCanvas(true);

      try {
        await canvasService.createCollaborativeCanvas({
          id: canvasId,
          title: 'Untitled Canvas',
          channelId: channel.id,
          projectId: channel.projectId,
        });
        handleCloseChannelCreateDialog();
        void navigate(`/chat/canvas/${canvasId}`);
      } catch {
        toast.error('Failed to create canvas');
      } finally {
        setIsCreatingCanvas(false);
      }
    },
    [handleCloseChannelCreateDialog, navigate, showArchivedChannelCreateError],
  );

  const handleCreateCanvasInChannelFolder = useCallback(
    (folder: CanvasFolder) => {
      handleCloseChannelCreateDialog();
      void handleCreateCanvasInFolder(folder);
    },
    [handleCloseChannelCreateDialog, handleCreateCanvasInFolder],
  );

  return (
    <>
      <div className='h-full overflow-auto no-scrollbar' data-testid='canvas-list'>
        <CanvasListGroupedContent
          projectGroups={activeProjectGroups}
          personalFolderGroups={activePersonalFolderGroups}
          personalCanvases={activePersonalCanvases}
          isEmpty={activeIsEmpty}
          onSelect={onSelect}
          currentUserId={currentUserId}
          selectedCanvasId={selectedCanvasId}
          usersById={activeUsersById}
          adminChannelIds={activeAdminChannelIds}
          isPersonalSectionCollapsed={isPersonalSectionCollapsed}
          excludeCallGeneratedCanvases={excludeCallGeneratedCanvases}
          excludeRecordingGeneratedCanvases={excludeRecordingGeneratedCanvases}
          collapsedProjects={collapsedProjects}
          collapsedChannels={collapsedChannels}
          collapsedFolders={collapsedFolders}
          renamingFolderId={renamingFolderId}
          renamingFolderName={renamingFolderName}
          setRenamingFolderName={setRenamingFolderName}
          isCreatingCanvas={isCreatingCanvas}
          onToggleProject={handleToggleProject}
          onToggleChannel={handleToggleChannel}
          onToggleFolder={handleToggleFolder}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onArchiveToggle={onArchiveToggle}
          onSetPersonalSectionCollapsed={onSetPersonalSectionCollapsed}
          showStarredOnly={showStarredOnly}
          includeArchived={includeArchived}
          onlyArchived={onlyArchived}
          onToggleStar={onToggleStar}
          onCreatePersonalCanvas={handleCreatePersonalCanvas}
          onCreateCanvasInProject={handleCreateCanvasInProject}
          onCreateFolder={handleCreateFolder}
          onOpenChannelCreateDialog={handleOpenChannelCreateDialog}
          onCreateCanvasInFolder={handleCreateCanvasInFolder}
          onStartRenameFolder={handleStartRenameFolder}
          onConfirmRenameFolder={handleConfirmRenameFolder}
          onCancelRenameFolder={handleCancelRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onRegisterFolderIds={registerCollapsedFolderIds}
          searchQuery={normalizedSearchQuery}
          isSearchLoading={isSearchActive && activeIsLoading}
        />
      </div>

      <Dialog
        open={!!channelCreateTarget}
        onOpenChange={open => {
          if (!open) handleCloseChannelCreateDialog();
        }}
        title='Create canvas in channel'
      >
        <div className='p-4 space-y-4'>
          <div>
            <h3 className='text-base font-semibold text-foreground'>Create canvas</h3>
            {resolvedChannelTargetName && (
              <p className='text-sm text-muted-foreground'>{resolvedChannelTargetName}</p>
            )}
          </div>

          <Button
            variant='ghost'
            className='w-full flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-foreground hover:bg-accent disabled:opacity-50'
            onClick={() =>
              channelCreateTarget && void handleCreateCanvasInChannel(channelCreateTarget)
            }
            disabled={isCreatingCanvas || !channelCreateTarget || !!channelCreateTarget?.isArchived}
            trackId='create_canvas_in_channel_root'
            data-track-category='CANVAS'
            data-track-name='CREATE_CANVAS_IN_CHANNEL_ROOT'
          >
            <FileText className='w-4 h-4 text-muted-foreground shrink-0' />
            <span className='text-sm'>Create in channel</span>
          </Button>

          <div className='space-y-2'>
            <div className='text-sm font-medium text-foreground'>Folders</div>
            {channelFoldersForTarget.length > 0 ? (
              <div className='space-y-1'>
                {channelFoldersForTarget.map(folder => (
                  <Button
                    key={folder.id}
                    variant='ghost'
                    className='w-full flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-foreground hover:bg-accent disabled:opacity-50'
                    onClick={() => handleCreateCanvasInChannelFolder(folder)}
                    disabled={isCreatingCanvas}
                    trackId='create_canvas_in_channel_folder'
                    data-track-category='CANVAS'
                    data-track-name='CREATE_CANVAS_IN_CHANNEL_FOLDER'
                  >
                    <Folder className='w-4 h-4 text-amber-500 shrink-0' />
                    <span className='text-sm truncate'>{folder.name}</span>
                  </Button>
                ))}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>No folders yet for this channel.</p>
            )}
          </div>

          <div className='space-y-2 border-t border-border pt-4'>
            <div className='text-sm font-medium text-foreground'>New folder</div>
            <div className='flex items-center gap-2'>
              <Input
                value={newChannelFolderName}
                onChange={event => setNewChannelFolderName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCreateChannelFolder();
                  }
                }}
                placeholder='Folder name'
                className='h-9 flex-1'
              />
              <Button
                variant='ghost'
                className='inline-flex items-center justify-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50'
                onClick={handleCreateChannelFolder}
                disabled={!channelCreateTarget || !!channelCreateTarget?.isArchived}
                trackId='create_channel_canvas_folder'
                data-track-category='CANVAS'
                data-track-name='CREATE_CHANNEL_CANVAS_FOLDER'
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!deletingFolder}
        onOpenChange={open => {
          if (!open) handleCloseDeleteFolderDialog();
        }}
        title='Delete Folder'
      >
        <CanvasDeleteModal
          onClose={handleCloseDeleteFolderDialog}
          onConfirm={handleConfirmDeleteFolder}
          entityType='folder'
          itemTitle={deletingFolder?.name}
        />
      </Dialog>
    </>
  );
};
