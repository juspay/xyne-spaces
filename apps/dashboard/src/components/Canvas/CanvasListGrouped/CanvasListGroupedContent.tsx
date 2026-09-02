import React, { useEffect, useMemo } from 'react';
import {
  ChevronBigDown,
  ChevronBigRight,
  DeleteDustbin01,
  FileText,
  FolderDefault,
  Hashtag,
  PencilEdit,
  PlusDefault,
  Spinner,
  ThreeDotsMenuHorizontal,
  UserDefault,
} from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import type { Canvas, CanvasChannel, CanvasFolder, CanvasProject } from '../Canvas.types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Input from '../../ui/Input';
import { Button } from '../../ui/Button/Button';
import { CanvasRow, HighlightedText } from '../CanvasRow';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { CanvasUser, FolderGroup, ProjectGroup } from './CanvasListGrouped.utils';
import {
  filterArchivedCanvases,
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

const SHARED_PERSONAL_FOLDER_ID = '__shared_personal_canvases__';

/**
 * Sidebar idiom shared with the chat directory. Every item — section headers
 * and rows alike — is 36px so the list keeps a single vertical rhythm. Rows add
 * a hover border that appears without shifting layout (transparent at rest).
 */
const SECTION_HEADER_CLASS =
  'flex min-w-0 flex-1 items-center gap-2 h-9 px-3 text-left text-sm font-medium tracking-[-0.14px] text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors';

const ROW_CLASS =
  'group flex items-center gap-3 h-9 px-3 rounded-[10px] border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';

/** Hover-revealed control: `display`, not `opacity`, so it reserves no width. */
const HOVER_ACTION_CLASS =
  'hidden group-hover:flex items-center justify-center p-1 rounded-md shrink-0 hover:bg-sidebar-accent disabled:opacity-40';

const SearchLoadingRow: React.FC<{ indentClassName?: string }> = ({ indentClassName = 'pl-2' }) => (
  <div
    className={`flex items-center gap-3 ${indentClassName} px-3 h-9 text-sm text-sidebar-foreground`}
  >
    <Spinner size={16} className='animate-spin shrink-0' />
    <span>Searching...</span>
  </div>
);

interface FolderGroupSectionProps {
  folderGroup: FolderGroup;
  indentClassName: string;
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
  onArchiveToggle?: ((canvas: Canvas) => void) | undefined;
  includeArchived: boolean;
  onlyArchived: boolean;
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
  onArchiveToggle,
  includeArchived,
  onlyArchived,
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
      includeArchived,
      onlyArchived,
    }),
    { enabled: !isCollapsed && isProjectFolder },
  );
  const [genericFolderCanvases, genericFolderCanvasesDetails] = useCachedQuery(
    queries.hierarchyCanvases({
      scope: 'folder',
      folderId: folderGroup.folder.id,
      includeArchived,
      onlyArchived,
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
            filterArchivedCanvases(
              toArray<Canvas>(isProjectFolder ? projectFolderCanvases : genericFolderCanvases),
              { includeArchived, onlyArchived },
            ),
          ),
          excludeCallGeneratedCanvases,
        ),
        showStarredOnly,
      ),
    [
      excludeCallGeneratedCanvases,
      genericFolderCanvases,
      includeArchived,
      isProjectFolder,
      onlyArchived,
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
      <div className={cn(indentClassName, 'relative')}>
        <div className={ROW_CLASS}>
          <button
            className='flex items-center gap-2 shrink-0'
            onClick={() => onToggleFolder(folderGroup.folder.id)}
            title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_CANVAS_FOLDER_ICON'
          >
            {isCollapsed ? (
              <ChevronBigRight size={12} className='shrink-0' />
            ) : (
              <ChevronBigDown size={12} className='shrink-0' />
            )}
            <FolderDefault size={16} className='shrink-0' />
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
              className='h-7 flex-1 min-w-0 text-sm px-2 py-0'
            />
          ) : (
            <button
              className='min-w-0 flex-1 text-left'
              onClick={() => onToggleFolder(folderGroup.folder.id)}
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${folderGroup.folder.name}`}
              title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
              data-track-category='CANVAS'
              data-track-name='TOGGLE_CANVAS_FOLDER'
            >
              <span className='block truncate text-sm font-medium tracking-[-0.14px]'>
                <HighlightedText text={folderGroup.folder.name} query={searchQuery} />
              </span>
            </button>
          )}
          <Button
            variant='ghost'
            className={HOVER_ACTION_CLASS}
            onClick={() => void onCreateCanvasInFolder(folderGroup.folder)}
            disabled={isCreatingCanvas}
            title='Create canvas in folder'
            trackId='create_canvas_in_folder'
            data-track-category='CANVAS'
            data-track-name='CREATE_CANVAS_IN_FOLDER'
          >
            <PlusDefault size={14} />
          </Button>
          {canRenameFolder && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={HOVER_ACTION_CLASS}
                  onClick={event => event.stopPropagation()}
                  title='Folder actions'
                  data-track-category='CANVAS'
                  data-track-name='CANVAS_FOLDER_ACTIONS_MENU'
                >
                  <ThreeDotsMenuHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-40'>
                <DropdownMenuItem
                  className='gap-2'
                  onClick={() => onStartRenameFolder(folderGroup.folder)}
                  data-track-category='CANVAS'
                  data-track-name='RENAME_CANVAS_FOLDER'
                >
                  <PencilEdit size={14} className='shrink-0' />
                  <span className='flex-1'>Rename</span>
                </DropdownMenuItem>
                {canDeleteFolder && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDeleteFolder(folderGroup.folder, folderCanvases.length)}
                      className='gap-2 text-destructive focus:text-destructive'
                      data-track-category='CANVAS'
                      data-track-name='DELETE_CANVAS_FOLDER'
                    >
                      <DeleteDustbin01 size={14} className='shrink-0' />
                      <span className='flex-1'>Delete</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {/* Children sit behind a vertical guide rail, per the frame's
          folder-with-nested-canvases group. The 18px offset centres the rail on
          the folder row's chevron (12px row padding + half of the 12px glyph).
          It uses `ml-*`, not `pl-*`: `cn` runs tailwind-merge, so a `pl-*` on the
          indent wrapper would override the caller's `pl-10` rather than add to
          it, leaving children rendering shallower than the folder they belong to. */}
      {!isCollapsed && (isFolderLoading || visibleFolderCanvases.length > 0) && (
        <div className={indentClassName}>
          <div className='ml-[18px] border-l border-border pl-3'>
            {isFolderLoading && <SearchLoadingRow indentClassName='' />}
            {visibleFolderCanvases.map(canvas => (
              <CanvasRow
                key={canvas.id}
                canvas={canvas}
                indentClassName=''
                onSelect={onSelect}
                selectedCanvasId={selectedCanvasId}
                currentUserId={currentUserId}
                trackNames={groupedCanvasRowTrackNames}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onToggleStar={onToggleStar}
                onArchiveToggle={onArchiveToggle}
                highlightQuery={searchQuery}
              />
            ))}
          </div>
        </div>
      )}
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
  onArchiveToggle,
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
  includeArchived,
  onlyArchived,
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
      includeArchived,
      onlyArchived,
    }),
    { enabled: !isCollapsed },
  );
  const channelRootCanvases = useMemo(
    () =>
      filterStarredCanvases(
        filterExcludedCallGeneratedCanvases(
          withStarredCanvasState(
            filterArchivedCanvases(toArray<Canvas>(channelRootCanvasesResult), {
              includeArchived,
              onlyArchived,
            }),
          ),
          excludeCallGeneratedCanvases,
        ),
        showStarredOnly,
      ),
    [
      channelRootCanvasesResult,
      excludeCallGeneratedCanvases,
      includeArchived,
      onlyArchived,
      showStarredOnly,
    ],
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
        <div className='group flex items-center pl-3'>
          <button
            className={SECTION_HEADER_CLASS}
            onClick={() => onToggleChannel(channelGroup.channel.id)}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_CANVAS_CHANNEL'
          >
            {isCollapsed ? (
              <ChevronBigRight size={12} className='shrink-0' />
            ) : (
              <ChevronBigDown size={12} className='shrink-0' />
            )}
            <Hashtag size={12} className='shrink-0' />
            <span className='truncate'>
              <HighlightedText text={channelName} query={searchQuery} />
            </span>
          </button>
          <button
            className={HOVER_ACTION_CLASS}
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
            <PlusDefault size={14} />
          </button>
        </div>
      )}
      {!isCollapsed && (
        <div>
          {channelFolders.map(folder => (
            <FolderGroupSection
              key={folder.id}
              folderGroup={{ folder, canvases: [] }}
              indentClassName='pl-10'
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
              onArchiveToggle={onArchiveToggle}
              includeArchived={includeArchived}
              onlyArchived={onlyArchived}
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
              onArchiveToggle={onArchiveToggle}
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
  onArchiveToggle,
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
  includeArchived,
  onlyArchived,
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
          withStarredCanvasState(
            filterArchivedCanvases(group.rootCanvases, { includeArchived, onlyArchived }),
          ),
          excludeCallGeneratedCanvases,
        ),
        showStarredOnly,
      ),
    [
      excludeCallGeneratedCanvases,
      group.rootCanvases,
      includeArchived,
      onlyArchived,
      showStarredOnly,
    ],
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
    <section key={group.project.id} className={showProjectHeader ? 'pb-1' : ''}>
      {showProjectHeader && (
        <div className='group flex items-center'>
          <button
            className={SECTION_HEADER_CLASS}
            onClick={() => onToggleProject(group.project.id)}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_CANVAS_PROJECT'
          >
            {isProjectCollapsed ? (
              <ChevronBigRight size={12} className='shrink-0' />
            ) : (
              <ChevronBigDown size={12} className='shrink-0' />
            )}
            <FolderDefault size={14} className='shrink-0' />
            <span className='truncate font-semibold'>
              <HighlightedText text={group.project.name} query={searchQuery} />
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={HOVER_ACTION_CLASS}
                onClick={event => event.stopPropagation()}
                title='Create canvas or folder'
                disabled={isCreatingCanvas}
                data-track-category='CANVAS'
                data-track-name='OPEN_PROJECT_CANVAS_CREATE'
              >
                <PlusDefault size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              <DropdownMenuItem
                className='gap-2'
                onClick={() => void onCreateCanvasInProject(group.project, projectFolders)}
                data-track-category='CANVAS'
                data-track-name='CREATE_PROJECT_CANVAS'
              >
                <FileText size={14} className='shrink-0' />
                <span className='flex-1'>Create canvas</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className='gap-2'
                onClick={() => onCreateFolder(group.project.id, projectFolders)}
                data-track-category='CANVAS'
                data-track-name='CREATE_CANVAS_FOLDER'
              >
                <FolderDefault size={14} className='shrink-0' />
                <span className='flex-1'>Create folder</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {!isProjectCollapsed && (
        <div>
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
              onArchiveToggle={onArchiveToggle}
              onToggleStar={onToggleStar}
              includeArchived={includeArchived}
              onlyArchived={onlyArchived}
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
              onArchiveToggle={onArchiveToggle}
              includeArchived={includeArchived}
              onlyArchived={onlyArchived}
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
              onArchiveToggle={onArchiveToggle}
              highlightQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </section>
  );
};

interface SharedPersonalSectionProps {
  sharedRootCanvases: Canvas[];
  currentUserId?: string | undefined;
  selectedCanvasId?: string | undefined;
  collapsedFolders: ReadonlySet<string>;
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  onDelete?: ((id: string) => void) | undefined;
  onDuplicate?: ((canvas: Canvas) => void) | undefined;
  onToggleStar?: ((canvas: Canvas) => void) | undefined;
  onArchiveToggle?: ((canvas: Canvas) => void) | undefined;
  onToggleFolder: (folderId: string) => void;
  searchQuery: string;
}

const SharedPersonalSection: React.FC<SharedPersonalSectionProps> = ({
  sharedRootCanvases,
  currentUserId,
  selectedCanvasId,
  collapsedFolders,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleStar,
  onArchiveToggle,
  onToggleFolder,
  searchQuery,
}) => {
  const isSearchActive = searchQuery.length > 0;
  const isCollapsed = !isSearchActive && collapsedFolders.has(SHARED_PERSONAL_FOLDER_ID);
  const sharedFolderNameMatches = matchesGroupedCanvasSearch('Shared', searchQuery);
  const visibleSharedRootCanvases = useMemo(
    () =>
      isSearchActive
        ? sharedRootCanvases.filter(
            canvas => sharedFolderNameMatches || canvasMatchesGroupedSearch(canvas, searchQuery),
          )
        : sharedRootCanvases,
    [isSearchActive, searchQuery, sharedFolderNameMatches, sharedRootCanvases],
  );
  const shouldShowSharedFolder =
    !isSearchActive || sharedFolderNameMatches || visibleSharedRootCanvases.length > 0;

  if (!shouldShowSharedFolder) return null;

  return (
    <div>
      <div className={cn('pl-6', 'relative')}>
        <div className={ROW_CLASS}>
          <button
            className='flex items-center gap-2 shrink-0'
            onClick={() => onToggleFolder(SHARED_PERSONAL_FOLDER_ID)}
            title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_SHARED_CANVAS_FOLDER_ICON'
          >
            {isCollapsed ? (
              <ChevronBigRight size={12} className='shrink-0' />
            ) : (
              <ChevronBigDown size={12} className='shrink-0' />
            )}
            <FolderDefault size={16} className='shrink-0' />
          </button>
          <button
            className='min-w-0 flex-1 text-left'
            onClick={() => onToggleFolder(SHARED_PERSONAL_FOLDER_ID)}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} Shared`}
            title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_SHARED_CANVAS_FOLDER'
          >
            <span className='block truncate text-sm font-medium tracking-[-0.14px]'>
              <HighlightedText text='Shared' query={searchQuery} />
            </span>
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className='pl-6'>
          <div className='ml-[18px] border-l border-border pl-3'>
            {visibleSharedRootCanvases.map(canvas => (
              <CanvasRow
                key={canvas.id}
                canvas={canvas}
                indentClassName=''
                onSelect={onSelect}
                selectedCanvasId={selectedCanvasId}
                currentUserId={currentUserId}
                trackNames={groupedCanvasRowTrackNames}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onToggleStar={onToggleStar}
                onArchiveToggle={onArchiveToggle}
                highlightQuery={searchQuery}
              />
            ))}
          </div>
        </div>
      )}
    </div>
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
  onArchiveToggle?: ((canvas: Canvas) => void) | undefined;
  includeArchived: boolean;
  onlyArchived: boolean;
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
  onArchiveToggle,
  includeArchived,
  onlyArchived,
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
  const personalRootCanvases = useMemo(() => {
    let filtered = filterExcludedCallGeneratedCanvases(
      filterArchivedCanvases(personalCanvases, { includeArchived, onlyArchived }),
      excludeCallGeneratedCanvases,
    );

    filtered = currentUserId
      ? filtered.filter(canvas => canvas.createdBy === currentUserId)
      : filtered;

    return isSearchActive
      ? filtered.filter(canvas => canvasMatchesGroupedSearch(canvas, searchQuery))
      : filtered;
  }, [
    currentUserId,
    excludeCallGeneratedCanvases,
    includeArchived,
    isSearchActive,
    onlyArchived,
    personalCanvases,
    searchQuery,
  ]);
  const sharedRootCanvases = useMemo(() => {
    let filtered = filterExcludedCallGeneratedCanvases(
      filterArchivedCanvases(personalCanvases, { includeArchived, onlyArchived }),
      excludeCallGeneratedCanvases,
    );

    filtered = currentUserId ? filtered.filter(canvas => canvas.createdBy !== currentUserId) : [];

    return isSearchActive
      ? filtered.filter(canvas => canvasMatchesGroupedSearch(canvas, searchQuery))
      : filtered;
  }, [
    currentUserId,
    excludeCallGeneratedCanvases,
    includeArchived,
    isSearchActive,
    onlyArchived,
    personalCanvases,
    searchQuery,
  ]);

  if (isEmpty) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-center py-16'>
        <FileText size={64} className='text-muted-foreground mb-4' />
        <h3 className='text-lg font-medium text-foreground mb-2'>No canvases yet</h3>
        <p className='text-muted-foreground text-sm'>
          Create your first personal canvas or folder to get started.
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-1'>
      {isSearchLoading && (
        <div className='flex items-center justify-center gap-3 px-3 h-9 text-sm text-sidebar-foreground'>
          <Spinner size={16} className='animate-spin shrink-0' />
          <span>Searching...</span>
        </div>
      )}

      <section className='pb-1'>
        <div className='group flex items-center'>
          <button
            className={SECTION_HEADER_CLASS}
            onClick={() => onSetPersonalSectionCollapsed(!isPersonalSectionCollapsed)}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_PERSONAL_CANVAS_SECTION'
          >
            {isPersonalSectionCollapsed ? (
              <ChevronBigRight size={12} className='shrink-0' />
            ) : (
              <ChevronBigDown size={12} className='shrink-0' />
            )}
            <UserDefault size={14} className='shrink-0' />
            <span className='truncate font-semibold'>My Canvases</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={HOVER_ACTION_CLASS}
                onClick={event => event.stopPropagation()}
                title='Create personal canvas or folder'
                disabled={isCreatingCanvas}
                data-track-category='CANVAS'
                data-track-name='OPEN_PERSONAL_CANVAS_CREATE'
              >
                <PlusDefault size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              <DropdownMenuItem
                className='gap-2'
                onClick={() => void onCreatePersonalCanvas()}
                data-track-category='CANVAS'
                data-track-name='CREATE_PERSONAL_CANVAS'
              >
                <FileText size={14} className='shrink-0' />
                <span className='flex-1'>Create canvas</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className='gap-2'
                onClick={() =>
                  onCreateFolder(
                    null,
                    personalFolderGroups.map(folderGroup => folderGroup.folder),
                  )
                }
                data-track-category='CANVAS'
                data-track-name='CREATE_PERSONAL_CANVAS_FOLDER'
              >
                <FolderDefault size={14} className='shrink-0' />
                <span className='flex-1'>Create folder</span>
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
                onArchiveToggle={onArchiveToggle}
                includeArchived={includeArchived}
                onlyArchived={onlyArchived}
                onToggleFolder={onToggleFolder}
                onCreateCanvasInFolder={onCreateCanvasInFolder}
                onStartRenameFolder={onStartRenameFolder}
                onConfirmRenameFolder={onConfirmRenameFolder}
                onCancelRenameFolder={onCancelRenameFolder}
                onDeleteFolder={onDeleteFolder}
                searchQuery={searchQuery}
              />
            ))}
            {personalRootCanvases.map(canvas => (
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
                onArchiveToggle={onArchiveToggle}
                highlightQuery={searchQuery}
              />
            ))}
            <SharedPersonalSection
              sharedRootCanvases={sharedRootCanvases}
              currentUserId={currentUserId}
              selectedCanvasId={selectedCanvasId}
              collapsedFolders={collapsedFolders}
              onSelect={onSelect}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onToggleStar={onToggleStar}
              onArchiveToggle={onArchiveToggle}
              onToggleFolder={onToggleFolder}
              searchQuery={searchQuery}
            />
            {personalFolderGroups.length === 0 &&
              personalRootCanvases.length === 0 &&
              sharedRootCanvases.length === 0 && (
                <div className='px-6 py-2 text-sm text-sidebar-foreground'>
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
          onArchiveToggle={onArchiveToggle}
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
          includeArchived={includeArchived}
          onlyArchived={onlyArchived}
          onToggleStar={onToggleStar}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
};
