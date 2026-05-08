import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '../../../hooks/useQuery';
import { useNavigate } from 'react-router-dom';
import {
  Folders,
  FolderKanban,
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
import { useAuth } from '../../../hooks/useAuth';
import CreateCollectionModal from '../upload/CreateCollectionModal';
import { ShareCollectionModal } from '../upload/ShareCollectionModal';
import { CollectionSummary, CollectionRole } from '../../../services/Knowledge/collectionService';
import { toast } from 'sonner';
import { useProjectCollections } from '../context/ProjectCollectionsContext';
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
}

/**
 * Tree Sidebar Component
 * Displays list of collections only (like folder manager)
 * Shows project selector dropdown at the top
 */
export const TreeSidebar: React.FC<TreeSidebarProps> = ({
  selectedCollectionId,
  onSelectCollection,
  selectedProjectId,
  onSelectProject,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [internalProjectId, setInternalProjectId] = useState<string | null>(null);
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
  const {
    renameCollection: renameCollectionFromContext,
    deleteCollection: deleteCollectionFromContext,
    activeCollection: ctxActiveCollection,
    setActiveCollection: ctxSetActiveCollection,
  } = useProjectCollections();

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Dropdown expansion state
  const [isMineExpanded, setIsMineExpanded] = useState(true);
  const [isSharedExpanded, setIsSharedExpanded] = useState(true);

  // Ref for selected collection element (for auto-scroll)
  const selectedCollectionRef = useRef<HTMLDivElement | null>(null);

  // Use external project selection if provided, otherwise use internal state
  const currentProjectId = selectedProjectId !== undefined ? selectedProjectId : internalProjectId;

  const handleProjectSelect = (projectId: string | null): void => {
    if (onSelectProject) {
      onSelectProject(projectId);
    } else {
      setInternalProjectId(projectId);
      // Navigate to knowledge-base root if no project is selected
      if (!projectId) {
        void navigate('/knowledge-base');
      }
    }
  };

  // Fetch projects (still using Zero for projects)
  const [allProjects] = useCachedQuery(queries.getAllProjects());

  // Convert projects to EntitySelector options
  const projectOptions = useMemo(() => {
    if (!allProjects) return [];
    return allProjects.map(project => ({
      value: project.id,
      label: project.name,
      icon: <FolderKanban size={16} className='text-gray-500' />,
    }));
  }, [allProjects]);

  // Fetch collections via Zero (real-time, auto-syncing)
  const queryEnabled = !!currentProjectId && !!user;
  const [zeroCollections, { type: collectionsQueryType }] = useQuery(
    queries.projectCollections({ projectId: currentProjectId ?? '' }),
    queryEnabled,
  );
  // Only show loading when the query is active AND still syncing
  const isLoadingCollections = queryEnabled && collectionsQueryType !== 'complete';

  const collections: CollectionSummary[] = useMemo(() => {
    if (!zeroCollections || !user) return [];
    return zeroCollections.map(col => {
      const perm = col.permissions?.find(p => p.userId === user.id);
      return {
        id: col.id,
        name: col.name,
        description: col.description ?? null,
        ownerId: col.ownerId,
        role: (perm?.role ?? (col.ownerId === user.id ? 'OWNER' : 'VIEWER')) as CollectionRole,
        canShare: perm?.canShare ?? col.ownerId === user.id,
      };
    });
  }, [zeroCollections, user]);

  // ── Context gathering: when collections load and selectedCollectionId matches one,
  //    resolve full info (name, role, canShare) into the ProjectCollectionsContext.
  //    This handles notification-click and localStorage-restore scenarios where
  //    we only have a minimal { id } in context. ──

  useEffect(() => {
    if (!selectedCollectionId || isLoadingCollections) return;

    const found = collections.find(c => c.id === selectedCollectionId);
    if (!found) {
      // Collection was deleted or is no longer accessible — navigate to project root
      onSelectCollection(null);
      return;
    }

    // Only push if context is missing full info or role/canShare changed
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

  // ── Auto-scroll to selected collection ──
  // Expands the relevant dropdown section and scrolls to the selected collection
  useEffect(() => {
    if (!selectedCollectionId || collections.length === 0 || isLoadingCollections) return;

    const found = collections.find(c => c.id === selectedCollectionId);
    if (!found) return;

    // Auto-expand the relevant section
    if (found.role === 'OWNER') {
      setIsMineExpanded(true);
    } else {
      setIsSharedExpanded(true);
    }

    // Scroll to the selected collection after a small delay to ensure DOM is updated
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

  // Filter collections by search query
  // Note: Collections are already filtered by project via API call
  const filteredCollections = useMemo(() => {
    if (!searchQuery.trim()) return collections;
    return collections.filter(col => col.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [collections, searchQuery]);

  // Group collections: user's collections and shared collections
  const { userCollections, sharedCollections } = useMemo(() => {
    const user = filteredCollections.filter(col => col.role === 'OWNER');
    const shared = filteredCollections.filter(col => col.role !== 'OWNER');
    return { userCollections: user, sharedCollections: shared };
  }, [filteredCollections]);

  const handleAddCollection = () => {
    setIsCreateModalOpen(true);
  };

  const handleCreateSuccess = (newCollection: CollectionSummary) => {
    // Zero auto-syncs the new collection — just select it
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
    e.stopPropagation(); // Prevent collection selection
    setShareModalState({
      isOpen: true,
      collectionId: collection.id,
      collectionName: collection.name,
    });
  };

  // ── Rename handlers ──

  const handleStartRename = (collection: CollectionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    // Check permissions: editor or owner can rename collections
    if (collection.role !== 'EDITOR' && collection.role !== 'OWNER') {
      return;
    }
    setRenamingId(collection.id);
    setRenameValue(collection.name);
    // Focus input after state update
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

      // Update selected collection if it's the one being renamed
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
      // Keep rename mode open on error so user can retry
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

  // ── Delete handler ──

  const handleDelete = async (collection: CollectionSummary) => {
    // Only owner can delete collections
    // If shared, check if role is OWNER
    // If not shared, it's the owner's collection
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

      // Clear selection if deleted collection was selected
      if (selectedCollectionId === collection.id) {
        onSelectCollection(null);
      }

      toast.success('Collection deleted successfully');
    } catch (error) {
      console.error('Failed to delete collection:', error);
      toast.error('Failed to delete collection. Please try again.');
    }
  };

  return (
    <div className='h-full flex flex-col'>
      {/* Project Selector */}
      <div className='p-4 border-b'>
        <div className='mb-3'>
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
      </div>

      {/* Collections Header */}
      <div className='flex flex-col justify-between items-center p-4 border-b'>
        <div className='flex flex-col justify-between items-center mb-3 w-full min-h-[40px]'>
          <Button
            buttonType={ButtonType.PRIMARY}
            onClick={handleAddCollection}
            disabled={!currentProjectId}
            text='New Collection'
          />
        </div>
        <TreeSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder='Search collections...'
          disabled={!currentProjectId}
        />
      </div>

      {/* Collections List */}
      <div className='flex-1 overflow-auto'>
        {!currentProjectId ? (
          <div className='p-4 text-center text-sm text-gray-500'>
            Select a project to view collections
          </div>
        ) : isLoadingCollections ? (
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
            {/* Mine Dropdown */}
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
                    userCollections.map(collection => {
                      const isRenaming = renamingId === collection.id;
                      const isSelected = selectedCollectionId === collection.id;
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
                            onDoubleClick={e => handleStartRename(collection, e)}
                            data-track-category='knowledge-base'
                            data-track-name='select-collection'
                            className='flex items-center gap-2 flex-1 min-w-0 text-left ml-2'
                          >
                            <Folders
                              size={16}
                              className={`flex-shrink-0 ${
                                isSelected ? 'text-blue-500' : 'text-gray-500'
                              }`}
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
                                <div className='text-sm font-medium truncate'>
                                  {collection.name}
                                </div>
                              )}
                              {!isRenaming && collection.description && (
                                <div className='text-xs text-gray-500 truncate'>
                                  {collection.description}
                                </div>
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
                                    handleStartRename(collection, e);
                                  }}
                                  className='flex items-center gap-2'
                                >
                                  <Pencil size={14} className='text-gray-500' />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleShareClick(e, collection);
                                  }}
                                  className='flex items-center gap-2'
                                >
                                  <Share2 size={14} className='text-gray-500' />
                                  Share
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={e => {
                                    e.stopPropagation();
                                    void handleDelete(collection);
                                  }}
                                  className='flex items-center gap-2 text-red-600 focus:text-red-600 focus:bg-red-50'
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className='px-4 py-3 text-sm text-gray-500'>No collections yet</div>
                  )}
                </div>
              )}
            </div>

            {/* Shared with me Dropdown */}
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
                    sharedCollections.map(collection => {
                      const isRenaming = renamingId === collection.id;
                      const isSelected = selectedCollectionId === collection.id;
                      // Shared collections: editor or owner can rename/share, only owner can delete
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
                            onDoubleClick={e => {
                              if (canRename) {
                                handleStartRename(collection, e);
                              }
                            }}
                            data-track-category='knowledge-base'
                            data-track-name='select-shared-collection'
                            className='flex items-center gap-2 flex-1 min-w-0 text-left ml-2'
                          >
                            <Folders
                              size={16}
                              className={`flex-shrink-0 ${
                                isSelected ? 'text-blue-500' : 'text-gray-500'
                              }`}
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
                                  <div className='text-sm font-medium truncate'>
                                    {collection.name}
                                  </div>
                                  {collection.description && (
                                    <div className='text-xs text-gray-500 truncate'>
                                      {collection.description}
                                    </div>
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
                                  className='p-1.5 rounded-md hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0'
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
                                    if (canRename) {
                                      handleStartRename(collection, e);
                                    }
                                  }}
                                  className='flex items-center gap-2 cursor-pointer'
                                  disabled={!canRename}
                                >
                                  <Pencil size={14} className='text-gray-500' />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (canShare) {
                                      handleShareClick(e, collection);
                                    }
                                  }}
                                  className='flex items-center gap-2 cursor-pointer'
                                  disabled={!canShare}
                                >
                                  <Share2 size={14} className='text-gray-500' />
                                  Share
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (canDelete) {
                                      void handleDelete(collection);
                                    }
                                  }}
                                  className='flex items-center gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50'
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
                    })
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

      {/* Create Collection Modal */}
      {currentProjectId && (
        <CreateCollectionModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          projectId={currentProjectId}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Share Collection Modal */}
      {shareModalState.collectionId && (
        <ShareCollectionModal
          isOpen={shareModalState.isOpen}
          onClose={() =>
            setShareModalState({
              isOpen: false,
              collectionId: null,
              collectionName: '',
            })
          }
          collectionId={shareModalState.collectionId}
          collectionName={shareModalState.collectionName}
          projectId={currentProjectId ?? null}
        />
      )}
    </div>
  );
};
