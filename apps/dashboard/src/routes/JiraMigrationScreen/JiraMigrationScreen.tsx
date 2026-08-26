import { type ChangeEvent, ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useChannelsByProjectId } from '../../hooks/useChannels';
import { usePlatform } from '../../hooks/usePlatform';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import {
  jiraMigrationService,
  type JiraBoard,
  type JiraMigrationExecuteRequest,
  type JiraMigrationExecuteResponse,
  type JiraMigrationFilters,
  type JiraMigrationHistoryItem,
  type JiraMigrationJobProgress,
  type JiraMigrationMoveJiraProjectChannelResponse,
  type JiraMigrationPreviewResponse,
  type JiraMigrationMoveJiraProjectBoardResponse,
  type JiraMigrationPurgeProjectMigrationResponse,
  type JiraMigrationResolveUsersResponse,
} from '../../services/JiraMigration/jiraMigrationService';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import Dialog from '../../components/ui/Dialog';
import { toast } from 'sonner';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import { EntityMultiSelector } from '../../components/ui/EntitySelector/EntityMultiSelector';
import { cn } from '../../utils/classNames';
import { FolderKanban, LayoutTemplate, Hash, User, Tag } from 'lucide-react';
import { isAxiosError } from 'axios';

const actionClassMap: Record<string, string> = {
  create_board_custom_field: 'bg-blue-100 text-blue-800',
  reuse_existing_board_custom_field: 'bg-emerald-100 text-emerald-800',
  store_in_metadata: 'bg-amber-100 text-amber-800',
};

const confidenceClassMap: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-rose-100 text-rose-800',
};

const issueStatusClassMap: Record<'completed' | 'partial' | 'failed', string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-800',
};

const ACTIVE_JIRA_MIGRATION_STORAGE_KEY = 'jiraMigration.activeJob';
const PREVIEW_CUSTOM_FIELDS_PER_PAGE = 8;
const PREVIEW_ISSUE_SAMPLES_PER_PAGE = 8;
const ISSUE_EXECUTION_DETAILS_PER_PAGE = 10;

type TicketRange = 'all' | 'last_1_month' | 'last_6_months' | 'last_1_year';
type PreviewSection = 'overview' | 'fields' | 'issues';
type TicketStatusV2Option = 'TODO' | 'STARTED' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';
type MigrationPhase = 'setup' | 'map-statuses' | 'migrate';
type MigrationMode = 'all-to-one' | 'per-board';
type JiraMigrationUseCase =
  | 'issues'
  | 'channel-only'
  | 'purge-project'
  | 'move-jira-project-board'
  | 'move-jira-project-channel';

type PerBoardMapping = {
  jiraBoard: JiraBoard;
  xyneBoardId: string;
};

type PerBoardJobEntry = {
  jiraBoard: JiraBoard;
  xyneBoardId: string;
  jobId: string | null;
  progress: JiraMigrationJobProgress | null;
  pollError: string | null;
};

const TICKET_STATUS_V2_OPTIONS: TicketStatusV2Option[] = [
  'TODO',
  'STARTED',
  'COMPLETED',
  'PAUSED',
  'CANCELLED',
];

const normalizeStatusKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ticketRangeLabelMap: Record<TicketRange, string> = {
  all: 'All Time',
  last_1_month: 'Last 1 Month',
  last_6_months: 'Last 6 Months',
  last_1_year: 'Last 1 Year',
};

type PersistedJiraMigrationJob = {
  jobId: string;
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  ticketRange: TicketRange;
  dateFrom?: string;
  startedAt: string;
};

const readPersistedJiraMigrationJob = (): PersistedJiraMigrationJob | null => {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
    if (!rawValue) return null;

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedJiraMigrationJob>;
    if (
      typeof parsedValue.jobId !== 'string' ||
      typeof parsedValue.jiraProjectKey !== 'string' ||
      typeof parsedValue.targetProjectId !== 'string' ||
      typeof parsedValue.targetBoardId !== 'string' ||
      typeof parsedValue.targetChannelId !== 'string'
    ) {
      window.localStorage.removeItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
      return null;
    }

    return {
      jobId: parsedValue.jobId,
      jiraProjectKey: parsedValue.jiraProjectKey,
      targetProjectId: parsedValue.targetProjectId,
      targetBoardId: parsedValue.targetBoardId,
      targetChannelId: parsedValue.targetChannelId,
      ticketRange:
        parsedValue.ticketRange === 'last_1_month' ||
        parsedValue.ticketRange === 'last_6_months' ||
        parsedValue.ticketRange === 'last_1_year'
          ? parsedValue.ticketRange
          : 'all',
      ...(typeof parsedValue.dateFrom === 'string' ? { dateFrom: parsedValue.dateFrom } : {}),
      startedAt:
        typeof parsedValue.startedAt === 'string'
          ? parsedValue.startedAt
          : new Date().toISOString(),
    };
  } catch {
    window.localStorage.removeItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
    return null;
  }
};

const persistJiraMigrationJob = (job: PersistedJiraMigrationJob): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY, JSON.stringify(job));
};

const clearPersistedJiraMigrationJob = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVE_JIRA_MIGRATION_STORAGE_KEY);
};

const JiraMigrationScreen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const [projects] = useCachedQuery(queries.getAllProjects());
  const [workspaceUsers] = useCachedQuery(queries.getUsersV2());
  const [useCase, setUseCase] = useState<JiraMigrationUseCase>('issues');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [targetChannelId, setTargetChannelId] = useState('');
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [issueKeysInput, setIssueKeysInput] = useState('');
  const [jiraBoardId, setJiraBoardId] = useState<number | null>(null);
  const [ticketRange, setTicketRange] = useState<TicketRange>('all');
  const [filters, setFilters] = useState<JiraMigrationFilters>({});
  const [isFilterEnabled, setIsFilterEnabled] = useState(false);
  const [preview, setPreview] = useState<JiraMigrationPreviewResponse | null>(null);
  const [result, setResult] = useState<JiraMigrationExecuteResponse | null>(null);
  const [migrationHistory, setMigrationHistory] = useState<JiraMigrationHistoryItem[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<JiraMigrationJobProgress | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [pageTokens, setPageTokens] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [previewSection, setPreviewSection] = useState<PreviewSection>('overview');
  const [customFieldPage, setCustomFieldPage] = useState(0);
  const [issueSamplePage, setIssueSamplePage] = useState(0);
  const [issueResultPage, setIssueResultPage] = useState(0);
  const [statusV2Mappings, setStatusV2Mappings] = useState<Record<string, string>>({});
  const [jiraStatusSequence, setJiraStatusSequence] = useState<string[]>([]);
  const [jiraStatusSequenceOrderInput, setJiraStatusSequenceOrderInput] = useState<
    Record<string, string>
  >({});
  const [draggingJiraStatus, setDraggingJiraStatus] = useState<string | null>(null);
  const [excludedStageNames, setExcludedStageNames] = useState<Record<string, boolean>>({});
  const [skippedCustomFieldIds, setSkippedCustomFieldIds] = useState<Record<string, boolean>>({});
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>('setup');
  const [resolveUsersResult, setResolveUsersResult] =
    useState<JiraMigrationResolveUsersResponse | null>(null);
  const [isResolveUsersLoading, setIsResolveUsersLoading] = useState(false);
  const [userEmailMappings, setUserEmailMappings] = useState<Record<string, string>>({});
  const [scanPagesScanned, setScanPagesScanned] = useState(0);
  const [scanUnresolvedFound, setScanUnresolvedFound] = useState(0);
  const [scanIncludeComments, setScanIncludeComments] = useState(true);
  const [scanIncludeAttachments, setScanIncludeAttachments] = useState(true);
  const channels = useChannelsByProjectId(selectedProjectId || undefined);
  const [channelMoveSourceProjectId, setChannelMoveSourceProjectId] = useState('');
  const [channelMoveTargetProjectId, setChannelMoveTargetProjectId] = useState('');
  const [channelMoveChannelId, setChannelMoveChannelId] = useState('');
  const [channelMoveUpdatedAt, setChannelMoveUpdatedAt] = useState('');
  const [isChannelMoveLoading, setIsChannelMoveLoading] = useState(false);
  const channelMoveChannels = useChannelsByProjectId(channelMoveSourceProjectId || undefined);
  const [purgeProjectId, setPurgeProjectId] = useState('');
  const [purgeExternalSourceId, setPurgeExternalSourceId] = useState('');
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purgeDryRun, setPurgeDryRun] = useState(true);
  const [purgeResult, setPurgeResult] = useState<JiraMigrationPurgeProjectMigrationResponse | null>(
    null,
  );
  const [isPurgeLoading, setIsPurgeLoading] = useState(false);
  const [purgeJobId, setPurgeJobId] = useState<string | null>(null);
  const [purgeJobProgress, setPurgeJobProgress] = useState<JiraMigrationJobProgress | null>(null);
  const [moveJiraProjectKey, setMoveJiraProjectKey] = useState('');
  const [moveXyneProjectId, setMoveXyneProjectId] = useState('');
  const [moveJiraChannelId, setMoveJiraChannelId] = useState('');
  const [moveSourceBoardId, setMoveSourceBoardId] = useState('');
  const [moveTargetBoardId, setMoveTargetBoardId] = useState('');
  const [moveTagNamesInput, setMoveTagNamesInput] = useState('');
  const [moveDryRun, setMoveDryRun] = useState(true);
  const [moveConfirmText, setMoveConfirmText] = useState('');
  const [moveResult, setMoveResult] = useState<JiraMigrationMoveJiraProjectBoardResponse | null>(
    null,
  );
  const [isMoveBoardLoading, setIsMoveBoardLoading] = useState(false);
  const [moveChannelProjectId, setMoveChannelProjectId] = useState('');
  const [moveChannelJiraProjectKey, setMoveChannelJiraProjectKey] = useState('');
  const [moveChannelSourceId, setMoveChannelSourceId] = useState('');
  const [moveChannelTargetId, setMoveChannelTargetId] = useState('');
  const [moveChannelDryRun, setMoveChannelDryRun] = useState(true);
  const [moveChannelConfirmText, setMoveChannelConfirmText] = useState('');
  const [moveChannelResult, setMoveChannelResult] =
    useState<JiraMigrationMoveJiraProjectChannelResponse | null>(null);
  const [isMoveChannelLoading, setIsMoveChannelLoading] = useState(false);
  const [scanResolvedMappings, setScanResolvedMappings] = useState<
    JiraMigrationResolveUsersResponse['resolvedUserMappings']
  >([]);
  const [scanResolvedMappingsTruncated, setScanResolvedMappingsTruncated] = useState(false);
  const [resolvedUsersPage, setResolvedUsersPage] = useState(0);
  const RESOLVED_USERS_PER_PAGE = 50;

  const purgeChannels = useChannelsByProjectId(purgeProjectId || undefined);
  const purgeChannelIdSet = useMemo(
    () => new Set(purgeChannels.map(channel => channel.id)),
    [purgeChannels],
  );
  const purgeMigrationHistory = useMemo(
    () => migrationHistory.filter(item => purgeChannelIdSet.has(item.targetChannelId)),
    [migrationHistory, purgeChannelIdSet],
  );

  useEffect(() => {
    if (!purgeExternalSourceId) return;
    if (purgeMigrationHistory.some(item => item.externalSourceId === purgeExternalSourceId)) return;
    setPurgeExternalSourceId('');
  }, [purgeExternalSourceId, purgeMigrationHistory]);

  // Board mode state
  const [jiraBoards, setJiraBoards] = useState<JiraBoard[]>([]);
  const [isFetchingBoards, setIsFetchingBoards] = useState(false);
  const [migrationMode, setMigrationMode] = useState<MigrationMode | null>(null);
  const boardSectionRef = useRef<HTMLDivElement>(null);
  const [perBoardMappings, setPerBoardMappings] = useState<PerBoardMapping[]>([]);
  const [perBoardJobs, setPerBoardJobs] = useState<PerBoardJobEntry[]>([]);
  const [isPerBoardImportLoading, setIsPerBoardImportLoading] = useState(false);

  const [boards] = useCachedQuery(
    queries.boardsListByProject({ projectId: selectedProjectId || 'placeholder' }),
    { enabled: !!selectedProjectId },
  );

  const moveChannels = useChannelsByProjectId(moveXyneProjectId || undefined);
  const [moveBoards] = useCachedQuery(
    queries.boardsListByProject({ projectId: moveXyneProjectId || 'placeholder' }),
    { enabled: !!moveXyneProjectId },
  );
  const moveProjectChannels = useChannelsByProjectId(moveChannelProjectId || undefined);

  const selectedProject = useMemo(
    () => projects?.find(project => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const selectedBoard = useMemo(
    () => boards?.find(board => board.id === selectedBoardId) || null,
    [boards, selectedBoardId],
  );

  const selectedChannel = useMemo(
    () => channels.find(channel => channel.id === targetChannelId) || null,
    [channels, targetChannelId],
  );

  const handleMoveChannelProject = async (): Promise<void> => {
    if (!channelMoveSourceProjectId.trim()) {
      toast.error('Select a source project');
      return;
    }
    if (!channelMoveChannelId.trim()) {
      toast.error('Select a channel to move');
      return;
    }
    if (!channelMoveTargetProjectId.trim()) {
      toast.error('Select a target project');
      return;
    }
    if (channelMoveSourceProjectId === channelMoveTargetProjectId) {
      toast.error('Source and target project must be different');
      return;
    }

    setIsChannelMoveLoading(true);
    try {
      const payload = {
        channelId: channelMoveChannelId.trim(),
        sourceProjectId: channelMoveSourceProjectId.trim(),
        targetProjectId: channelMoveTargetProjectId.trim(),
        ...(channelMoveUpdatedAt.trim() ? { updatedAt: channelMoveUpdatedAt.trim() } : {}),
      };
      const result = await jiraMigrationService.moveChannelProject(payload);
      toast.success('Channel moved', {
        description: result.channel
          ? `${result.channel.name} → ${result.channel.projectId}`
          : `Updated: ${result.updatedCount}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move channel';
      toast.error('Channel move failed', { description: message });
    } finally {
      setIsChannelMoveLoading(false);
    }
  };

  const handlePurgeProjectMigration = async (): Promise<void> => {
    if (!purgeProjectId.trim()) {
      toast.error('Select a project to purge');
      return;
    }
    if (!purgeExternalSourceId.trim()) {
      toast.error('Select a Jira migration source to purge');
      return;
    }
    if (!purgeDryRun) {
      if (!purgeConfirmText.trim()) {
        toast.error(`Type 'DELETE ${purgeProjectId}' to confirm`);
        return;
      }
    }

    setIsPurgeLoading(true);
    try {
      const payload = {
        projectId: purgeProjectId.trim(),
        externalSourceId: purgeExternalSourceId.trim(),
        dryRun: purgeDryRun,
        ...(!purgeDryRun && purgeConfirmText.trim()
          ? { confirmText: purgeConfirmText.trim() }
          : {}),
      };
      const result = await jiraMigrationService.purgeProjectMigration(payload);
      setPurgeResult(result);
      if (result.jobId) {
        setPurgeJobId(result.jobId);
        setPurgeJobProgress(null);
        toast.success('Purge started — running in background');
        // isPurgeLoading stays true until polling completes
      } else {
        toast.success('Dry run complete');
        setIsPurgeLoading(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to purge migration';
      toast.error('Purge failed', { description: message });
      setIsPurgeLoading(false);
    }
  };

  const handleMoveJiraProjectBoard = async (): Promise<void> => {
    const projectKey = moveJiraProjectKey.trim().toUpperCase();
    if (!projectKey) {
      toast.error('Enter Jira project key');
      return;
    }
    if (!moveXyneProjectId.trim()) {
      toast.error('Select Xyne project');
      return;
    }
    if (!moveJiraChannelId.trim()) {
      toast.error('Select channel');
      return;
    }
    if (!moveSourceBoardId.trim()) {
      toast.error('Select source board');
      return;
    }
    if (!moveTargetBoardId.trim()) {
      toast.error('Select target board');
      return;
    }
    if (moveSourceBoardId.trim() === moveTargetBoardId.trim()) {
      toast.error('Source and target board must be different');
      return;
    }
    if (!moveDryRun) {
      if (moveConfirmText.trim() !== `MOVE ${projectKey}`) {
        toast.error(`Type 'MOVE ${projectKey}' to confirm`);
        return;
      }
    }

    const normalizedMoveTagNames = Array.from(
      new Set(
        moveTagNamesInput
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),
      ),
    );

    setIsMoveBoardLoading(true);
    try {
      const payload = {
        jiraProjectKey: projectKey,
        channelId: moveJiraChannelId.trim(),
        sourceBoardId: moveSourceBoardId.trim(),
        targetBoardId: moveTargetBoardId.trim(),
        ...(normalizedMoveTagNames.length > 0 ? { tagNames: normalizedMoveTagNames } : {}),
        dryRun: moveDryRun,
        ...(!moveDryRun ? { confirmText: moveConfirmText.trim() } : {}),
      };
      const result = await jiraMigrationService.moveJiraProjectBoard(payload);
      setMoveResult(result);
      if (result.missingStages.length > 0) {
        toast.error('Target board missing stages', {
          description: result.missingStages.join(', '),
        });
      } else {
        toast.success(moveDryRun ? 'Dry run complete' : 'Tickets moved', {
          description: `${result.movedTickets} tickets`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Move failed';
      toast.error('Move failed', { description: message });
    } finally {
      setIsMoveBoardLoading(false);
    }
  };

  const handleMoveJiraProjectChannel = async (): Promise<void> => {
    const projectKey = moveChannelJiraProjectKey.trim().toUpperCase();
    if (!projectKey) {
      toast.error('Enter Jira project key');
      return;
    }
    if (!moveChannelProjectId.trim()) {
      toast.error('Select Xyne project');
      return;
    }
    if (!moveChannelSourceId.trim()) {
      toast.error('Select source channel');
      return;
    }
    if (!moveChannelTargetId.trim()) {
      toast.error('Select target channel');
      return;
    }
    if (moveChannelSourceId.trim() === moveChannelTargetId.trim()) {
      toast.error('Source and target channel must be different');
      return;
    }
    if (!moveChannelDryRun && moveChannelConfirmText.trim() !== `MOVE ${projectKey}`) {
      toast.error(`Type 'MOVE ${projectKey}' to confirm`);
      return;
    }

    setIsMoveChannelLoading(true);
    try {
      const payload = {
        jiraProjectKey: projectKey,
        sourceChannelId: moveChannelSourceId.trim(),
        targetChannelId: moveChannelTargetId.trim(),
        dryRun: moveChannelDryRun,
        ...(!moveChannelDryRun ? { confirmText: moveChannelConfirmText.trim() } : {}),
      };
      const result = await jiraMigrationService.moveJiraProjectChannel(payload);
      setMoveChannelResult(result);
      toast.success(moveChannelDryRun ? 'Dry run complete' : 'Tickets moved', {
        description: `${result.movedTickets} tickets • ${result.movedConversations} conversations`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Move failed';
      toast.error('Move failed', { description: message });
    } finally {
      setIsMoveChannelLoading(false);
    }
  };

  const UnresolvedUserMappingRow = ({
    item,
  }: {
    item: JiraMigrationResolveUsersResponse['unresolvedUsers'][number];
  }) => {
    const [search, setSearch] = useState('');
    const { primary, fallbacks } = getUnresolvedMappingKeys(item);
    const selectedEmail = getMappedEmailForUnresolved(item);

    const options = useMemo(() => {
      const query = search.trim().toLowerCase();
      const users = (workspaceUsers || []).filter(user => Boolean(user?.email));
      const filtered = query
        ? users.filter(user => {
            const email = (user.email || '').toLowerCase();
            const name = (user.name || '').toLowerCase();
            return email.includes(query) || name.includes(query);
          })
        : users;

      // Keep dropdown fast: cap options shown.
      const baseOptions = filtered.slice(0, 50).map(user => ({
        value: user.email,
        label: user.name || user.email,
        subtitle: user.email,
        icon: <User className='w-4 h-4 text-muted-foreground' />,
      }));

      if (!selectedEmail) return baseOptions;

      const selectedUser = users.find(
        user => (user.email || '').toLowerCase() === selectedEmail.toLowerCase(),
      );
      if (!selectedUser) return baseOptions;

      const selectedOption = {
        value: selectedUser.email,
        label: selectedUser.name || selectedUser.email,
        subtitle: selectedUser.email,
        icon: <User className='w-4 h-4 text-muted-foreground' />,
      };

      if (baseOptions.some(opt => opt.value === selectedOption.value)) {
        return baseOptions;
      }

      return [selectedOption, ...baseOptions];
    }, [workspaceUsers, search]);

    return (
      <EntitySelector
        options={options}
        disableClientFiltering
        onSearchChange={setSearch}
        selectedValue={selectedEmail}
        onSelect={value => {
          setUserEmailMappings(prev => {
            const next = { ...prev };
            if (value) {
              next[primary] = value;
              for (const k of fallbacks) next[k] = value;
            } else {
              delete next[primary];
              for (const k of fallbacks) delete next[k];
            }
            return next;
          });
        }}
        placeholder='Map to Xyne user email'
        searchPlaceholder='Search users...'
        width='100%'
        testId={`jira-unresolved-map-${primary}`}
      />
    );
  };

  const previewActionCounts = useMemo(() => {
    if (!preview) {
      return {
        create: 0,
        reuse: 0,
        metadata: 0,
        fieldsPageCount: 0,
        issuePageCount: 0,
      };
    }

    return {
      create: preview.customFieldMappings.filter(
        item => item.action === 'create_board_custom_field',
      ).length,
      reuse: preview.customFieldMappings.filter(
        item => item.action === 'reuse_existing_board_custom_field',
      ).length,
      metadata: preview.customFieldMappings.filter(item => item.action === 'store_in_metadata')
        .length,
      fieldsPageCount: Math.max(
        1,
        Math.ceil(preview.customFieldMappings.length / PREVIEW_CUSTOM_FIELDS_PER_PAGE),
      ),
      issuePageCount: Math.max(
        1,
        Math.ceil(preview.issueSamples.length / PREVIEW_ISSUE_SAMPLES_PER_PAGE),
      ),
    };
  }, [preview]);

  const paginatedCustomFieldMappings = useMemo(() => {
    if (!preview) return [];
    const start = customFieldPage * PREVIEW_CUSTOM_FIELDS_PER_PAGE;
    return preview.customFieldMappings.slice(start, start + PREVIEW_CUSTOM_FIELDS_PER_PAGE);
  }, [customFieldPage, preview]);

  const paginatedIssueSamples = useMemo(() => {
    if (!preview) return [];
    const start = issueSamplePage * PREVIEW_ISSUE_SAMPLES_PER_PAGE;
    return preview.issueSamples.slice(start, start + PREVIEW_ISSUE_SAMPLES_PER_PAGE);
  }, [issueSamplePage, preview]);

  const paginatedIssueResults = useMemo(() => {
    if (!result) return [];
    const start = issueResultPage * ISSUE_EXECUTION_DETAILS_PER_PAGE;
    return result.issueResults.slice(start, start + ISSUE_EXECUTION_DETAILS_PER_PAGE);
  }, [issueResultPage, result]);

  const issueResultPageCount = useMemo(() => {
    if (!result) return 1;
    return Math.max(1, Math.ceil(result.issueResults.length / ISSUE_EXECUTION_DETAILS_PER_PAGE));
  }, [result]);

  const statusesMissingV2Mapping = useMemo(() => {
    if (!preview) return [];

    const statuses =
      preview.jiraStatusSequence.length > 0
        ? preview.jiraStatusSequence
        : preview.statusMappings.map(mapping => mapping.jiraStatus);

    return statuses.filter(
      status =>
        !TICKET_STATUS_V2_OPTIONS.includes(statusV2Mappings[status] as TicketStatusV2Option),
    );
  }, [preview, statusV2Mappings]);

  const hasCompleteStatusV2Mappings = Boolean(preview) && statusesMissingV2Mapping.length === 0;

  const orderedStageSequence = useMemo(() => {
    if (!preview) return [];
    const base = jiraStatusSequence.length > 0 ? jiraStatusSequence : preview.jiraStatusSequence;
    return base.filter(status => !excludedStageNames[status]);
  }, [excludedStageNames, jiraStatusSequence, preview]);

  const mappedStatusMappings = useMemo(() => {
    if (!preview) return [];

    const mappingByStatus = new Map(
      preview.statusMappings.map(mapping => [mapping.jiraStatus, mapping] as const),
    );
    const orderedStatuses =
      preview.jiraStatusSequence.length > 0
        ? preview.jiraStatusSequence
        : preview.statusMappings.map(mapping => mapping.jiraStatus);

    return orderedStatuses
      .map(
        status =>
          mappingByStatus.get(status) || {
            jiraStatus: status,
            suggestedStageName: null,
            confidence: 'low' as const,
          },
      )
      .filter(mapping =>
        TICKET_STATUS_V2_OPTIONS.includes(
          statusV2Mappings[mapping.jiraStatus] as TicketStatusV2Option,
        ),
      );
  }, [preview, statusV2Mappings]);

  const newStatusMappings = useMemo(() => {
    if (!preview) return [];

    const mappingByStatus = new Map(
      preview.statusMappings.map(mapping => [mapping.jiraStatus, mapping] as const),
    );
    const orderedStatuses =
      preview.jiraStatusSequence.length > 0
        ? preview.jiraStatusSequence
        : preview.statusMappings.map(mapping => mapping.jiraStatus);

    return orderedStatuses
      .map(
        status =>
          mappingByStatus.get(status) || {
            jiraStatus: status,
            suggestedStageName: null,
            confidence: 'low' as const,
          },
      )
      .filter(
        mapping =>
          !TICKET_STATUS_V2_OPTIONS.includes(
            statusV2Mappings[mapping.jiraStatus] as TicketStatusV2Option,
          ),
      );
  }, [preview, statusV2Mappings]);

  const loadMigrationHistory = async (): Promise<void> => {
    try {
      const history = await jiraMigrationService.getMigrationHistory();
      setMigrationHistory(history);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load migration history';
      toast.error('History load failed', { description: message });
    }
  };

  useEffect(() => {
    void loadMigrationHistory();
  }, []);

  useEffect(() => {
    const persistedJob = readPersistedJiraMigrationJob();
    if (!persistedJob) return;

    setJiraProjectKey(persistedJob.jiraProjectKey);
    setSelectedProjectId(persistedJob.targetProjectId);
    setSelectedBoardId(persistedJob.targetBoardId);
    setTargetChannelId(persistedJob.targetChannelId);
    setTicketRange(persistedJob.ticketRange);
    setIsImportLoading(true);
    setActiveJobId(persistedJob.jobId);
    toast.info('Recovered active Jira migration job', {
      description: `${persistedJob.jiraProjectKey} migration is resuming from the backend job tracker.`,
    });
  }, []);

  const resolvedDateFrom = useMemo(() => {
    if (ticketRange === 'all') return undefined;

    const date = new Date();
    if (ticketRange === 'last_1_year') {
      date.setFullYear(date.getFullYear() - 1);
    } else if (ticketRange === 'last_6_months') {
      date.setMonth(date.getMonth() - 6);
    } else {
      date.setMonth(date.getMonth() - 1);
    }
    return date.toISOString().slice(0, 10);
  }, [ticketRange]);

  const normalizedIssueKeys = useMemo(
    () =>
      Array.from(
        new Set(
          issueKeysInput
            .split(',')
            .map(value => value.trim().toUpperCase())
            .filter(Boolean),
        ),
      ),
    [issueKeysInput],
  );

  useEffect(() => {
    if (!activeJobId) return undefined;

    let cancelled = false;
    const lastRetryableToastAtRef = { current: 0 };

    const pollStatus = async (): Promise<void> => {
      try {
        const status = await jiraMigrationService.getMigrationStatus(activeJobId);
        if (cancelled) return;

        persistJiraMigrationJob({
          jobId: status.jobId,
          jiraProjectKey: status.jiraProjectKey,
          targetProjectId: status.targetProjectId,
          targetBoardId: status.targetBoardId,
          targetChannelId: status.targetChannelId,
          ticketRange,
          ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
          startedAt: status.startedAt,
        });

        setMigrationProgress(status);

        if (status.status === 'completed') {
          clearPersistedJiraMigrationJob();
          setIsImportLoading(false);
          setActiveJobId(null);
          if (status.result) {
            setResult(status.result);
            setIssueResultPage(0);
          }
          void loadMigrationHistory();
          toast.success('Jira migration completed');
          return;
        }

        if (status.status === 'failed') {
          clearPersistedJiraMigrationJob();
          setIsImportLoading(false);
          setActiveJobId(null);
          toast.error('Import failed', {
            description: status.errorMessage || 'Jira migration failed',
          });
        }
      } catch (error) {
        if (cancelled) return;

        const httpStatus = isAxiosError(error) ? error.response?.status : undefined;
        const isRetryable =
          httpStatus === 429 ||
          (typeof httpStatus === 'number' && httpStatus >= 500 && httpStatus <= 599) ||
          typeof httpStatus !== 'number'; // network / unknown

        if (isRetryable) {
          // Do NOT clear persisted job for transient server/network failures (e.g. 503).
          // Keep showing last known progress and retry on next poll tick.
          const now = Date.now();
          if (now - lastRetryableToastAtRef.current > 10_000) {
            lastRetryableToastAtRef.current = now;
            toast.warning('Migration status temporarily unavailable', {
              description:
                typeof httpStatus === 'number'
                  ? `Server returned ${httpStatus}. Retrying…`
                  : 'Network error. Retrying…',
            });
          }
          return;
        }

        // Non-retryable: job likely gone / auth issues etc. Clear local persistence so UI can recover cleanly.
        setIsImportLoading(false);
        setActiveJobId(null);
        const message = error instanceof Error ? error.message : 'Failed to fetch migration status';
        toast.error('Status check failed', { description: message });
      }
    };

    void pollStatus();
    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobId, resolvedDateFrom, ticketRange]);

  useEffect(() => {
    if (!purgeJobId) return undefined;

    let cancelled = false;

    const pollPurgeStatus = async (): Promise<void> => {
      try {
        const status = await jiraMigrationService.getMigrationStatus(purgeJobId);
        if (cancelled) return;
        setPurgeJobProgress(status);

        if (status.status === 'completed' || status.status === 'failed') {
          setPurgeJobId(null);
          setIsPurgeLoading(false);
          if (status.status === 'completed') {
            toast.success('Purge completed');
            void loadMigrationHistory();
          } else {
            toast.error('Purge failed', {
              description: status.errorMessage || 'Background purge job failed',
            });
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to fetch purge status';
        toast.error('Purge status check failed', { description: message });
        setPurgeJobId(null);
        setIsPurgeLoading(false);
      }
    };

    void pollPurgeStatus();
    const intervalId = window.setInterval(() => {
      void pollPurgeStatus();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [purgeJobId]);

  const canPreview =
    jiraProjectKey.trim() !== '' &&
    selectedProjectId.trim() !== '' &&
    selectedBoardId.trim() !== '' &&
    targetChannelId.trim() !== '';

  const getUnresolvedMappingKeys = (item: {
    displayName: string | null;
    accountId: string | null;
  }): { primary: string; fallbacks: string[] } => {
    const accountIdKey = item.accountId?.trim()
      ? `accountId:${item.accountId.trim().toLowerCase()}`
      : null;
    const displayNameKey = item.displayName?.trim()
      ? `displayName:${item.displayName.trim().toLowerCase()}`
      : null;
    const rawDisplayNameKey = item.displayName?.trim()
      ? item.displayName.trim().toLowerCase()
      : null;

    const keys = [accountIdKey, displayNameKey, rawDisplayNameKey].filter((v): v is string =>
      Boolean(v),
    );
    const primary = keys[0] || 'unknown';
    return { primary, fallbacks: keys.slice(1) };
  };

  const getMappedEmailForUnresolved = (item: {
    displayName: string | null;
    accountId: string | null;
  }): string | null => {
    const { primary, fallbacks } = getUnresolvedMappingKeys(item);
    return (
      userEmailMappings[primary] || fallbacks.map(k => userEmailMappings[k]).find(Boolean) || null
    );
  };

  const handleResolveUsers = async (): Promise<void> => {
    if (!canPreview) {
      toast.error('Please fill Jira project key, target project, board, and channel ID');
      return;
    }

    setIsResolveUsersLoading(true);
    setScanPagesScanned(0);
    setScanUnresolvedFound(0);
    setScanResolvedMappings([]);
    setScanResolvedMappingsTruncated(false);
    setResolvedUsersPage(0);
    try {
      const aggregated = new Map<
        string,
        {
          displayName: string | null;
          accountId: string | null;
          suggestedEmails: Set<string>;
          issueKeys: Set<string>;
        }
      >();

      let nextPageToken: string | null = null;
      let hasNextPage = true;
      let pages = 0;
      const scanPageSize = 100;

      while (hasNextPage) {
        pages += 1;
        setScanPagesScanned(pages);
        const page = await jiraMigrationService.resolveUsers({
          jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
          ...(normalizedIssueKeys.length > 0 ? { issueKeys: normalizedIssueKeys } : {}),
          ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
          includeComments: scanIncludeComments,
          includeAttachments: scanIncludeAttachments,
          pageSize: scanPageSize,
          nextPageToken,
          ...(Object.keys(userEmailMappings).length > 0 ? { userEmailMappings } : {}),
        });

        if (page.resolvedUserMappings?.length) {
          setScanResolvedMappings(prev => {
            const seen = new Set(prev.map(item => item.jiraUserKey));
            const next = [...prev];
            for (const item of page.resolvedUserMappings) {
              if (!seen.has(item.jiraUserKey)) {
                next.push(item);
                seen.add(item.jiraUserKey);
              }
            }
            return next;
          });
        }
        if (page.resolvedUserMappingsTruncated) {
          setScanResolvedMappingsTruncated(true);
        }

        for (const item of page.unresolvedUsers) {
          const { primary: key } = getUnresolvedMappingKeys(item);
          const existing = aggregated.get(key);
          const next = existing || {
            displayName: item.displayName,
            accountId: item.accountId,
            suggestedEmails: new Set<string>(),
            issueKeys: new Set<string>(),
          };

          item.suggestedEmails.forEach(email => next.suggestedEmails.add(email));
          item.issueKeys.forEach(issueKey => next.issueKeys.add(issueKey));
          aggregated.set(key, next);
        }

        setScanUnresolvedFound(aggregated.size);
        nextPageToken = page.nextPageToken;
        hasNextPage = page.hasNextPage;
        if (pages % 5 === 0) {
          toast.info(`Scanning Jira users… pages scanned: ${pages}`);
        }
      }

      const merged = [...aggregated.entries()].map(([key, item]) => ({
        key,
        displayName: item.displayName,
        accountId: item.accountId,
        suggestedEmails: [...item.suggestedEmails],
        issueKeys: [...item.issueKeys],
      }));

      const emailSet = new Set(
        (workspaceUsers || []).map(user => (user.email || '').toLowerCase()).filter(Boolean),
      );
      const nextMappings: Record<string, string> = { ...userEmailMappings };
      for (const item of merged) {
        if (nextMappings[item.key]) continue;
        const match = item.suggestedEmails.find(email => emailSet.has(email.toLowerCase()));
        if (match) nextMappings[item.key] = match;
      }
      setUserEmailMappings(nextMappings);

      setResolveUsersResult({
        jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
        nextPageToken: null,
        hasNextPage: false,
        boardNextStartAt: null,
        totalIssuesScanned: 0,
        jiraUsersSeen: 0,
        resolvedUsers: 0,
        resolvedUserMappings: [],
        resolvedUserMappingsTruncated: false,
        unresolvedUsers: merged.map(item => ({
          displayName: item.displayName,
          accountId: item.accountId,
          suggestedEmails: item.suggestedEmails,
          issueKeys: item.issueKeys,
        })),
      });

      toast.success(`User scan complete. Unresolved: ${merged.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve Jira users';
      toast.error('Resolve users failed', { description: message });
    } finally {
      setIsResolveUsersLoading(false);
    }
  };

  const handleFetchBoards = async (): Promise<void> => {
    const key = jiraProjectKey.trim().toUpperCase();
    if (!key) {
      toast.error('Enter a Jira project key first');
      return;
    }
    setIsFetchingBoards(true);
    setJiraBoards([]);
    setMigrationMode(null);
    setPerBoardMappings([]);
    setPerBoardJobs([]);
    try {
      const boards = await jiraMigrationService.fetchBoards(key);
      setJiraBoards(boards);
      if (boards.length === 0) {
        toast.warning('No boards found for this project');
      } else {
        if (boards.length === 1) {
          setMigrationMode('all-to-one');
        }
        toast.success(`${boards.length} board${boards.length > 1 ? 's' : ''} found`);
        setTimeout(
          () => boardSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          100,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch boards';
      toast.error('Board fetch failed', { description: message });
    } finally {
      setIsFetchingBoards(false);
    }
  };

  const handlePerBoardImport = async (): Promise<void> => {
    const readyMappings = perBoardMappings.filter(m => m.xyneBoardId.trim() !== '');
    if (readyMappings.length === 0) {
      toast.error('Map at least one Jira board to a Xyne board');
      return;
    }
    if (!targetChannelId.trim()) {
      toast.error('Select a target channel');
      return;
    }
    if (!hasCompleteStatusV2Mappings) {
      toast.error('Run preview and map all statuses first');
      return;
    }

    setIsPerBoardImportLoading(true);
    const strictStatusV2Mappings = Object.fromEntries(
      orderedStageSequence.map(jiraStatus => [
        jiraStatus,
        statusV2Mappings[jiraStatus]?.trim() || '',
      ]),
    );
    const selectedSkipCustomFieldIds =
      preview?.customFieldMappings
        .filter(
          m => m.action === 'create_board_custom_field' && skippedCustomFieldIds[m.jiraFieldId],
        )
        .map(m => m.jiraFieldId) ?? [];

    const initialJobs: PerBoardJobEntry[] = readyMappings.map(m => ({
      jiraBoard: m.jiraBoard,
      xyneBoardId: m.xyneBoardId,
      jobId: null,
      progress: null,
      pollError: null,
    }));
    setPerBoardJobs(initialJobs);

    const bulkJobsPayload: JiraMigrationExecuteRequest[] = readyMappings.map(mapping => ({
      jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
      targetProjectId: selectedProjectId,
      targetBoardId: mapping.xyneBoardId,
      targetChannelId: targetChannelId.trim(),
      jiraBoardId: mapping.jiraBoard.id,
      jiraBoardName: mapping.jiraBoard.name,
      statusV2Mappings: strictStatusV2Mappings,
      skipCustomFieldIds: selectedSkipCustomFieldIds,
      excludedStageNames: Object.keys(excludedStageNames).filter(n => excludedStageNames[n]),
      ...(Object.keys(userEmailMappings).length > 0 ? { userEmailMappings } : {}),
      ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
    }));

    let hadFailure = false;
    try {
      const bulkStart = await jiraMigrationService.startBulkMigration({ jobs: bulkJobsPayload });
      const jobIdsInOrder = bulkStart.jobs.map(job => job.jobId);

      setPerBoardJobs(prev =>
        prev.map((entry, idx) => ({
          ...entry,
          jobId: jobIdsInOrder[idx] ?? null,
          pollError: null,
        })),
      );
      toast.success(`Started ${jobIdsInOrder.length} board migration job(s)`);
      toast.message('Note', {
        description:
          'Bulk migration jobs run sequentially on the server. If the server restarts mid-run, you may need to re-run the remaining boards.',
      });

      // Poll each job in order (server runs sequentially; polling sequentially keeps UI simple).
      for (let i = 0; i < jobIdsInOrder.length; i += 1) {
        const jobId = jobIdsInOrder[i];
        const mapping = readyMappings[i];
        if (!jobId || !mapping) continue;

        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>(resolve => {
          const startedAt = Date.now();
          const maxPollMs = 30 * 60 * 1000; // 30 minutes per board
          const poll = async () => {
            if (Date.now() - startedAt > maxPollMs) {
              hadFailure = true;
              toast.warning('Migration polling timed out', {
                description: `Job ${jobId} is still running. You can check status later in History.`,
              });
              setPerBoardJobs(prev =>
                prev.map((entry, idx) =>
                  idx === i ? { ...entry, pollError: 'Polling timed out' } : entry,
                ),
              );
              resolve();
              return;
            }
            try {
              const progress = await jiraMigrationService.getMigrationStatus(jobId);
              setPerBoardJobs(prev =>
                prev.map((entry, idx) =>
                  idx === i ? { ...entry, progress, pollError: null } : entry,
                ),
              );
              if (progress.status === 'completed' || progress.status === 'failed') {
                if (progress.status === 'failed') {
                  hadFailure = true;
                }
                resolve();
              } else {
                setTimeout(() => {
                  void poll();
                }, 2000);
              }
            } catch (error) {
              hadFailure = true;
              const message = error instanceof Error ? error.message : 'Polling failed';
              setPerBoardJobs(prev =>
                prev.map((entry, idx) =>
                  idx === i
                    ? {
                        ...entry,
                        pollError: message,
                      }
                    : entry,
                ),
              );
              toast.error('Polling failed', {
                description: `Job ${jobId}: ${message}. Continuing; check History for latest status.`,
              });
              resolve();
            }
          };
          void poll();
        });
      }
    } catch (error) {
      hadFailure = true;
      const message = error instanceof Error ? error.message : 'Failed to start bulk migration';
      toast.error('Bulk start failed', { description: message });
    } finally {
      setIsPerBoardImportLoading(false);
    }

    const history = await jiraMigrationService.getMigrationHistory();
    setMigrationHistory(history);
    if (!hadFailure) toast.success('Per-board migration complete');
    else
      toast.warning('Per-board migration finished with warnings', {
        description: 'Some boards failed or could not be polled. Check History.',
      });
  };

  const buildPayload = (nextPageToken?: string) => ({
    jiraProjectKey: jiraProjectKey.trim().toUpperCase(),
    targetProjectId: selectedProjectId,
    targetBoardId: selectedBoardId,
    targetChannelId: targetChannelId.trim(),
    ...(normalizedIssueKeys.length > 0 ? { issueKeys: normalizedIssueKeys } : {}),
    ...(jiraBoardId !== null ? { jiraBoardId } : {}),
    maxResults: 25,
    ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
    ...(isFilterEnabled ? { loadFilterOptions: true } : {}),
    ...(normalizedIssueKeys.length === 0 &&
    isFilterEnabled &&
    (filters.reporterAccountIds?.length ||
      filters.creatorAccountIds?.length ||
      filters.assigneeAccountIds?.length ||
      filters.labels?.length ||
      filters.epicKeys?.length)
      ? { filters }
      : {}),
    ...(nextPageToken ? { nextPageToken } : {}),
  });

  const handlePreview = async (nextPageToken?: string): Promise<void> => {
    if (!canPreview) {
      toast.error('Please fill Jira project key, target project, board, and channel ID');
      return;
    }

    setIsPreviewLoading(true);
    try {
      const previewResult = await jiraMigrationService.previewMigration(
        buildPayload(nextPageToken),
      );

      const boardStatusByNormalizedStageName = new Map<string, string>(
        previewResult.target.stages.map(stage => [
          normalizeStatusKey(stage.name),
          stage.defaultTicketStatusV2,
        ]),
      );

      setPreview(previewResult);
      setJiraBoardId(previewResult.selectedJiraBoardId ?? null);
      setStatusV2Mappings(previous =>
        Object.fromEntries(
          (previewResult.jiraStatusSequence.length > 0
            ? previewResult.jiraStatusSequence
            : previewResult.statusMappings.map(mapping => mapping.jiraStatus)
          ).map(status => [
            status,
            previous[status] ||
              (TICKET_STATUS_V2_OPTIONS.includes(
                boardStatusByNormalizedStageName.get(
                  normalizeStatusKey(status),
                ) as TicketStatusV2Option,
              )
                ? boardStatusByNormalizedStageName.get(normalizeStatusKey(status))
                : '') ||
              '',
          ]),
        ),
      );
      setJiraStatusSequence(previewResult.jiraStatusSequence);
      setJiraStatusSequenceOrderInput({});
      setExcludedStageNames({});
      setSkippedCustomFieldIds(previous =>
        Object.fromEntries(
          previewResult.customFieldMappings.map(mapping => [
            mapping.jiraFieldId,
            previous[mapping.jiraFieldId] || false,
          ]),
        ),
      );
      setResult(null);
      setIssueResultPage(0);
      setPreviewSection('overview');
      setCustomFieldPage(0);
      setIssueSamplePage(0);
      setMigrationPhase(prev => (prev === 'setup' ? 'map-statuses' : prev));
      toast.success('Jira migration preview loaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to preview migration';
      toast.error('Preview failed', { description: message });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (!canPreview) {
      toast.error('Please fill Jira project key, target project, board, and channel ID');
      return;
    }

    if (!preview) {
      toast.error('Preview is required before migration');
      return;
    }

    if (!hasCompleteStatusV2Mappings) {
      toast.error('Map all Jira statuses to StatusV2 before migration');
      return;
    }

    const strictStatusV2Mappings = Object.fromEntries(
      orderedStageSequence.map(jiraStatus => [
        jiraStatus,
        statusV2Mappings[jiraStatus]?.trim() || '',
      ]),
    );
    const selectedSkipCustomFieldIds = preview.customFieldMappings
      .filter(
        mapping =>
          mapping.action === 'create_board_custom_field' &&
          skippedCustomFieldIds[mapping.jiraFieldId],
      )
      .map(mapping => mapping.jiraFieldId);

    setIsImportLoading(true);
    setResult(null);
    setMigrationProgress(null);

    try {
      const payload: JiraMigrationExecuteRequest = {
        ...buildPayload(),
        statusV2Mappings: strictStatusV2Mappings,
        skipCustomFieldIds: selectedSkipCustomFieldIds,
        jiraStatusSequence: orderedStageSequence,
        excludedStageNames: Object.keys(excludedStageNames).filter(
          name => excludedStageNames[name],
        ),
        ...(Object.keys(userEmailMappings).length > 0 ? { userEmailMappings } : {}),
      };

      const startResult = await jiraMigrationService.startMigration(payload);
      persistJiraMigrationJob({
        jobId: startResult.jobId,
        jiraProjectKey: payload.jiraProjectKey,
        targetProjectId: payload.targetProjectId,
        targetBoardId: payload.targetBoardId,
        targetChannelId: payload.targetChannelId,
        ticketRange,
        ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
        startedAt: new Date().toISOString(),
      });
      setActiveJobId(startResult.jobId);
      toast.success('Jira migration started');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start migration';
      setIsImportLoading(false);
      toast.error('Import failed', { description: message });
    }
  };

  const handleStopMigration = async (): Promise<void> => {
    if (!migrationProgress) return;
    try {
      const next = await jiraMigrationService.stopMigration(migrationProgress.jobId);
      setMigrationProgress(next);
      toast.warning('Stopping migration...');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop migration';
      toast.error('Stop failed', { description: message });
    }
  };

  const handlePauseMigration = async (): Promise<void> => {
    if (!migrationProgress) return;
    try {
      const next = await jiraMigrationService.pauseMigration(
        migrationProgress.jobId,
        2 * 60 * 1000,
      );
      setMigrationProgress(next);
      toast.info('Migration paused for 2 minutes');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pause migration';
      toast.error('Pause failed', { description: message });
    }
  };

  const handleResumeMigration = async (): Promise<void> => {
    if (!migrationProgress) return;
    try {
      const next = await jiraMigrationService.resumeMigration(migrationProgress.jobId);
      setMigrationProgress(next);
      toast.success('Migration resumed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume migration';
      toast.error('Resume failed', { description: message });
    }
  };

  const handleNextPage = async (): Promise<void> => {
    if (!preview?.pagination.nextPageToken) return;
    const nextToken = preview.pagination.nextPageToken;
    const existingIndex = pageTokens.findIndex(token => token === nextToken);
    const newTokens =
      existingIndex === -1 ? [...pageTokens.slice(0, pageIndex + 1), nextToken] : pageTokens;
    const newPageIndex = existingIndex === -1 ? pageIndex + 1 : existingIndex;

    setPageTokens(newTokens);
    setPageIndex(newPageIndex);
    await handlePreview(nextToken);
  };

  const handlePreviousPage = async (): Promise<void> => {
    if (pageIndex === 0) return;
    const previousPageIndex = pageIndex - 1;
    const previousToken = pageTokens[previousPageIndex];
    setPageIndex(previousPageIndex);
    await handlePreview(previousToken);
  };

  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <div className='h-full overflow-y-auto'>
        <div className='border-b border-border bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.04),transparent)] p-6'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <div className='inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-800'>
                Admin Migration Console
              </div>
              <h2 className='mt-3 text-xl font-bold tracking-tight text-foreground'>
                Jira Migration Planner
              </h2>
              <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
                Preview Jira issue mappings, validate board fit, and run a resumable import into the
                selected Xyne project, board, and channel.
              </p>
              <div className='mt-4 inline-flex rounded-xl border border-border bg-background/70 p-1'>
                <button
                  type='button'
                  data-track-category='jira_migration'
                  data-track-name='use_case_issues'
                  onClick={() => setUseCase('issues')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    useCase === 'issues'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Issue Migration
                </button>
                <button
                  type='button'
                  data-track-category='jira_migration'
                  data-track-name='use_case_channel_only'
                  onClick={() => setUseCase('channel-only')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    useCase === 'channel-only'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Move Channel
                </button>
                <button
                  type='button'
                  data-track-category='jira_migration'
                  data-track-name='use_case_purge_project'
                  onClick={() => setUseCase('purge-project')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    useCase === 'purge-project'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Purge Migration
                </button>
                <button
                  type='button'
                  data-track-category='jira_migration'
                  data-track-name='use_case_move_jira_project_channel'
                  onClick={() => setUseCase('move-jira-project-channel')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    useCase === 'move-jira-project-channel'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Move Jira Project Channel
                </button>
                <button
                  type='button'
                  data-track-category='jira_migration'
                  data-track-name='use_case_move_jira_project_board'
                  onClick={() => setUseCase('move-jira-project-board')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    useCase === 'move-jira-project-board'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Move Jira Project Tickets
                </button>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3 text-left lg:min-w-[320px]'>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                  Execution
                </p>
                <p className='mt-1 text-sm font-semibold text-foreground'>Async backend job</p>
                <p className='mt-1 text-xs text-muted-foreground'>Progress tracked in Redis</p>
              </div>
              <div className='rounded-xl border border-border bg-background/80 p-3 shadow-sm'>
                <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                  Recovery
                </p>
                <p className='mt-1 text-sm font-semibold text-foreground'>Refresh-safe UI</p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Active jobs resume automatically
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className='p-6 space-y-6'>
          {useCase === 'channel-only' ? (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
              <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.05),transparent)] px-5 py-4'>
                <div className='flex flex-col gap-1'>
                  <h3 className='text-sm font-semibold text-foreground'>
                    Move Channel (No tickets)
                  </h3>
                  <p className='text-xs text-muted-foreground'>
                    Updates the channel&apos;s `projectId` and marks it migrated. Does not touch
                    tickets.
                  </p>
                </div>
              </div>

              <div className='p-5'>
                <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Source Project
                    </p>
                    <EntitySelector
                      options={(projects || []).map(project => ({
                        value: project.id,
                        label: project.name,
                        icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={channelMoveSourceProjectId || null}
                      onSelect={value => {
                        setChannelMoveSourceProjectId(value ?? '');
                        setChannelMoveChannelId('');
                      }}
                      placeholder='Select project'
                      searchPlaceholder='Search projects...'
                      width='100%'
                      testId='jira-move-channel-source-project'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Channel
                    </p>
                    <EntitySelector
                      options={(channelMoveChannels || []).map(channel => ({
                        value: channel.id,
                        label: channel.name,
                        icon: <Hash className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={channelMoveChannelId || null}
                      onSelect={value => setChannelMoveChannelId(value ?? '')}
                      placeholder='Select channel'
                      searchPlaceholder='Search channels...'
                      width='100%'
                      testId='jira-move-channel-channel'
                    />
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Must currently belong to the source project.
                    </p>
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Target Project
                    </p>
                    <EntitySelector
                      options={(projects || []).map(project => ({
                        value: project.id,
                        label: project.name,
                        icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={channelMoveTargetProjectId || null}
                      onSelect={value => setChannelMoveTargetProjectId(value ?? '')}
                      placeholder='Select project'
                      searchPlaceholder='Search projects...'
                      width='100%'
                      testId='jira-move-channel-target-project'
                    />
                  </div>
                </div>

                <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr,auto]'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-move-channel-updated-at'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      updatedAt (optional)
                    </label>
                    <Input
                      id='jira-move-channel-updated-at'
                      value={channelMoveUpdatedAt}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setChannelMoveUpdatedAt(e.target.value)
                      }
                      placeholder='2026-05-19T13:23:47.000Z'
                    />
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Leave empty to use current time.
                    </p>
                  </div>

                  <div className='flex items-end'>
                    <Button
                      className='w-full lg:w-auto'
                      onClick={() => void handleMoveChannelProject()}
                      data-track-category='jira_migration'
                      data-track-name='MOVE_CHANNEL_PROJECT'
                      disabled={isChannelMoveLoading}
                    >
                      {isChannelMoveLoading ? 'Moving…' : 'Move Channel'}
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          ) : useCase === 'purge-project' ? (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
              <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(225,29,72,0.08),rgba(14,165,233,0.04),transparent)] px-5 py-4'>
                <div className='flex flex-col gap-1'>
                  <h3 className='text-sm font-semibold text-foreground'>
                    Purge Jira Migration (Danger)
                  </h3>
                  <p className='text-xs text-muted-foreground'>
                    Deletes imported Jira migration data for the selected Xyne project (tickets,
                    comments/messages, attachments, external mappings).
                  </p>
                </div>
              </div>

              <div className='p-5 space-y-4'>
                <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Project
                    </p>
                    <EntitySelector
                      options={(projects || []).map(project => ({
                        value: project.id,
                        label: project.name,
                        icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={purgeProjectId || null}
                      onSelect={value => {
                        const next = value ?? '';
                        setPurgeProjectId(next);
                        setPurgeExternalSourceId('');
                        setPurgeConfirmText('');
                        setPurgeResult(null);
                      }}
                      placeholder='Select project'
                      searchPlaceholder='Search projects...'
                      width='100%'
                      testId='jira-purge-project'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Jira Migration Source
                    </p>
                    <EntitySelector
                      options={purgeMigrationHistory.map(item => ({
                        value: item.externalSourceId,
                        label: item.jiraProjectKey,
                        icon: null,
                        subtitle: item.displayName,
                      }))}
                      selectedValue={purgeExternalSourceId || null}
                      onSelect={value => {
                        setPurgeExternalSourceId(value ?? '');
                        setPurgeConfirmText('');
                        setPurgeResult(null);
                      }}
                      placeholder={
                        purgeProjectId
                          ? purgeMigrationHistory.length === 0
                            ? 'No migrations found for this project'
                            : 'Select Jira project'
                          : 'Select a project first'
                      }
                      searchPlaceholder='Search Jira projects...'
                      width='100%'
                      testId='jira-purge-external-source'
                    />
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Select the specific Jira project migration to purge.
                    </p>
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-purge-confirm'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Confirm
                    </label>
                    <Input
                      id='jira-purge-confirm'
                      value={purgeConfirmText}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setPurgeConfirmText(e.target.value)
                      }
                      placeholder={
                        purgeProjectId ? `DELETE ${purgeProjectId}` : 'Select project first'
                      }
                    />
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Must exactly match:{' '}
                      <span className='font-mono'>
                        {purgeProjectId ? `DELETE ${purgeProjectId}` : 'DELETE <projectId>'}
                      </span>
                    </p>
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Mode
                    </p>
                    <div className='flex items-center gap-2'>
                      <button
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name='purge_mode_dry_run'
                        onClick={() => setPurgeDryRun(true)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium border transition',
                          purgeDryRun
                            ? 'bg-foreground text-background border-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Dry run
                      </button>
                      <button
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name='purge_mode_delete'
                        onClick={() => setPurgeDryRun(false)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium border transition',
                          !purgeDryRun
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Delete
                      </button>
                    </div>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Start with Dry run to see counts.
                    </p>
                  </div>
                </div>

                <div className='flex justify-end'>
                  <Button
                    variant={purgeDryRun ? 'outline' : 'default'}
                    onClick={() => void handlePurgeProjectMigration()}
                    data-track-category='jira_migration'
                    data-track-name='PURGE_PROJECT_MIGRATION'
                    disabled={isPurgeLoading}
                  >
                    {isPurgeLoading
                      ? 'Running…'
                      : purgeDryRun
                        ? 'Run Dry Run'
                        : 'Delete Migration Data'}
                  </Button>
                </div>

                {purgeResult?.stats && (
                  <div className='rounded-2xl border border-border/70 bg-card/60 p-4 text-sm'>
                    <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>Channels</div>
                        <div className='font-semibold'>{purgeResult.stats.channelCount}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Jira Sources
                        </div>
                        <div className='font-semibold'>
                          {purgeResult.stats.jiraExternalSourceCount}
                        </div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          External Mappings
                        </div>
                        <div className='font-semibold'>
                          {purgeResult.stats.externalMessageCount}
                        </div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>Tickets</div>
                        <div className='font-semibold'>{purgeResult.stats.ticketCount}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Conversations
                        </div>
                        <div className='font-semibold'>{purgeResult.stats.conversationCount}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Mapped Messages
                        </div>
                        <div className='font-semibold'>{purgeResult.stats.mappedMessageCount}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Mapped Attachments
                        </div>
                        <div className='font-semibold'>
                          {purgeResult.stats.mappedAttachmentCount}
                        </div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>Dry Run</div>
                        <div className='font-semibold'>{String(purgeResult.dryRun ?? false)}</div>
                      </div>
                    </div>
                  </div>
                )}

                {purgeJobProgress && (
                  <div className='rounded-2xl border border-border/70 bg-card/60 p-4 text-sm space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                        Purge Progress
                      </span>
                      <span
                        className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          purgeJobProgress.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : purgeJobProgress.status === 'failed'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-sky-100 text-sky-700',
                        )}
                      >
                        {purgeJobProgress.status}
                      </span>
                    </div>
                    {purgeJobProgress.currentStep && (
                      <p className='text-xs text-muted-foreground font-mono'>
                        {purgeJobProgress.currentStep}
                      </p>
                    )}
                    {purgeJobProgress.totalIssues !== null && purgeJobProgress.totalIssues > 0 && (
                      <div className='space-y-1'>
                        <div className='flex justify-between text-xs text-muted-foreground'>
                          <span>Tickets deleted</span>
                          <span>
                            {purgeJobProgress.processedIssues} / {purgeJobProgress.totalIssues}
                          </span>
                        </div>
                        <div className='h-1.5 rounded-full bg-muted overflow-hidden'>
                          <div
                            className='h-full rounded-full bg-sky-500 transition-all'
                            style={{
                              width: `${Math.round((purgeJobProgress.processedIssues / purgeJobProgress.totalIssues) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {purgeJobProgress.errorMessage && (
                      <p className='text-xs text-rose-600'>{purgeJobProgress.errorMessage}</p>
                    )}
                  </div>
                )}
              </div>
            </section>
          ) : useCase === 'move-jira-project-channel' ? (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
              <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.04),transparent)] px-5 py-4'>
                <div className='flex flex-col gap-1'>
                  <h3 className='text-sm font-semibold text-foreground'>
                    Move Jira Project Channel
                  </h3>
                  <p className='text-xs text-muted-foreground'>
                    Move only Jira-migrated tickets for one Jira project from one channel to another
                    within the same Xyne project.
                  </p>
                </div>
              </div>

              <div className='p-5 space-y-4'>
                <div className='grid grid-cols-1 gap-4 lg:grid-cols-4'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-move-channel-project-key'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Jira Project Key
                    </label>
                    <Input
                      id='jira-move-channel-project-key'
                      value={moveChannelJiraProjectKey}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        setMoveChannelJiraProjectKey(e.target.value);
                        setMoveChannelResult(null);
                      }}
                      placeholder='ABC'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Xyne Project
                    </p>
                    <EntitySelector
                      options={(projects || []).map(project => ({
                        value: project.id,
                        label: project.name,
                        icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={moveChannelProjectId || null}
                      onSelect={value => {
                        setMoveChannelProjectId(value ?? '');
                        setMoveChannelSourceId('');
                        setMoveChannelTargetId('');
                        setMoveChannelConfirmText('');
                        setMoveChannelResult(null);
                      }}
                      placeholder='Select project'
                      searchPlaceholder='Search projects...'
                      width='100%'
                      testId='jira-move-channel-project'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Source Channel
                    </p>
                    <EntitySelector
                      options={moveProjectChannels.map(channel => ({
                        value: channel.id,
                        label: channel.name,
                        icon: <Hash className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={moveChannelSourceId || null}
                      onSelect={value => {
                        setMoveChannelSourceId(value ?? '');
                        setMoveChannelResult(null);
                      }}
                      placeholder='Select channel'
                      searchPlaceholder='Search channels...'
                      width='100%'
                      testId='jira-move-channel-source'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Target Channel
                    </p>
                    <EntitySelector
                      options={moveProjectChannels
                        .filter(channel => channel.id !== moveChannelSourceId)
                        .map(channel => ({
                          value: channel.id,
                          label: channel.name,
                          icon: <Hash className='w-4 h-4 text-muted-foreground' />,
                        }))}
                      selectedValue={moveChannelTargetId || null}
                      onSelect={value => {
                        setMoveChannelTargetId(value ?? '');
                        setMoveChannelResult(null);
                      }}
                      placeholder='Select channel'
                      searchPlaceholder='Search channels...'
                      width='100%'
                      testId='jira-move-channel-target'
                    />
                  </div>
                </div>

                <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Mode
                    </p>
                    <div className='flex items-center gap-2'>
                      <button
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name='move_jira_project_channel_set_dry_run'
                        onClick={() => setMoveChannelDryRun(true)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium border transition',
                          moveChannelDryRun
                            ? 'bg-foreground text-background border-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Dry run
                      </button>
                      <button
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name='move_jira_project_channel_set_move'
                        onClick={() => setMoveChannelDryRun(false)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium border transition',
                          !moveChannelDryRun
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Move
                      </button>
                    </div>
                    <p className='mt-2 text-xs text-muted-foreground'>Start with Dry run.</p>
                  </div>

                  {!moveChannelDryRun && (
                    <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm lg:col-span-2'>
                      <label
                        htmlFor='jira-move-channel-confirm'
                        className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        Confirm
                      </label>
                      <Input
                        id='jira-move-channel-confirm'
                        value={moveChannelConfirmText}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setMoveChannelConfirmText(e.target.value)
                        }
                        placeholder={`MOVE ${moveChannelJiraProjectKey.trim().toUpperCase() || 'ABC'}`}
                      />
                    </div>
                  )}
                </div>

                <div className='flex justify-end'>
                  <Button
                    variant={moveChannelDryRun ? 'outline' : 'default'}
                    onClick={() => void handleMoveJiraProjectChannel()}
                    data-track-category='jira_migration'
                    data-track-name='MOVE_JIRA_PROJECT_CHANNEL'
                    disabled={isMoveChannelLoading}
                  >
                    {isMoveChannelLoading
                      ? 'Running…'
                      : moveChannelDryRun
                        ? 'Run Dry Run'
                        : 'Move Tickets'}
                  </Button>
                </div>

                {moveChannelResult && (
                  <div className='rounded-2xl border border-border/70 bg-card/60 p-4 text-sm'>
                    <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>Tickets</div>
                        <div className='font-semibold'>{moveChannelResult.movedTickets}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Conversations
                        </div>
                        <div className='font-semibold'>{moveChannelResult.movedConversations}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Participants
                        </div>
                        <div className='font-semibold'>{moveChannelResult.movedParticipants}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Source Updated
                        </div>
                        <div className='font-semibold'>
                          {moveChannelResult.externalSourceUpdated ? 'Yes' : 'No'}
                        </div>
                      </div>
                    </div>
                    <div className='mt-3 text-xs text-muted-foreground'>
                      {moveChannelResult.sourceChannelName || moveChannelResult.sourceChannelId} →{' '}
                      {moveChannelResult.targetChannelName || moveChannelResult.targetChannelId}
                    </div>
                    {moveChannelResult.warnings?.length ? (
                      <div className='mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900'>
                        {moveChannelResult.warnings.join(' ')}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>
          ) : useCase === 'move-jira-project-board' ? (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
              <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.04),transparent)] px-5 py-4'>
                <div className='flex flex-col gap-1'>
                  <h3 className='text-sm font-semibold text-foreground'>
                    Move Jira Project Tickets
                  </h3>
                  <p className='text-xs text-muted-foreground'>
                    Move only Jira-migrated tickets for one Jira project + channel from source board
                    to target board. Missing stages will be created and the target board stage order
                    will be aligned to the source board.
                  </p>
                </div>
              </div>

              <div className='p-5 space-y-4'>
                <div className='grid grid-cols-1 gap-4 lg:grid-cols-5'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-move-project-key'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Jira Project Key
                    </label>
                    <Input
                      id='jira-move-project-key'
                      value={moveJiraProjectKey}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setMoveJiraProjectKey(e.target.value)
                      }
                      placeholder='ABC'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Xyne Project
                    </p>
                    <EntitySelector
                      options={(projects || []).map(project => ({
                        value: project.id,
                        label: project.name,
                        icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={moveXyneProjectId || null}
                      onSelect={value => {
                        setMoveXyneProjectId(value ?? '');
                        setMoveJiraChannelId('');
                        setMoveSourceBoardId('');
                        setMoveTargetBoardId('');
                        setMoveConfirmText('');
                        setMoveResult(null);
                      }}
                      placeholder='Select project'
                      searchPlaceholder='Search projects...'
                      width='100%'
                      testId='jira-move-project-xyne-project'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Channel
                    </p>
                    <EntitySelector
                      options={moveChannels.map(channel => ({
                        value: channel.id,
                        label: channel.name,
                        icon: <Hash className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={moveJiraChannelId || null}
                      onSelect={value => setMoveJiraChannelId(value ?? '')}
                      placeholder='Select channel'
                      searchPlaceholder='Search channels...'
                      width='100%'
                      testId='jira-move-project-channel'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Source Board
                    </p>
                    <EntitySelector
                      options={(moveBoards || []).map(board => ({
                        value: board.id,
                        label: board.name,
                        icon: <LayoutTemplate className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={moveSourceBoardId || null}
                      onSelect={value => setMoveSourceBoardId(value ?? '')}
                      placeholder='Select board'
                      searchPlaceholder='Search boards...'
                      width='100%'
                      testId='jira-move-project-source-board'
                    />
                  </div>

                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Target Board
                    </p>
                    <EntitySelector
                      options={(moveBoards || []).map(board => ({
                        value: board.id,
                        label: board.name,
                        icon: <LayoutTemplate className='w-4 h-4 text-muted-foreground' />,
                      }))}
                      selectedValue={moveTargetBoardId || null}
                      onSelect={value => setMoveTargetBoardId(value ?? '')}
                      placeholder='Select board'
                      searchPlaceholder='Search boards...'
                      width='100%'
                      testId='jira-move-project-target-board'
                    />
                  </div>
                </div>

                <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                  <label
                    htmlFor='jira-move-project-tags'
                    className='mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                  >
                    <Tag className='h-3.5 w-3.5' />
                    Ticket Tags
                  </label>
                  <Input
                    id='jira-move-project-tags'
                    value={moveTagNamesInput}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setMoveTagNamesInput(e.target.value);
                      setMoveResult(null);
                    }}
                    placeholder='bug, urgent, customer-escalation'
                  />
                  <p className='mt-2 text-xs text-muted-foreground'>
                    Optional. When set, only tickets with any of these tags will be moved.
                  </p>
                </div>

                <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
                  <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                    <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                      Mode
                    </p>
                    <div className='flex items-center gap-2'>
                      <button
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name='move_jira_project_board_set_dry_run'
                        onClick={() => setMoveDryRun(true)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium border transition',
                          moveDryRun
                            ? 'bg-foreground text-background border-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Dry run
                      </button>
                      <button
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name='move_jira_project_board_set_move'
                        onClick={() => setMoveDryRun(false)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium border transition',
                          !moveDryRun
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Move
                      </button>
                    </div>
                    <p className='mt-2 text-xs text-muted-foreground'>Start with Dry run.</p>
                  </div>

                  {!moveDryRun && (
                    <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm lg:col-span-2'>
                      <label
                        htmlFor='jira-move-project-confirm'
                        className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        Confirm
                      </label>
                      <Input
                        id='jira-move-project-confirm'
                        value={moveConfirmText}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setMoveConfirmText(e.target.value)
                        }
                        placeholder={`MOVE ${moveJiraProjectKey.trim().toUpperCase() || 'ABC'}`}
                      />
                    </div>
                  )}
                </div>

                <div className='flex justify-end'>
                  <Button
                    variant={moveDryRun ? 'outline' : 'default'}
                    onClick={() => void handleMoveJiraProjectBoard()}
                    data-track-category='jira_migration'
                    data-track-name='MOVE_JIRA_PROJECT_BOARD'
                    disabled={isMoveBoardLoading}
                  >
                    {isMoveBoardLoading ? 'Running…' : moveDryRun ? 'Run Dry Run' : 'Move Tickets'}
                  </Button>
                </div>

                {moveResult && (
                  <div className='rounded-2xl border border-border/70 bg-card/60 p-4 text-sm'>
                    <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>Tickets</div>
                        <div className='font-semibold'>{moveResult.movedTickets}</div>
                      </div>
                      <div>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Tag Filter
                        </div>
                        <div className='font-semibold'>
                          {moveResult.tagNames?.length ? moveResult.tagNames.join(', ') : 'All'}
                        </div>
                      </div>
                      <div className='md:col-span-3'>
                        <div className='text-[11px] uppercase text-muted-foreground'>
                          Missing Stages
                        </div>
                        <div className='font-semibold'>
                          {moveResult.missingStages.length > 0
                            ? moveResult.missingStages.join(', ')
                            : 'None'}
                        </div>
                      </div>
                    </div>
                    {moveResult.warnings?.length ? (
                      <div className='mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900'>
                        {moveResult.warnings.join(' ')}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
              <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.05),transparent)] px-5 py-4'>
                <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <h3 className='text-sm font-semibold text-foreground'>Migration Inputs</h3>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Choose the Jira scope and the exact Xyne destination before previewing the
                      import.
                    </p>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-800'>
                      Project → Board → Channel
                    </span>
                    <span className='rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-800'>
                      {ticketRangeLabelMap[ticketRange]}
                    </span>
                  </div>
                </div>
              </div>

              <div className='p-5'>
                <div className='grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr,0.9fr]'>
                  <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                    <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                      <label
                        htmlFor='jira-project-key'
                        className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        Jira Project Key
                      </label>
                      <Input
                        id='jira-project-key'
                        autoFocus={!isMobile}
                        value={jiraProjectKey}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          setJiraProjectKey(e.target.value.toUpperCase());
                          setStatusV2Mappings({});
                          setSkippedCustomFieldIds({});
                          setMigrationPhase('setup');
                          setFilters({});
                          setIsFilterEnabled(false);
                          setPreview(null);
                          setResult(null);
                          setPageTokens([undefined]);
                          setPageIndex(0);
                          setJiraBoards([]);
                          setMigrationMode(null);
                          setPerBoardMappings([]);
                          setPerBoardJobs([]);
                        }}
                        placeholder='EUL'
                      />
                      <p className='mt-2 text-xs text-muted-foreground'>
                        Short Jira project identifier, for example `EUL`.
                      </p>
                      <label
                        htmlFor='jira-issue-keys'
                        className='mt-4 mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        Issue Keys
                      </label>
                      <Input
                        id='jira-issue-keys'
                        value={issueKeysInput}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          setIssueKeysInput(e.target.value.toUpperCase());
                          setStatusV2Mappings({});
                          setSkippedCustomFieldIds({});
                          setMigrationPhase('setup');
                          setFilters({});
                          setIsFilterEnabled(false);
                          setPreview(null);
                          setResult(null);
                          setPageTokens([undefined]);
                          setPageIndex(0);
                        }}
                        placeholder='JP-1234, JP-4566'
                      />
                      <p className='mt-2 text-xs text-muted-foreground'>
                        Optional. Migrate only specific ticket keys. If provided, these keys take
                        priority over project-wide filters.
                      </p>
                      <Button
                        variant='outline'
                        className='mt-3 w-full'
                        onClick={() => void handleFetchBoards()}
                        data-track-category='jira_migration'
                        data-track-name='FETCH_BOARDS'
                        disabled={isFetchingBoards || !jiraProjectKey.trim()}
                      >
                        {isFetchingBoards ? 'Fetching boards…' : 'Fetch Boards'}
                      </Button>
                    </div>

                    <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                      <label
                        htmlFor='jira-target-project'
                        className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        Target Project
                      </label>
                      <EntitySelector
                        options={(projects || []).map(project => ({
                          value: project.id,
                          label: project.name,
                          icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
                        }))}
                        selectedValue={selectedProjectId || null}
                        onSelect={value => {
                          setSelectedProjectId(value ?? '');
                          setSelectedBoardId('');
                          setTargetChannelId('');
                          setStatusV2Mappings({});
                          setSkippedCustomFieldIds({});
                          setMigrationPhase('setup');
                          setFilters({});
                          setIsFilterEnabled(false);
                          setPreview(null);
                          setResult(null);
                          setPageTokens([undefined]);
                          setPageIndex(0);
                        }}
                        placeholder='Select project'
                        searchPlaceholder='Search projects...'
                        width='100%'
                        testId='jira-target-project'
                      />
                    </div>

                    <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                      <label
                        htmlFor='jira-target-board'
                        className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        {migrationMode === 'per-board'
                          ? 'Preview Board (for status mapping)'
                          : 'Target Board'}
                      </label>
                      <EntitySelector
                        options={(boards || []).map(board => ({
                          value: board.id,
                          label: board.name,
                          icon: <LayoutTemplate className='w-4 h-4 text-muted-foreground' />,
                        }))}
                        selectedValue={selectedBoardId || null}
                        onSelect={value => {
                          setSelectedBoardId(value ?? '');
                          setStatusV2Mappings({});
                          setSkippedCustomFieldIds({});
                          setMigrationPhase('setup');
                          setFilters({});
                          setIsFilterEnabled(false);
                          setPreview(null);
                          setResult(null);
                          setPageTokens([undefined]);
                          setPageIndex(0);
                        }}
                        placeholder='Select board'
                        searchPlaceholder='Search boards...'
                        width='100%'
                        testId='jira-target-board'
                      />
                    </div>

                    <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                      <label
                        htmlFor='jira-target-channel'
                        className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                      >
                        Target Channel
                      </label>
                      <EntitySelector
                        options={channels.map(channel => ({
                          value: channel.id,
                          label: channel.name,
                          icon: <Hash className='w-4 h-4 text-muted-foreground' />,
                        }))}
                        selectedValue={targetChannelId || null}
                        onSelect={value => {
                          setTargetChannelId(value ?? '');
                          setStatusV2Mappings({});
                          setSkippedCustomFieldIds({});
                          setMigrationPhase('setup');
                          setFilters({});
                          setIsFilterEnabled(false);
                          setPreview(null);
                          setResult(null);
                          setPageTokens([undefined]);
                          setPageIndex(0);
                        }}
                        placeholder='Select channel'
                        searchPlaceholder='Search channels...'
                        width='100%'
                        testId='jira-target-channel'
                      />
                    </div>
                  </div>

                  {/* Board mode picker — shown after boards are fetched */}
                  {jiraBoards.length > 0 && (
                    <div
                      ref={boardSectionRef}
                      className='col-span-full rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'
                    >
                      <p className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2'>
                        Jira Boards Found
                      </p>
                      <div className='flex flex-wrap gap-2 mb-4'>
                        {jiraBoards.map(b => (
                          <span
                            key={b.id}
                            className='inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800'
                          >
                            {b.name}
                            {b.type ? <span className='text-sky-500'>· {b.type}</span> : null}
                          </span>
                        ))}
                      </div>
                      <p className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3'>
                        Migration Mode
                      </p>
                      <div className='flex flex-wrap gap-3 mb-4'>
                        <button
                          type='button'
                          data-track-category='jira_migration'
                          data-track-name='migration_mode_all_to_one'
                          onClick={() => {
                            setMigrationMode('all-to-one');
                            setPerBoardMappings([]);
                            setPerBoardJobs([]);
                          }}
                          className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${migrationMode === 'all-to-one' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-border bg-background text-foreground hover:bg-muted/30'}`}
                        >
                          All boards → one Xyne board
                        </button>
                        <button
                          type='button'
                          data-track-category='jira_migration'
                          data-track-name='migration_mode_per_board'
                          onClick={() => {
                            setMigrationMode('per-board');
                            setPerBoardMappings(
                              jiraBoards.map(b => ({ jiraBoard: b, xyneBoardId: '' })),
                            );
                            setPerBoardJobs([]);
                          }}
                          className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${migrationMode === 'per-board' ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-border bg-background text-foreground hover:bg-muted/30'}`}
                        >
                          Separate boards per Jira board
                        </button>
                      </div>

                      {/* Per-board mapping table */}
                      {migrationMode === 'per-board' && (
                        <div className='overflow-x-auto'>
                          <table className='w-full text-sm'>
                            <thead>
                              <tr className='border-b border-border'>
                                <th className='pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                                  Jira Board
                                </th>
                                <th className='pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                                  Type
                                </th>
                                <th className='pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                                  Xyne Board (pre-created)
                                </th>
                                <th className='pb-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {perBoardMappings.map((mapping, idx) => {
                                const job = perBoardJobs.find(
                                  j => j.jiraBoard.id === mapping.jiraBoard.id,
                                );
                                return (
                                  <tr
                                    key={mapping.jiraBoard.id}
                                    className='border-b border-border/40'
                                  >
                                    <td className='py-2 pr-4 font-medium text-foreground'>
                                      {mapping.jiraBoard.name}
                                    </td>
                                    <td className='py-2 pr-4 text-muted-foreground'>
                                      {mapping.jiraBoard.type || '—'}
                                    </td>
                                    <td className='py-2 pr-4'>
                                      <EntitySelector
                                        options={(boards || []).map(board => ({
                                          value: board.id,
                                          label: board.name,
                                          icon: (
                                            <LayoutTemplate className='w-4 h-4 text-muted-foreground' />
                                          ),
                                        }))}
                                        selectedValue={mapping.xyneBoardId || null}
                                        onSelect={value => {
                                          setPerBoardMappings(prev =>
                                            prev.map((m, i) =>
                                              i === idx ? { ...m, xyneBoardId: value ?? '' } : m,
                                            ),
                                          );
                                        }}
                                        placeholder='Select Xyne board'
                                        searchPlaceholder='Search boards...'
                                        width='220px'
                                        testId={`per-board-selector-${mapping.jiraBoard.id}`}
                                      />
                                    </td>
                                    <td className='py-2 text-xs'>
                                      {job?.pollError ? (
                                        <span className='inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800'>
                                          poll error
                                        </span>
                                      ) : job?.progress ? (
                                        <span
                                          className={`inline-flex rounded-full px-2 py-0.5 font-medium ${job.progress.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : job.progress.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}
                                        >
                                          {job.progress.status === 'completed'
                                            ? `✓ ${job.progress.importedTickets} tickets`
                                            : job.progress.status === 'failed'
                                              ? 'failed'
                                              : `${job.progress.processedIssues}/${job.progress.totalIssues ?? '?'}`}
                                        </span>
                                      ) : job?.jobId ? (
                                        <span className='inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800'>
                                          running…
                                        </span>
                                      ) : (
                                        <span className='text-muted-foreground'>pending</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {perBoardJobs.length === 0 && (
                            <div className='mt-4 space-y-2'>
                              {!preview && (
                                <p className='text-xs text-amber-600'>
                                  Run preview and map all statuses before migrating.
                                </p>
                              )}
                              {preview && !hasCompleteStatusV2Mappings && (
                                <p className='text-xs text-amber-600'>
                                  Map all Jira statuses to StatusV2 before migrating.
                                </p>
                              )}
                              {normalizedIssueKeys.length > 0 && (
                                <p className='text-xs text-amber-600'>
                                  Explicit issue-key migration is available only in all-to-one mode.
                                  Clear issue keys to run per-board bulk migration.
                                </p>
                              )}
                              <Button
                                onClick={() => void handlePerBoardImport()}
                                data-track-category='jira_migration'
                                data-track-name='START_PER_BOARD_IMPORT'
                                disabled={
                                  isPerBoardImportLoading ||
                                  normalizedIssueKeys.length > 0 ||
                                  !hasCompleteStatusV2Mappings ||
                                  !targetChannelId.trim() ||
                                  !selectedProjectId.trim() ||
                                  perBoardMappings.every(m => !m.xyneBoardId.trim())
                                }
                              >
                                {isPerBoardImportLoading
                                  ? 'Starting bulk migration…'
                                  : 'Start Bulk Migration (Mapped Boards)'}
                              </Button>
                            </div>
                          )}

                          {perBoardJobs.length > 0 && (
                            <div className='mt-4 space-y-2'>
                              {perBoardJobs.map(job => (
                                <div
                                  key={job.jiraBoard.id}
                                  className='rounded-lg border border-border bg-muted/10 p-3'
                                >
                                  <div className='flex items-center justify-between gap-3'>
                                    <p className='text-sm font-medium text-foreground'>
                                      {job.jiraBoard.name}
                                    </p>
                                    {job.progress && (
                                      <span
                                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${job.progress.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : job.progress.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}
                                      >
                                        {job.progress.status}
                                      </span>
                                    )}
                                  </div>
                                  {job.pollError && (
                                    <p className='mt-2 text-xs text-rose-700'>
                                      Poll error: {job.pollError}
                                    </p>
                                  )}
                                  {job.progress && (
                                    <div className='mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground'>
                                      <span>Imported: {job.progress.importedTickets}</span>
                                      <span>Skipped: {job.progress.skippedTickets}</span>
                                      <span>Comments: {job.progress.importedComments}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className='rounded-2xl border border-border/70 bg-slate-50/80 p-4 shadow-sm'>
                    <label
                      htmlFor='jira-ticket-range'
                      className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                    >
                      Ticket Range
                    </label>
                    <select
                      id='jira-ticket-range'
                      data-track-category='jira_migration'
                      data-track-name='select_ticket_range'
                      value={ticketRange}
                      onChange={e => {
                        setTicketRange(e.target.value as TicketRange);
                        setStatusV2Mappings({});
                        setSkippedCustomFieldIds({});
                        setMigrationPhase('setup');
                        setFilters({});
                        setIsFilterEnabled(false);
                        setPreview(null);
                        setResult(null);
                        setPageTokens([undefined]);
                        setPageIndex(0);
                      }}
                      className='w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground shadow-sm'
                    >
                      <option value='all'>All Time</option>
                      <option value='last_1_month'>Last 1 Month</option>
                      <option value='last_6_months'>Last 6 Months</option>
                      <option value='last_1_year'>Last 1 Year</option>
                    </select>

                    <div className='mt-4 rounded-2xl border border-border/70 bg-background p-4'>
                      <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                        Target Context
                      </p>
                      <p className='mt-2 text-sm font-medium text-foreground'>
                        {selectedProject && selectedBoard
                          ? `${selectedProject.name} / ${selectedBoard.name}${selectedChannel ? ` / ${selectedChannel.name}` : ''}`
                          : 'Select project, board, and channel'}
                      </p>
                      <p className='mt-2 text-xs text-muted-foreground'>
                        Range: {ticketRangeLabelMap[ticketRange]}
                        {resolvedDateFrom ? ` • Since ${resolvedDateFrom}` : ''}
                        {normalizedIssueKeys.length > 0
                          ? ` • ${normalizedIssueKeys.length} explicit issue key${normalizedIssueKeys.length > 1 ? 's' : ''}`
                          : ''}
                      </p>
                    </div>

                    <div className='mt-4 rounded-2xl border border-border/70 bg-background p-4'>
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>
                            Ticket Filters
                          </p>
                          <p className='mt-2 text-sm font-medium text-foreground'>
                            Apply epic, assignee, reporter, creator, and label filters only when
                            needed.
                          </p>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            Filters are optional. If disabled, preview uses the standard Jira flow
                            and does not load filter metadata.
                          </p>
                          {normalizedIssueKeys.length > 0 ? (
                            <p className='mt-2 text-xs text-amber-700'>
                              Explicit issue keys are set, so ticket-key scope overrides filters
                              during preview and migration.
                            </p>
                          ) : null}
                        </div>
                        {preview && isFilterEnabled && (
                          <span className='rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-800'>
                            {preview.filteredIssueCount} matching issues
                          </span>
                        )}
                      </div>

                      <div className='mt-4 flex items-center justify-between rounded-xl border border-border bg-muted/10 px-4 py-3'>
                        <div>
                          <p className='text-sm font-medium text-foreground'>Enable Filters</p>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            Turn this on only if you want to filter by epic, assignee, reporter,
                            creator, or labels.
                          </p>
                        </div>
                        <input
                          type='checkbox'
                          data-track-category='jira_migration'
                          data-track-name='toggle_filters'
                          checked={isFilterEnabled}
                          onChange={event => {
                            const checked = event.target.checked;
                            setIsFilterEnabled(checked);
                            setFilters({});
                            setPreview(null);
                            setResult(null);
                            setPageTokens([undefined]);
                            setPageIndex(0);
                          }}
                          className='h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500'
                        />
                      </div>

                      {isFilterEnabled ? (
                        preview ? (
                          <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-5'>
                            <div>
                              <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                                Epic
                              </p>
                              <EntityMultiSelector
                                options={preview.filterOptions.epics.map(epic => ({
                                  value: epic.issueKey,
                                  label: epic.issueKey,
                                  subtitle: epic.summary,
                                  icon: (
                                    <LayoutTemplate className='w-4 h-4 text-muted-foreground' />
                                  ),
                                }))}
                                selectedValues={filters.epicKeys || []}
                                onMultiSelect={values =>
                                  setFilters(previous => ({
                                    ...previous,
                                    epicKeys: values,
                                  }))
                                }
                                placeholder='Search epics...'
                                searchPlaceholder='Search epics...'
                                width='100%'
                                inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                              />
                            </div>
                            <div>
                              <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                                Assignee
                              </p>
                              <EntityMultiSelector
                                options={preview.filterOptions.assignees.map(user => ({
                                  value: user.accountId,
                                  label: user.displayName,
                                  ...(user.emailAddress ? { subtitle: user.emailAddress } : {}),
                                  icon: <User className='w-4 h-4 text-muted-foreground' />,
                                }))}
                                selectedValues={filters.assigneeAccountIds || []}
                                onMultiSelect={values =>
                                  setFilters(previous => ({
                                    ...previous,
                                    assigneeAccountIds: values,
                                  }))
                                }
                                placeholder='Search assignees...'
                                searchPlaceholder='Search assignees...'
                                width='100%'
                                inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                              />
                            </div>
                            <div>
                              <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                                Reporter
                              </p>
                              <EntityMultiSelector
                                options={preview.filterOptions.reporters.map(user => ({
                                  value: user.accountId,
                                  label: user.displayName,
                                  ...(user.emailAddress ? { subtitle: user.emailAddress } : {}),
                                  icon: <User className='w-4 h-4 text-muted-foreground' />,
                                }))}
                                selectedValues={filters.reporterAccountIds || []}
                                onMultiSelect={values =>
                                  setFilters(previous => ({
                                    ...previous,
                                    reporterAccountIds: values,
                                  }))
                                }
                                placeholder='Search reporters...'
                                searchPlaceholder='Search reporters...'
                                width='100%'
                                inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                              />
                            </div>
                            <div>
                              <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                                Creator
                              </p>
                              <EntityMultiSelector
                                options={preview.filterOptions.creators.map(user => ({
                                  value: user.accountId,
                                  label: user.displayName,
                                  ...(user.emailAddress ? { subtitle: user.emailAddress } : {}),
                                  icon: <User className='w-4 h-4 text-muted-foreground' />,
                                }))}
                                selectedValues={filters.creatorAccountIds || []}
                                onMultiSelect={values =>
                                  setFilters(previous => ({
                                    ...previous,
                                    creatorAccountIds: values,
                                  }))
                                }
                                placeholder='Search creators...'
                                searchPlaceholder='Search creators...'
                                width='100%'
                                inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                              />
                            </div>
                            <div>
                              <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                                Labels
                              </p>
                              <EntityMultiSelector
                                options={preview.filterOptions.labels.map(label => ({
                                  value: label,
                                  label,
                                  icon: <Tag className='w-4 h-4 text-muted-foreground' />,
                                }))}
                                selectedValues={filters.labels || []}
                                onMultiSelect={values =>
                                  setFilters(previous => ({ ...previous, labels: values }))
                                }
                                placeholder='Search labels...'
                                searchPlaceholder='Search labels...'
                                width='100%'
                                inputClassName='w-full min-h-10 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                              />
                            </div>
                          </div>
                        ) : (
                          <div className='mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground'>
                            Click Load Preview after enabling filters to fetch epic, assignee,
                            reporter, creator, and label options for this Jira project.
                          </div>
                        )
                      ) : (
                        <div className='mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground'>
                          Filters are off. Preview and migration will include the normal Jira scope
                          without loading filter option data.
                        </div>
                      )}
                    </div>

                    <div className='mt-4 flex flex-wrap gap-2'>
                      <Button
                        onClick={() => {
                          setPageTokens([undefined]);
                          setPageIndex(0);
                          void handlePreview();
                        }}
                        data-track-category='jira_migration'
                        data-track-name='RESET_PAGINATION'
                        disabled={isPreviewLoading || isImportLoading || !canPreview}
                      >
                        {isPreviewLoading
                          ? 'Loading Preview...'
                          : preview
                            ? 'Refresh Preview'
                            : 'Load Preview'}
                      </Button>
                      <Button
                        variant='outline'
                        onClick={() => setIsHistoryModalOpen(true)}
                        data-track-category='jira_migration'
                        data-track-name='OPEN_MIGRATION_HISTORY'
                        disabled={migrationHistory.length === 0}
                      >
                        View Migrated Projects
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Step Indicator */}
          {migrationPhase !== 'setup' && (
            <nav className='flex flex-wrap items-center gap-2 px-1'>
              {[
                { phase: 'setup' as MigrationPhase, label: '1. Configure' },
                { phase: 'map-statuses' as MigrationPhase, label: '2. Map Statuses' },
                { phase: 'migrate' as MigrationPhase, label: '3. Migrate Tickets' },
              ].map(({ phase, label }, idx) => {
                const phaseOrder: MigrationPhase[] = ['setup', 'map-statuses', 'migrate'];
                const isCompleted = phaseOrder.indexOf(phase) < phaseOrder.indexOf(migrationPhase);
                const isCurrent = phase === migrationPhase;
                return (
                  <span key={phase} className='flex items-center gap-2'>
                    {idx > 0 && <span className='text-muted-foreground text-xs'>›</span>}
                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        isCompleted
                          ? 'bg-emerald-100 text-emerald-800'
                          : isCurrent
                            ? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300'
                            : 'bg-muted/30 text-muted-foreground'
                      }`}
                    >
                      {isCompleted ? `✓ ${label}` : label}
                    </span>
                  </span>
                );
              })}
            </nav>
          )}

          {/* Step 2: Map Statuses */}
          {preview && migrationPhase === 'map-statuses' && (
            <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
              <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(14,165,233,0.05),transparent)] px-5 py-4'>
                <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <div className='inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-sky-800'>
                      Step 2 of 3
                    </div>
                    <h3 className='mt-2 text-sm font-semibold text-foreground'>
                      Map Jira Statuses to StatusV2
                    </h3>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Assign a StatusV2 category to each Jira status. Xyne stages will be
                      auto-created using the exact Jira status names.
                    </p>
                  </div>
                  <span className='text-xs text-muted-foreground'>
                    {preview.jiraProject.totalIssues} total issues ·{' '}
                    {preview.jiraStatusSequence.length} statuses
                  </span>
                </div>
              </div>
              <div className='p-5'>
                {preview.jiraBoards.length > 1 && (
                  <div className='mb-5 rounded-xl border border-border bg-muted/10 p-4'>
                    <p className='text-xs font-semibold text-foreground'>Jira Board</p>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Multiple Jira boards found for this project. Pick board to derive status
                      list/order, then refresh preview.
                    </p>
                    <div className='mt-3 flex flex-wrap items-center gap-3'>
                      <select
                        value={jiraBoardId ?? ''}
                        onChange={event => {
                          const raw = event.target.value;
                          setJiraBoardId(raw ? Number(raw) : null);
                        }}
                        data-track-category='jira_migration'
                        data-track-name='jira_board_select'
                        className='w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                      >
                        <option value=''>Select Jira board</option>
                        {preview.jiraBoards.map(board => (
                          <option key={board.id} value={board.id}>
                            {board.name}
                            {board.type ? ` (${board.type})` : ''}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant='outline'
                        onClick={() => void handlePreview()}
                        data-track-category='jira_migration'
                        data-track-name='PREVIEW_MIGRATION'
                        disabled={isPreviewLoading || isImportLoading}
                      >
                        Refresh Preview
                      </Button>
                      {preview.selectedJiraBoardId && (
                        <span className='text-xs text-muted-foreground'>
                          Using board ID {preview.selectedJiraBoardId}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {statusesMissingV2Mapping.length > 0 ? (
                  <div className='mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'>
                    {statusesMissingV2Mapping.length}{' '}
                    {statusesMissingV2Mapping.length === 1 ? 'new status' : 'new statuses'} still
                    need a StatusV2 mapping.
                  </div>
                ) : (
                  <div className='mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800'>
                    All Jira statuses mapped — you can proceed to migration.
                  </div>
                )}
                {mappedStatusMappings.length > 0 && (
                  <div className='mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4'>
                    <div className='flex items-center justify-between gap-2'>
                      <h4 className='text-xs font-semibold uppercase tracking-[0.08em] text-emerald-900'>
                        Already Mapped
                      </h4>
                      <span className='text-xs text-emerald-800'>
                        {mappedStatusMappings.length} mapped
                      </span>
                    </div>
                    <div className='mt-3 flex flex-wrap gap-2'>
                      {mappedStatusMappings.map(mapping => (
                        <div
                          key={`mapped-${mapping.jiraStatus}`}
                          className='inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs text-foreground'
                        >
                          <span className='font-medium'>{mapping.jiraStatus}</span>
                          <span className='text-muted-foreground'>→</span>
                          <span className='font-semibold text-emerald-700'>
                            {statusV2Mappings[mapping.jiraStatus]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                  {newStatusMappings.map(mapping => (
                    <div
                      key={mapping.jiraStatus}
                      className='rounded-lg border border-border bg-muted/10 p-3'
                    >
                      <div className='flex items-start justify-between gap-2'>
                        <p className='text-sm font-medium text-foreground'>{mapping.jiraStatus}</p>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${confidenceClassMap[mapping.confidence]}`}
                        >
                          {mapping.confidence}
                        </span>
                      </div>
                      <div className='mt-3'>
                        <label
                          htmlFor={`status-v2-${mapping.jiraStatus}`}
                          className='text-xs text-muted-foreground'
                        >
                          StatusV2
                        </label>
                        <select
                          id={`status-v2-${mapping.jiraStatus}`}
                          data-track-category='jira_migration'
                          data-track-name='select_status_v2_mapping'
                          value={statusV2Mappings[mapping.jiraStatus] || ''}
                          onChange={event => {
                            const selectedStatusV2 = event.target.value;
                            setStatusV2Mappings(previous => ({
                              ...previous,
                              [mapping.jiraStatus]: selectedStatusV2,
                            }));
                          }}
                          className='mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm'
                        >
                          <option value=''>Select StatusV2</option>
                          {TICKET_STATUS_V2_OPTIONS.map(statusV2 => (
                            <option key={statusV2} value={statusV2}>
                              {statusV2}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div className='mt-6 rounded-2xl border border-border/70 bg-background/60 p-4'>
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div>
                      <p className='text-sm font-semibold text-foreground'>
                        Stage Sequence (Manual)
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Reorder Jira statuses; stages will be created/reordered in this order.
                      </p>
                    </div>
                    <Button
                      variant='outline'
                      onClick={() =>
                        setJiraStatusSequence(
                          [...preview.jiraStatusSequence].sort((a, b) => a.localeCompare(b)),
                        )
                      }
                      data-track-category='jira_migration'
                      data-track-name='APPLY_STATUS_SEQUENCE'
                      disabled={preview.jiraStatusSequence.length === 0}
                    >
                      Sort A→Z
                    </Button>
                  </div>

                  <div className='mt-3 max-h-72 overflow-auto rounded-xl border border-border bg-background'>
                    <table className='w-full text-left text-xs'>
                      <thead className='sticky top-0 bg-background/90 backdrop-blur'>
                        <tr>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>#</th>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>
                            Jira Status
                          </th>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>Order</th>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>Exclude</th>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>
                            Mapped StatusV2
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const list =
                            jiraStatusSequence.length > 0
                              ? jiraStatusSequence
                              : preview.jiraStatusSequence;
                          const boardStageNames = new Set(
                            preview.target.stages.map(stage => stage.name),
                          );
                          return list.map((status, index) => {
                            const isBoardStage = boardStageNames.has(status);
                            const excluded = Boolean(excludedStageNames[status]);
                            return (
                              <tr
                                key={status}
                                className={`border-t border-border/60 ${draggingJiraStatus === status ? 'bg-muted/40' : ''} ${excluded ? 'opacity-50' : ''}`}
                                draggable
                                onDragStart={event => {
                                  if (excluded) return;
                                  setDraggingJiraStatus(status);
                                  event.dataTransfer.setData('text/plain', status);
                                  event.dataTransfer.effectAllowed = 'move';
                                  if (jiraStatusSequence.length === 0) {
                                    setJiraStatusSequence([...list]);
                                  }
                                }}
                                onDragEnd={() => setDraggingJiraStatus(null)}
                                onDragOver={event => {
                                  if (excluded) return;
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = 'move';
                                }}
                                onDrop={event => {
                                  if (excluded) return;
                                  event.preventDefault();
                                  const draggedStatus = event.dataTransfer.getData('text/plain');
                                  if (!draggedStatus || draggedStatus === status) return;

                                  setJiraStatusSequence(prev => {
                                    const base = prev.length > 0 ? [...prev] : [...list];
                                    const fromIndex = base.indexOf(draggedStatus);
                                    const toIndex = base.indexOf(status);
                                    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
                                      return base;
                                    const [moved] = base.splice(fromIndex, 1);
                                    if (!moved) return base;
                                    base.splice(toIndex, 0, moved);
                                    return base;
                                  });
                                }}
                              >
                                <td className='px-3 py-2 text-muted-foreground'>{index + 1}</td>
                                <td className='px-3 py-2 font-medium text-foreground'>
                                  <span
                                    className='mr-2 select-none text-muted-foreground'
                                    title='Drag to reorder'
                                  >
                                    ⋮⋮
                                  </span>
                                  {status}
                                </td>
                                <td className='px-3 py-2'>
                                  <input
                                    type='number'
                                    min={1}
                                    max={list.length}
                                    value={
                                      jiraStatusSequenceOrderInput[status] ?? String(index + 1)
                                    }
                                    onChange={event => {
                                      const raw = event.target.value;
                                      setJiraStatusSequenceOrderInput(previous => ({
                                        ...previous,
                                        [status]: raw,
                                      }));

                                      const nextPosition = Number(raw);
                                      if (!Number.isInteger(nextPosition)) return;
                                      setJiraStatusSequence(prev => {
                                        const next = prev.length > 0 ? [...prev] : [...list];
                                        const fromIndex = next.indexOf(status);
                                        if (fromIndex === -1) return next;

                                        const toIndexRaw = nextPosition - 1;
                                        const toIndex = Math.min(
                                          next.length - 1,
                                          Math.max(0, toIndexRaw),
                                        );
                                        if (toIndex === fromIndex) return next;

                                        const [moved] = next.splice(fromIndex, 1);
                                        if (!moved) return next;
                                        next.splice(toIndex, 0, moved);
                                        return next;
                                      });

                                      setJiraStatusSequenceOrderInput(previous => {
                                        const { [status]: _ignored, ...rest } = previous;
                                        return rest;
                                      });
                                    }}
                                    data-track-category='jira_migration'
                                    data-track-name={`jira_stage_sequence_set_position:${status}`}
                                    className='w-20 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground shadow-sm'
                                    disabled={excluded}
                                  />
                                </td>
                                <td className='px-3 py-2'>
                                  <label className='inline-flex items-center gap-2 text-xs text-muted-foreground'>
                                    <input
                                      type='checkbox'
                                      checked={excluded}
                                      onChange={event => {
                                        const checked = event.target.checked;
                                        setExcludedStageNames(previous => ({
                                          ...previous,
                                          [status]: checked,
                                        }));
                                      }}
                                      data-track-category='jira_migration'
                                      data-track-name={`jira_stage_exclude_toggle:${status}`}
                                      disabled={!isBoardStage}
                                    />
                                    {isBoardStage ? 'Exclude' : '—'}
                                  </label>
                                </td>
                                <td className='px-3 py-2 text-muted-foreground'>
                                  {statusV2Mappings[status] || '-'}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className='mt-6 flex flex-wrap items-center gap-3 border-t border-border/60 pt-5'>
                  <Button
                    variant='outline'
                    onClick={() => setMigrationPhase('setup')}
                    data-track-category='jira_migration'
                    data-track-name='GO_TO_SETUP_PHASE'
                  >
                    ← Back to Configure
                  </Button>
                  <Button
                    onClick={() => setMigrationPhase('migrate')}
                    data-track-category='jira_migration'
                    data-track-name='GO_TO_MIGRATE_PHASE'
                    disabled={!hasCompleteStatusV2Mappings}
                  >
                    Proceed to Migration →
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Step 3: Migrate action bar */}
          {preview && migrationPhase === 'migrate' && (
            <section className='overflow-hidden rounded-3xl border border-emerald-200/60 bg-[linear-gradient(135deg,rgba(16,185,129,0.06),rgba(255,255,255,0.96))] shadow-sm'>
              <div className='flex flex-wrap items-center justify-between gap-3 px-5 py-4'>
                <div>
                  <div className='inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-800'>
                    Step 3 of 3
                  </div>
                  <h3 className='mt-2 text-sm font-semibold text-foreground'>Ready to Migrate</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    All {preview.statusMappings.length} Jira statuses are mapped. Review the preview
                    below and run the migration when ready.
                  </p>
                  {isResolveUsersLoading && (
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Scanning users… pages: {scanPagesScanned} · unresolved found:{' '}
                      {scanUnresolvedFound}
                    </p>
                  )}
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <Button
                    variant='outline'
                    onClick={() => setMigrationPhase('map-statuses')}
                    disabled={isImportLoading}
                    data-track-category='jira_migration'
                    data-track-name='edit_status_mappings'
                  >
                    ← Edit Status Mappings
                  </Button>
                  <div className='flex flex-wrap items-center gap-3 rounded-xl border border-emerald-100 bg-white/70 px-3 py-2'>
                    <label className='flex items-center gap-2 text-xs text-muted-foreground'>
                      <input
                        type='checkbox'
                        checked={scanIncludeComments}
                        onChange={e => setScanIncludeComments(e.target.checked)}
                        disabled={isResolveUsersLoading || isImportLoading}
                        data-track-category='jira_migration'
                        data-track-name='scan_toggle_include_commenters'
                      />
                      Include commenters
                    </label>
                    <label className='flex items-center gap-2 text-xs text-muted-foreground'>
                      <input
                        type='checkbox'
                        checked={scanIncludeAttachments}
                        onChange={e => setScanIncludeAttachments(e.target.checked)}
                        disabled={isResolveUsersLoading || isImportLoading}
                        data-track-category='jira_migration'
                        data-track-name='scan_toggle_include_attachments'
                      />
                      Include attachments
                    </label>
                  </div>
                  <Button
                    variant='outline'
                    onClick={() => void handleResolveUsers()}
                    disabled={isImportLoading || isResolveUsersLoading}
                    data-track-category='jira_migration'
                    data-track-name='scan_users'
                  >
                    {isResolveUsersLoading ? 'Scanning Users...' : 'Scan Users'}
                  </Button>
                  <Button
                    onClick={() => void handleImport()}
                    data-track-category='jira_migration'
                    data-track-name='START_IMPORT'
                    disabled={isImportLoading || !hasCompleteStatusV2Mappings}
                  >
                    {isImportLoading ? 'Migrating...' : 'Migrate Tickets'}
                  </Button>
                </div>
              </div>

              {Object.keys(userEmailMappings).length > 0 && (
                <div className='border-t border-emerald-200/60 bg-white/70 px-5 py-4'>
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <p className='text-xs font-semibold text-foreground'>Mapped Users</p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Mappings that will be sent with the migration request.
                      </p>
                    </div>
                    <p className='text-[11px] text-muted-foreground'>
                      {Object.keys(userEmailMappings).length} mapped
                    </p>
                  </div>

                  <div className='mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2'>
                    {Object.entries(userEmailMappings).map(([key, mappedEmail]) => {
                      const matchingItem = resolveUsersResult?.unresolvedUsers.find(item => {
                        const { primary, fallbacks } = getUnresolvedMappingKeys(item);
                        return primary === key || fallbacks.includes(key);
                      });
                      const display = matchingItem?.displayName || matchingItem?.accountId || key;

                      return (
                        <div
                          key={`${key}-mapped`}
                          className='flex items-center justify-between gap-2 rounded-lg border border-emerald-50 bg-white/70 px-3 py-2'
                        >
                          <div className='min-w-0'>
                            <p className='text-xs font-medium text-foreground truncate'>
                              {display}
                            </p>
                            <p className='text-[11px] text-muted-foreground truncate'>
                              {mappedEmail}
                            </p>
                          </div>
                          <Button
                            variant='outline'
                            onClick={() => {
                              setUserEmailMappings(prev => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              });
                            }}
                            data-track-category='jira_migration'
                            data-track-name='UPDATE_USER_EMAIL_MAPPINGS'
                          >
                            Clear
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {scanResolvedMappings.length > 0 && (
                <div className='border-t border-emerald-200/60 bg-white/70 px-5 py-4'>
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <p className='text-xs font-semibold text-foreground'>Resolved Jira Users</p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Users Jira resolver matched automatically during scan.
                      </p>
                    </div>
                    <p className='text-[11px] text-muted-foreground'>
                      Showing {scanResolvedMappings.length}
                      {scanResolvedMappingsTruncated ? ' (truncated)' : ''}
                    </p>
                  </div>

                  <div className='mt-3 flex flex-wrap items-center justify-between gap-2'>
                    <p className='text-[11px] text-muted-foreground'>
                      Page {resolvedUsersPage + 1} /{' '}
                      {Math.max(
                        1,
                        Math.ceil(scanResolvedMappings.length / RESOLVED_USERS_PER_PAGE),
                      )}
                    </p>
                    <div className='flex items-center gap-2'>
                      <Button
                        variant='outline'
                        onClick={() => setResolvedUsersPage(p => Math.max(0, p - 1))}
                        data-track-category='jira_migration'
                        data-track-name='RESOLVED_USERS_PREV_PAGE'
                        disabled={resolvedUsersPage === 0}
                      >
                        Prev
                      </Button>
                      <Button
                        variant='outline'
                        onClick={() =>
                          setResolvedUsersPage(p =>
                            Math.min(
                              Math.max(
                                0,
                                Math.ceil(scanResolvedMappings.length / RESOLVED_USERS_PER_PAGE) -
                                  1,
                              ),
                              p + 1,
                            ),
                          )
                        }
                        data-track-category='jira_migration'
                        data-track-name='RESOLVED_USERS_NEXT_PAGE'
                        disabled={
                          resolvedUsersPage >=
                          Math.max(
                            0,
                            Math.ceil(scanResolvedMappings.length / RESOLVED_USERS_PER_PAGE) - 1,
                          )
                        }
                      >
                        Next
                      </Button>
                    </div>
                  </div>

                  <div className='mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2'>
                    {scanResolvedMappings
                      .slice(
                        resolvedUsersPage * RESOLVED_USERS_PER_PAGE,
                        resolvedUsersPage * RESOLVED_USERS_PER_PAGE + RESOLVED_USERS_PER_PAGE,
                      )
                      .map(item => (
                        <div
                          key={item.jiraUserKey}
                          className='rounded-lg border border-emerald-50 bg-white/70 px-3 py-2'
                        >
                          <p className='text-xs font-medium text-foreground truncate'>
                            {item.displayName ||
                              item.emailAddress ||
                              item.accountId ||
                              item.jiraUserKey}
                          </p>
                          <p className='text-[11px] text-muted-foreground truncate'>
                            → {item.resolvedEmail || item.resolvedUserId}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {resolveUsersResult && resolveUsersResult.unresolvedUsers.length > 0 && (
                <div className='border-t border-emerald-200/60 bg-white/70 px-5 py-4'>
                  {(() => {
                    const visibleUnresolvedUsers = resolveUsersResult.unresolvedUsers.filter(
                      item => {
                        return !getMappedEmailForUnresolved(item);
                      },
                    );

                    if (visibleUnresolvedUsers.length === 0) {
                      return (
                        <div className='rounded-xl border border-emerald-100 bg-background/70 p-3'>
                          <p className='text-xs font-semibold text-foreground'>
                            All unresolved users mapped
                          </p>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            Unresolved list hidden because every item has a manual mapping. You can
                            run Scan Users again to verify.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <>
                        <div className='flex items-center justify-between gap-3'>
                          <div>
                            <p className='text-xs font-semibold text-foreground'>
                              Unresolved Jira Users
                            </p>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Map each Jira user to an existing Xyne user email. These mappings will
                              be sent with the migration request.
                            </p>
                          </div>
                          <p className='text-[11px] text-muted-foreground'>
                            {visibleUnresolvedUsers.length} unresolved
                          </p>
                        </div>

                        <div className='mt-3 space-y-3'>
                          {visibleUnresolvedUsers.slice(0, 50).map(item => {
                            const { primary: key } = getUnresolvedMappingKeys(item);
                            return (
                              <div
                                key={key}
                                className='rounded-xl border border-emerald-100 bg-background/70 p-3'
                              >
                                <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
                                  <div className='min-w-0'>
                                    <p className='text-xs font-semibold text-foreground truncate'>
                                      {item.displayName || item.accountId || 'Unknown Jira user'}
                                    </p>
                                    <p className='mt-1 text-[11px] text-muted-foreground'>
                                      Suggested:{' '}
                                      {item.suggestedEmails.slice(0, 3).join(', ') || '—'} ·
                                      Tickets: {item.issueKeys.slice(0, 3).join(', ') || '—'}
                                    </p>
                                  </div>
                                  <div className='w-full lg:w-[420px]'>
                                    <UnresolvedUserMappingRow item={item} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {visibleUnresolvedUsers.length > 50 && (
                            <p className='text-[11px] text-muted-foreground'>
                              Showing first 50 unresolved users. Keep scanning/mapping, then run
                              migration.
                            </p>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {hasCompleteStatusV2Mappings && orderedStageSequence.length > 0 && (
                <div className='border-t border-emerald-200/60 bg-white/70 px-5 py-4'>
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <p className='text-xs font-semibold text-foreground'>
                        Planned Stage Sequence
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Stages will be created/reordered on the board in Jira status order.
                      </p>
                    </div>
                    <p className='text-[11px] text-muted-foreground'>
                      {orderedStageSequence.length} stages
                    </p>
                  </div>

                  <div className='mt-3 max-h-64 overflow-auto rounded-xl border border-emerald-100 bg-background/70'>
                    <table className='w-full text-left text-xs'>
                      <thead className='sticky top-0 bg-background/90 backdrop-blur'>
                        <tr>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>#</th>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>
                            Jira Status
                          </th>
                          <th className='px-3 py-2 font-medium text-muted-foreground'>
                            Mapped StatusV2
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderedStageSequence.map((status, index) => (
                          <tr key={status} className='border-t border-emerald-50'>
                            <td className='px-3 py-2 text-muted-foreground'>{index + 1}</td>
                            <td className='px-3 py-2 font-medium text-foreground'>{status}</td>
                            <td className='px-3 py-2 text-muted-foreground'>
                              {statusV2Mappings[status] || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {migrationProgress && (
            <section className='rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.92))] p-5 shadow-sm'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Live Migration Progress</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Redis-backed execution status for the active Jira migration job.
                  </p>
                </div>
                <div className='text-right text-xs text-muted-foreground'>
                  <p>Job ID</p>
                  <p className='mt-1 font-medium text-foreground'>{migrationProgress.jobId}</p>
                  {migrationProgress.status === 'running' && (
                    <div className='mt-2 flex flex-wrap justify-end gap-2'>
                      {migrationProgress.controlStatus === 'paused' ? (
                        <Button
                          variant='outline'
                          onClick={() => void handleResumeMigration()}
                          data-track-category='jira_migration'
                          data-track-name='RESUME_MIGRATION'
                        >
                          Resume
                        </Button>
                      ) : (
                        <Button
                          variant='outline'
                          onClick={() => void handlePauseMigration()}
                          data-track-category='jira_migration'
                          data-track-name='PAUSE_MIGRATION'
                        >
                          Pause
                        </Button>
                      )}
                      <Button
                        variant='outline'
                        onClick={() => void handleStopMigration()}
                        data-track-category='jira_migration'
                        data-track-name='STOP_MIGRATION'
                      >
                        Stop
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {(() => {
                const totalIssues = migrationProgress.totalIssues ?? 0;
                const progressWidth =
                  totalIssues > 0
                    ? Math.min(100, (migrationProgress.processedIssues / totalIssues) * 100)
                    : 0;

                return (
                  <>
                    <div className='mt-4 h-2 w-full overflow-hidden rounded-full bg-emerald-100'>
                      <div
                        className='h-full rounded-full bg-emerald-600 transition-all'
                        style={{ width: `${progressWidth}%` }}
                      />
                    </div>

                    <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Status</p>
                        <p className='mt-1 text-lg font-semibold text-foreground capitalize'>
                          {migrationProgress.status}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Processed Issues</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.processedIssues}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Imported Tickets</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.importedTickets}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Imported Comments</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.importedComments}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Imported Attachments</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.importedAttachments}
                        </p>
                      </div>
                      <div className='rounded-lg bg-card/70 p-3'>
                        <p className='text-[11px] text-muted-foreground'>Current Step</p>
                        <p className='mt-1 text-lg font-semibold text-foreground'>
                          {migrationProgress.currentStep || 'Waiting'}
                        </p>
                      </div>
                    </div>

                    <div className='mt-4 rounded-lg border border-emerald-200 bg-card/70 p-3'>
                      <p className='text-xs text-muted-foreground'>Current Issue</p>
                      <p className='mt-1 text-sm font-medium text-foreground'>
                        {migrationProgress.currentIssueKey ||
                          (migrationProgress.status === 'completed'
                            ? 'Completed'
                            : migrationProgress.status === 'failed'
                              ? 'Stopped'
                              : 'Waiting to start')}
                      </p>
                    </div>

                    {migrationProgress.stageSequence &&
                      migrationProgress.stageSequence.length > 0 && (
                        <div className='mt-4 rounded-lg border border-emerald-200 bg-card/70 p-3'>
                          <div className='flex items-center justify-between gap-3'>
                            <p className='text-xs text-muted-foreground'>Stage Sequence</p>
                            <p className='text-[11px] text-muted-foreground'>
                              {migrationProgress.stageSequence.length} stages
                            </p>
                          </div>
                          <div className='mt-2 max-h-56 overflow-auto rounded-md border border-emerald-100 bg-background/60'>
                            <table className='w-full text-left text-xs'>
                              <thead className='sticky top-0 bg-background/80 backdrop-blur'>
                                <tr>
                                  <th className='px-2 py-1 font-medium text-muted-foreground'>#</th>
                                  <th className='px-2 py-1 font-medium text-muted-foreground'>
                                    Stage
                                  </th>
                                  <th className='px-2 py-1 font-medium text-muted-foreground'>
                                    StatusV2
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {migrationProgress.stageSequence
                                  .slice()
                                  .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
                                  .map(stage => (
                                    <tr
                                      key={`${stage.sequenceNumber}-${stage.name}`}
                                      className='border-t border-emerald-50'
                                    >
                                      <td className='px-2 py-1 text-muted-foreground'>
                                        {stage.sequenceNumber}
                                      </td>
                                      <td className='px-2 py-1 font-medium text-foreground'>
                                        {stage.name}
                                      </td>
                                      <td className='px-2 py-1 text-muted-foreground'>
                                        {stage.defaultTicketStatusV2}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                  </>
                );
              })()}

              {migrationProgress.errorMessage && (
                <div className='mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3'>
                  <p className='text-xs font-semibold text-rose-900'>Job Error</p>
                  <p className='mt-1 text-xs text-rose-900'>{migrationProgress.errorMessage}</p>
                </div>
              )}
            </section>
          )}

          {result && (
            <section className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Last Import Result</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Jira project {result.jiraProjectKey} imported into the selected Xyne target.
                  </p>
                </div>
                <div className='text-right text-xs text-muted-foreground'>
                  <p>External Source</p>
                  <p className='mt-1 font-medium text-foreground'>
                    {result.externalSourceId || 'Not created'}
                  </p>
                  {targetChannelId && (
                    <a
                      href={`/chat/dir/${targetChannelId}`}
                      className='mt-2 inline-flex text-xs font-medium text-sky-700 hover:underline'
                    >
                      Open Channel
                    </a>
                  )}
                </div>
              </div>

              <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Imported Tickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.importedTickets}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Skipped Tickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.skippedTickets}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Imported Comments</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.importedComments}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Imported Attachments</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.importedAttachments}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Created Custom Fields</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.createdBoardCustomFields}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Linked Tickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.linkedTickets}
                  </p>
                </div>
                <div className='rounded-lg bg-muted/30 p-3'>
                  <p className='text-[11px] text-muted-foreground'>Created Subtickets</p>
                  <p className='mt-1 text-lg font-semibold text-foreground'>
                    {result.createdSubTickets}
                  </p>
                </div>
              </div>

              {result.warnings.length > 0 && (
                <div className='mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4'>
                  <h4 className='text-xs font-semibold text-amber-900'>Warnings</h4>
                  <div className='mt-2 space-y-2'>
                    {result.warnings.map((warning, index) => (
                      <p key={`${warning}-${index}`} className='text-xs text-amber-900'>
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {result.unresolvedUsers.length > 0 && (
                <div className='mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4'>
                  <h4 className='text-xs font-semibold text-rose-900'>Unresolved Jira Users</h4>
                  <div className='mt-2 space-y-3'>
                    {result.unresolvedUsers.map((user, index) => (
                      <div
                        key={`${user.accountId || user.displayName || 'unknown'}-${index}`}
                        className='rounded-md border border-rose-200 bg-card/70 p-3'
                      >
                        <p className='text-xs font-medium text-rose-900'>
                          {user.displayName || 'Unknown Jira user'}
                        </p>
                        <p className='mt-1 text-xs text-rose-900'>
                          Account ID: {user.accountId || '—'}
                        </p>
                        <p className='mt-1 text-xs text-rose-900'>
                          Suggested emails:{' '}
                          {user.suggestedEmails.length > 0 ? user.suggestedEmails.join(', ') : '—'}
                        </p>
                        <p className='mt-1 text-xs text-rose-900'>
                          Tickets: {user.issueKeys.length > 0 ? user.issueKeys.join(', ') : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.issueResults.length > 0 && (
                <div className='mt-4 rounded-lg border border-border bg-muted/10 p-4'>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                    <div>
                      <h4 className='text-xs font-semibold text-foreground'>
                        Issue Execution Details
                      </h4>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        Per-ticket execution status with failed step and detailed errors.
                      </p>
                    </div>
                    <div className='flex items-center gap-2 text-right text-xs text-muted-foreground'>
                      <span>{result.issueResults.length} issues tracked</span>
                      <span>•</span>
                      <span>
                        Page {issueResultPage + 1} of {issueResultPageCount}
                      </span>
                    </div>
                  </div>
                  <div className='mt-3 flex items-center justify-end gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setIssueResultPage(page => Math.max(0, page - 1))}
                      data-track-category='jira_migration'
                      data-track-name='ISSUE_RESULTS_PREV_PAGE'
                      disabled={issueResultPage === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        setIssueResultPage(page => Math.min(issueResultPageCount - 1, page + 1))
                      }
                      data-track-category='jira_migration'
                      data-track-name='ISSUE_RESULTS_NEXT_PAGE'
                      disabled={issueResultPage >= issueResultPageCount - 1}
                    >
                      Next
                    </Button>
                  </div>
                  <div className='mt-3 space-y-3'>
                    {paginatedIssueResults.map(issue => (
                      <div
                        key={issue.issueKey}
                        className='rounded-md border border-border bg-card/70 p-3'
                      >
                        <div className='flex items-start justify-between gap-3'>
                          <div>
                            <p className='text-sm font-medium text-foreground'>{issue.issueKey}</p>
                            <p className='mt-1 text-xs text-muted-foreground'>{issue.summary}</p>
                          </div>
                          <div className='text-right'>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${issueStatusClassMap[issue.status]}`}
                            >
                              {issue.status}
                            </span>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Failed step: {issue.failedStep || '—'}
                            </p>
                          </div>
                        </div>
                        {issue.errors.length > 0 && (
                          <div className='mt-3 space-y-2'>
                            {issue.errors.map((error, index) => (
                              <p
                                key={`${issue.issueKey}-${index}`}
                                className='text-xs text-rose-900'
                              >
                                {error}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <Dialog
            open={isHistoryModalOpen}
            onOpenChange={setIsHistoryModalOpen}
            title='Migrated Jira Projects'
            description='Persisted Jira migration sources already imported into Xyne.'
            className='max-w-4xl'
          >
            <div className='rounded-2xl bg-background p-5 shadow-sm'>
              <div className='flex items-start justify-between gap-4 border-b border-border pb-4'>
                <div>
                  <h3 className='text-sm font-semibold text-foreground'>Migrated Jira Projects</h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Persisted Jira migration sources already imported into Xyne.
                  </p>
                </div>
                <div className='text-right text-xs text-muted-foreground'>
                  <p>{migrationHistory.length} sources</p>
                </div>
              </div>
              <div className='mt-4 max-h-[70vh] overflow-y-auto pr-1'>
                <div className='grid grid-cols-1 gap-3 xl:grid-cols-2'>
                  {migrationHistory.map(item => (
                    <div
                      key={item.externalSourceId}
                      className='rounded-lg border border-border bg-muted/10 p-4'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <p className='text-sm font-medium text-foreground'>
                            {item.jiraProjectKey}
                          </p>
                          <p className='mt-1 text-xs text-muted-foreground'>{item.displayName}</p>
                        </div>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            item.isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.isActive ? 'active' : 'inactive'}
                        </span>
                      </div>
                      <div className='mt-3 grid grid-cols-2 gap-3'>
                        <div>
                          <p className='text-[11px] text-muted-foreground'>Board ID</p>
                          <p className='mt-1 text-sm text-foreground'>
                            {item.targetBoardId || '—'}
                          </p>
                        </div>
                        <div>
                          <p className='text-[11px] text-muted-foreground'>Channel ID</p>
                          <p className='mt-1 text-sm text-foreground'>{item.targetChannelId}</p>
                        </div>
                      </div>
                      <div className='mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground'>
                        <span>Created {new Date(item.createdAt).toLocaleString()}</span>
                        <span>Updated {new Date(item.updatedAt).toLocaleString()}</span>
                      </div>
                      <div className='mt-3'>
                        <a
                          href={`/chat/dir/${item.targetChannelId}`}
                          className='inline-flex text-xs font-medium text-sky-700 hover:underline'
                        >
                          Open Channel
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Dialog>

          {migrationPhase === 'setup' && !preview && (
            <section className='rounded-2xl border border-dashed border-border bg-muted/10 p-10 text-center'>
              <h3 className='text-sm font-semibold text-foreground'>No preview yet</h3>
              <p className='mt-2 text-xs text-muted-foreground'>
                Fill in your Jira project key, target project, board, and channel, then click
                &ldquo;Start Migration&rdquo; to load statuses and begin mapping.
              </p>
            </section>
          )}

          {preview && migrationPhase === 'migrate' && (
            <>
              <section className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
                <div className='rounded-2xl border border-border bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(255,255,255,0.96))] p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Jira Scope
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>
                    {preview.jiraProject.key}
                  </h3>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {preview.jiraProject.totalIssues} issues in project
                  </p>
                </div>
                <div className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Target
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>
                    {preview.target.boardName}
                  </h3>
                  <p className='mt-1 text-sm text-muted-foreground'>{preview.target.projectName}</p>
                </div>
                <div className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Custom Fields
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>
                    {preview.customFieldMappings.length}
                  </h3>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    Create {previewActionCounts.create} • Reuse {previewActionCounts.reuse}
                  </p>
                </div>
                <div className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                  <p className='text-[11px] uppercase tracking-[0.14em] text-muted-foreground'>
                    Preview Page
                  </p>
                  <h3 className='mt-2 text-lg font-semibold text-foreground'>{pageIndex + 1}</h3>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {preview.pagination.currentPageIssueCount} issues shown
                  </p>
                </div>
              </section>

              <section className='rounded-2xl border border-border bg-background p-5 shadow-sm'>
                <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <h3 className='text-sm font-semibold text-foreground'>Preview Workspace</h3>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Focus on one area at a time instead of scanning the full migration report.
                    </p>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    {(
                      [
                        ['overview', 'Overview'],
                        ['fields', `Custom Fields (${preview.customFieldMappings.length})`],
                        ['issues', `Issue Samples (${preview.issueSamples.length})`],
                      ] as Array<[PreviewSection, string]>
                    ).map(([sectionKey, label]) => (
                      <button
                        key={sectionKey}
                        type='button'
                        data-track-category='jira_migration'
                        data-track-name={`preview_section_${sectionKey}`}
                        onClick={() => setPreviewSection(sectionKey)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          previewSection === sectionKey
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className='mt-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/10 p-4 lg:flex-row lg:items-center lg:justify-between'>
                  <div>
                    <p className='text-xs font-medium text-foreground'>Jira page navigation</p>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Page {pageIndex + 1} • {preview.pagination.currentPageIssueCount} issues in
                      this preview slice
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => void handlePreviousPage()}
                      data-track-category='jira_migration'
                      data-track-name='PREVIEW_PREV_PAGE'
                      disabled={isPreviewLoading || pageIndex === 0}
                    >
                      Previous Page
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => void handleNextPage()}
                      data-track-category='jira_migration'
                      data-track-name='PREVIEW_NEXT_PAGE'
                      disabled={isPreviewLoading || !preview.pagination.hasNextPage}
                    >
                      Next Page
                    </Button>
                  </div>
                </div>

                {previewSection === 'overview' && (
                  <div className='mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr,0.85fr]'>
                    <div className='rounded-xl border border-border p-4'>
                      <div className='flex items-center justify-between gap-3'>
                        <div>
                          <h4 className='text-sm font-semibold text-foreground'>
                            Migration Summary
                          </h4>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            High-signal view of what this import will create, reuse, or preserve.
                          </p>
                        </div>
                      </div>
                      <div className='mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3'>
                        <div className='rounded-lg border border-blue-200 bg-blue-50 p-3'>
                          <p className='text-[11px] uppercase tracking-wide text-blue-700'>
                            Create
                          </p>
                          <p className='mt-1 text-2xl font-semibold text-blue-900'>
                            {previewActionCounts.create}
                          </p>
                          <p className='mt-1 text-xs text-blue-800'>New board custom fields</p>
                        </div>
                        <div className='rounded-lg border border-emerald-200 bg-emerald-50 p-3'>
                          <p className='text-[11px] uppercase tracking-wide text-emerald-700'>
                            Reuse
                          </p>
                          <p className='mt-1 text-2xl font-semibold text-emerald-900'>
                            {previewActionCounts.reuse}
                          </p>
                          <p className='mt-1 text-xs text-emerald-800'>Existing board fields</p>
                        </div>
                        <div className='rounded-lg border border-amber-200 bg-amber-50 p-3'>
                          <p className='text-[11px] uppercase tracking-wide text-amber-700'>
                            Metadata
                          </p>
                          <p className='mt-1 text-2xl font-semibold text-amber-900'>
                            {previewActionCounts.metadata}
                          </p>
                          <p className='mt-1 text-xs text-amber-800'>Stored without board fields</p>
                        </div>
                      </div>

                      <div className='mt-5 rounded-lg border border-border bg-background p-4'>
                        <div className='flex items-center justify-between gap-3'>
                          <div>
                            <h5 className='text-sm font-semibold text-foreground'>
                              Core Field Mapping
                            </h5>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              Stable mappings that will apply to every imported issue.
                            </p>
                          </div>
                          <span className='text-xs text-muted-foreground'>
                            {preview.coreMappings.length} mappings
                          </span>
                        </div>
                        <div className='mt-3 space-y-2'>
                          {preview.coreMappings.map(mapping => (
                            <div
                              key={mapping.jiraField}
                              className='flex flex-col gap-1 rounded-lg border border-border/80 bg-muted/10 p-3 sm:flex-row sm:items-start sm:justify-between'
                            >
                              <div>
                                <p className='text-sm font-medium text-foreground'>
                                  {mapping.jiraField}
                                </p>
                                <p className='mt-1 text-xs text-muted-foreground'>
                                  {mapping.notes ||
                                    'Mapped directly into the target workflow model.'}
                                </p>
                              </div>
                              <p className='text-xs font-medium text-foreground sm:text-right'>
                                {mapping.targetField}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className='rounded-xl border border-border p-4'>
                      <div className='flex items-center justify-between gap-3'>
                        <div>
                          <h4 className='text-sm font-semibold text-foreground'>Status Mappings</h4>
                          <p className='mt-1 text-xs text-muted-foreground'>
                            StatusV2 assigned in Step 2.
                          </p>
                        </div>
                        <button
                          type='button'
                          data-track-category='jira_migration'
                          data-track-name='click_edit_status_mappings'
                          onClick={() => setMigrationPhase('map-statuses')}
                          className='text-xs font-medium text-sky-700 hover:underline'
                        >
                          Edit
                        </button>
                      </div>
                      <div className='mt-4 space-y-2'>
                        {preview.statusMappings.map(mapping => (
                          <div
                            key={mapping.jiraStatus}
                            className='flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2'
                          >
                            <p className='text-sm text-foreground'>{mapping.jiraStatus}</p>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                statusV2Mappings[mapping.jiraStatus]
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {statusV2Mappings[mapping.jiraStatus] || 'Unmapped'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {previewSection === 'fields' && (
                  <div className='mt-5 rounded-xl border border-border p-4'>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <h4 className='text-sm font-semibold text-foreground'>Custom Field Plan</h4>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          Review only a small set at a time instead of scrolling through the full
                          list.
                        </p>
                      </div>
                      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                        <span>
                          Page {customFieldPage + 1} of {previewActionCounts.fieldsPageCount}
                        </span>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setCustomFieldPage(page => Math.max(0, page - 1))}
                          data-track-category='jira_migration'
                          data-track-name='CUSTOM_FIELDS_PREV_PAGE'
                          disabled={customFieldPage === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            setCustomFieldPage(page =>
                              Math.min(previewActionCounts.fieldsPageCount - 1, page + 1),
                            )
                          }
                          data-track-category='jira_migration'
                          data-track-name='CUSTOM_FIELDS_NEXT_PAGE'
                          disabled={customFieldPage >= previewActionCounts.fieldsPageCount - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                    <div className='mt-4 space-y-3'>
                      {paginatedCustomFieldMappings.map(mapping => (
                        <div
                          key={mapping.jiraFieldId}
                          className='rounded-xl border border-border bg-muted/10 p-4'
                        >
                          <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
                            <div>
                              <p className='text-sm font-semibold text-foreground'>
                                {mapping.jiraFieldName}
                              </p>
                              <p className='mt-1 text-xs text-muted-foreground'>
                                {mapping.jiraFieldId}
                              </p>
                            </div>
                            <div className='flex flex-col items-start gap-2 lg:items-end'>
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${actionClassMap[mapping.action]}`}
                              >
                                {mapping.action.replaceAll('_', ' ')}
                              </span>
                              {mapping.action === 'create_board_custom_field' && (
                                <label className='inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground'>
                                  <input
                                    type='checkbox'
                                    data-track-category='jira_migration'
                                    data-track-name='toggle_skip_custom_field'
                                    checked={Boolean(skippedCustomFieldIds[mapping.jiraFieldId])}
                                    onChange={event => {
                                      const checked = event.target.checked;
                                      setSkippedCustomFieldIds(previous => ({
                                        ...previous,
                                        [mapping.jiraFieldId]: checked,
                                      }));
                                    }}
                                  />
                                  Skip this field in import
                                </label>
                              )}
                            </div>
                          </div>
                          <div className='mt-4 grid grid-cols-1 gap-3 md:grid-cols-3'>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>
                                Suggested Xyne Field
                              </p>
                              <p className='mt-1 text-sm text-foreground'>
                                {mapping.suggestedXyneFieldName}
                              </p>
                              {mapping.matchedExistingFieldId && (
                                <p className='mt-1 text-xs text-muted-foreground'>
                                  Existing field: {mapping.matchedExistingFieldId}
                                </p>
                              )}
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Type Mapping</p>
                              <p className='mt-1 text-sm text-foreground'>
                                {mapping.jiraFieldType} → {mapping.suggestedXyneFieldType}
                              </p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Coverage</p>
                              <p className='mt-1 text-sm text-foreground'>
                                {mapping.issueCoverageCount} issues
                              </p>
                            </div>
                          </div>
                          <p className='mt-4 text-xs text-muted-foreground'>{mapping.reason}</p>
                          {mapping.sampleValues.length > 0 && (
                            <div className='mt-4 flex flex-wrap gap-2'>
                              {mapping.sampleValues.map(sample => (
                                <span
                                  key={`${mapping.jiraFieldId}-${sample}`}
                                  className='rounded-full bg-background px-2.5 py-1 text-[11px] text-muted-foreground border border-border'
                                >
                                  {sample}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewSection === 'issues' && (
                  <div className='mt-5 rounded-xl border border-border p-4'>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <h4 className='text-sm font-semibold text-foreground'>Issue Samples</h4>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          Representative issues from the current Jira page to validate type,
                          ownership, and load.
                        </p>
                      </div>
                      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                        <span>
                          Page {issueSamplePage + 1} of {previewActionCounts.issuePageCount}
                        </span>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setIssueSamplePage(page => Math.max(0, page - 1))}
                          data-track-category='jira_migration'
                          data-track-name='ISSUE_SAMPLES_PREV_PAGE'
                          disabled={issueSamplePage === 0}
                        >
                          Previous
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() =>
                            setIssueSamplePage(page =>
                              Math.min(previewActionCounts.issuePageCount - 1, page + 1),
                            )
                          }
                          data-track-category='jira_migration'
                          data-track-name='ISSUE_SAMPLES_NEXT_PAGE'
                          disabled={issueSamplePage >= previewActionCounts.issuePageCount - 1}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                    <div className='mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2'>
                      {paginatedIssueSamples.map(issue => (
                        <div
                          key={issue.id}
                          className='rounded-xl border border-border bg-muted/10 p-4'
                        >
                          <div className='flex items-start justify-between gap-3'>
                            <div>
                              <p className='text-sm font-semibold text-foreground'>{issue.key}</p>
                              <p className='mt-1 text-sm text-foreground'>{issue.summary}</p>
                            </div>
                            <div className='text-right'>
                              <p className='text-[11px] text-muted-foreground'>Status</p>
                              <p className='mt-1 text-sm font-medium text-foreground'>
                                {issue.status}
                              </p>
                            </div>
                          </div>
                          <div className='mt-4 grid grid-cols-2 gap-3 text-sm'>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Type</p>
                              <p className='mt-1 text-foreground'>{issue.issueType}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Reporter</p>
                              <p className='mt-1 text-foreground'>{issue.reporter || '—'}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Creator</p>
                              <p className='mt-1 text-foreground'>{issue.creator || '—'}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Assignee</p>
                              <p className='mt-1 text-foreground'>{issue.assignee || '—'}</p>
                            </div>
                            <div>
                              <p className='text-[11px] text-muted-foreground'>Labels</p>
                              <p className='mt-1 text-foreground'>
                                {issue.labels.length > 0 ? issue.labels.join(', ') : '—'}
                              </p>
                            </div>
                            <div className='col-span-2'>
                              <p className='text-[11px] text-muted-foreground'>Load</p>
                              <p className='mt-1 text-foreground'>
                                {issue.commentCount} comments • {issue.attachmentCount} attachments
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default JiraMigrationScreen;
