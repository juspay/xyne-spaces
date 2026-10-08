import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { BoardType, ReleaseTrackingMode, resolveTicketDescription } from '@xyne/shared';
import { buildStagesByBoard } from '../../../components/Release/releaseChanges.utils';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useChannelParticipation } from '../../../hooks/useChannels';
import { useUsersById } from '../../../hooks/useUsers';
import { resolveStageStatus } from '../../../utils/board/stageStatusIcon';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { apiInstance } from '../../../services/clients/apiClient';
import { getApiErrorMessage } from '../../../utils/apiError';
import { htmlToPlainText } from '../../../utils/sanitizer';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import {
  buildApplicationReleaseBoardName,
  buildMainReleaseBoardName,
} from '../../../components/Release/ReleaseConfigWizard/releaseBoardNames';
import type {
  ReleaseRepoDraft,
  ReleaseRepositoryRow,
  SdlcHubRepoInput,
  SdlcReleaseCardData,
  SdlcReleaseRepo,
} from './SdlcReleases.types';
import {
  firstBranch,
  formatReleaseDate,
  jsonStringArray,
  normalizeRepoUrl,
  releaseTitle,
  repoHostLabel,
  repoMatchesUrl,
} from './SdlcReleases.utils';

const PAGE_SIZE = 20;

interface ApplicationRow {
  mainReleaseBoardId?: string | null | undefined;
  repoUrl: string;
}

// An exact URL match wins over a prefix match (e.g. a repoUrl saved with /browse).
function matchingMainBoardId(
  repoUrl: string,
  applications: readonly ApplicationRow[],
): string | null {
  const candidates = applications.filter(
    app => !!app.mainReleaseBoardId && repoMatchesUrl(repoUrl, app.repoUrl),
  );
  const exact = candidates.find(app => normalizeRepoUrl(app.repoUrl) === normalizeRepoUrl(repoUrl));
  return (exact ?? candidates[0])?.mainReleaseBoardId ?? null;
}

/** The hub's repositories with their release config. Config is scoped by the hub's
 *  project, like the project release manager; the repository only supplies URL and branch. */
export function useSdlcReleaseRepos(
  repositories: readonly SdlcHubRepoInput[],
  projectId: string | null,
): { repos: SdlcReleaseRepo[]; loading: boolean } {
  const [applications, applicationsStatus] = useCachedQuery(
    queries.applicationsByProjectId({ projectId: projectId ?? '' }),
    { enabled: !!projectId },
  );

  const mainBoardIdByRepo = useMemo(() => {
    const map = new Map<string, string>();
    for (const repo of repositories) {
      const boardId = matchingMainBoardId(repo.canonicalUrl || repo.url, applications ?? []);
      if (boardId) map.set(repo.id, boardId);
    }
    return map;
  }, [repositories, applications]);

  // Service boards come along so a save keeps their current names.
  const boardIds = useMemo(() => {
    const mainBoardIds = new Set(mainBoardIdByRepo.values());
    const serviceBoardIds = (applications ?? [])
      .filter(app => app.mainReleaseBoardId && mainBoardIds.has(app.mainReleaseBoardId))
      .map(app => app.boardId);
    return [...mainBoardIds, ...serviceBoardIds];
  }, [mainBoardIdByRepo, applications]);
  const [boards, boardsStatus] = useCachedQuery(queries.boardsByIds({ boardIds }), {
    enabled: boardIds.length > 0,
  });

  const repos = useMemo(
    () =>
      repositories.map(repo => {
        const repoUrl = repo.canonicalUrl || repo.url;
        const mainBoardId = mainBoardIdByRepo.get(repo.id);
        const board = mainBoardId ? boards?.find(item => item.id === mainBoardId) : undefined;
        const apps = mainBoardId
          ? (applications ?? []).filter(app => app.mainReleaseBoardId === mainBoardId)
          : [];
        const config: ReleaseRepoDraft | null =
          board && apps.length > 0
            ? {
                mainBoardId: board.id,
                mainBoardName: board.name,
                channelId: apps[0]?.channelId ?? null,
                mode:
                  (board.releaseTrackingMode as ReleaseTrackingMode | null | undefined) ??
                  ReleaseTrackingMode.COMMIT_RANGE,
                services: [...apps]
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map(app => {
                    const envPaths = jsonStringArray(app.envPaths);
                    const migrationPaths = jsonStringArray(app.migrationPaths);
                    return {
                      id: app.id,
                      boardId: app.boardId,
                      boardName: boards?.find(item => item.id === app.boardId)?.name ?? '',
                      name: app.name,
                      regex: app.regex,
                      ownerTeam: app.ownerTeam,
                      envPaths,
                      migrationPaths,
                      showPaths: envPaths.length + migrationPaths.length > 0,
                    };
                  }),
              }
            : null;
        return {
          id: repo.id,
          name: repo.name,
          repoUrl,
          host: repoHostLabel(repoUrl),
          branch: firstBranch(repo.baseBranch),
          projectId,
          config,
        };
      }),
    [repositories, projectId, mainBoardIdByRepo, boards, applications],
  );

  const loading =
    (!!projectId && applicationsStatus.type !== 'complete' && !applications) ||
    (boardIds.length > 0 && boardsStatus.type !== 'complete' && !boards);

  return { repos, loading };
}

/** Release tickets of the given repos, newest first. Pages by raising the query limit so
 *  every loaded row stays live. */
export function useSdlcReleases(repos: readonly SdlcReleaseRepo[]): {
  releases: SdlcReleaseCardData[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
} {
  const repoByBoardId = useMemo(
    () => new Map(repos.flatMap(repo => (repo.config ? [[repo.config.mainBoardId, repo]] : []))),
    [repos],
  );
  const boardIds = useMemo(() => [...repoByBoardId.keys()].sort(), [repoByBoardId]);
  const scopeKey = boardIds.join(',');
  const [page, setPage] = useState({ scopeKey, limit: PAGE_SIZE });
  const limit = page.scopeKey === scopeKey ? page.limit : PAGE_SIZE;
  const [tickets, ticketsStatus] = useCachedQuery(
    queries.releaseTicketsByBoardIds({ boardIds, limit }),
    { enabled: boardIds.length > 0 },
  );
  const rows = useMemo(() => tickets ?? [], [tickets]);
  const usersById = useUsersById();
  const projectId = repos[0]?.projectId ?? '';
  const [stageRows] = useCachedQuery(
    queries.stagesByBoards({ projectId, boardType: BoardType.RELEASE }),
    { enabled: !!projectId },
  );
  const stagesByBoard = useMemo(() => buildStagesByBoard(stageRows), [stageRows]);

  const complete = ticketsStatus.type === 'complete';
  const hasMore = rows.length >= limit;

  const releases = useMemo(() => {
    return rows.flatMap(row => {
      const repo = repoByBoardId.get(row.boardId);
      if (!repo) return [];
      const creator = usersById.get(row.createdBy);
      return [
        {
          id: row.id,
          title: releaseTitle(row),
          summary: htmlToPlainText(resolveTicketDescription(row)),
          stage: {
            name: row.stageName,
            status:
              resolveStageStatus(stagesByBoard.get(row.boardId), row.stageName) ?? row.statusV2,
          },
          date: formatReleaseDate(row.createdAt),
          repoName: repo.name,
          ownerId: row.createdBy,
          ownerName: creator ? getUserDisplayName(creator) : 'Unknown',
        },
      ];
    });
  }, [rows, repoByBoardId, usersById, stagesByBoard]);

  const loadMore = useCallback(() => {
    if (complete && hasMore) setPage({ scopeKey, limit: limit + PAGE_SIZE });
  }, [complete, hasMore, scopeKey, limit]);

  return {
    releases,
    loading: boardIds.length > 0 && !complete && rows.length === 0,
    loadingMore: !complete && rows.length > 0,
    hasMore,
    loadMore,
  };
}

export function useRerunReleaseAnalysis(releaseId: string): {
  rerunning: boolean;
  rerun: () => Promise<void>;
} {
  const [rerunning, setRerunning] = useState(false);

  const rerun = useCallback(async (): Promise<void> => {
    setRerunning(true);
    try {
      const response = await apiInstance.post<{ success: boolean; error?: string }>(
        `/commits/analyze/re-run/${releaseId}`,
        {},
      );
      if (response.data?.success) {
        refreshReleaseRepositories(releaseId);
        toast.success('Re-running analysis — this release updates when it finishes.');
      } else {
        toast.error(response.data?.error ?? 'Re-run failed');
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Re-run failed'));
    } finally {
      setRerunning(false);
    }
  }, [releaseId]);

  return { rerunning, rerun };
}

const FIELD_AUTOSAVE_MS = 600;

export function useReleaseFieldEditor(
  releaseId: string,
  field: 'title' | 'description',
  value: string,
): {
  editing: boolean;
  draft: string;
  setDraft: (next: string) => void;
  start: () => void;
  finish: () => void;
  cancel: () => void;
} {
  const zero = useZero();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = useCallback(
    (input: string): void => {
      const next = input.trim();
      if (next === value || (field === 'title' && !next)) return;
      void surfaceMutationError(
        zero.mutate(
          mutators.ticket.update({
            id: releaseId,
            ...(field === 'title' ? { title: next } : { description: next }),
            updatedAt: Date.now(),
          }),
        ),
        `Failed to update ${field}`,
      );
    },
    [zero, releaseId, field, value],
  );

  useEffect(() => {
    if (!editing) return undefined;
    const timeoutId = setTimeout(() => save(draft), FIELD_AUTOSAVE_MS);
    return (): void => clearTimeout(timeoutId);
  }, [editing, draft, save]);

  return {
    editing,
    draft,
    setDraft,
    start: (): void => {
      setDraft(value);
      setEditing(true);
    },
    finish: (): void => {
      save(draft);
      setEditing(false);
    },
    cancel: (): void => setEditing(false),
  };
}

export function useAssignReleaseQa(): (artIds: readonly string[], userId: string | null) => void {
  const zero = useZero();
  return useCallback(
    (artIds: readonly string[], userId: string | null): void => {
      const timestamp = Date.now();
      for (const id of artIds) {
        void surfaceMutationError(
          zero.mutate(mutators.applicationReleaseTicket.setTestedBy({ id, userId, timestamp })),
          'Failed to update QA',
        );
      }
    },
    [zero],
  );
}

export function useReleaseThreadAccess(releaseId: string | null): boolean {
  const [release] = useCachedQuery(queries.ticketRowById({ ticketId: releaseId ?? '' }), {
    enabled: !!releaseId,
  });
  const participation = useChannelParticipation(releaseId ? (release?.channelId ?? '') : '');
  return !!releaseId && !!participation;
}

/** release_repositories is not synced through Zero, so it comes over REST along with the
 *  release's analysis canvas id. */
const releaseRepositoryListeners = new Set<(releaseId: string) => void>();

const refreshReleaseRepositories = (releaseId: string): void => {
  releaseRepositoryListeners.forEach(listener => listener(releaseId));
};

export function useReleaseRepositories(releaseId: string): {
  repos: ReleaseRepositoryRow[];
  analysisCanvasId: string | null;
} {
  const [state, setState] = useState<{
    repos: ReleaseRepositoryRow[];
    analysisCanvasId: string | null;
  }>({
    repos: [],
    analysisCanvasId: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = (changedId: string): void => {
      if (changedId === releaseId) setVersion(value => value + 1);
    };
    releaseRepositoryListeners.add(listener);
    return (): void => {
      releaseRepositoryListeners.delete(listener);
    };
  }, [releaseId]);

  useEffect(() => {
    let active = true;
    apiInstance
      .get<{ repos?: ReleaseRepositoryRow[]; analysisCanvasId?: string | null }>(
        `/commits/analyze/repos/${releaseId}`,
      )
      .then((response): void => {
        if (active) {
          setState({
            repos: response.data?.repos ?? [],
            analysisCanvasId: response.data?.analysisCanvasId ?? null,
          });
        }
      })
      .catch((): void => {
        if (!active) return;
        setState({ repos: [], analysisCanvasId: null });
        toast.error('Could not load the repository breakdown for this release. Try refreshing.');
      });
    return (): void => {
      active = false;
    };
  }, [releaseId, version]);

  return state;
}

export function useSaveReleaseRepoConfig(): {
  saving: boolean;
  save: (repo: SdlcReleaseRepo, draft: ReleaseRepoDraft) => Promise<boolean>;
} {
  const zero = useZero();
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (repo: SdlcReleaseRepo, draft: ReleaseRepoDraft): Promise<boolean> => {
      if (!repo.projectId) {
        toast.error('This hub is not linked to a project');
        return false;
      }
      if (!draft.channelId) return false;
      const mainBoardName = draft.mainBoardName || buildMainReleaseBoardName(repo.repoUrl);
      const applications = draft.services.map(service => ({
        id: service.id,
        boardId: service.boardId,
        boardName:
          service.boardName.trim() || buildApplicationReleaseBoardName(repo.repoUrl, service.name),
        name: service.name.trim(),
        regex: service.regex.trim(),
        repoUrl: repo.repoUrl,
        ownerTeam: service.ownerTeam,
        envPaths: service.envPaths,
        migrationPaths: service.migrationPaths,
      }));
      if (!mainBoardName || applications.some(app => !app.boardName)) {
        toast.error('Repository and service names must produce valid board names');
        return false;
      }

      setSaving(true);
      try {
        const response = await zero.mutate(
          mutators.project.saveReleaseBoardConfig({
            projectId: repo.projectId,
            mainBoardId: draft.mainBoardId || uuidv4(),
            mainBoardName,
            releaseTrackingMode: draft.mode,
            channelId: draft.channelId,
            applications,
          }),
        ).server;
        if (response.type === 'error') {
          throw new Error(response.error.message || 'Failed to save configuration');
        }
        toast.success('Release configuration saved');
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save configuration');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [zero],
  );

  return { saving, save };
}
