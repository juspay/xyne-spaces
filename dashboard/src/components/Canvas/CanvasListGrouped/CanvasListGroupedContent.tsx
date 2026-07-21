import React, { useEffect, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  User,
} from 'lucide-react';
import type { Canvas, CanvasChannel, CanvasFolder, CanvasProject } from '../Canvas.types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Input from '../../ui/Input';
import { CanvasRow, HighlightedText } from '../CanvasRow';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { CanvasUser, FolderGroup, ProjectGroup } from './CanvasListGrouped.utils';
import {
  filterExcludedCallGeneratedCanvases,
  filterStarredCanvases,
  withStarredCanvasState,
} from '../canvasFilters';
import {
  canvasMatchesGroupedSearch,
  getChannelDisplayName,
  matchesGroupedCanvasSearch,
} from './CanvasListGrouped.utils';

const groupedCanvasRowTrackNames = {
  canvasOpen: 'Open_Canvas_Grouped',
  actionsMenu: 'CANVAS_ACTIONS_MENU',
} as const;

function toArray<T>(value: unknown): T[] {
  return (value as T[] | undefined) ?? [];
}

const SearchLoadingRow: React.FC<{ indentClassName?: string }> = ({ indentClassName = 'pl-2' }) => (
  <div
    className={`flex items-center gap-2 ${indentClassName} pr-2 py-2 text-sm text-muted-foreground`}
  >
    <div className='animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600' />
    <span>Searching...</span>
  </div>
);

interface FolderGroupSectionProps {
  folderGroup: FolderGroup;
  indentClassName: string;
  canvasIndentClassName: string;
  currentUserId?: string | undefined;
  selectedCanvasId?: string | undefined;
  adminChannelIds: ReadonlySet<string>;
  collapsedFolders: ReadonlySet<string>;
  renamingFolderId: string | null;
  renamingFolderName: string;
  setRenamingFolderName: React.Dispatch<React.SetStateAction<string>>;
  isCreatingCanvas: boolean;
  excludeCallGeneratedCanvases: boolean;
  showStarredOnly: boolean;
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  onDelete?: ((id: string) => void) | undefined;
  onDuplicate?: ((canvas: Canvas) => void) | undefined;
  onToggleStar?: ((canvas: Canvas) => void) | undefined;
  onToggleFolder: (folderId: string) => void;
  onCreateCanvasInFolder: (folder: CanvasFolder) => void | Promise<void>;
  onStartRenameFolder: (folder: CanvasFolder) => void;
  onConfirmRenameFolder: (folder: CanvasFolder) => void;
  onCancelRenameFolder: () => void;
  onDeleteFolder: (folder: CanvasFolder, canvasCount: number) => void;
  searchQuery: string;
}

const FolderGroupSection: React.FC<FolderGroupSectionProps> = ({
  folderGroup,
  indentClassName,
  canvasIndentClassName,
  currentUserId,
  selectedCanvasId,
  adminChannelIds,
  collapsedFolders,
  renamingFolderId,
  renamingFolderName,
  setRenamingFolderName,
  isCreatingCanvas,
  excludeCallGeneratedCanvases,
  showStarredOnly,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleStar,
  onToggleFolder,
  onCreateCanvasInFolder,
  onStartRenameFolder,
  onConfirmRenameFolder,
  onCancelRenameFolder,
  onDeleteFolder,
  searchQuery,
}) => {
  const isSearchActive = searchQuery.length > 0;
  const isCollapsed = !isSearchActive && collapsedFolders.has(folderGroup.folder.id);
  const isProjectFolder = !!folderGroup.folder.projectId && !folderGroup.folder.channelId;
  const [projectFolderCanvases, projectFolderCanvasesDetails] = useCachedQuery(
    queries.projectFolderCanvases({
      folderId: folderGroup.folder.id,
      projectId: folderGroup.folder.projectId ?? '',
    }),
    { enabled: !isCollapsed && isProjectFolder },
  );
  const [genericFolderCanvases, genericFolderCanvasesDetails] = useCachedQuery(
    queries.hierarchyCanvases({
      scope: 'folder',
      folderId: folderGroup.folder.id,
    }),
    { enabled: !isCollapsed && !isProjectFolder },
  );
  const isFolderLoading =
    isSearchActive &&
    (isProjectFolder
      ? projectFolderCanvasesDetails.type !== 'complete'
      : genericFolderCanvasesDetails.type !== 'complete');
  const folderCanvases = useMemo(
    () =>
      filterStarredCanvases(
        filterExcludedCallGeneratedCanvases(
          withStarredCanvasState(
            toArray<Canvas>(isProjectFolder ? projectFolderCanvases : genericFolderCanvases),
          ),
          excludeCallGeneratedCanvases,
        ),
        showStarredOnly,
      ),
    [
      excludeCallGeneratedCanvases,
      genericFolderCanvases,
      isProjectFolder,
      projectFolderCanvases,
      showStarredOnly,
    ],
  );
  const folderNameMatches = matchesGroupedCanvasSearch(folderGroup.folder.name, searchQuery);
  const visibleFolderCanvases = useMemo(
    () =>
      isSearchActive
        ? folderCanvases.filter(
            canvas => folderNameMatches || canvasMatchesGroupedSearch(canvas, searchQuery),
          )
        : folderCanvases,
    [folderCanvases, folderNameMatches, isSearchActive, searchQuery],
  );
  const isRenaming = renamingFolderId === folderGroup.folder.id;
  const isProjectDefaultFolder =
    !!folderGroup.folder.projectId &&
    !folderGroup.folder.channelId &&
    folderGroup.folder.name === 'Default';

  const canDeleteFolder = !isProjectDefaultFolder && folderCanvases.length === 0;
  const canRenameFolder =
    !isProjectDefaultFolder &&
    !!currentUserId &&
    (folderGroup.folder.createdBy === currentUserId ||
      (!!folderGroup.folder.channelId && adminChannelIds.has(folderGroup.folder.channelId)));

  if (
    isSearchActive &&
    !isFolderLoading &&
    !folderNameMatches &&
    visibleFolderCanvases.length === 0
  ) {
    return null;
  }

  return (
    <div key={folderGroup.folder.id}>
      <div
        className={[
          'flex items-center group',
          indentClassName,
          'pr-2 py-1.5 hover:bg-accent rounded-md',
        ].join(' ')}
      >
        <button
          className='flex items-center gap-2 shrink-0'
          onClick={() => onToggleFolder(folderGroup.folder.id)}
          title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
          data-track-category='CANVAS'
          data-track-name='TOGGLE_CANVAS_FOLDER_ICON'
        >
          {isCollapsed ? (
            <ChevronRight className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
          ) : (
            <ChevronDown className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
          )}
          <Folder className='w-3.5 h-3.5 text-amber-500 shrink-0' />
        </button>
        {isRenaming ? (
          <Input
            value={renamingFolderName}
            onChange={event => setRenamingFolderName(event.target.value)}
            onBlur={() => onConfirmRenameFolder(folderGroup.folder)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onConfirmRenameFolder(folderGroup.folder);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelRenameFolder();
              }
            }}
            onClick={event => event.stopPropagation()}
            className='ml-1 h-7 flex-1 min-w-0 text-sm px-2 py-0'
          />
        ) : (
          <button
            className='ml-1 min-w-0 flex-1 text-left'
            onClick={() => onToggleFolder(folderGroup.folder.id)}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${folderGroup.folder.name}`}
            title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_CANVAS_FOLDER'
          >
            <span className='block text-sm truncate'>
              <HighlightedText text={folderGroup.folder.name} query={searchQuery} />
            </span>
          </button>
        )}
        <button
          className='p-1 opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all disabled:opacity-40'
          onClick={() => void onCreateCanvasInFolder(folderGroup.folder)}
          disabled={isCreatingCanvas}
          title='Create canvas in folder'
          data-track-category='CANVAS'
          data-track-name='CREATE_CANVAS_IN_FOLDER'
        >
          <Plus className='w-4 h-4 text-muted-foreground' />
        </button>
        {canRenameFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className='p-1 opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all'
                onClick={event => event.stopPropagation()}
                title='Folder actions'
                data-track-category='CANVAS'
                data-track-name='CANVAS_FOLDER_ACTIONS_MENU'
              >
                <MoreHorizontal className='w-4 h-4 text-muted-foreground' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-40'>
              <DropdownMenuItem
                onClick={() => onStartRenameFolder(folderGroup.folder)}
                data-track-category='CANVAS'
                data-track-name='RENAME_CANVAS_FOLDER'
              >
                <Pencil className='w-4 h-4 mr-2' />
                Rename
              </DropdownMenuItem>
              {canDeleteFolder && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDeleteFolder(folderGroup.folder, folderCanvases.length)}
                    className='text-red-600 focus:text-red-600 focus:bg-red-50'
                    data-track-category='CANVAS'
                    data-track-name='DELETE_CANVAS_FOLDER'
                  >
                    <Trash2 className='w-4 h-4 mr-2' />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!isCollapsed && isFolderLoading && (
        <SearchLoadingRow indentClassName={canvasIndentClassName} />
      )}
      {!isCollapsed &&
        visibleFolderCanvases.map(canvas => (
          <CanvasRow
            key={canvas.id}
            canvas={canvas}
            indentClassName={canvasIndentClassName}
            onSelect={onSelect}
            selectedCanvasId={selectedCanvasId}
            currentUserId={currentUserId}
            trackNames={groupedCanvasRowTrackNames}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onToggleStar={onToggleStar}
            highlightQuery={searchQuery}
          />
        ))}
    </div>
  );
};

interface ProjectSectionProps extends Omit<
  CanvasListGroupedContentProps,
  | 'projectGroups'
  | 'personalFolderGroups'
  | 'personalCanvases'
  | 'isEmpty'
  | 'isSearchLoading'
  | 'isPersonalSectionCollapsed'
  | 'onSetPersonalSectionCollapsed'
  | 'onCreatePersonalCanvas'
> {
  group: ProjectGroup;
}

interface ChannelSectionProps extends Omit<
  ProjectSectionProps,
  'group' | 'onToggleProject' | 'onCreateCanvasInProject' | 'onCreateFolder'
> {
  channelGroup: ProjectGroup['channels'][number];
  onRegisterFolderIds: (folderIds: readonly string[]) => void;
  excludeCallGeneratedCanvases: boolean;
  searchQuery: string;
}

const ChannelSection: React.FC<ChannelSectionProps> = ({
  channelGroup,
  currentUserId,
  selectedCanvasId,
  usersById,
  adminChannelIds,
  collapsedChannels,
  collapsedFolders,
  renamingFolderId,
  renamingFolderName,
  setRenamingFolderName,
  isCreatingCanvas,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleChannel,
  onToggleFolder,
  onOpenChannelCreateDialog,
  onCreateCanvasInFolder,
  onStartRenameFolder,
  onConfirmRenameFolder,
  onCancelRenameFolder,
  onDeleteFolder,
  onRegisterFolderIds,
  excludeCallGeneratedCanvases,
  showStarredOnly,
  onToggleStar,
  searchQuery,
}) => {
  const isSearchActive = searchQuery.length > 0;
  const isCollapsed = !isSearchActive && collapsedChannels.has(channelGroup.channel.id);
  const channelName = getChannelDisplayName(channelGroup.channel, currentUserId, usersById);
  const [channelFoldersResult] = useCachedQuery(
    queries.channelCanvasFolders({
      channelId: channelGroup.channel.id,
    }),
    { enabled: !isCollapsed },
  );
  const [channelRootCanvasesResult] = useCachedQuery(
    queries.hierarchyCanvases({
      scope: 'channel_root',
      channelId: channelGroup.channel.id,
    }),
    { enabled: !isCollapsed },
  );
  const channelRootCanvases = useMemo(
    () =>
      filterStarredCanvases(
        filterExcludedCallGeneratedCanvases(
          withStarredCanvasState(toArray<Canvas>(channelRootCanvasesResult)),
          excludeCallGeneratedCanvases,
        ),
        showStarredOnly,
      ),
    [channelRootCanvasesResult, excludeCallGeneratedCanvases, showStarredOnly],
  );
  const channelNameMatches = matchesGroupedCanvasSearch(channelName, searchQuery);
  const visibleChannelRootCanvases = useMemo(
    () =>
      isSearchActive
        ? channelRootCanvases.filter(
            canvas => channelNameMatches || canvasMatchesGroupedSearch(canvas, searchQuery),
          )
        : channelRootCanvases,
    [channelNameMatches, channelRootCanvases, isSearchActive, searchQuery],
  );
  const channelFolders = useMemo(
    () => toArray<CanvasFolder>(channelFoldersResult),
    [channelFoldersResult],
  );
  const hasMatchingChannelFolder = useMemo(
    () => channelFolders.some(folder => matchesGroupedCanvasSearch(folder.name, searchQuery)),
    [channelFolders, searchQuery],
  );
  const showChannelHeader =
    !isSearchActive ||
    channelNameMatches ||
    visibleChannelRootCanvases.length > 0 ||
    hasMatchingChannelFolder;

  useEffect(() => {
    if (channelFolders.length === 0) return;
    onRegisterFolderIds(channelFolders.map(folder => folder.id));
  }, [channelFolders, onRegisterFolderIds]);

  return (
    <div key={channelGroup.channel.id}>
      {showChannelHeader && (
        <div className='flex items-center group'>
          <button
            className='flex min-w-0 flex-1 items-center gap-2 pl-6 pr-3 py-1.5 hover:bg-accent rounded-md text-left'
            onClick={() => onToggleChannel(channelGroup.channel.id)}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_CANVAS_CHANNEL'
          >
            {isCollapsed ? (
              <ChevronRight className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
            ) : (
              <ChevronDown className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
            )}
            <Hash className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
            <span className='text-sm truncate'>
              <HighlightedText text={channelName} query={searchQuery} />
            </span>
          </button>
          <button
            className='p-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded transition-all disabled:opacity-40'
            onClick={() => onOpenChannelCreateDialog(channelGroup.channel, channelFolders)}
            disabled={isCreatingCanvas || !!channelGroup.channel.isArchived}
            title={
              channelGroup.channel.isArchived
                ? 'Archived channels cannot create canvases or folders'
                : 'Create canvas in channel'
            }
            data-track-category='CANVAS'
            data-track-name='OPEN_CHANNEL_CANVAS_CREATE'
          >
            <Plus className='w-4 h-4 text-muted-foreground' />
          </button>
        </div>
      )}
      {!isCollapsed && (
        <div className='space-y-0.5'>
          {channelFolders.map(folder => (
            <FolderGroupSection
              key={folder.id}
              folderGroup={{ folder, canvases: [] }}
              indentClassName='pl-10'
              canvasIndentClassName='pl-14'
              currentUserId={currentUserId}
              selectedCanvasId={selectedCanvasId}
              adminChannelIds={adminChannelIds}
              collapsedFolders={collapsedFolders}
              renamingFolderId={renamingFolderId}
              renamingFolderName={renamingFolderName}
              setRenamingFolderName={setRenamingFolderName}
              isCreatingCanvas={isCreatingCanvas}
              excludeCallGeneratedCanvases={excludeCallGeneratedCanvases}
              showStarredOnly={showStarredOnly}
              onSelect={onSelect}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onToggleStar={onToggleStar}
              onToggleFolder={onToggleFolder}
              onCreateCanvasInFolder={onCreateCanvasInFolder}
              onStartRenameFolder={onStartRenameFolder}
              onConfirmRenameFolder={onConfirmRenameFolder}
              onCancelRenameFolder={onCancelRenameFolder}
              onDeleteFolder={onDeleteFolder}
              searchQuery={searchQuery}
            />
          ))}
          {visibleChannelRootCanvases.map(canvas => (
            <CanvasRow
              key={canvas.id}
              canvas={canvas}
              indentClassName='pl-10'
              onSelect={onSelect}
              selectedCanvasId={selectedCanvasId}
              currentUserId={currentUserId}
              trackNames={groupedCanvasRowTrackNames}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onToggleStar={onToggleStar}
              highlightQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ProjectSection: React.FC<ProjectSectionProps> = ({
  group,
  currentUserId,
  selectedCanvasId,
  usersById,
  adminChannelIds,
  collapsedProjects,
  collapsedChannels,
  collapsedFolders,
  renamingFolderId,
  renamingFolderName,
  setRenamingFolderName,
  isCreatingCanvas,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleProject,
  onToggleChannel,
  onToggleFolder,
  onCreateCanvasInProject,
  onCreateFolder,
  onOpenChannelCreateDialog,
  onCreateCanvasInFolder,
  onStartRenameFolder,
  onConfirmRenameFolder,
  onCancelRenameFolder,
  onDeleteFolder,
  onRegisterFolderIds,
  excludeCallGeneratedCanvases,
  showStarredOnly,
  onToggleStar,
  searchQuery,
}) => {
  const isSearchActive = searchQuery.length > 0;
  const isProjectCollapsed = !isSearchActive && collapsedProjects.has(group.project.id);
  const [projectFoldersResult] = useCachedQuery(
    queries.projectCanvasFolders({
      projectId: group.project.id,
    }),
    { enabled: !isProjectCollapsed },
  );
  const projectFolders = useMemo(
    () => toArray<CanvasFolder>(projectFoldersResult),
    [projectFoldersResult],
  );
  const projectRootCanvases = useMemo(
    () =>
      filterStarredCanvases(
        filterExcludedCallGeneratedCanvases(
          withStarredCanvasState(group.rootCanvases),
          excludeCallGeneratedCanvases,
        ),
        showStarredOnly,
      ),
    [excludeCallGeneratedCanvases, group.rootCanvases, showStarredOnly],
  );
  const projectNameMatches = matchesGroupedCanvasSearch(group.project.name, searchQuery);
  const visibleProjectRootCanvases = useMemo(
    () =>
      isSearchActive
        ? projectRootCanvases.filter(
            canvas => projectNameMatches || canvasMatchesGroupedSearch(canvas, searchQuery),
          )
        : projectRootCanvases,
    [isSearchActive, projectNameMatches, projectRootCanvases, searchQuery],
  );

  useEffect(() => {
    if (projectFolders.length === 0) return;
    onRegisterFolderIds(projectFolders.map(folder => folder.id));
  }, [onRegisterFolderIds, projectFolders]);

  const hasMatchingProjectFolder = useMemo(
    () => projectFolders.some(folder => matchesGroupedCanvasSearch(folder.name, searchQuery)),
    [projectFolders, searchQuery],
  );
  const hasMatchingChannel = useMemo(
    () =>
      group.channels.some(channel => {
        const channelName = getChannelDisplayName(channel.channel, currentUserId, usersById);
        return matchesGroupedCanvasSearch(channelName, searchQuery);
      }),
    [currentUserId, group.channels, searchQuery, usersById],
  );
  const showProjectHeader =
    !isSearchActive ||
    projectNameMatches ||
    visibleProjectRootCanvases.length > 0 ||
    hasMatchingProjectFolder ||
    hasMatchingChannel;

  return (
    <section
      key={group.project.id}
      className={showProjectHeader ? 'border-b border-border pb-1 last:border-b-0' : ''}
    >
      {showProjectHeader && (
        <div className='flex items-center group'>
          <button
            className='flex min-w-0 flex-1 items-center gap-2 px-3 py-2 hover:bg-accent rounded-md text-left'
            onClick={() => onToggleProject(group.project.id)}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_CANVAS_PROJECT'
          >
            {isProjectCollapsed ? (
              <ChevronRight className='w-4 h-4 text-muted-foreground shrink-0' />
            ) : (
              <ChevronDown className='w-4 h-4 text-muted-foreground shrink-0' />
            )}
            <FolderOpen className='w-4 h-4 text-amber-500 shrink-0' />
            <span className='font-semibold text-sm truncate'>
              <HighlightedText text={group.project.name} query={searchQuery} />
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className='p-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded transition-all disabled:opacity-40'
                onClick={event => event.stopPropagation()}
                title='Create canvas or folder'
                disabled={isCreatingCanvas}
                data-track-category='CANVAS'
                data-track-name='OPEN_PROJECT_CANVAS_CREATE'
              >
                <Plus className='w-4 h-4 text-muted-foreground' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              <DropdownMenuItem
                onClick={() => void onCreateCanvasInProject(group.project, projectFolders)}
                data-track-category='CANVAS'
                data-track-name='CREATE_PROJECT_CANVAS'
              >
                <FileText className='w-4 h-4 mr-2' />
                Create canvas
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onCreateFolder(group.project.id, projectFolders)}
                data-track-category='CANVAS'
                data-track-name='CREATE_CANVAS_FOLDER'
              >
                <Folder className='w-4 h-4 mr-2 text-amber-500' />
                Create folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {!isProjectCollapsed && (
        <div className='space-y-0.5'>
          {group.channels.map(channelGroup => (
            <ChannelSection
              key={channelGroup.channel.id}
              channelGroup={channelGroup}
              currentUserId={currentUserId}
              selectedCanvasId={selectedCanvasId}
              usersById={usersById}
              adminChannelIds={adminChannelIds}
              collapsedProjects={collapsedProjects}
              collapsedChannels={collapsedChannels}
              collapsedFolders={collapsedFolders}
              renamingFolderId={renamingFolderId}
              renamingFolderName={renamingFolderName}
              setRenamingFolderName={setRenamingFolderName}
              isCreatingCanvas={isCreatingCanvas}
              excludeCallGeneratedCanvases={excludeCallGeneratedCanvases}
              showStarredOnly={showStarredOnly}
              onSelect={onSelect}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onToggleStar={onToggleStar}
              onToggleChannel={onToggleChannel}
              onToggleFolder={onToggleFolder}
              onOpenChannelCreateDialog={onOpenChannelCreateDialog}
              onCreateCanvasInFolder={onCreateCanvasInFolder}
              onStartRenameFolder={onStartRenameFolder}
              onConfirmRenameFolder={onConfirmRenameFolder}
              onCancelRenameFolder={onCancelRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onRegisterFolderIds={onRegisterFolderIds}
              searchQuery={searchQuery}
            />
          ))}

          {projectFolders.map(folder => (
            <FolderGroupSection
              key={folder.id}
              folderGroup={{ folder, canvases: [] }}
              indentClassName='pl-6'
              canvasIndentClassName='pl-10'
              currentUserId={currentUserId}
              selectedCanvasId={selectedCanvasId}
              adminChannelIds={adminChannelIds}
              collapsedFolders={collapsedFolders}
              renamingFolderId={renamingFolderId}
              renamingFolderName={renamingFolderName}
              setRenamingFolderName={setRenamingFolderName}
              isCreatingCanvas={isCreatingCanvas}
              excludeCallGeneratedCanvases={excludeCallGeneratedCanvases}
              showStarredOnly={showStarredOnly}
              onSelect={onSelect}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onToggleStar={onToggleStar}
              onToggleFolder={onToggleFolder}
              onCreateCanvasInFolder={onCreateCanvasInFolder}
              onStartRenameFolder={onStartRenameFolder}
              onConfirmRenameFolder={onConfirmRenameFolder}
              onCancelRenameFolder={onCancelRenameFolder}
              onDeleteFolder={onDeleteFolder}
              searchQuery={searchQuery}
            />
          ))}

          {visibleProjectRootCanvases.map(canvas => (
            <CanvasRow
              key={canvas.id}
              canvas={canvas}
              indentClassName='pl-6'
              onSelect={onSelect}
              selectedCanvasId={selectedCanvasId}
              currentUserId={currentUserId}
              trackNames={groupedCanvasRowTrackNames}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onToggleStar={onToggleStar}
              highlightQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export interface CanvasListGroupedContentProps {
  projectGroups: ProjectGroup[];
  personalFolderGroups: FolderGroup[];
  personalCanvases: Canvas[];
  isEmpty: boolean;
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  currentUserId?: string | undefined;
  selectedCanvasId?: string | undefined;
  usersById: Map<string, CanvasUser>;
  adminChannelIds: ReadonlySet<string>;
  isPersonalSectionCollapsed: boolean;
  excludeCallGeneratedCanvases: boolean;
  showStarredOnly: boolean;
  collapsedProjects: ReadonlySet<string>;
  collapsedChannels: ReadonlySet<string>;
  collapsedFolders: ReadonlySet<string>;
  renamingFolderId: string | null;
  renamingFolderName: string;
  setRenamingFolderName: React.Dispatch<React.SetStateAction<string>>;
  isCreatingCanvas: boolean;
  onToggleProject: (projectId: string) => void;
  onToggleChannel: (channelId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onDelete?: ((id: string) => void) | undefined;
  onDuplicate?: ((canvas: Canvas) => void) | undefined;
  onToggleStar?: ((canvas: Canvas) => void) | undefined;
  onSetPersonalSectionCollapsed: (collapsed: boolean) => void;
  onCreatePersonalCanvas: () => void | Promise<void>;
  onCreateCanvasInProject: (
    project: CanvasProject,
    projectFolders: CanvasFolder[],
  ) => void | Promise<void>;
  onCreateFolder: (projectId: string | null, existingFolders?: CanvasFolder[]) => void;
  onOpenChannelCreateDialog: (channel: CanvasChannel, channelFolders: CanvasFolder[]) => void;
  onCreateCanvasInFolder: (folder: CanvasFolder) => void | Promise<void>;
  onStartRenameFolder: (folder: CanvasFolder) => void;
  onConfirmRenameFolder: (folder: CanvasFolder) => void;
  onCancelRenameFolder: () => void;
  onDeleteFolder: (folder: CanvasFolder, canvasCount: number) => void;
  onRegisterFolderIds: (folderIds: readonly string[]) => void;
  searchQuery: string;
  isSearchLoading: boolean;
}

export const CanvasListGroupedContent: React.FC<CanvasListGroupedContentProps> = ({
  projectGroups,
  personalFolderGroups,
  personalCanvases,
  isEmpty,
  onSelect,
  currentUserId,
  selectedCanvasId,
  usersById,
  adminChannelIds,
  isPersonalSectionCollapsed,
  excludeCallGeneratedCanvases,
  showStarredOnly,
  collapsedProjects,
  collapsedChannels,
  collapsedFolders,
  renamingFolderId,
  renamingFolderName,
  setRenamingFolderName,
  isCreatingCanvas,
  onToggleProject,
  onToggleChannel,
  onToggleFolder,
  onDelete,
  onDuplicate,
  onToggleStar,
  onSetPersonalSectionCollapsed,
  onCreatePersonalCanvas,
  onCreateCanvasInProject,
  onCreateFolder,
  onOpenChannelCreateDialog,
  onCreateCanvasInFolder,
  onStartRenameFolder,
  onConfirmRenameFolder,
  onCancelRenameFolder,
  onDeleteFolder,
  onRegisterFolderIds,
  searchQuery,
  isSearchLoading,
}) => {
  const isSearchActive = searchQuery.length > 0;
  const visiblePersonalCanvases = useMemo(() => {
    const filtered = filterExcludedCallGeneratedCanvases(
      personalCanvases,
      excludeCallGeneratedCanvases,
    );

    return isSearchActive
      ? filtered.filter(canvas => canvasMatchesGroupedSearch(canvas, searchQuery))
      : filtered;
  }, [excludeCallGeneratedCanvases, isSearchActive, personalCanvases, searchQuery]);

  if (isEmpty) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-center py-16'>
        <FileText className='w-16 h-16 text-muted-foreground mb-4' />
        <h3 className='text-lg font-medium text-foreground mb-2'>No canvases yet</h3>
        <p className='text-muted-foreground text-sm'>
          Create your first personal canvas or folder to get started.
        </p>
      </div>
    );
  }

  return (
    <div className='p-2 space-y-1'>
      {isSearchLoading && (
        <div className='flex items-center justify-center gap-2 px-3 py-3 text-sm text-muted-foreground'>
          <div className='animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600' />
          <span>Searching...</span>
        </div>
      )}

      <section className='border-b border-border pb-1'>
        <div className='flex items-center group'>
          <button
            className='flex min-w-0 flex-1 items-center gap-2 px-3 py-2 hover:bg-accent rounded-md text-left'
            onClick={() => onSetPersonalSectionCollapsed(!isPersonalSectionCollapsed)}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_PERSONAL_CANVAS_SECTION'
          >
            {isPersonalSectionCollapsed ? (
              <ChevronRight className='w-4 h-4 text-muted-foreground shrink-0' />
            ) : (
              <ChevronDown className='w-4 h-4 text-muted-foreground shrink-0' />
            )}
            <User className='w-4 h-4 text-muted-foreground shrink-0' />
            <span className='font-semibold text-sm'>My Canvases</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className='p-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded transition-all disabled:opacity-40'
                onClick={event => event.stopPropagation()}
                title='Create personal canvas or folder'
                disabled={isCreatingCanvas}
                data-track-category='CANVAS'
                data-track-name='OPEN_PERSONAL_CANVAS_CREATE'
              >
                <Plus className='w-4 h-4 text-muted-foreground' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              <DropdownMenuItem
                onClick={() => void onCreatePersonalCanvas()}
                data-track-category='CANVAS'
                data-track-name='CREATE_PERSONAL_CANVAS'
              >
                <FileText className='w-4 h-4 mr-2' />
                Create canvas
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onCreateFolder(
                    null,
                    personalFolderGroups.map(folderGroup => folderGroup.folder),
                  )
                }
                data-track-category='CANVAS'
                data-track-name='CREATE_PERSONAL_CANVAS_FOLDER'
              >
                <Folder className='w-4 h-4 mr-2 text-amber-500' />
                Create folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {(!isPersonalSectionCollapsed || isSearchActive) && (
          <>
            {personalFolderGroups.map(folderGroup => (
              <FolderGroupSection
                key={folderGroup.folder.id}
                folderGroup={folderGroup}
                indentClassName='pl-6'
                canvasIndentClassName='pl-10'
                currentUserId={currentUserId}
                selectedCanvasId={selectedCanvasId}
                adminChannelIds={adminChannelIds}
                collapsedFolders={collapsedFolders}
                renamingFolderId={renamingFolderId}
                renamingFolderName={renamingFolderName}
                setRenamingFolderName={setRenamingFolderName}
                isCreatingCanvas={isCreatingCanvas}
                excludeCallGeneratedCanvases={excludeCallGeneratedCanvases}
                showStarredOnly={showStarredOnly}
                onSelect={onSelect}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onToggleStar={onToggleStar}
                onToggleFolder={onToggleFolder}
                onCreateCanvasInFolder={onCreateCanvasInFolder}
                onStartRenameFolder={onStartRenameFolder}
                onConfirmRenameFolder={onConfirmRenameFolder}
                onCancelRenameFolder={onCancelRenameFolder}
                onDeleteFolder={onDeleteFolder}
                searchQuery={searchQuery}
              />
            ))}
            {visiblePersonalCanvases.map(canvas => (
              <CanvasRow
                key={canvas.id}
                canvas={canvas}
                indentClassName='pl-6'
                onSelect={onSelect}
                selectedCanvasId={selectedCanvasId}
                currentUserId={currentUserId}
                trackNames={groupedCanvasRowTrackNames}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onToggleStar={onToggleStar}
                highlightQuery={searchQuery}
              />
            ))}
            {personalFolderGroups.length === 0 && visiblePersonalCanvases.length === 0 && (
              <div className='px-6 py-2 text-sm text-muted-foreground'>
                Create a personal canvas or folder to get started.
              </div>
            )}
          </>
        )}
      </section>

      {projectGroups.map(group => (
        <ProjectSection
          key={group.project.id}
          group={group}
          onSelect={onSelect}
          currentUserId={currentUserId}
          selectedCanvasId={selectedCanvasId}
          usersById={usersById}
          adminChannelIds={adminChannelIds}
          collapsedProjects={collapsedProjects}
          collapsedChannels={collapsedChannels}
          collapsedFolders={collapsedFolders}
          renamingFolderId={renamingFolderId}
          renamingFolderName={renamingFolderName}
          setRenamingFolderName={setRenamingFolderName}
          isCreatingCanvas={isCreatingCanvas}
          onToggleProject={onToggleProject}
          onToggleChannel={onToggleChannel}
          onToggleFolder={onToggleFolder}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onCreateCanvasInProject={onCreateCanvasInProject}
          onCreateFolder={onCreateFolder}
          onOpenChannelCreateDialog={onOpenChannelCreateDialog}
          onCreateCanvasInFolder={onCreateCanvasInFolder}
          onStartRenameFolder={onStartRenameFolder}
          onConfirmRenameFolder={onConfirmRenameFolder}
          onCancelRenameFolder={onCancelRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onRegisterFolderIds={onRegisterFolderIds}
          excludeCallGeneratedCanvases={excludeCallGeneratedCanvases}
          showStarredOnly={showStarredOnly}
          onToggleStar={onToggleStar}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
};
