import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Folders,
  FolderKanban,
  Hash,
  Loader2,
  Share2,
  MoreVertical,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  User,
  Users,
} from 'lucide-react';
import { ButtonType, Button } from '@juspay/blend-design-system';
import { TreeSearchInput } from './TreeSearchInput';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useAuth } from '../../../hooks/useAuth';
import CreateCollectionModal from '../upload/CreateCollectionModal';
import { ShareCollectionModal } from '../upload/ShareCollectionModal';
import { CollectionSummary, CollectionRole } from '../../../services/Knowledge/collectionService';
import { toast } from 'sonner';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useProjectCollectionMutations } from '../hooks/useProjectCollectionMutations';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface TreeSidebarProps {
  selectedCollectionId: string | null;
  onSelectCollection: (
    collectionId: string | null,
    collectionName?: string,
    collectionRole?: CollectionRole,
    collectionCanShare?: boolean,
    ownerId?: string,
  ) => void;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  selectedChannelId?: string | null;
  onSelectChannel?: (channelId: string | null) => void;
}

/**
 * Tree Sidebar Component
 * Shows a 3-level drill-down: project → channel → collections
 */
export const TreeSidebar: React.FC<TreeSidebarProps> = ({
  selectedCollectionId,
  onSelectCollection,
  selectedProjectId,
  onSelectProject,
  selectedChannelId,
  onSelectChannel,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [internalProjectId, setInternalProjectId] = useState<string | null>(null);
  const [internalChannelId, setInternalChannelId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [shareModalState, setShareModalState] = useState<{
    isOpen: boolean;
    collectionId: string | null;
    collectionName: string;
  }>({
    isOpen: false,
    collectionId: null,
    collectionName: '',
  });
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeCollection: ctxActiveCollection, setActiveCollection: ctxSetActiveCollection } =
    useProjectCollections();
  const {
    renameCollection: renameCollectionFromContext,
    deleteCollection: deleteCollectionFromContext,
  } = useProjectCollectionMutations();

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Dropdown expansion state
  const [isMineExpanded, setIsMineExpanded] = useState(true);
  const [isSharedExpanded, setIsSharedExpanded] = useState(true);

  // Ref for selected collection element (for auto-scroll)
  const selectedCollectionRef = useRef<HTMLDivElement | null>(null);

  // Use external selection if provided, otherwise use internal state
  const currentProjectId = selectedProjectId !== undefined ? selectedProjectId : internalProjectId;
  const currentChannelId = selectedChannelId !== undefined ? selectedChannelId : internalChannelId;

  const handleProjectSelect = (projectId: string | null): void => {
    if (onSelectProject) {
      onSelectProject(projectId);
    } else {
      setInternalProjectId(projectId);
      setInternalChannelId(null);
      if (!projectId) {
        void navigate('/knowledge-base');
      }
    }
  };

  const handleChannelSelect = (channelId: string | null): void => {
    if (onSelectChannel) {
      onSelectChannel(channelId);
    } else {
      setInternalChannelId(channelId);
    }
  };

  // Fetch projects
  const [allProjects] = useCachedQuery(queries.getAllProjects());

  const projectOptions = useMemo(() => {
    if (!allProjects) return [];
    return allProjects.map(project => ({
      value: project.id,
      label: project.name,
      icon: <FolderKanban size={16} className='text-gray-500' />,
    }));
  }, [allProjects]);

  // Filter visible (participated) channels for the selected project
  const allVisibleChannels = useAllVisibleChannels();
  const channelOptions = useMemo(() => {
    if (!currentProjectId) return [];
    return allVisibleChannels
      .filter(ch => ch.projectId === currentProjectId)
      .map(ch => ({
        value: ch.id,
        label: ch.name,
        icon: <Hash size={16} className='text-gray-500' />,
      }));
  }, [allVisibleChannels, currentProjectId]);

  // Fetch collections for the selected channel (scoped)
  const collectionsQueryEnabled = !!currentChannelId && !!user;
  const [zeroCollections, { type: collectionsQueryType }] = useCachedQuery(
    queries.scopedCollections({ scopeType: 'CHANNEL', scopeId: currentChannelId ?? '' }),
    collectionsQueryEnabled,
  );
  const isLoadingCollections = collectionsQueryEnabled && collectionsQueryType !== 'complete';

  const collections: CollectionSummary[] = useMemo(() => {
    if (!zeroCollections || !user) return [];
    return zeroCollections.map(col => {
      const perm = col.permissions?.find(p => p.userId === user.id);
      const isOwner = col.ownerId === user.id;
      const defaultRole = isOwner ? 'OWNER' : col.isPrivate ? 'VIEWER' : 'EDITOR';
      return {
        id: col.id,
        name: col.name,
        description: col.description ?? null,
        ownerId: col.ownerId,
        role: (perm?.role ?? defaultRole) as CollectionRole,
        canShare: perm?.canShare ?? isOwner,
      };
    });
  }, [zeroCollections, user]);

  // Resolve full collection info into context when selectedCollectionId matches
  useEffect(() => {
    if (!selectedCollectionId || isLoadingCollections) return;

    const found = collections.find(c => c.id === selectedCollectionId);
    if (!found) {
      onSelectCollection(null);
      return;
    }

    if (
      ctxActiveCollection?.id === found.id &&
      ctxActiveCollection.name &&
      ctxActiveCollection.role === found.role &&
      ctxActiveCollection.canShare === found.canShare
    )
      return;

    ctxSetActiveCollection({
      id: found.id,
      name: found.name,
      role: found.role,
      canShare: found.canShare,
      ownerId: found.ownerId,
    });
  }, [
    selectedCollectionId,
    collections,
    ctxActiveCollection,
    ctxSetActiveCollection,
    isLoadingCollections,
    onSelectCollection,
  ]);

  // Auto-scroll to selected collection
  useEffect(() => {
    if (!selectedCollectionId || collections.length === 0 || isLoadingCollections) return;

    const found = collections.find(c => c.id === selectedCollectionId);
    if (!found) return;

    if (found.role === 'OWNER') {
      setIsMineExpanded(true);
    } else {
      setIsSharedExpanded(true);
    }

    const timeoutId = setTimeout(() => {
      if (selectedCollectionRef.current) {
        selectedCollectionRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [selectedCollectionId, collections, isLoadingCollections]);

  const filteredCollections = useMemo(() => {
    if (!searchQuery.trim()) return collections;
    return collections.filter(col => col.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [collections, searchQuery]);

  const { userCollections, sharedCollections } = useMemo(() => {
    const user = filteredCollections.filter(col => col.role === 'OWNER');
    const shared = filteredCollections.filter(col => col.role !== 'OWNER');
    return { userCollections: user, sharedCollections: shared };
  }, [filteredCollections]);

  const handleAddCollection = () => {
    setIsCreateModalOpen(true);
  };

  const handleCreateSuccess = (newCollection: CollectionSummary) => {
    onSelectCollection(
      newCollection.id,
      newCollection.name,
      newCollection.role,
      newCollection.canShare,
      newCollection.ownerId,
    );
    setIsCreateModalOpen(false);
  };

  const handleShareClick = (e: React.MouseEvent, collection: CollectionSummary) => {
    e.stopPropagation();
    setShareModalState({
      isOpen: true,
      collectionId: collection.id,
      collectionName: collection.name,
    });
  };

  const handleStartRename = (collection: CollectionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    if (collection.role !== 'EDITOR' && collection.role !== 'OWNER') return;
    setRenamingId(collection.id);
    setRenameValue(collection.name);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const handleRenameSubmit = async (collectionId: string) => {
    const trimmedName = renameValue.trim();
    const collection = collections.find(c => c.id === collectionId);
    if (!trimmedName || trimmedName === collection?.name) {
      setRenamingId(null);
      setRenameValue('');
      return;
    }

    try {
      await renameCollectionFromContext(collectionId, trimmedName);

      if (selectedCollectionId === collectionId && collection) {
        onSelectCollection(
          collectionId,
          trimmedName,
          collection.role,
          collection.canShare,
          collection.ownerId,
        );
      }

      toast.success('Collection renamed successfully');
      setRenamingId(null);
      setRenameValue('');
    } catch (error) {
      console.error('Failed to rename collection:', error);
      toast.error('Failed to rename collection. Please try again.');
    }
  };

  const handleRenameCancel = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, collectionId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void handleRenameSubmit(collectionId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleRenameCancel();
    }
  };

  const handleDelete = async (collection: CollectionSummary) => {
    if (collection.role !== 'OWNER') {
      toast.error('Only collection owners can delete collections');
      return;
    }

    if (
      !confirm(
        `Are you sure you want to delete "${collection.name}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await deleteCollectionFromContext(collection.id);

      if (selectedCollectionId === collection.id) {
        onSelectCollection(null);
      }

      toast.success('Collection deleted successfully');
    } catch (error) {
      console.error('Failed to delete collection:', error);
      toast.error('Failed to delete collection. Please try again.');
    }
  };

  const renderCollectionItem = (collection: CollectionSummary) => {
    const isRenaming = renamingId === collection.id;
    const isSelected = selectedCollectionId === collection.id;
    const canRename = collection.role === 'EDITOR' || collection.role === 'OWNER';
    const canShare = collection.canShare;
    const canDelete = collection.role === 'OWNER';

    return (
      <div
        key={collection.id}
        ref={isSelected ? selectedCollectionRef : null}
        className={`
          w-full flex items-center gap-2 px-4 py-2
          transition-colors group
          ${
            isSelected
              ? 'bg-blue-50 text-blue-900 border-l-2 border-blue-500'
              : 'text-gray-700 hover:bg-gray-50'
          }
        `}
      >
        <button
          onClick={() =>
            !isRenaming &&
            onSelectCollection(
              collection.id,
              collection.name,
              collection.role,
              collection.canShare,
              collection.ownerId,
            )
          }
          onDoubleClick={e => canRename && handleStartRename(collection, e)}
          data-track-category='knowledge-base'
          data-track-name='select-collection'
          className='flex items-center gap-2 flex-1 min-w-0 text-left ml-2'
        >
          <Folders
            size={16}
            className={`flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-500'}`}
          />
          <div className='flex-1 min-w-0'>
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type='text'
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => void handleRenameSubmit(collection.id)}
                onKeyDown={e => handleRenameKeyDown(e, collection.id)}
                onClick={e => e.stopPropagation()}
                data-track-category='knowledge-base'
                data-track-name='rename-input'
                className='w-full px-1 py-0.5 text-sm border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white'
              />
            ) : (
              <>
                <div className='text-sm font-medium truncate'>{collection.name}</div>
                {collection.description && (
                  <div className='text-xs text-gray-500 truncate'>{collection.description}</div>
                )}
              </>
            )}
          </div>
        </button>
        {!isRenaming && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                onClick={e => e.stopPropagation()}
                data-track-category='knowledge-base'
                data-track-name='collection-options'
                className={`${isSelected ? 'hover:bg-blue-100' : 'hover:bg-gray-100'} p-2 rounded-full transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0`}
                aria-label='Collection options'
              >
                <MoreVertical
                  size={14}
                  className={`${isSelected ? 'text-blue-600' : 'text-gray-500'}`}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-40'>
              <DropdownMenuItem
                onClick={e => {
                  e.stopPropagation();
                  if (canRename) handleStartRename(collection, e);
                }}
                className='flex items-center gap-2'
                disabled={!canRename}
              >
                <Pencil size={14} className='text-gray-500' />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={e => {
                  e.stopPropagation();
                  if (canShare) handleShareClick(e, collection);
                }}
                className='flex items-center gap-2'
                disabled={!canShare}
              >
                <Share2 size={14} className='text-gray-500' />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={e => {
                  e.stopPropagation();
                  if (canDelete) void handleDelete(collection);
                }}
                className='flex items-center gap-2 text-red-600 focus:text-red-600 focus:bg-red-50'
                disabled={!canDelete}
              >
                <Trash2 size={14} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <div className='h-full flex flex-col'>
      {/* Level 1: Project Selector */}
      <div className='p-4 border-b'>
        <EntitySelector
          options={projectOptions}
          selectedValue={currentProjectId || null}
          onSelect={handleProjectSelect}
          placeholder='Select a project...'
          searchPlaceholder='Search projects...'
          width='100%'
          showClearButton={true}
        />
      </div>

      {/* Level 2: Channel Selector (shown once project is selected) */}
      {currentProjectId && (
        <div className='p-4 border-b'>
          <EntitySelector
            options={channelOptions}
            selectedValue={currentChannelId || null}
            onSelect={handleChannelSelect}
            placeholder='Select a channel...'
            searchPlaceholder='Search channels...'
            width='100%'
            showClearButton={true}
          />
        </div>
      )}

      {/* Level 3: Collections (shown once channel is selected) */}
      {currentChannelId && (
        <>
          {/* Collections Header */}
          <div className='flex flex-col justify-between items-center p-4 border-b'>
            <div className='flex flex-col justify-between items-center mb-3 w-full min-h-[40px]'>
              <Button
                buttonType={ButtonType.PRIMARY}
                onClick={handleAddCollection}
                text='New Collection'
              />
            </div>
            <TreeSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder='Search collections...'
            />
          </div>

          {/* Collections List */}
          <div className='flex-1 overflow-auto'>
            {isLoadingCollections ? (
              <div className='p-4 text-center'>
                <Loader2 size={20} className='mx-auto text-blue-500 animate-spin mb-2' />
                <p className='text-sm text-gray-500'>Loading collections...</p>
              </div>
            ) : filteredCollections.length === 0 ? (
              <div className='p-4 text-center text-sm text-gray-500'>
                {searchQuery ? 'No collections found' : 'No collections yet'}
              </div>
            ) : (
              <div className='py-2'>
                {/* My Collections */}
                <div>
                  <button
                    onClick={() => setIsMineExpanded(!isMineExpanded)}
                    data-track-category='knowledge-base'
                    data-track-name='toggle-my-collections'
                    className='w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors'
                  >
                    <div className='flex items-center gap-2'>
                      {isMineExpanded ? (
                        <ChevronDown size={16} className='text-gray-500' />
                      ) : (
                        <ChevronRight size={16} className='text-gray-500' />
                      )}
                      <User size={18} className='text-gray-600' />
                      <span className='text-sm font-semibold text-gray-700'>My Collections</span>
                      {userCollections.length > 0 && (
                        <span className='text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full'>
                          {userCollections.length}
                        </span>
                      )}
                    </div>
                  </button>
                  {isMineExpanded && (
                    <div>
                      {userCollections.length > 0 ? (
                        userCollections.map(renderCollectionItem)
                      ) : (
                        <div className='px-4 py-3 text-sm text-gray-500'>No collections yet</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Shared with me */}
                <div>
                  <button
                    onClick={() => setIsSharedExpanded(!isSharedExpanded)}
                    data-track-category='knowledge-base'
                    data-track-name='toggle-shared-collections'
                    className='w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors'
                  >
                    <div className='flex items-center gap-2'>
                      {isSharedExpanded ? (
                        <ChevronDown size={16} className='text-gray-500' />
                      ) : (
                        <ChevronRight size={16} className='text-gray-500' />
                      )}
                      <Users size={18} className='text-gray-600' />
                      <span className='text-sm font-semibold text-gray-700'>Shared with me</span>
                      {sharedCollections.length > 0 && (
                        <span className='text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full'>
                          {sharedCollections.length}
                        </span>
                      )}
                    </div>
                  </button>
                  {isSharedExpanded && (
                    <div>
                      {sharedCollections.length > 0 ? (
                        sharedCollections.map(renderCollectionItem)
                      ) : (
                        <div className='px-4 py-3 text-sm text-gray-500 ml-2'>
                          No shared collections
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Prompt when no channel selected */}
      {currentProjectId && !currentChannelId && (
        <div className='flex-1 p-4 text-center text-sm text-gray-500'>
          Select a channel to view collections
        </div>
      )}

      {!currentProjectId && (
        <div className='flex-1 p-4 text-center text-sm text-gray-500'>
          Select a project to get started
        </div>
      )}

      {/* Create Collection Modal */}
      {currentChannelId && (
        <CreateCollectionModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          scopeType='CHANNEL'
          scopeId={currentChannelId}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Share Collection Modal */}
      {shareModalState.collectionId && (
        <ShareCollectionModal
          isOpen={shareModalState.isOpen}
          onClose={() =>
            setShareModalState({ isOpen: false, collectionId: null, collectionName: '' })
          }
          collectionId={shareModalState.collectionId}
          collectionName={shareModalState.collectionName}
          channelId={currentChannelId}
        />
      )}
    </div>
  );
};
