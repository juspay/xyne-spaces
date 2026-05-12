import { useMemo } from 'react';
import type { Canvas, CanvasChannel, CanvasFolder, CanvasProject } from '../Canvas.types';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useUsers } from '../../../hooks/useUsers';
import { useAllVisibleChannels, useVisibleProjects } from '../../../hooks/useChannels';
import type {
  CanvasHierarchyMeta,
  CanvasUser,
  FolderGroup,
  ProjectGroup,
} from './CanvasListGrouped.utils';
import {
  buildGroupedCanvasSections,
  type CanvasHierarchySections,
} from './CanvasListGrouped.utils';

interface UseCanvasListGroupedDataParams {
  currentUserId?: string | undefined;
  collapsedProjects: ReadonlySet<string>;
}

interface UseCanvasListGroupedDataResult {
  usersById: Map<string, CanvasUser>;
  adminChannelIds: ReadonlySet<string>;
  projectGroups: ProjectGroup[];
  personalFolderGroups: FolderGroup[];
  personalCanvases: Canvas[];
  projectIds: string[];
  loadedChannelIds: string[];
  loadedFolderIds: string[];
  isEmpty: boolean;
  hierarchyMeta: CanvasHierarchyMeta;
}

function toArray<T>(value: unknown): T[] {
  return (value as T[] | undefined) ?? [];
}

export function useCanvasListGroupedData({
  currentUserId,
  collapsedProjects,
}: UseCanvasListGroupedDataParams): UseCanvasListGroupedDataResult {
  const allUsers = useUsers();
  const allVisibleChannels = useAllVisibleChannels();
  const usersById = useMemo(
    () => new Map<string, CanvasUser>(allUsers.map(user => [user.id, user])),
    [allUsers],
  );
  const visibleProjects = useVisibleProjects();

  const [adminParticipationsResult] = useCachedQuery(queries.myChannelParticipations({}));
  const adminChannelIds = useMemo(
    () =>
      new Set(
        toArray<{ channelId: string }>(adminParticipationsResult).map(
          participation => participation.channelId,
        ),
      ),
    [adminParticipationsResult],
  );

  const lazyProjects = useMemo(() => visibleProjects as CanvasProject[], [visibleProjects]);
  const projectIds = useMemo(() => lazyProjects.map(project => project.id), [lazyProjects]);
  const allProjectChannels = useMemo(
    () =>
      allVisibleChannels.filter(channel =>
        projectIds.includes(channel.projectId),
      ) as CanvasChannel[],
    [allVisibleChannels, projectIds],
  );

  const [personalFoldersResult] = useCachedQuery(queries.personalCanvasFolders());
  const [personalCanvasesResult] = useCachedQuery(
    queries.hierarchyCanvases({ scope: 'personal_root' }),
    {
      enabled: true,
    },
  );
  const personalFolders = useMemo(
    () => toArray<CanvasFolder>(personalFoldersResult),
    [personalFoldersResult],
  );
  const lazyPersonalFolders = useMemo(() => personalFolders, [personalFolders]);
  const lazyPersonalCanvases = useMemo(
    () => toArray<Canvas>(personalCanvasesResult),
    [personalCanvasesResult],
  );
  const expandedProjectIds = useMemo(
    () => projectIds.filter(projectId => !collapsedProjects.has(projectId)),
    [collapsedProjects, projectIds],
  );
  const projectChannels = useMemo(
    () => allProjectChannels.filter(channel => expandedProjectIds.includes(channel.projectId)),
    [allProjectChannels, expandedProjectIds],
  );

  const loadedChannelIds = useMemo(
    () => allProjectChannels.map(channel => channel.id),
    [allProjectChannels],
  );

  const loadedFolderIds = useMemo(
    () => lazyPersonalFolders.map(folder => folder.id),
    [lazyPersonalFolders],
  );
  const lazySections = useMemo<CanvasHierarchySections>(
    () => ({
      projects: lazyProjects,
      personalFolders: lazyPersonalFolders,
      personalCanvases: lazyPersonalCanvases,
      projectFolders: [],
      projectRootCanvases: [],
      projectChannels,
      channelFolders: [],
      channelRootCanvases: [],
      folderCanvases: [],
    }),
    [lazyPersonalCanvases, lazyPersonalFolders, lazyProjects, projectChannels],
  );
  const hierarchyMeta = useMemo<CanvasHierarchyMeta>(
    () => ({
      projects: lazySections.projects,
      personalFolders: lazyPersonalFolders,
      projectFolders: [],
      projectChannels: allProjectChannels,
      channelFolders: [],
    }),
    [allProjectChannels, lazyPersonalFolders, lazySections.projects],
  );
  const groupedData = useMemo(
    () => buildGroupedCanvasSections(lazySections, { currentUserId, usersById }),
    [currentUserId, lazySections, usersById],
  );

  const isEmpty =
    lazySections.projects.length === 0 &&
    groupedData.personalFolderGroups.length === 0 &&
    groupedData.personalCanvases.length === 0;

  return {
    usersById,
    adminChannelIds,
    projectGroups: groupedData.projectGroups,
    personalFolderGroups: groupedData.personalFolderGroups,
    personalCanvases: groupedData.personalCanvases,
    projectIds,
    loadedChannelIds,
    loadedFolderIds,
    isEmpty,
    hierarchyMeta,
  };
}
