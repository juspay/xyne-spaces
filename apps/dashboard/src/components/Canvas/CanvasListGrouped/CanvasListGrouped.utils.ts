import { ChannelScopeType } from '@xyne/shared';
import type { Canvas, CanvasChannel, CanvasFolder, CanvasProject } from '../Canvas.types';
import { getUserDisplayName } from '../../../utils/userDisplayName';

export interface CanvasListGroupedProps {
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  currentUserId?: string | undefined;
  selectedCanvasId?: string | undefined;
  onDelete?: ((id: string) => void) | undefined;
  onDuplicate?: ((canvas: Canvas) => void) | undefined;
  onArchiveToggle?: ((canvas: Canvas) => void) | undefined;
  isPersonalSectionCollapsed: boolean;
  onSetPersonalSectionCollapsed: (collapsed: boolean) => void;
  excludeCallGeneratedCanvases?: boolean;
  excludeRecordingGeneratedCanvases?: boolean;
  showStarredOnly?: boolean;
  includeArchived?: boolean;
  onlyArchived?: boolean;
  onToggleStar?: (canvas: Canvas) => void;
  searchQuery?: string;
}

export interface FolderGroup {
  folder: CanvasFolder;
  canvases: Canvas[];
}

export interface ChannelGroup {
  channel: CanvasChannel;
  rootCanvases: Canvas[];
  folders: FolderGroup[];
}

export interface ProjectGroup {
  project: CanvasProject;
  channels: ChannelGroup[];
  folders: FolderGroup[];
  rootCanvases: Canvas[];
}

export interface CanvasUser {
  id: string;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
  presenceStatus?:
    | {
        statusEmoji?: string | null;
        statusExpiryAt?: number | null;
      }
    | null
    | undefined;
}

export function sortByName<T>(items: T[], getName: (item: T) => string): T[] {
  return [...items].sort((a, b) => getName(a).localeCompare(getName(b)));
}

export function sortCanvases(canvases: Canvas[]): Canvas[] {
  return [...canvases].sort(
    (a, b) =>
      b.updatedAt - a.updatedAt || (a.title || 'Untitled').localeCompare(b.title || 'Untitled'),
  );
}

export function matchesGroupedCanvasSearch(
  value: string | null | undefined,
  query: string,
): boolean {
  return Boolean(value?.toLowerCase().includes(query));
}

export function canvasMatchesGroupedSearch(canvas: Canvas, query: string): boolean {
  return matchesGroupedCanvasSearch(canvas.title, query);
}

export function getChannelDisplayName(
  channel: CanvasChannel,
  currentUserId: string | undefined,
  usersById: Map<string, CanvasUser>,
): string {
  if (
    channel.scopeType !== ChannelScopeType.DM &&
    channel.scopeType !== ChannelScopeType.GROUP_DM
  ) {
    return channel.name;
  }

  const participantIds = channel.name.split(',').filter(Boolean);
  const otherParticipantIds = currentUserId
    ? participantIds.filter(id => id !== currentUserId)
    : participantIds;

  if (channel.scopeType === ChannelScopeType.DM) {
    const otherUserId = otherParticipantIds[0] ?? participantIds[0];
    const user = otherUserId ? usersById.get(otherUserId) : undefined;

    if (otherUserId === currentUserId) {
      return user ? `${getUserDisplayName(user)} (you)` : 'You';
    }

    return user ? getUserDisplayName(user) : 'Unknown User';
  }

  const userNames = otherParticipantIds
    .map(id => usersById.get(id))
    .filter((user): user is CanvasUser => Boolean(user))
    .map(user => getUserDisplayName(user));

  if (userNames.length === 0) return 'Group Chat';
  if (otherParticipantIds.length <= 3) return userNames.join(', ');

  const remainingCount = otherParticipantIds.length - 3;
  return `${userNames.slice(0, 3).join(', ')} and ${remainingCount} other${remainingCount > 1 ? 's' : ''}`;
}

export interface CanvasHierarchyMeta {
  projects: CanvasProject[];
  personalFolders: CanvasFolder[];
  projectFolders: CanvasFolder[];
  projectChannels: CanvasChannel[];
  channelFolders: CanvasFolder[];
}

export interface CanvasHierarchySections {
  projects: CanvasProject[];
  personalFolders: CanvasFolder[];
  personalCanvases: Canvas[];
  projectFolders: CanvasFolder[];
  projectRootCanvases: Canvas[];
  projectChannels: CanvasChannel[];
  channelFolders: CanvasFolder[];
  channelRootCanvases: Canvas[];
  folderCanvases: Canvas[];
}

interface BuildGroupedCanvasSectionsOptions {
  currentUserId?: string | undefined;
  usersById: Map<string, CanvasUser>;
}

interface GroupedCanvasSections {
  projectGroups: ProjectGroup[];
  personalFolderGroups: FolderGroup[];
  personalCanvases: Canvas[];
}

export function buildGroupedCanvasSections(
  sections: CanvasHierarchySections,
  options: BuildGroupedCanvasSectionsOptions,
): GroupedCanvasSections {
  const { currentUserId, usersById } = options;
  const groups = new Map<string, ProjectGroup>();
  const projectChannelsById = new Map(
    sections.projectChannels.map(channel => [channel.id, channel]),
  );

  const ensureProjectGroup = (projectId: string): ProjectGroup | null => {
    let group = groups.get(projectId);
    if (group) return group;

    const project = sections.projects.find(item => item.id === projectId) ?? null;
    if (!project) return null;

    group = { project, channels: [], folders: [], rootCanvases: [] };
    groups.set(projectId, group);
    return group;
  };

  const ensureChannelGroup = (group: ProjectGroup, channel: CanvasChannel): ChannelGroup => {
    let channelGroup = group.channels.find(item => item.channel.id === channel.id);
    if (channelGroup) return channelGroup;
    channelGroup = { channel, rootCanvases: [], folders: [] };
    group.channels.push(channelGroup);
    return channelGroup;
  };

  for (const project of sections.projects) {
    groups.set(project.id, { project, channels: [], folders: [], rootCanvases: [] });
  }

  for (const folder of sections.projectFolders) {
    if (!folder.projectId) continue;
    const group = ensureProjectGroup(folder.projectId);
    if (!group || group.folders.some(item => item.folder.id === folder.id)) continue;
    group.folders.push({ folder, canvases: [] });
  }

  for (const channel of sections.projectChannels) {
    const group = ensureProjectGroup(channel.projectId);
    if (!group) continue;
    ensureChannelGroup(group, channel);
  }

  for (const folder of sections.channelFolders) {
    if (!folder.channelId) continue;
    const channel = projectChannelsById.get(folder.channelId) ?? null;
    const projectId = channel?.projectId ?? folder.projectId ?? null;
    if (!channel || !projectId) continue;
    const group = ensureProjectGroup(projectId);
    if (!group) continue;
    const channelGroup = ensureChannelGroup(group, channel);
    if (!channelGroup.folders.some(item => item.folder.id === folder.id)) {
      channelGroup.folders.push({ folder, canvases: [] });
    }
  }

  const canvasesByFolderId = new Map<string, Canvas[]>();
  for (const canvas of sections.folderCanvases) {
    if (!canvas.folderId) continue;
    const items = canvasesByFolderId.get(canvas.folderId) ?? [];
    items.push(canvas);
    canvasesByFolderId.set(canvas.folderId, items);
  }

  for (const group of groups.values()) {
    for (const folderGroup of group.folders) {
      folderGroup.canvases = sortCanvases(canvasesByFolderId.get(folderGroup.folder.id) ?? []);
    }

    for (const channelGroup of group.channels) {
      for (const folderGroup of channelGroup.folders) {
        folderGroup.canvases = sortCanvases(canvasesByFolderId.get(folderGroup.folder.id) ?? []);
      }
    }
  }

  for (const canvas of sections.channelRootCanvases) {
    const channel =
      canvas.channel ?? (canvas.channelId ? projectChannelsById.get(canvas.channelId) : null);
    if (!channel) continue;
    const group = ensureProjectGroup(channel.projectId);
    if (!group) continue;
    const channelGroup = ensureChannelGroup(group, channel);
    channelGroup.rootCanvases.push(canvas);
  }

  for (const canvas of sections.projectRootCanvases) {
    if (!canvas.projectId) continue;
    const group = ensureProjectGroup(canvas.projectId);
    if (!group) continue;
    group.rootCanvases.push(canvas);
  }

  return {
    projectGroups: sortByName(Array.from(groups.values()), group => group.project.name).map(
      group => ({
        ...group,
        folders: sortByName(group.folders, folder => folder.folder.name).map(folderGroup => ({
          ...folderGroup,
          canvases: sortCanvases(folderGroup.canvases),
        })),
        channels: sortByName(group.channels, channel =>
          getChannelDisplayName(channel.channel, currentUserId, usersById),
        ).map(channelGroup => ({
          ...channelGroup,
          folders: sortByName(channelGroup.folders, folder => folder.folder.name).map(
            folderGroup => ({
              ...folderGroup,
              canvases: sortCanvases(folderGroup.canvases),
            }),
          ),
          rootCanvases: sortCanvases(channelGroup.rootCanvases),
        })),
        rootCanvases: sortCanvases(group.rootCanvases),
      }),
    ),
    personalFolderGroups: sortByName(sections.personalFolders, folder => folder.name).map(
      folder => ({
        folder,
        canvases: sortCanvases(canvasesByFolderId.get(folder.id) ?? []),
      }),
    ),
    personalCanvases: sortCanvases(sections.personalCanvases),
  };
}

export function nextFolderName(
  projectId: string | null | undefined,
  folders: CanvasFolder[],
  channelId?: string | null,
): string {
  const prefix = 'Untitled folder';
  const usedNumbers = new Set<number>();
  const scopedChannelId = channelId ?? null;
  const scopedProjectId = projectId ?? null;

  for (const folder of folders) {
    if ((folder.projectId ?? null) !== scopedProjectId) continue;
    if ((folder.channelId ?? null) !== scopedChannelId) continue;
    const match = folder.name.match(/^Untitled folder (\d+)$/i);
    if (match?.[1]) usedNumbers.add(Number(match[1]));
  }

  let next = 1;
  while (usedNumbers.has(next)) next++;
  return `${prefix} ${next}`;
}
