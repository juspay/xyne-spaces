import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useZero } from '../../../hooks/useZero';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import {
  Tag,
  Plus,
  X,
  Check,
  FileText,
  ChevronDown,
  ChevronLeft,
  LinkIcon,
  Minimize2,
  Play,
  Sparkles,
  Calendar,
  SquareKanban,
  Clock,
  Eye,
  AlertCircle,
  ClipboardCheck,
  ArrowRight,
  Archive,
} from 'lucide-react';
import type {
  SubTicket,
  Ticket,
  TicketReferenceMapping,
  FormFields,
  FormEntityValues,
  TicketStageRequest,
} from '@xyne/shared';
import {
  TicketPriority,
  TicketStatusV2,
  TicketReferenceRelation,
  FormFieldType,
  FormContextType,
  FormEntityType,
  TicketStageRequestStatus,
  BaseTicketType,
  RCAStatus,
  LookupType,
} from '@xyne/shared';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { TicketActivity } from '../TicketActivity';
import { UserSelector } from '../CreateTicketModal/UserSelector';
import { UserGroupSelector } from '../CreateTicketModal/UserGroupSelector';
import { SubTicketModal } from '../SubTicketModal/SubTicketModal';
import { CreateTicketModal } from '../CreateTicketModal/CreateTicketModal';
import { MappedTicketModal } from '../MappedTicketModal/MappedTicketModal';
import { EditableFormField } from './EditableFormField';
import { queries } from '../../../zero/queries';
import { useChannel } from '../../../hooks/useChannels';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import UserAvatar, { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { Selector } from './Selector';
import { TicketPriorityIcon, TicketStatusIcon } from '../../../assets/icons';
import { mutators } from '../../../zero/mutators';
import { apiInstance } from '../../../services/clients/apiClient';
import { useUsers } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useAuth } from '../../../hooks/useAuth';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import {
  formatIncomingReferenceLabel,
  formatReferenceLabel,
  useTicketReferences,
} from '../../../hooks/useTicketReferences';
import { TicketStatusIcon as TicketStageIcon } from '../TicketStatus/TicketStatusIcon';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { calculateETADeadline, calculateWorkingDurationMs } from '../../../utils/etaCalculation';
import { formatETADisplay, getLocalISOString, getStatusBadgeConfig } from '../utils';
import { cn } from '../../../utils/classNames';
import Button from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { FileBubble } from '../../ui/FileBubble/FileBubble';
import { StageFormModal } from '../StageFormModal/StageFormModal';
import Tooltip from '../../ui/Tooltip';
import WorkflowTriggerModal from '../../Workflow/WorkflowTriggerModal';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { useEmailChannelPreference } from '../../../hooks/useEmailChannelPreference';
import ApprovalNudgeBanner from './ApprovalNudgeBanner';
import { isReleaseTicket } from '@xyne/shared';
import { generateReleaseNotes } from '../../../services/ticketBoardService';
import { searchService } from '../../../services/searchService';
import { AIClassificationPanel } from './AIClassificationPanel';
import type { TicketClassificationData } from '../../../types/classification';

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return ` ${date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
};

interface StageInfo {
  id: string;
  boardId: string;
  name: string;
  sequenceNumber: number;
  defaultTicketStatusV2?: TicketStatusV2;
  approvers?: readonly { userId: string; stageId: string }[];
  formId?: string | null;
  eta: number | null;
}

const getStageProgress = (
  currentStageName: string | null | undefined,
  stages: StageInfo[] | undefined,
): number => {
  if (!stages || stages.length === 0 || !currentStageName) return 0;

  const currentStage = stages.find(stage => stage.name === currentStageName);
  if (!currentStage) return 0;

  return Math.round((currentStage.sequenceNumber / stages.length) * 100);
};

const PRIORITY_OPTIONS: TicketPriority[] = [
  TicketPriority.LOW,
  TicketPriority.MEDIUM,
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
];

type VespaProjectTicket = {
  id: string;
  title?: string;
  xyneId?: string | null;
  searchContext?: {
    tags?: string[];
  };
};

const VESPA_PROJECT_TICKET_MAX_OFFSET = 1000;

const toVespaProjectTicket = (result: {
  id: string;
  title: string;
  searchContext?: {
    xyneId?: string | null;
    tags?: string[];
  };
}): VespaProjectTicket => ({
  id: result.id,
  title: result.title,
  ...(result.searchContext?.xyneId !== undefined
    ? { xyneId: result.searchContext.xyneId ?? null }
    : {}),
  ...(result.searchContext?.tags ? { searchContext: { tags: result.searchContext.tags } } : {}),
});

const fetchProjectTicketsPageFromVespa = async (
  projectId: string,
  query: string,
  offset: number,
): Promise<{
  results: VespaProjectTicket[];
  totalCount: number;
  offset: number;
  limit: number;
}> => {
  const response = await searchService.vespaSearch({
    query: query || '*',
    type: 'tickets',
    apps: 'ticket',
    projectId,
    limit: 200,
    offset,
  });

  return {
    results: response.results.map(result => toVespaProjectTicket(result)),
    totalCount: response.totalCount,
    offset: response.offset,
    limit: response.limit,
  };
};

interface TicketReferenceWithTicket extends TicketReferenceMapping {
  targetTicket?: {
    id?: string;
    title?: string | null;
    xyneId?: string | null;
    boardId?: string | null;
    stageName?: string | null;
    priority?: TicketPriority;
    assignedTo?: string | null;
  };
  sourceTicket?: {
    id?: string;
    title?: string | null;
    xyneId?: string | null;
    boardId?: string | null;
    stageName?: string | null;
    priority?: TicketPriority;
    assignedTo?: string | null;
  };
}

// Type for form entity values with the related form field
interface FormEntityValueWithField extends FormEntityValues {
  formField?: FormFields & {
    form?: {
      formContextMappings?: Array<{ contextId: string; contextType: string }>;
    };
  };
}

interface TicketDetailsProps {
  ticketId: string;
  onNavigateToTicket?: (ticketId: string) => void;
  expandedView?: boolean;
  onFillRCA?: () => void;
}

const TicketKeyValuePair = ({
  ticketKey,
  value,
  className,
}: {
  ticketKey: string;
  value: React.ReactElement;
  className?: string;
}): React.ReactElement => {
  return (
    <div className='flex flex-wrap items-center gap-2 w-fit'>
      <span className='text-sm text-foreground w-[85px]'>{ticketKey}</span>
      <div className={`text-sm text-foreground break-all ${className}`}>{value}</div>
    </div>
  );
};

interface ReleaseNotesButtonProps {
  metadata: { releaseNotesCanvasUrl?: string; isGeneratingReleaseNotes?: boolean } | null;

  isGeneratingReleaseNotes: boolean;
  onGenerate: () => Promise<unknown>;
  onGeneratingChange: (isGenerating: boolean) => void;
}

const ReleaseNotesButton: React.FC<ReleaseNotesButtonProps> = ({
  metadata,
  isGeneratingReleaseNotes,
  onGenerate,
  onGeneratingChange,
}) => {
  const canvasUrl = metadata?.releaseNotesCanvasUrl;
  const isGenerating = isGeneratingReleaseNotes || (metadata?.isGeneratingReleaseNotes ?? false);
  const navigate = useNavigate();

  const handleViewClick = (): void => {
    void navigate(canvasUrl!);
  };

  const handleGenerateClick = (): void => {
    onGeneratingChange(true);
    void onGenerate()
      .then(() => {
        toast.success('Release notes generated successfully', {
          description: 'The release notes canvas has been created and posted to the conversation.',
          duration: 2000,
        });
      })
      .catch(error => {
        toast.error('Failed to generate release notes', {
          description: error instanceof Error ? error.message : 'Please try again.',
          duration: 2000,
        });
      })
      .finally(() => {
        onGeneratingChange(false);
      });
  };

  const config = canvasUrl
    ? {
        onClick: handleViewClick,
        trackName: 'ViewReleaseNotes',
        testId: 'view-release-notes-button',
        iconClass: 'bg-muted text-muted-foreground',
        label: 'View Release Notes',
        description: 'Open the generated release notes canvas',
        disabled: false,
      }
    : {
        onClick: handleGenerateClick,
        trackName: 'GenerateReleaseNotes',
        testId: 'generate-release-notes-button',
        iconClass: 'bg-muted text-muted-foreground',
        label: isGenerating ? 'Generating...' : 'Generate Release Notes',
        description: 'Create release-notes for this release',
        disabled: isGenerating,
      };

  return (
    <button
      type='button'
      onClick={config.onClick}
      disabled={config.disabled}
      data-track-category='Tickets'
      data-track-name={config.trackName}
      data-testid={config.testId}
      className='group flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground shadow-sm hover:shadow-md hover:border-border transition-all disabled:opacity-50 disabled:cursor-not-allowed'
    >
      <span className='inline-flex items-center gap-3'>
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full ${config.iconClass}`}
        >
          <FileText size={18} />
        </span>
        <span className='flex flex-col text-left'>
          <span className='text-sm font-semibold text-foreground'>{config.label}</span>
          <span className='text-xs text-muted-foreground'>{config.description}</span>
        </span>
      </span>
      <ArrowRight
        className={`h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 ${isGenerating ? 'animate-pulse' : ''}`}
      />
    </button>
  );
};
export const TicketDetails: React.FC<TicketDetailsProps> = ({
  ticketId,
  onNavigateToTicket,
  expandedView = false,
  onFillRCA,
}) => {
  const zero = useZero();
  const navigate = useNavigate();
  const shareableOrigin = useShareableOrigin();
  const location = useLocation();
  const { isMobile } = usePlatform();
  const { baseRoute, buildChannelRoute } = useRouteContext();

  // State declarations
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [isSubTicketModalOpen, setIsSubTicketModalOpen] = useState(false);
  const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);
  const [selectedSubTicket, setSelectedSubTicket] = useState<SubTicket | null>(null);
  const [mappedTicketId, setMappedTicketId] = useState<string | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const [stageFormModal, setStageFormModal] = useState<{
    ticket: typeof ticket;
    targetStage: StageInfo;
    sourceStageName: string;
    formId: string;
    isReviewer?: boolean;
    hasApprovers: boolean;
    existingRequest?: TicketStageRequest | null;
  } | null>(null);

  const [editingStageETA, setEditingStageETA] = useState(false);
  const [stageEtaValue, setStageEtaValue] = useState('');
  const stageEtaInputRef = useRef<HTMLInputElement>(null);
  const [editingETA, setEditingETA] = useState(false);
  const [etaValue, setEtaValue] = useState('');
  const etaInputRef = useRef<HTMLInputElement>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [needsReadMore, setNeedsReadMore] = useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [showBackwardConfirmDialog, setShowBackwardConfirmDialog] = useState(false);
  const [backwardStageChange, setBackwardStageChange] = useState<{
    stageName: string;
    fromSequenceNumber: number;
    newStatus?: TicketStatusV2;
  } | null>(null);
  const [showBoardChangeConfirmDialog, setShowBoardChangeConfirmDialog] = useState(false);
  const [pendingBoardChange, setPendingBoardChange] = useState<string | null>(null);
  const [isGeneratingReleaseNotes, setIsGeneratingReleaseNotes] = useState(false);
  const [showArchiveConfirmDialog, setShowArchiveConfirmDialog] = useState(false);
  const [pendingTitleValue, setPendingTitleValue] = useState<string | null>(null);
  const [showTitleChangeConfirmDialog, setShowTitleChangeConfirmDialog] = useState(false);
  const prevStatusV2Ref = useRef<TicketStatusV2 | null>(null);
  const hasAutoTriggeredReleaseNotesRef = useRef(false);
  const [boardDropdownOpen, setBoardDropdownOpen] = useState(false);
  const [hasBoardDropdownOpened, setHasBoardDropdownOpened] = useState(false);

  // Query ticket data
  const [ticket] = useCachedQuery(queries.ticketDetailsByIdV2({ ticketId: ticketId }));
  const [ticketTypeDropdownOpened, setTicketTypeDropdownOpened] = useState(false);
  const [ticketTypeLookupResult, ticketTypeLookupDetails] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.TICKET_TYPE }),
    { enabled: ticketTypeDropdownOpened },
  );
  const ticketTypeOptions = useMemo(() => {
    if (!ticketTypeLookupResult) return [];
    return ticketTypeLookupResult.map(type => ({
      id: type.value,
      name: type.value,
    }));
  }, [ticketTypeLookupResult]);
  const isTicketTypeLoading =
    ticketTypeDropdownOpened && ticketTypeLookupDetails.type !== 'complete';
  const rcaRecord = ticket?.rcas?.[0];

  // RCA button labels based on status
  const isClosedRca = rcaRecord?.status === RCAStatus.CLOSED;
  const isDraftRca = rcaRecord?.status === RCAStatus.DRAFT;
  const rcaButtonTitle = isClosedRca ? 'View/Edit RCA' : isDraftRca ? 'Continue RCA' : 'Fill RCA';
  const rcaButtonSubtitle = isClosedRca
    ? 'Review submitted RCA and edit details'
    : isDraftRca
      ? 'Resume your in-progress RCA'
      : 'Add root cause, impact, and COE details';
  const rcaTrackName = isClosedRca ? 'ViewEditRCA' : isDraftRca ? 'ContinueRCA' : 'FillRCA';

  const handleOpenRcaPanel = (): void => {
    if (onFillRCA) {
      onFillRCA();
      return;
    }

    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.set('selectedTab', 'rca');
    void navigate(
      {
        pathname: location.pathname,
        search: `?${nextSearchParams.toString()}`,
      },
      { replace: true },
    );
  };

  // ticketDetailsById already loads assignments, so reuse them instead of subscribing twice.
  const ticketAssignments = useMemo(() => ticket?.assignments ?? [], [ticket?.assignments]);

  // Filter PR reviewers and QA from assignments
  const prReviewerIds =
    ticketAssignments
      ?.filter(a => a.userResponsibility === 'PR_REVIEWER')
      .map(a => a.userId)
      .filter(Boolean) || [];

  const qaId = ticketAssignments?.find(a => a.userResponsibility === 'QA')?.userId || null;
  const managerId =
    ticketAssignments?.find(a => a.userResponsibility === 'MANAGER')?.userId || null;
  // Check if description needs truncation by comparing scrollHeight with clientHeight
  useEffect(() => {
    if (!descriptionRef.current || showFullDescription) return;

    const checkTruncation = () => {
      const element = descriptionRef.current;
      if (element) {
        const isTruncated = element.scrollHeight > element.clientHeight;
        setNeedsReadMore(isTruncated);
      }
    };

    // Use ResizeObserver for better performance
    const resizeObserver = new ResizeObserver(checkTruncation);
    if (descriptionRef.current) {
      resizeObserver.observe(descriptionRef.current);
      checkTruncation(); // Initial check
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [ticket?.description, showFullDescription]);

  // Query all users for assignee dropdown
  const users = useUsers();

  // Query all user groups for activity display
  const userGroups = useUserGroups();
  const { user: currentUser } = useAuth();

  // Query stages if ticket has a boardId
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: ticket?.boardId ?? '' }), {
    enabled: !!ticket?.boardId,
  });

  // Create a map of stageId -> formId for quick lookup (from stages.formContextMappings)
  const stageFormMap = useMemo(() => {
    const map = new Map<string, string>();
    if (stages) {
      stages.forEach(stage => {
        if (stage.formContextMappings && stage.formContextMappings.length > 0) {
          stage.formContextMappings
            .filter(mapping => mapping.contextType === FormContextType.STAGE)
            .forEach(mapping => {
              map.set(mapping.contextId, mapping.formId);
            });
        }
      });
    }
    return map;
  }, [stages]);

  // Create stages array with formId and approvers included
  const stagesWithFormInfo = useMemo(() => {
    if (!stages) return [];
    return stages.map(stage => ({
      ...stage,
      formId: stageFormMap.get(stage.id) ?? null,
    }));
  }, [stages, stageFormMap]);

  // Check if board has stages with approval (for sequential movement enforcement)
  const boardHasStagesWithApproval = useMemo(() => {
    return stages?.some(s => s.approvers && s.approvers.length > 0) ?? false;
  }, [stages]);

  // Check if board has stages with forms (for sequential movement enforcement)
  const boardHasStagesWithForms = useMemo(() => {
    return stageFormMap.size > 0;
  }, [stageFormMap]);

  // Enforce sequential movement if board has EITHER approvers OR forms
  const shouldEnforceSequentialMovement = useMemo(() => {
    return boardHasStagesWithApproval || boardHasStagesWithForms;
  }, [boardHasStagesWithApproval, boardHasStagesWithForms]);

  // Query channel if ticket has conversation with channelId
  const channelId = ticket?.conversation?.channelId;
  const channel = useChannel(channelId || '');

  // Detect if ticket belongs to an email/desk channel — title changes also update email subject
  // ticket.channelId is the direct field; ticket.conversation.channelId is the linked conversation's channel
  const emailChannelPreference = useEmailChannelPreference(
    ticket?.channelId || ticket?.conversation?.channelId || null,
  );
  const isEmailDeskTicket = !!emailChannelPreference;

  const [projectTickets, setProjectTickets] = useState<VespaProjectTicket[] | null>(null);
  const [isAddTicketMenuOpen, setIsAddTicketMenuOpen] = useState(false);
  const [isLoadingProjectTickets, setIsLoadingProjectTickets] = useState(false);
  const [isLoadingMoreProjectTickets, setIsLoadingMoreProjectTickets] = useState(false);
  const [projectTicketHasMore, setProjectTicketHasMore] = useState(false);
  const [projectTicketSearch, setProjectTicketSearch] = useState('');
  const [projectTicketNextOffset, setProjectTicketNextOffset] = useState(0);
  const projectTicketsRequestIdRef = useRef(0);

  // Project-level tags — lazy-loaded when tag dropdown is opened
  const [projectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: ticket?.projectId ?? '' }),
    { enabled: !!ticket?.projectId && showTagDropdown },
  );

  useEffect(() => {
    setProjectTickets(null);
    setIsLoadingProjectTickets(false);
    setIsLoadingMoreProjectTickets(false);
    setProjectTicketHasMore(false);
    setProjectTicketNextOffset(0);
    setProjectTicketSearch('');
    setIsAddTicketMenuOpen(false);
    projectTicketsRequestIdRef.current += 1;
  }, [ticket?.projectId]);

  const loadProjectTicketsPage = useCallback(
    async (offset: number, replace: boolean): Promise<void> => {
      if (!ticket?.projectId) {
        return;
      }

      const normalizedQuery = projectTicketSearch.trim();
      const requestId = ++projectTicketsRequestIdRef.current;
      const isInitialLoad = replace || offset === 0;

      if (isInitialLoad) {
        setIsLoadingProjectTickets(true);
      } else {
        setIsLoadingMoreProjectTickets(true);
      }

      try {
        const response = await fetchProjectTicketsPageFromVespa(
          ticket.projectId,
          normalizedQuery,
          offset,
        );

        if (requestId !== projectTicketsRequestIdRef.current) {
          return;
        }

        const nextOffset = response.offset + response.limit;
        const cappedNextOffset = Math.min(nextOffset, VESPA_PROJECT_TICKET_MAX_OFFSET);
        const hasMore =
          response.results.length > 0 &&
          nextOffset < response.totalCount &&
          nextOffset < VESPA_PROJECT_TICKET_MAX_OFFSET;

        setProjectTickets(previousTickets => {
          const baseTickets = replace ? [] : (previousTickets ?? []);
          return Array.from(
            new Map(
              [...baseTickets, ...response.results].map(ticket => [ticket.id, ticket]),
            ).values(),
          );
        });
        setProjectTicketNextOffset(cappedNextOffset);
        setProjectTicketHasMore(hasMore);
      } catch (error) {
        if (requestId !== projectTicketsRequestIdRef.current) {
          return;
        }

        console.warn('[TicketDetails] Failed to load Vespa project tickets', {
          projectId: ticket.projectId,
          offset,
          query: normalizedQuery || '*',
          error,
        });

        if (replace) {
          setProjectTickets([]);
          setProjectTicketNextOffset(0);
        }

        setProjectTicketHasMore(false);
      } finally {
        if (requestId === projectTicketsRequestIdRef.current) {
          setIsLoadingProjectTickets(false);
          setIsLoadingMoreProjectTickets(false);
        }
      }
    },
    [projectTicketSearch, ticket?.projectId],
  );

  useEffect(() => {
    if (!isAddTicketMenuOpen || !ticket?.projectId) {
      return;
    }

    setProjectTickets(null);
    setProjectTicketNextOffset(0);
    setProjectTicketHasMore(false);
    if (projectTicketSearch.trim()) {
      void loadProjectTicketsPage(0, true);
    }
  }, [isAddTicketMenuOpen, loadProjectTicketsPage, ticket?.projectId, projectTicketSearch]);

  const handleAddTicketMenuOpenChange = useCallback((open: boolean): void => {
    setIsAddTicketMenuOpen(open);
  }, []);

  const handleAddTicketMenuSearchChange = useCallback((searchValue: string): void => {
    setProjectTicketSearch(searchValue);
    setProjectTicketNextOffset(0);
    setProjectTicketHasMore(false);
    setProjectTickets(null);
    projectTicketsRequestIdRef.current += 1;
  }, []);

  const handleAddTicketMenuScrollEnd = useCallback((): void => {
    if (!projectTicketHasMore || isLoadingProjectTickets || isLoadingMoreProjectTickets) {
      return;
    }

    if (projectTicketNextOffset >= VESPA_PROJECT_TICKET_MAX_OFFSET) {
      setProjectTicketHasMore(false);
      return;
    }

    void loadProjectTicketsPage(projectTicketNextOffset, false);
  }, [
    isLoadingMoreProjectTickets,
    isLoadingProjectTickets,
    loadProjectTicketsPage,
    projectTicketHasMore,
    projectTicketNextOffset,
  ]);

  const [boards] = useCachedQuery(
    queries.boardsListByProject({ projectId: ticket?.projectId || '' }),
    {
      enabled: !!ticket?.projectId && hasBoardDropdownOpened,
    },
  );

  // Get current active stage entry (where stageLeftAt is null)
  const currentStageEntry = useMemo(() => {
    return ticket?.stageEtaEntries?.find(entry => entry.stageLeftAt === null);
  }, [ticket?.stageEtaEntries]);

  // Get current stage info (including eta) to determine if status deadline should be shown
  const currentStageInfo = useMemo(() => {
    return stages?.find(s => s.name === ticket?.stageName);
  }, [stages, ticket?.stageName]);

  // Query ticket attachments
  const [ticketAttachments] = useCachedQuery(queries.attachmentsByTicket({ ticketId }));

  // Ref hooks
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Memoized values
  const createdByUser = useMemo(
    () => users?.find(u => u.id === ticket?.createdBy),
    [users, ticket?.createdBy],
  );

  // Fetch ticket activities
  const [activities] = useCachedQuery(queries.ticketActivities({ ticketId: ticket?.id ?? '' }), {
    enabled: !!ticket?.id,
  });

  // Fetch subtickets
  const [subTicketMappings] = useCachedQuery(queries.subTicketsForTicket({ ticketId: ticketId }));
  const subTickets = useMemo(
    () =>
      subTicketMappings
        ?.map(mapping => mapping.subTicket)
        .filter((st): st is NonNullable<typeof st> => st !== null && st !== undefined) || [],
    [subTicketMappings],
  );

  // Fetch parent tickets - check if this ticket is a mapped ticket for any sub-ticket
  const [parentSubTickets] = useCachedQuery(
    queries.subTicketsByMappedTicketId({ mappedTicketId: ticketId }),
  );

  // Query parent tickets through the mappings
  const parentTicketIds = useMemo(
    () =>
      parentSubTickets
        ?.flatMap(st => st.ticketMappings?.map(m => m.ticketId) || [])
        .filter((id): id is string => id !== null && id !== undefined) || [],
    [parentSubTickets],
  );

  const [parentTickets] = useCachedQuery(queries.ticketsByIds({ ticketIds: parentTicketIds }), {
    enabled: parentTicketIds.length > 0,
  });

  // Fetch form entity values for this ticket
  const [formEntityValues] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: ticketId }),
    { enabled: !!ticketId },
  );

  // Fetch form mapping for the ticket's board to get all defined fields
  const [formMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: ticket?.boardId || '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!ticket?.boardId },
  );

  // Merge form field definitions with entity values to show all fields including optional ones
  const allFormFields = useMemo((): FormEntityValueWithField[] | undefined => {
    const currentFormId = formMapping?.formFields?.[0]?.formId;

    const formValues = (formEntityValues as FormEntityValueWithField[] | undefined)?.filter(
      fev => fev.formField?.formId === currentFormId,
    );

    if (!formMapping?.formFields || formMapping.formFields.length === 0) {
      return formValues;
    }

    // Build a map of field ID to existing values
    const existingValuesMap = new Map<string, FormEntityValueWithField>();
    formValues?.forEach(fev => {
      if (fev.fieldId) {
        existingValuesMap.set(fev.fieldId, fev);
      }
    });

    // Create array of all fields - defined fields from form mapping, with values if they exist
    return (formMapping.formFields as FormFields[]).map((formField): FormEntityValueWithField => {
      const existingValue = existingValuesMap.get(formField.id);
      if (existingValue) {
        return existingValue;
      }
      // Field exists in form definition but has no value - create a placeholder entry
      return {
        id: `placeholder-${formField.id}`,
        formId: formMapping.formId,
        fieldId: formField.id,
        entityId: ticketId,
        entityType: FormEntityType.TICKET,
        contextId: ticket?.boardId || '',
        fieldValue: '',
        actualFieldValue: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        formField,
      };
    });
  }, [formMapping, formEntityValues, ticketId, ticket?.boardId]);

  type FormsToShowItem = {
    type: 'request' | 'form';
    id: string;
    stageId: string;
    formId: string;
    status?: TicketStageRequestStatus;
    createdAt: number;
    updatedAt: number;
    form?: { formName: string };
    request?: TicketStageRequest;
  };

  const formsToShow = useMemo(() => {
    const result: FormsToShowItem[] = [];

    // Get current ticket stage sequence number to limit formEntityValues (not requests)
    const currentTicketStage = stagesWithFormInfo?.find(s => s.name === ticket?.stageName);
    const currentStageSeq = currentTicketStage?.sequenceNumber;

    // Track which stageIds we already have forms for (to avoid duplicates)
    const stagesWithForm = new Set<string>();

    // Show ALL ticketStageRequests (these are active requests, show regardless of current stage)
    if (ticket?.ticketStageRequests) {
      ticket.ticketStageRequests.forEach(req => {
        const stage = stagesWithFormInfo?.find(s => s.id === req.stageId);
        const hasApprovers = stage?.approvers && stage.approvers.length > 0;

        if (hasApprovers) {
          const form = (req as TicketStageRequest & { form?: { formName: string } }).form;
          result.push({
            type: 'request',
            id: req.id,
            stageId: req.stageId,
            formId: req.formId || '',
            status: req.status,
            createdAt: req.createdAt,
            updatedAt: req.updatedAt,
            request: req,
            ...(form && { form }),
          });
          stagesWithForm.add(req.stageId);
        }
      });
    }

    // Show formEntityValues only for stages up to current stage (stale data)
    if (formEntityValues && stagesWithFormInfo && currentStageSeq !== undefined) {
      // Group formEntityValues by contextId (stageId)
      const contextIdsWithValue = new Set(
        (formEntityValues as FormEntityValueWithField[])
          .filter(fev => fev.contextId && stagesWithFormInfo.some(s => s.id === fev.contextId))
          .map(fev => fev.contextId!),
      );

      contextIdsWithValue.forEach(contextId => {
        // Skip if we already have a request for this stage
        if (stagesWithForm.has(contextId)) {
          return;
        }

        // Find which stage this contextId belongs to
        const stage = stagesWithFormInfo.find(s => s.id === contextId);
        if (stage && stage.formId) {
          // Only show forms for stages up to current ticket stage (filter stale data)
          if (stage.sequenceNumber !== undefined && stage.sequenceNumber > currentStageSeq) {
            return;
          }

          // Find the earliest createdAt from form entity values for this context
          const formValues = (formEntityValues as FormEntityValueWithField[]).filter(
            fev => fev.contextId === contextId,
          );
          const createdAt = Math.min(...formValues.map(fev => fev.createdAt || Date.now()));
          const updatedAt = Math.max(...formValues.map(fev => fev.updatedAt || Date.now()));

          result.push({
            type: 'form',
            id: `form-${contextId}`,
            stageId: stage.id,
            formId: stage.formId,
            createdAt,
            updatedAt,
            form: { formName: stage.name + ' Form' },
          });
        }
      });
    }

    return result;
  }, [ticket?.ticketStageRequests, formEntityValues, stagesWithFormInfo, ticket?.stageName]);

  const tags = ticket?.tagMappings;
  // Available tags from project_tags
  const availableTags = useMemo(() => {
    if (!projectTags) return [];

    const tagSet = new Set<string>();
    projectTags.forEach(t => {
      if (t?.name) {
        tagSet.add(t.name);
      }
    });

    return Array.from(tagSet).sort();
  }, [projectTags]);

  const priorityItems = useMemo(
    () => PRIORITY_OPTIONS.map(priority => ({ id: priority, name: priority })),
    [],
  );

  // Filter available tags based on search query and exclude already assigned tags
  const filteredTags = useMemo(() => {
    return availableTags.filter(tagName =>
      tagName.toLowerCase().includes(tagSearchQuery.toLowerCase()),
    );
  }, [availableTags, tagSearchQuery]);
  const selectedTagNames = useMemo(() => new Set(tags?.map(t => t.tagName)), [tags]);

  const referencesOut = useMemo<TicketReferenceWithTicket[]>(
    () =>
      Array.isArray(ticket?.referencesOut)
        ? (ticket.referencesOut as TicketReferenceWithTicket[])
        : [],
    [ticket?.referencesOut],
  );
  const referencesIn = useMemo<TicketReferenceWithTicket[]>(
    () =>
      Array.isArray(ticket?.referencesIn)
        ? (ticket.referencesIn as TicketReferenceWithTicket[])
        : [],
    [ticket?.referencesIn],
  );
  const referenceBoardIds = useMemo(() => {
    if (!ticket) return [];
    const boardIds = new Set<string>();

    referencesOut.forEach(reference => {
      if (reference.targetTicket?.boardId) {
        boardIds.add(reference.targetTicket.boardId);
      }
    });

    referencesIn.forEach(reference => {
      if (reference.sourceTicket?.boardId) {
        boardIds.add(reference.sourceTicket.boardId);
      }
    });

    // Add board IDs from mapped tickets of sub-tickets
    subTickets.forEach(subTicket => {
      if (subTicket?.mappedTicket?.boardId) {
        boardIds.add(subTicket.mappedTicket.boardId);
      }
    });

    // Exclude ticket's own board — stagesByBoard already covers it
    if (ticket.boardId) {
      boardIds.delete(ticket.boardId);
    }

    return Array.from(boardIds);
  }, [referencesOut, referencesIn, ticket, subTickets]);
  const [referenceStages] = useCachedQuery(
    queries.getStagesByBoardIds({ boardIds: referenceBoardIds }),
    {
      enabled: referenceBoardIds.length > 0,
    },
  );
  const stagesByBoardId = useMemo(() => {
    const stageMap = new Map<string, StageInfo[]>();

    // Include current board's stages from the stagesByBoard query
    if (stages && ticket?.boardId) {
      stageMap.set(
        ticket.boardId,
        stages.map(s => ({
          id: s.id,
          boardId: ticket.boardId,
          name: s.name,
          sequenceNumber: s.sequenceNumber,
          defaultTicketStatusV2: s.defaultTicketStatusV2,
          eta: s.eta ?? null,
        })),
      );
    }

    if (referenceStages) {
      referenceStages.forEach(stage => {
        const existing = stageMap.get(stage.boardId) ?? [];
        existing.push({
          id: stage.id,
          boardId: stage.boardId,
          name: stage.name,
          sequenceNumber: stage.sequenceNumber,
          defaultTicketStatusV2: stage.defaultTicketStatusV2,
          eta: stage.eta ?? null,
        });
        stageMap.set(stage.boardId, existing);
      });
    }

    return stageMap;
  }, [referenceStages, stages, ticket?.boardId]);
  const {
    referenceError,
    isReferenceSaving,
    referenceTicketOptions,
    referenceRelationOptions,
    handleAddReference,
    handleRemoveReference,
    handleReferenceRelationChange,
  } = useTicketReferences({
    ticketId: ticket?.id,
    projectTickets: projectTickets ?? [],
    referencesOut,
  });

  // Check if search query matches exactly with any filtered tag
  const exactMatch = useMemo(() => {
    return filteredTags.some(tag => tag.toLowerCase() === tagSearchQuery.toLowerCase());
  }, [filteredTags, tagSearchQuery]);

  // Initialize edit values when ticket changes
  useEffect(() => {
    if (ticket) {
      setTitleValue(ticket.title);
      setDescriptionValue(ticket.description);
    }
  }, [ticket]);
  // Initialize stage ETA edit value when current stage changes
  useEffect(() => {
    if (currentStageEntry?.stageEta) {
      setStageEtaValue(getLocalISOString(currentStageEntry.stageEta));
    }
  }, [currentStageEntry]);

  // Auto-focus inputs when entering edit mode
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingDescription && descriptionTextareaRef.current) {
      descriptionTextareaRef.current.focus();
    }
  }, [editingDescription]);

  // Auto-focus tag input when dropdown opens
  useEffect(() => {
    if (showTagDropdown && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagDropdown]);

  // Auto-focus Stage ETA input when entering edit mode
  useEffect(() => {
    if (editingStageETA && stageEtaInputRef.current) {
      stageEtaInputRef.current.focus();
      stageEtaInputRef.current.select();
    }
  }, [editingStageETA]);

  // Initialize ETA edit value when ticket changes
  useEffect(() => {
    if (ticket?.eta) {
      setEtaValue(getLocalISOString(ticket.eta));
    }
  }, [ticket?.eta]);

  // Auto-focus ETA input when entering edit mode
  useEffect(() => {
    if (editingETA && etaInputRef.current) {
      etaInputRef.current.focus();
      etaInputRef.current.select();
    }
  }, [editingETA]);

  // Auto-generate release notes when ticket status transitions to COMPLETED
  useEffect(() => {
    if (!ticket) return;

    const currentStatus = ticket.statusV2;
    const prevStatus = prevStatusV2Ref.current;
    const metadata = ticket.metadata as {
      releaseNotesCanvasUrl?: string;
      isGeneratingReleaseNotes?: boolean;
    } | null;

    const isReleaseType = isReleaseTicket(ticket.ticketType as BaseTicketType);
    const justTransitionedToCompleted =
      prevStatus !== TicketStatusV2.COMPLETED && currentStatus === TicketStatusV2.COMPLETED;
    const hasNoReleaseNotes = !metadata?.releaseNotesCanvasUrl;
    const isNotGenerating = !metadata?.isGeneratingReleaseNotes && !isGeneratingReleaseNotes;
    const hasNotAutoTriggered = !hasAutoTriggeredReleaseNotesRef.current;

    if (
      isReleaseType &&
      justTransitionedToCompleted &&
      hasNoReleaseNotes &&
      isNotGenerating &&
      hasNotAutoTriggered
    ) {
      hasAutoTriggeredReleaseNotesRef.current = true;
      setIsGeneratingReleaseNotes(true);

      generateReleaseNotes(ticket.id)
        .then(() => {
          toast.success('Release notes generated automatically', {
            description: 'Release notes have been created for this completed release.',
            duration: 3000,
          });
        })
        .catch(error => {
          hasAutoTriggeredReleaseNotesRef.current = false;
          toast.error('Failed to generate release notes', {
            description: error instanceof Error ? error.message : 'Please try again manually.',
            duration: 4000,
          });
        })
        .finally(() => {
          setIsGeneratingReleaseNotes(false);
        });
    }

    prevStatusV2Ref.current = currentStatus;
  }, [ticket, isGeneratingReleaseNotes]);

  // Click outside handlers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target as Node)) {
        setShowTagDropdown(false);
        setTagSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return (): void => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Early return if no ticket data - after all hooks
  if (!ticket) {
    return (
      <div className='max-w-5xl mx-auto px-6 py-6'>
        <p className='text-muted-foreground'>Loading ticket details...</p>
      </div>
    );
  }

  const buildTicketLink = (refTicket?: {
    id?: string;
    boardId?: string | null;
  }): string | undefined => {
    if (!refTicket?.id) {
      return undefined;
    }
    const boardId = refTicket.boardId || ticket.boardId;
    return `/projects/${ticket.projectId}/${boardId}/${refTicket.id}`;
  };

  const getReferenceTitle = (refTicket?: {
    title?: string | null;
    xyneId?: string | null;
    id?: string;
  }): string => {
    return refTicket?.title || refTicket?.xyneId || refTicket?.id || 'Unknown ticket';
  };

  const handleUnmerge = async (sourceTicketId: string): Promise<void> => {
    try {
      await apiInstance.post(`/tickets/${sourceTicketId}/unmerge`);
      toast.success('Ticket unmerged successfully');
    } catch {
      toast.error('Failed to unmerge ticket');
    }
  };

  const handleSaveTitle = (): void => {
    if (titleValue.trim() && titleValue !== ticket.title) {
      if (isEmailDeskTicket) {
        const newTitle = titleValue.trim();
        setPendingTitleValue(newTitle);
        setEditingTitle(true);
        setTimeout(() => setShowTitleChangeConfirmDialog(true), 0);
        return;
      }
      void zero.mutate(
        mutators.ticket.update({
          id: ticket.id,
          title: titleValue.trim(),
          updatedAt: Date.now(),
        }),
      );
    }
    setEditingTitle(false);
  };

  const handleSaveDescription = (): void => {
    if (descriptionValue !== ticket.description) {
      void zero.mutate(
        mutators.ticket.update({
          id: ticket.id,
          description: descriptionValue.trim(),
          updatedAt: Date.now(),
        }),
      );
    }
    setEditingDescription(false);
  };

  const handlePriorityChange = (priority: string): void => {
    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        priority: priority as TicketPriority,
        updatedAt: Date.now(),
      }),
    );
  };

  const handleAssigneeChange = (userId: string | null): void => {
    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        assignedTo: userId,
        updatedAt: Date.now(),
      }),
    );
  };

  const handleTicketTypeChange = (type: string): void => {
    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        ticketType: type,
        updatedAt: Date.now(),
      }),
    );
  };

  const handleUserGroupChange = (groupId: string | null): void => {
    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        userGroupId: groupId ?? undefined,
        updatedAt: Date.now(),
      }),
    );
  };

  const handleStageChange = (stageName: string): void => {
    if (!ticket) return;

    // Find the stage's default ticket status
    const boardStages = stages; // Use the current board's stages, not related tickets
    const targetStage = boardStages?.find(s => s.name === stageName);
    const currentStage = boardStages?.find(s => s.name === ticket.stageName);
    const newStatus = targetStage?.defaultTicketStatusV2;

    // Check if target stage requires approval (has approvers)
    const targetStageApprovers = targetStage?.approvers;
    const targetStageFormId = targetStage ? stageFormMap.get(targetStage.id) : undefined;
    const hasApprovers = targetStageApprovers && targetStageApprovers.length > 0;

    // CASE 1: Target stage has a form → open form modal regardless of approval settings
    if (targetStageFormId && currentStage && targetStage) {
      // Enforce sequential movement when form exists
      const isMovingBackward = targetStage.sequenceNumber < currentStage.sequenceNumber;

      if (isMovingBackward) {
        setBackwardStageChange({
          stageName,
          fromSequenceNumber: targetStage.sequenceNumber,
          ...(newStatus !== undefined && { newStatus }),
        });
        setShowBackwardConfirmDialog(true);
        return;
      }

      const isNextStage = targetStage.sequenceNumber === currentStage.sequenceNumber + 1;

      if (!isNextStage) {
        toast.error('Sequential movement only', {
          description: 'You can only move to the next stage',
        });
        return;
      }

      // Open form modal for everyone (approvers and non-approvers)
      const existingRequest = ticket.ticketStageRequests?.find(r => r.stageId === targetStage.id);
      setStageFormModal({
        ticket,
        targetStage,
        sourceStageName: currentStage.name,
        formId: targetStageFormId,
        isReviewer: false,
        hasApprovers: hasApprovers ?? false,
        existingRequest: existingRequest || null,
      });
      return;
    }

    // CASE 2: Board has approval workflow and target stage has approvers (but no form)
    if (shouldEnforceSequentialMovement && currentStage && targetStage && hasApprovers) {
      const isMovingBackward = targetStage.sequenceNumber < currentStage.sequenceNumber;

      if (isMovingBackward) {
        setBackwardStageChange({
          stageName,
          fromSequenceNumber: targetStage.sequenceNumber,
          ...(newStatus !== undefined && { newStatus }),
        });
        setShowBackwardConfirmDialog(true);
        return;
      }

      const isNextStage = targetStage.sequenceNumber === currentStage.sequenceNumber + 1;

      if (!isNextStage) {
        toast.error('Sequential movement only', {
          description: 'You can only move to the next stage',
        });
        return;
      }

      // Stage has approvers but no form
      const targetStageApproversList = targetStage.approvers;
      const isApprover = targetStageApproversList.some(a => a.userId === currentUser?.id);

      if (!isApprover) {
        const ticketStageRequests = (
          ticket as Ticket & { ticketStageRequests?: readonly TicketStageRequest[] }
        )?.ticketStageRequests;
        const rejectedRequest = ticketStageRequests?.find(
          (s: TicketStageRequest) =>
            s.stageId === targetStage.id &&
            s.status === TicketStageRequestStatus.REJECTED &&
            !s.formId,
        );

        if (rejectedRequest) {
          // Update the rejected request to submitted
          void zero.mutate(
            mutators.ticketStageRequest.upsert({
              id: rejectedRequest.id,
              ticketId: ticket.id,
              stageId: targetStage.id,
              status: TicketStageRequestStatus.SUBMITTED,
              updatedBy: currentUser?.id || '',
              updatedAt: Date.now(),
              requestActivityId: uuidv4(),
            }),
          );
          toast.success('Approval Requested', {
            description: 'Your stage change has been resubmitted for approval.',
          });
        } else {
          // Create a new approval request
          void zero.mutate(
            mutators.ticketStageRequest.upsert({
              id: uuidv4(),
              ticketId: ticket.id,
              stageId: targetStage.id,
              status: TicketStageRequestStatus.SUBMITTED,
              updatedBy: currentUser?.id || '',
              updatedAt: Date.now(),
              requestActivityId: uuidv4(),
            }),
          );
          toast.success('Approval Requested', {
            description: 'Your stage change has been submitted for approval.',
          });
        }
        return;
      }
    }

    // CASE 3: Board has approval workflow - check movement restrictions even for stages without approvers/forms
    if (shouldEnforceSequentialMovement && currentStage && targetStage) {
      // Check if moving backward
      const isMovingBackward = targetStage.sequenceNumber < currentStage.sequenceNumber;

      if (isMovingBackward) {
        // Show confirmation dialog
        setBackwardStageChange({
          stageName,
          fromSequenceNumber: targetStage.sequenceNumber,
          ...(newStatus !== undefined && { newStatus }),
        });
        setShowBackwardConfirmDialog(true);
        return;
      }
      const isNextStage = targetStage.sequenceNumber === currentStage.sequenceNumber + 1;

      if (!isNextStage) {
        toast.error('Sequential movement only', {
          description: 'You can only move to the next stage',
        });
        return;
      }
    }

    // Default: Direct stage update
    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        stageName,
        ...(newStatus && { statusV2: newStatus }),
        updatedAt: Date.now(),
      }),
    );
  };

  const handleStageETAChange = (): void => {
    if (!ticket) {
      setEditingStageETA(false);
      return;
    }

    // Get current stage info
    const currentStage = stages?.find(s => s.name === ticket.stageName);
    if (!currentStage) {
      setEditingStageETA(false);
      return;
    }

    const originalStageETA = currentStageEntry?.stageEta
      ? getLocalISOString(currentStageEntry.stageEta)
      : '';

    if (stageEtaValue.trim() === originalStageETA) {
      setEditingStageETA(false);
      return;
    }

    if (!stageEtaValue.trim()) {
      setEditingStageETA(false);
      return;
    }

    const newStageEtaDate = new Date(stageEtaValue);
    if (isNaN(newStageEtaDate.getTime())) {
      setEditingStageETA(false);
      return;
    }

    // Use existing entry ID or generate a new one
    const entryId = currentStageEntry?.id || uuidv4();

    void zero.mutate(
      mutators.ticketStageEta.update({
        id: entryId,
        stageEta: newStageEtaDate.getTime(),
        updatedAt: Date.now(),
        ticketId: ticket.id,
        stageId: currentStage.id,
      }),
    );

    setEditingStageETA(false);
  };

  const handleETAChange = (): void => {
    if (!ticket) {
      setEditingETA(false);
      return;
    }

    const originalETA = ticket.eta ? getLocalISOString(ticket.eta) : '';

    if (etaValue.trim() === originalETA) {
      setEditingETA(false);
      return;
    }

    const updateData: {
      id: string;
      updatedAt: number;
      eta?: number;
    } = {
      id: ticket.id,
      updatedAt: Date.now(),
    };

    if (!etaValue.trim()) {
      // Clear the ETA - omit eta field entirely
      setEditingETA(false);
    } else {
      const newETADate = new Date(etaValue);
      if (isNaN(newETADate.getTime())) {
        setEditingETA(false);
        return;
      }
      updateData.eta = newETADate.getTime();
    }

    void zero.mutate(mutators.ticket.update(updateData));
    setEditingETA(false);
  };

  const handleBoardChange = (boardId: string | null): void => {
    if (boardId && boardId !== ticket.boardId) {
      setPendingBoardChange(boardId);
      setShowBoardChangeConfirmDialog(true);
    }
  };

  const confirmBoardChange = (): void => {
    if (!pendingBoardChange || !ticket) return;

    zero.mutate(mutators.ticketStageRequest.deleteByTicketId({ ticketId: ticket.id }));

    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        boardId: pendingBoardChange,
        updatedAt: Date.now(),
      }),
    );

    setShowBoardChangeConfirmDialog(false);
    setPendingBoardChange(null);
  };

  const handleToggleTag = (tagName: string): void => {
    const existingTag = tags?.find(t => t.tagName === tagName);

    if (existingTag) {
      zero.mutate(
        mutators.ticketTagV2.delete({
          tagId: existingTag.id,
          mappingId: existingTag.id,
        }),
      );
    } else {
      zero.mutate(
        mutators.ticketTagV2.create({
          ticketId: ticket.id,
          tagId: uuidv4(),
          projectTagId: uuidv4(),
          mappingId: uuidv4(),
          projectId: ticket.projectId,
          tagName: tagName.trim(),
        }),
      );
    }

    setTagSearchQuery('');
  };

  const handleRemoveTag = (tagId: string): void => {
    zero.mutate(
      mutators.ticketTagV2.delete({
        tagId,
        mappingId: tagId,
      }),
    );
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && tagSearchQuery.trim()) {
      e.preventDefault();
      void handleToggleTag(tagSearchQuery);
    } else if (e.key === 'Escape') {
      setShowTagDropdown(false);
      setTagSearchQuery('');
    }
  };

  const handleArchiveTicket = (): void => {
    if (!ticket) return;

    if (
      ticket.statusV2 !== TicketStatusV2.COMPLETED &&
      ticket.statusV2 !== TicketStatusV2.CANCELLED
    ) {
      setShowArchiveConfirmDialog(false);
      toast.error('Cannot archive ticket', {
        description: 'Ticket must be in Completed or Cancelled status to be archived',
      });
      return;
    }
    setShowArchiveConfirmDialog(false);

    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        isArchived: true,
        updatedAt: Date.now(),
      }),
    );
    toast.success('Ticket archived successfully');
  };

  const handleMinimizeExpandedView = (): void => {
    if (!ticket) return;

    const state = location.state as {
      activeTab?: string;
      fromMyTickets?: boolean;
      returnToUrl?: string;
    } | null;
    const isFromMyTickets = !!state?.fromMyTickets;

    // On mobile: always navigate to ThreadMessages with details tab
    if (isMobile) {
      void navigate(
        buildChannelRoute(`${ticket.channelId}/${ticket.conversationId}/${ticket.id}`, {
          selectedTab: 'details',
        }),
      );
    } else if (isFromMyTickets) {
      // Desktop: Take them back to the My Tickets list
      void navigate(`/chat/my-tickets`);
    } else {
      // Desktop: Navigate to channel with ticket in minimized view
      // This mimics the behavior when clicking a ticket card from within the channel
      const activeTabParam = state?.activeTab
        ? `?selectedTab=${encodeURIComponent(state.activeTab)}`
        : '';
      void navigate(
        `${baseRoute}/${ticket.channelId}/${ticket.conversationId}/${ticket.id}${activeTabParam}`,
      );
    }
  };

  const handleBackFromExpandedView = (): void => {
    void navigate(-1);
  };

  const handleCopyTicketViewLink = (): void => {
    if (!ticket) return;

    // Use shareable origin from environment variable
    const minimizedTicketViewRoute = `${shareableOrigin}/chat/dir/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`;
    void navigator.clipboard.writeText(minimizedTicketViewRoute);
    toast.success('Link copied', {
      description: 'Ticket link copied to clipboard',
      duration: 3000,
    });
  };

  const handleFormFieldSave = (formEntityValueId: string, newValue: string[]): void => {
    // Check if this is a placeholder field (no existing record)
    const isPlaceholder = formEntityValueId.startsWith('placeholder-');
    const formFieldId = isPlaceholder ? formEntityValueId.replace('placeholder-', '') : '';

    if (isPlaceholder) {
      // Create a new form entity value record
      void zero.mutate(
        mutators.formEntityValue.create({
          id: uuidv4(),
          entityId: ticketId,
          entityType: FormEntityType.TICKET,
          fieldId: formFieldId,
          newValue,
          timestamp: Date.now(),
          contextId: ticket.boardId,
        }),
      );
    } else {
      // Update existing record
      void zero.mutate(
        mutators.formEntityValue.update({
          formEntityValueId,
          newValue,
          updatedAt: Date.now(),
        }),
      );
    }
  };

  const renderRelatedTicketRow = (
    reference: TicketReferenceWithTicket,
    relatedTicket:
      | TicketReferenceWithTicket['targetTicket']
      | TicketReferenceWithTicket['sourceTicket'],
    label: string,
    allowEdit: boolean,
    onUnmerge?: () => void,
  ): React.ReactElement => {
    const link = buildTicketLink(relatedTicket);
    const boardStages = relatedTicket?.boardId
      ? stagesByBoardId.get(relatedTicket.boardId)
      : undefined;
    const stageProgress = getStageProgress(relatedTicket?.stageName, boardStages);
    const displayProgress = stageProgress === 0 ? 1 : stageProgress;
    const assigneeId = relatedTicket?.assignedTo?.replace(/^(user:|group:)/, '') || '';
    const priorityIcon = relatedTicket?.priority ? getPriorityIcon(relatedTicket.priority) : null;

    return (
      <div key={reference.id} className='flex flex-col gap-2'>
        <div>
          {allowEdit ? (
            <div className='relative inline-flex items-center'>
              <select
                className='appearance-none pl-3 pr-8 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-lg shadow-sm'
                value={reference.relationType}
                onChange={event =>
                  handleReferenceRelationChange(
                    reference.id,
                    event.target.value as TicketReferenceRelation,
                  )
                }
                data-track-category='Tickets'
                data-track-name='ChangeReferenceRelation'
                data-track-metadata={JSON.stringify({ referenceId: reference.id })}
              >
                {referenceRelationOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className='pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground' />
            </div>
          ) : (
            <span className='inline-flex items-center px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground bg-background shadow-sm'>
              {label}
            </span>
          )}
        </div>

        <div className='relative group flex items-center justify-between gap-4 rounded-lg border border-border bg-muted px-3 py-2.5 shadow-sm'>
          <div className='flex items-center gap-3 min-w-0'>
            <TicketStageIcon progressPercentage={displayProgress} size={18} />
            <div className='flex items-center gap-4 min-w-0'>
              <span className='text-sm font-medium text-muted-foreground font-mono shrink-0'>
                {relatedTicket?.xyneId || relatedTicket?.id || '—'}
              </span>
              {link ? (
                onNavigateToTicket ? (
                  <button
                    type='button'
                    onClick={() => onNavigateToTicket(relatedTicket!.id!)}
                    className='text-sm font-normal text-foreground truncate hover:underline text-left'
                    data-track-category='Tickets'
                    data-track-name='NavigateToRelatedTicket'
                  >
                    {getReferenceTitle(relatedTicket)}
                  </button>
                ) : (
                  <Link className='text-sm font-normal text-foreground truncate' to={link}>
                    {getReferenceTitle(relatedTicket)}
                  </Link>
                )
              ) : (
                <span className='text-sm font-normal text-foreground truncate'>
                  {getReferenceTitle(relatedTicket)}
                </span>
              )}
            </div>
          </div>
          <div className='flex items-center gap-3 shrink-0'>
            {priorityIcon && <span className='flex items-center'>{priorityIcon}</span>}
            {assigneeId ? (
              <UserAvatar
                userId={assigneeId}
                size={AvatarSize.SM}
                shape={AvatarShape.ROUNDED}
                showActiveStatus={false}
              />
            ) : (
              <div className='h-7 w-7 rounded-lg border border-border bg-muted' />
            )}
          </div>
          {onUnmerge && (
            <button
              type='button'
              onClick={onUnmerge}
              className='text-sm text-primary hover:text-primary/80 font-medium whitespace-nowrap'
              data-track-category='Tickets'
              data-track-name='UnmergeTicket'
            >
              Unmerge
            </button>
          )}
          {allowEdit && (
            <button
              type='button'
              className='absolute right-[-20px] top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100'
              onClick={() => handleRemoveReference(reference.id)}
              aria-label='Remove reference'
              data-track-category='Tickets'
              data-track-name='RemoveReference'
              data-track-metadata={JSON.stringify({ referenceId: reference.id })}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className='mx-auto px-[24px] py-[20px] h-full overflow-scroll bg-background'>
      {expandedView && (
        <div className='flex items-center justify-between mb-6'>
          <div className='flex items-center gap-x-1/2'>
            <button
              onClick={handleBackFromExpandedView}
              data-track-category='Tickets'
              data-track-name='BackFromExpandedView'
            >
              <ChevronLeft size={18} className='text-foreground' />
            </button>
            <span className='text-[14px] font-medium text-foreground px-2 py-0.5'>
              {ticket.xyneId}
            </span>
          </div>
          <div className='flex items-center gap-x-2'>
            <Tooltip content='Copy Ticket Link'>
              <Button
                className='p-2 border border-border rounded-lg h-8 w-8'
                variant='ghost'
                size='sm'
                onClick={handleCopyTicketViewLink}
                aria-label='Copy Ticket'
              >
                <LinkIcon size={20} />
              </Button>
            </Tooltip>
            <Tooltip content='Summarize thread'>
              <Button
                variant='ghost'
                size='sm'
                className='p-2 border border-border rounded-lg h-8 w-8'
                onClick={() => {
                  void navigate(
                    `${baseRoute}/${ticket.channelId}/${ticket.conversationId}#thread-summary`,
                  );
                }}
                title='Summarize thread'
              >
                <Sparkles size={20} />
              </Button>
            </Tooltip>
            <Tooltip content='Trigger Workflow'>
              <Button
                className='p-2 border border-border rounded-lg h-8 w-8'
                variant='ghost'
                size='sm'
                onClick={() => setIsWorkflowModalOpen(true)}
                disabled={ticket?.isArchived}
                aria-label='Trigger Workflow'
              >
                <Play size={20} />
              </Button>
            </Tooltip>
            <Tooltip content={'Archive Ticket'}>
              <Button
                className='p-2 border border-border rounded-lg h-8 w-8'
                variant='ghost'
                size='sm'
                onClick={() => setShowArchiveConfirmDialog(true)}
                disabled={ticket?.isArchived}
                aria-label='Archive Ticket'
              >
                <Archive size={20} />
              </Button>
            </Tooltip>
            <Tooltip content='Minimize View'>
              <Button
                className='p-2 border border-border rounded-lg h-8 w-8'
                variant='ghost'
                size='sm'
                onClick={handleMinimizeExpandedView}
                aria-label='Copy Ticket'
              >
                <Minimize2 size={20} />
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      <div className='relative'>
        {/* Archived overlay - blocks all interactions on content */}
        {ticket?.isArchived && (
          <div
            className='absolute inset-0 z-50 cursor-not-allowed'
            style={{ backgroundColor: 'transparent' }}
          />
        )}

        <ApprovalNudgeBanner ticketId={ticket.id} className='mb-4' />

        {ticket?.isArchived && (
          <div className='mb-4 p-3 bg-muted border border-border rounded-lg flex items-center gap-3'>
            <Archive className='w-5 h-5 text-muted-foreground shrink-0' />
            <div className='flex-1'>
              <p className='text-sm font-medium text-foreground'>
                This ticket is archived and is Read-only
              </p>
            </div>
          </div>
        )}

        {/* Title Section */}
        <div className='flex items-start gap-3'>
          {editingTitle ? (
            <div className='flex-1 flex items-center gap-2'>
              <input
                ref={titleInputRef}
                type='text'
                value={titleValue}
                onChange={e => setTitleValue(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') {
                    setTitleValue(ticket.title);
                    setEditingTitle(false);
                  }
                }}
                className='flex-1 text-2xl font-semibold text-foreground outline-none bg-transparent'
                data-track-category='Tickets'
                data-track-name='EditTicketTitle'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
              />
            </div>
          ) : (
            <div
              role='button'
              tabIndex={0}
              className='text-[20px] font-semibold text-foreground flex-1 cursor-text px-2 -mx-2 break-all'
              onClick={() => setEditingTitle(true)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingTitle(true);
                }
              }}
              data-track-category='Tickets'
              data-track-name='StartEditTitle'
            >
              {ticket.title}
            </div>
          )}
        </div>
        <div>
          {editingDescription ? (
            <div className='bg-muted rounded-lg p-4 border border-input'>
              <textarea
                ref={descriptionTextareaRef}
                value={descriptionValue}
                onChange={e => setDescriptionValue(e.target.value)}
                onBlur={handleSaveDescription}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setDescriptionValue(ticket.description);
                    setEditingDescription(false);
                  }
                }}
                className='w-full text-sm text-foreground leading-relaxed outline-none bg-transparent resize-none min-h-[100px]'
                data-track-category='Tickets'
                data-track-name='EditDescription'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
              />
            </div>
          ) : (
            <div
              role='button'
              tabIndex={0}
              className='cursor-text my-3 text-foreground flex flex-col'
              onClick={() => setEditingDescription(true)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingDescription(true);
                }
              }}
              data-track-category='Tickets'
              data-track-name='StartEditDescription'
            >
              {!ticket.description ? (
                <p className='text-sm text-muted-foreground italic'>Add description</p>
              ) : (
                <>
                  <p
                    ref={descriptionRef}
                    className={cn(
                      'whitespace-pre-wrap text-foreground break-all text-sm',
                      !showFullDescription && 'overflow-hidden line-clamp-3 sm:line-clamp-3',
                    )}
                  >
                    <RenderMessageWithHTML message={ticket.description} />
                  </p>
                  {!showFullDescription && needsReadMore && (
                    <button
                      className='text-xs font-semibold cursor-pointer self-start underline py-1'
                      onClick={event => {
                        event.stopPropagation();
                        setShowFullDescription(true);
                      }}
                      data-track-category='Tickets'
                      data-track-name='ReadMoreDescription'
                    >
                      Read More
                    </button>
                  )}
                  {showFullDescription && (
                    <button
                      className='text-xs font-semibold cursor-pointer self-start underline py-1'
                      onClick={event => {
                        event.stopPropagation();
                        setShowFullDescription(false);
                      }}
                      data-track-category='Tickets'
                      data-track-name='ViewLessDescription'
                    >
                      View Less
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {/* Display Ticket Files */}
        {expandedView && ticketAttachments && ticketAttachments.length > 0 && (
          <div className='space-y-3'>
            {ticketAttachments.map(attachment => (
              <FileBubble
                key={attachment.id}
                createdBy={attachment.createdBy}
                createdAt={attachment.createdAt}
                attachment={attachment}
              />
            ))}
          </div>
        )}
        {/* Ticket MetaData Key Value */}
        <div className='flex flex-col gap-y-4 mt-8 mb-4 w-full'>
          {/* Left Column */}

          <div className='space-y-4'>
            {/* Assignee */}
            <TicketKeyValuePair
              ticketKey='Assignee'
              value={
                <UserSelector
                  selectedUserId={ticket.assignedTo ?? null}
                  onUserSelect={handleAssigneeChange}
                  noBorder={true}
                />
              }
            />

            {/* Manager - Only show if assigned */}
            {managerId && (
              <TicketKeyValuePair
                ticketKey='Manager'
                value={
                  <div className='flex items-center gap-2'>
                    <UserAvatar
                      userId={managerId}
                      size={AvatarSize.SM}
                      shape={AvatarShape.CIRCULAR}
                      showActiveStatus={false}
                    />
                    <span className='text-sm text-foreground'>
                      {users?.find((u: { id: string; name: string }) => u.id === managerId)?.name ||
                        'Unknown'}
                    </span>
                  </div>
                }
              />
            )}

            {/* PR Reviewers - Only show if assigned */}
            {prReviewerIds && prReviewerIds.length > 0 && (
              <TicketKeyValuePair
                ticketKey={prReviewerIds.length > 1 ? 'PR Reviewers' : 'PR Reviewer'}
                value={
                  <div className='flex flex-col gap-2'>
                    {prReviewerIds.map((reviewerId: string) => {
                      const reviewer = users?.find(
                        (u: { id: string; name: string }) => u.id === reviewerId,
                      );
                      return (
                        <div key={reviewerId} className='flex items-center gap-2'>
                          <UserAvatar
                            userId={reviewerId}
                            size={AvatarSize.SM}
                            shape={AvatarShape.CIRCULAR}
                            showActiveStatus={false}
                          />
                          <span className='text-sm text-foreground'>
                            {reviewer?.name || 'Unknown'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                }
              />
            )}

            {/* QA - Only show if assigned */}
            {qaId && (
              <TicketKeyValuePair
                ticketKey='QA'
                value={
                  <div className='flex items-center gap-2'>
                    <UserAvatar
                      userId={qaId}
                      size={AvatarSize.SM}
                      shape={AvatarShape.CIRCULAR}
                      showActiveStatus={false}
                    />
                    <span className='text-sm text-foreground'>
                      {users?.find((u: { id: string; name: string }) => u.id === qaId)?.name ||
                        'Unknown'}
                    </span>
                  </div>
                }
              />
            )}

            {/* Created At */}
            <TicketKeyValuePair
              ticketKey='Created at'
              value={<span>{formatTimestamp(ticket.createdAt)}</span>}
            />

            {/* Board */}
            <TicketKeyValuePair
              ticketKey='Board'
              value={
                <EntitySelector
                  options={(boards ?? []).map(board => ({
                    value: board.id,
                    label: board.name,
                    icon: <SquareKanban size={18} className='text-purple-600' />,
                  }))}
                  selectedValue={ticket.boardId ?? null}
                  onSelect={handleBoardChange}
                  placeholder='Select board'
                  searchPlaceholder='Search boards...'
                  isLoading={hasBoardDropdownOpened && !boards}
                  width='auto'
                  noBorder={true}
                  isOpen={boardDropdownOpen}
                  onOpenChange={open => {
                    setBoardDropdownOpen(open);
                    if (open && !hasBoardDropdownOpened) {
                      setHasBoardDropdownOpened(true);
                    }
                  }}
                />
              }
            />

            {/* Add Tag Button */}
            <TicketKeyValuePair
              ticketKey='Tags'
              value={
                <div className='relative flex items-center' ref={tagDropdownRef}>
                  {/* Tags */}
                  <div className='flex items-center gap-2 flex-wrap'>
                    {tags &&
                      tags.length > 0 &&
                      tags.map((tag, index) => {
                        const colors = [
                          {
                            bg: 'bg-cyan-400',
                            text: 'text-cyan-700',
                            icon: 'text-cyan-600',
                            hoverBg: 'hover:bg-cyan-200',
                          },
                          {
                            bg: 'bg-yellow-400',
                            text: 'text-yellow-700',
                            icon: 'text-yellow-600',
                            hoverBg: 'hover:bg-yellow-200',
                          },
                          {
                            bg: 'bg-purple-400',
                            text: 'text-purple-700',
                            icon: 'text-purple-600',
                            hoverBg: 'hover:bg-purple-200',
                          },
                          {
                            bg: 'bg-green-400',
                            text: 'text-green-700',
                            icon: 'text-green-600',
                            hoverBg: 'hover:bg-green-200',
                          },
                          {
                            bg: 'bg-pink-400',
                            text: 'text-pink-700',
                            icon: 'text-pink-600',
                            hoverBg: 'hover:bg-pink-200',
                          },
                          {
                            bg: 'bg-blue-400',
                            text: 'text-blue-700',
                            icon: 'text-blue-600',
                            hoverBg: 'hover:bg-blue-200',
                          },
                        ] as const;
                        const color = colors[index % colors.length]!;

                        return (
                          <span
                            key={tag.id}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 text-sm font-medium group relative rounded-[6px] border border-border bg-muted`}
                          >
                            {/* <Tag size={14} className={color.icon} /> */}
                            <div className={`w-2 h-2 rounded-full ${color.bg}`}></div>
                            {tag.tagName}
                            {
                              <button
                                onClick={() => void handleRemoveTag(tag.id)}
                                className={`ml-1 p-0.5 rounded transition-colors`}
                                aria-label='Remove tag'
                                data-track-category='Tickets'
                                data-track-name='RemoveTag'
                                data-track-metadata={JSON.stringify({
                                  tagId: tag.id,
                                  tagName: tag.tagName,
                                })}
                              >
                                <X size={12} />
                              </button>
                            }
                          </span>
                        );
                      })}
                    <button
                      onClick={() => setShowTagDropdown(!showTagDropdown)}
                      className='inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors'
                      aria-label='Add tag'
                      data-track-category='Tickets'
                      data-track-name='ToggleTagDropdown'
                      data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                    >
                      <Plus size={14} />
                      <span>Add</span>
                    </button>
                  </div>

                  {showTagDropdown && (
                    <div className='absolute top-full left-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-50 min-w-[250px] max-h-64 overflow-hidden'>
                      {/* Search Input */}
                      <div className='p-2 border-b border-border'>
                        <input
                          ref={tagInputRef}
                          type='text'
                          value={tagSearchQuery}
                          onChange={e => setTagSearchQuery(e.target.value)}
                          onKeyDown={handleTagKeyDown}
                          placeholder='Search or create tag...'
                          className='w-full px-2.5 py-1.5 text-sm border text-foreground bg-background border-input rounded outline-none focus:border-border'
                          data-track-category='Tickets'
                          data-track-name='SearchTags'
                        />
                      </div>

                      {/* Tag List */}
                      <div className='max-h-48 overflow-y-auto'>
                        {tagSearchQuery.trim() && !exactMatch && (
                          <button
                            onClick={() => void handleToggleTag(tagSearchQuery)}
                            className='w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 border-b border-border'
                            data-track-category='Tickets'
                            data-track-name='CreateTag'
                            data-track-metadata={JSON.stringify({ tagName: tagSearchQuery.trim() })}
                          >
                            <Plus size={14} className='text-foreground' />
                            <span className='text-foreground font-medium'>
                              Create &quot;{tagSearchQuery.trim()}&quot;
                            </span>
                          </button>
                        )}

                        {filteredTags.map(tagName => {
                          const isSelected = selectedTagNames.has(tagName);

                          return (
                            <button
                              key={tagName}
                              onClick={() => void handleToggleTag(tagName)}
                              className='w-full px-3 py-2 text-sm flex items-center justify-between hover:bg-muted'
                              data-track-category='Tickets'
                              data-track-name='ToggleTag'
                              data-track-metadata={JSON.stringify({
                                tagName,
                                isSelected: !isSelected,
                              })}
                            >
                              <div className='flex items-center gap-2'>
                                <Tag size={14} className='text-muted-foreground' />
                                <span>{tagName}</span>
                              </div>

                              {isSelected && (
                                <span className='text-sm'>
                                  <Check size={14} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              }
            />
          </div>

          {/* Right Column */}
          <div className='space-y-4'>
            {/* Stage */}
            <TicketKeyValuePair
              ticketKey='Status'
              value={
                <div
                  data-testid='ticket-detail-status-selector'
                  className='flex items-center gap-2'
                  data-track-event='SELECTOR_CHANGE'
                  data-track-category='TICKETS'
                  data-track-name='CHANGE_STATUS'
                  data-track-metadata={JSON.stringify({
                    ticketId: ticket.id,
                    boardId: ticket.boardId,
                    currentStatus: ticket.stageName,
                  })}
                >
                  <Selector
                    items={stages}
                    selectedValue={ticket.stageName}
                    onValueChange={handleStageChange}
                    placeholder='Set Status'
                    icon={<TicketStatusIcon size={14} />}
                    noBorder={true}
                    isItemDisabled={item => {
                      if (!shouldEnforceSequentialMovement) return false;
                      const currentStageSeq = stages?.find(
                        s => s.name === ticket.stageName,
                      )?.sequenceNumber;
                      if (currentStageSeq === undefined || item.sequenceNumber === undefined)
                        return false;

                      if (item.sequenceNumber > currentStageSeq) {
                        return item.sequenceNumber !== currentStageSeq + 1;
                      }
                      // Moving backward: allow to any previous stage
                      return false;
                    }}
                  />
                  {/* Show alert icon if there's a pending request for the next stage */}
                  {(() => {
                    if (!ticket.ticketStageRequests || !stagesWithFormInfo) return null;
                    const currentStage = stagesWithFormInfo.find(s => s.name === ticket.stageName);
                    if (!currentStage) return null;
                    const nextStage = stagesWithFormInfo.find(
                      s => s.sequenceNumber === currentStage.sequenceNumber + 1,
                    );
                    if (!nextStage) return null;
                    const hasPendingRequest = ticket.ticketStageRequests.some(
                      req =>
                        req.status === TicketStageRequestStatus.SUBMITTED &&
                        req.stageId === nextStage.id,
                    );
                    return hasPendingRequest ? (
                      <Tooltip content='Pending Status Approval'>
                        <AlertCircle size={14} className='text-orange-500' />
                      </Tooltip>
                    ) : null;
                  })()}
                </div>
              }
            />

            {/* Created By */}
            <TicketKeyValuePair
              ticketKey='Created by'
              value={
                <div className='items-center flex gap-2'>
                  <UserAvatar userId={createdByUser?.id || ''} shape={AvatarShape.CIRCULAR} />
                  {createdByUser?.name || 'Merchant User'}
                </div>
              }
            />

            {/* Priority */}
            <TicketKeyValuePair
              ticketKey='Priority'
              value={
                <div
                  data-testid='ticket-detail-priority-selector'
                  data-track-event='SELECTOR_CHANGE'
                  data-track-category='TICKETS'
                  data-track-name='CHANGE_PRIORITY'
                  data-track-metadata={JSON.stringify({
                    ticketId: ticket.id,
                    currentPriority: ticket.priority,
                  })}
                >
                  <Selector
                    items={priorityItems}
                    selectedValue={ticket.priority}
                    onValueChange={handlePriorityChange}
                    placeholder='Set Priority'
                    icon={<TicketPriorityIcon size={14} />}
                    noBorder={true}
                  />
                </div>
              }
            />

            {/* Ticket Type */}
            {ticket.ticketType && (
              <TicketKeyValuePair
                ticketKey='Type'
                value={
                  <Selector
                    items={ticketTypeOptions}
                    selectedValue={ticket.ticketType}
                    onValueChange={handleTicketTypeChange}
                    placeholder='Set Type'
                    noBorder={true}
                    isLoading={isTicketTypeLoading}
                    onOpenChange={open => {
                      if (open && !ticketTypeDropdownOpened) {
                        setTicketTypeDropdownOpened(true);
                      }
                    }}
                  />
                }
              />
            )}

            {/* Channel */}
            <TicketKeyValuePair
              ticketKey='Channel'
              value={<p>{channel ? `${channel.name}` : 'XyneSpace'}</p>}
            />

            {/* ETA */}
            <TicketKeyValuePair
              ticketKey='Due Date'
              value={
                editingETA ? (
                  <div className='flex items-center gap-2' data-testid='ticket-detail-eta-input'>
                    <input
                      ref={etaInputRef}
                      type='datetime-local'
                      value={etaValue}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={e => setEtaValue(e.target.value)}
                      onBlur={handleETAChange}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleETAChange();
                        if (e.key === 'Escape') {
                          setEtaValue(ticket.eta ? getLocalISOString(ticket.eta) : '');
                          setEditingETA(false);
                        }
                      }}
                      className='text-sm text-foreground bg-background border border-input rounded px-2 py-1 outline-none focus:border-border'
                      data-track-category='Tickets'
                      data-track-name='StageETAInput'
                      data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                    />
                  </div>
                ) : (
                  <div
                    role='button'
                    tabIndex={0}
                    data-testid='ticket-detail-eta-display'
                    className='inline-flex items-center gap-1.5 text-sm text-foreground cursor-pointer hover:bg-muted px-2 py-1 -mx-2 rounded-md border border-transparent hover:border-border transition-colors'
                    data-track-category='TicketDetails'
                    data-track-name='EditStageETA'
                    data-track-metadata={JSON.stringify({
                      ticketId: ticket.id,
                      stageId: currentStageEntry?.stageId,
                    })}
                    onClick={() => {
                      if (ticket.eta) {
                        setEtaValue(getLocalISOString(ticket.eta));
                      }
                      setEditingETA(true);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (ticket.eta) {
                          setEtaValue(getLocalISOString(ticket.eta));
                        }
                        setEditingETA(true);
                      }
                    }}
                  >
                    <Calendar
                      size={14}
                      className={
                        ticket.eta &&
                        new Date(ticket.eta) < new Date() &&
                        ticket.statusV2 !== TicketStatusV2.COMPLETED &&
                        ticket.statusV2 !== TicketStatusV2.CANCELLED
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }
                    />
                    <span>{ticket.eta ? formatETADisplay(ticket.eta) : 'Set Due Date'}</span>
                    {ticket.eta &&
                      new Date(ticket.eta) < new Date() &&
                      ticket.statusV2 !== TicketStatusV2.COMPLETED &&
                      ticket.statusV2 !== TicketStatusV2.CANCELLED && (
                        <span className='inline-flex items-center px-1.5 py-0.5 text-xs font-medium bg-destructive/10 text-destructive rounded'>
                          Overdue
                        </span>
                      )}
                  </div>
                )
              }
            />
            {/* Status Deadline - only show if current stage has eta configured */}
            {currentStageInfo?.eta && (
              <TicketKeyValuePair
                ticketKey='Status Deadline'
                value={
                  editingStageETA ? (
                    <div
                      className='flex items-center gap-2'
                      data-testid='ticket-detail-stage-eta-input'
                    >
                      <input
                        ref={stageEtaInputRef}
                        type='datetime-local'
                        value={stageEtaValue}
                        onChange={e => setStageEtaValue(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        onBlur={handleStageETAChange}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleStageETAChange();
                          if (e.key === 'Escape') {
                            setStageEtaValue(
                              currentStageEntry?.stageEta
                                ? getLocalISOString(currentStageEntry.stageEta)
                                : '',
                            );
                            setEditingStageETA(false);
                          }
                        }}
                        className='text-sm border border-input rounded px-2 py-1 outline-none focus:border-border'
                        data-track-category='Tickets'
                        data-track-name='StageETAInput'
                        data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                      />
                    </div>
                  ) : (
                    <div
                      role='button'
                      tabIndex={0}
                      data-testid='ticket-detail-stage-eta-display'
                      className='inline-flex items-center gap-1.5 text-sm text-foreground cursor-pointer hover:bg-muted px-2 py-1 -mx-2 rounded-md border border-transparent hover:border-border transition-colors'
                      onClick={() => {
                        if (currentStageEntry?.stageEta) {
                          setStageEtaValue(getLocalISOString(currentStageEntry.stageEta));
                        }
                        setEditingStageETA(true);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (currentStageEntry?.stageEta) {
                            setStageEtaValue(getLocalISOString(currentStageEntry.stageEta));
                          }
                          setEditingStageETA(true);
                        }
                      }}
                      data-track-category='Tickets'
                      data-track-name='EditStageDeadline'
                      data-track-metadata={JSON.stringify({
                        ticketId: ticket.id,
                        stageId: currentStageEntry?.stageId,
                      })}
                    >
                      <Clock
                        size={14}
                        className={
                          currentStageEntry?.stageEta &&
                          new Date(currentStageEntry.stageEta) < new Date() &&
                          ticket.statusV2 !== TicketStatusV2.COMPLETED &&
                          ticket.statusV2 !== TicketStatusV2.CANCELLED
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }
                      />
                      <span>
                        {currentStageEntry?.stageEta
                          ? formatETADisplay(currentStageEntry.stageEta)
                          : 'Set Stage Deadline'}
                      </span>
                      {currentStageEntry?.stageEta &&
                        new Date(currentStageEntry.stageEta) < new Date() &&
                        ticket.statusV2 !== TicketStatusV2.COMPLETED &&
                        ticket.statusV2 !== TicketStatusV2.CANCELLED && (
                          <span className='inline-flex items-center px-1.5 py-0.5 text-xs font-medium bg-destructive/10 text-destructive rounded'>
                            Stage Overdue
                          </span>
                        )}
                    </div>
                  )
                }
              />
            )}

            {/* Projected deadline (while PAUSED) */}
            {ticket.statusV2 === TicketStatusV2.PAUSED && (
              <TicketKeyValuePair
                ticketKey='projected deadline'
                value={
                  ticket.statusUpdatedAt ? (
                    (() => {
                      const pausedDurationMs = calculateWorkingDurationMs(
                        new Date(ticket.statusUpdatedAt),
                        new Date(Date.now()),
                      );

                      const projectedEta =
                        ticket.eta && pausedDurationMs > 0
                          ? calculateETADeadline(
                              new Date(Math.max(ticket.eta, ticket.statusUpdatedAt)),
                              pausedDurationMs / (60 * 60 * 1000),
                            ).getTime()
                          : (ticket.eta ?? null);

                      return (
                        <div className='inline-flex items-center gap-2 text-sm text-foreground'>
                          <span>{formatETADisplay(projectedEta ?? undefined)}</span>
                        </div>
                      );
                    })()
                  ) : (
                    <span className='text-sm text-muted-foreground'>-</span>
                  )
                }
              />
            )}

            {/* User Group */}
            <TicketKeyValuePair
              ticketKey='User Group'
              value={
                <UserGroupSelector
                  selectedGroupId={ticket.userGroupId ?? null}
                  onGroupSelect={handleUserGroupChange}
                />
              }
            />
          </div>
        </div>

        {/* Merchant ID */}
        {ticket.merchantId && (
          <TicketKeyValuePair
            ticketKey='Merchant ID'
            value={<span className='text-sm text-muted-foreground'>{ticket.merchantId}</span>}
          />
        )}

        {/* AI Classification Panel */}
        {ticket?.classificationData && channelId && (
          <div className='my-4'>
            <AIClassificationPanel
              ticketId={ticket.id}
              channelId={channelId}
              classificationData={ticket.classificationData as unknown as TicketClassificationData}
              userGroups={userGroups.map(g => ({ id: g.id, name: g.name }))}
              hasFormFields={!!(allFormFields && allFormFields.length > 0)}
            />
          </div>
        )}

        {/* Additional Form Fields */}
        {allFormFields && allFormFields.length > 0 && (
          <div className='border border-border bg-muted rounded-lg p-4 my-4'>
            <h3 className='text-base font-semibold text-foreground mb-4'>Additional Form Fields</h3>
            <div className='space-y-4'>
              {allFormFields.map(fieldValue => (
                <EditableFormField
                  key={fieldValue.id}
                  fieldName={fieldValue.formField?.fieldName || 'Unknown Field'}
                  fieldValue={fieldValue.actualFieldValue ?? fieldValue.fieldValue}
                  fieldType={
                    (fieldValue.formField?.fieldType as FormFieldType) || FormFieldType.STRING
                  }
                  fieldEnum={fieldValue.formField?.fieldEnum as string[] | undefined}
                  onSave={newValue => handleFormFieldSave(fieldValue.id, newValue)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Stage Forms Section */}
        {formsToShow.length > 0 && (
          <div className='my-4'>
            <div className='flex items-center gap-3 mb-4'>
              <p className='text-base font-semibold text-foreground'>Status Change Requests</p>
              <span className='inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                {formsToShow.length}
              </span>
            </div>

            <div className='space-y-1'>
              {formsToShow
                .sort((a, b) => b.createdAt - a.createdAt)
                .map(item => {
                  const stage = stagesWithFormInfo?.find(s => s.id === item.stageId);
                  const isSubmitted = item.status === TicketStageRequestStatus.SUBMITTED;
                  const isRejected = item.status === TicketStageRequestStatus.REJECTED;
                  const isApproved = item.status === TicketStageRequestStatus.APPROVED;
                  const isDraft = item.status === TicketStageRequestStatus.DRAFT;
                  const isApprover =
                    stage?.approvers?.some(a => a.userId === currentUser?.id) ?? false;
                  const hasApprovers = stage?.approvers && stage.approvers.length > 0;

                  // Find previous stage
                  const currentStageSeq = stage?.sequenceNumber ?? 0;
                  const previousStage = stagesWithFormInfo?.find(
                    s => s.sequenceNumber === currentStageSeq - 1,
                  );

                  return (
                    <div key={item.id} className='py-2'>
                      <div className='flex items-center justify-between gap-4'>
                        <div className='flex items-center gap-4 flex-1 min-w-0'>
                          {/* Form Name or Stage Name */}
                          <p className='text-base font-medium text-foreground'>
                            {item.formId
                              ? (item.form?.formName ?? 'Form')
                              : `Stage: ${stage?.name || 'Unknown Stage'}`}
                          </p>

                          {/* Old Stage -> New Stage */}
                          <p className='text-sm text-muted-foreground'>
                            {previousStage?.name || 'Start'} &rarr; {stage?.name || 'Unknown Stage'}
                          </p>

                          {/* Status Badge - only show for stages with approvers */}
                          {hasApprovers &&
                            item.status &&
                            (() => {
                              const config = getStatusBadgeConfig(item.status);
                              return config ? (
                                <span className={config.className.replace('text-xs', 'text-sm')}>
                                  {config.label}
                                </span>
                              ) : null;
                            })()}
                        </div>

                        {/* Action Buttons */}
                        <div className='flex items-center gap-2 shrink-0'>
                          {hasApprovers ? (
                            // Stages WITH approvers: Show approval workflow buttons
                            <>
                              {/* Draft status - allow user to continue/edit the form */}
                              {isDraft && item.formId && (
                                <button
                                  onClick={() =>
                                    setStageFormModal({
                                      ticket,
                                      targetStage: stage ?? {
                                        id: item.stageId,
                                        name: 'Unknown Stage',
                                        sequenceNumber: 0,
                                        boardId: ticket.boardId || '',
                                      },
                                      sourceStageName: previousStage?.name || 'Unknown Stage',
                                      formId: item.formId,
                                      isReviewer: false,
                                      hasApprovers: true,
                                      existingRequest: item.request!,
                                    })
                                  }
                                  className='text-sm text-foreground hover:text-muted-foreground font-medium whitespace-nowrap'
                                  data-track-category='Tickets'
                                  data-track-name='ContinueDraftStageForm'
                                  data-track-metadata={JSON.stringify({
                                    stageId: item.stageId,
                                    formId: item.formId,
                                  })}
                                >
                                  Continue Draft
                                </button>
                              )}
                              {isDraft && !item.formId && (
                                <button
                                  onClick={() => {
                                    void zero.mutate(
                                      mutators.ticketStageRequest.upsert({
                                        id: item.id,
                                        ticketId: ticket.id,
                                        stageId: item.stageId,
                                        status: TicketStageRequestStatus.SUBMITTED,
                                        updatedBy: currentUser?.id || '',
                                        updatedAt: Date.now(),
                                        requestActivityId: uuidv4(),
                                      }),
                                    );
                                    toast.success('Request submitted for approval');
                                  }}
                                  className='text-sm text-foreground hover:text-muted-foreground font-medium whitespace-nowrap'
                                  data-track-category='Tickets'
                                  data-track-name='SubmitStageRequest'
                                  data-track-metadata={JSON.stringify({ stageId: item.stageId })}
                                >
                                  Submit Request
                                </button>
                              )}
                              {isSubmitted && item.formId && (
                                <>
                                  {!isApprover && (
                                    <button
                                      onClick={() =>
                                        setStageFormModal({
                                          ticket,
                                          targetStage: stage ?? {
                                            id: item.stageId,
                                            name: 'Unknown Stage',
                                            sequenceNumber: 0,
                                            boardId: ticket.boardId || '',
                                          },
                                          sourceStageName: previousStage?.name || 'Unknown Stage',
                                          formId: item.formId,
                                          isReviewer: false,
                                          hasApprovers: true,
                                        })
                                      }
                                      className='text-muted-foreground hover:text-foreground transition-colors border border-input rounded-md p-1.5'
                                      aria-label='View form'
                                      data-track-category='Tickets'
                                      data-track-name='ViewStageForm'
                                      data-track-metadata={JSON.stringify({
                                        stageId: item.stageId,
                                        formId: item.formId,
                                      })}
                                    >
                                      <Eye size={16} />
                                    </button>
                                  )}
                                  {isApprover && (
                                    <button
                                      onClick={() =>
                                        setStageFormModal({
                                          ticket,
                                          targetStage: stage ?? {
                                            id: item.stageId,
                                            name: 'Unknown Stage',
                                            sequenceNumber: 0,
                                            boardId: ticket.boardId || '',
                                          },
                                          sourceStageName: previousStage?.name || 'Unknown Stage',
                                          formId: item.formId,
                                          isReviewer: true,
                                          hasApprovers: true,
                                          existingRequest: item.request!,
                                        })
                                      }
                                      className='text-sm font-medium whitespace-nowrap px-3 py-1.5 rounded-lg flex items-center gap-2 bg-blue-500 text-white hover:bg-blue-600'
                                      data-track-category='Tickets'
                                      data-track-name='ReviewStageForm'
                                      data-track-metadata={JSON.stringify({
                                        stageId: item.stageId,
                                        formId: item.formId,
                                      })}
                                    >
                                      View request
                                    </button>
                                  )}
                                </>
                              )}
                              {isApproved && item.formId && (
                                <button
                                  onClick={() =>
                                    setStageFormModal({
                                      ticket,
                                      targetStage: stage ?? {
                                        id: item.stageId,
                                        name: 'Unknown Stage',
                                        sequenceNumber: 0,
                                        boardId: ticket.boardId || '',
                                      },
                                      sourceStageName: previousStage?.name || 'Unknown Stage',
                                      formId: item.formId,
                                      isReviewer: false,
                                      hasApprovers: true,
                                      existingRequest: item.request!,
                                    })
                                  }
                                  className='text-muted-foreground hover:text-foreground transition-colors border border-input rounded-md p-1.5'
                                  aria-label='View form'
                                  data-track-category='Tickets'
                                  data-track-name='ViewApprovedStageForm'
                                  data-track-metadata={JSON.stringify({
                                    stageId: item.stageId,
                                    formId: item.formId,
                                  })}
                                >
                                  <Eye size={16} />
                                </button>
                              )}
                              {isSubmitted && !item.formId && isApprover && (
                                <>
                                  <button
                                    onClick={() =>
                                      void zero.mutate(
                                        mutators.ticketStageRequest.upsert({
                                          id: item.id,
                                          ticketId: ticket.id,
                                          stageId: item.stageId,
                                          status: TicketStageRequestStatus.APPROVED,
                                          updatedBy: currentUser?.id || '',
                                          updatedAt: Date.now(),
                                          approvedActivityId: uuidv4(),
                                        }),
                                      )
                                    }
                                    className='text-sm font-medium whitespace-nowrap px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600'
                                    data-track-category='Tickets'
                                    data-track-name='ApproveStageRequest'
                                    data-track-metadata={JSON.stringify({ stageId: item.stageId })}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() =>
                                      void zero.mutate(
                                        mutators.ticketStageRequest.upsert({
                                          id: item.id,
                                          ticketId: ticket.id,
                                          stageId: item.stageId,
                                          status: TicketStageRequestStatus.REJECTED,
                                          updatedBy: currentUser?.id || '',
                                          updatedAt: Date.now(),
                                          rejectedActivityId: uuidv4(),
                                        }),
                                      )
                                    }
                                    className='text-sm font-medium whitespace-nowrap px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600'
                                    data-track-category='Tickets'
                                    data-track-name='RejectStageRequest'
                                    data-track-metadata={JSON.stringify({ stageId: item.stageId })}
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                              {isRejected && item.formId && (
                                <button
                                  onClick={() =>
                                    setStageFormModal({
                                      ticket,
                                      targetStage: stage ?? {
                                        id: item.stageId,
                                        name: 'Unknown Stage',
                                        sequenceNumber: 0,
                                        boardId: ticket.boardId || '',
                                      },
                                      sourceStageName: previousStage?.name || 'Unknown Stage',
                                      formId: item.formId,
                                      isReviewer: isApprover,
                                      hasApprovers: true,
                                      existingRequest: item.request!,
                                    })
                                  }
                                  className='text-sm text-foreground hover:text-muted-foreground font-medium whitespace-nowrap'
                                  data-track-category='Tickets'
                                  data-track-name='ResubmitStageForm'
                                  data-track-metadata={JSON.stringify({
                                    stageId: item.stageId,
                                    formId: item.formId,
                                  })}
                                >
                                  Resubmit
                                </button>
                              )}
                              {isRejected && !item.formId && (
                                <button
                                  onClick={() => {
                                    void zero.mutate(
                                      mutators.ticketStageRequest.upsert({
                                        id: item.id,
                                        ticketId: ticket.id,
                                        stageId: item.stageId,
                                        status: TicketStageRequestStatus.SUBMITTED,
                                        updatedBy: currentUser?.id || '',
                                        updatedAt: Date.now(),
                                        requestActivityId: uuidv4(),
                                      }),
                                    );
                                    toast.success('Stage change request resubmitted for approval');
                                  }}
                                  className='text-sm text-foreground hover:text-muted-foreground font-medium whitespace-nowrap'
                                  data-track-category='Tickets'
                                  data-track-name='ResubmitStageRequest'
                                  data-track-metadata={JSON.stringify({ stageId: item.stageId })}
                                >
                                  Resubmit request
                                </button>
                              )}
                            </>
                          ) : (
                            // Stages WITHOUT approvers: Just show View Form button
                            <button
                              onClick={() =>
                                setStageFormModal({
                                  ticket,
                                  targetStage: stage ?? {
                                    id: item.stageId,
                                    name: 'Unknown Stage',
                                    sequenceNumber: 0,
                                    boardId: ticket.boardId || '',
                                    eta: null,
                                  },
                                  sourceStageName: previousStage?.name || 'Unknown Stage',
                                  formId: item.formId,
                                  isReviewer: false,
                                  hasApprovers: false,
                                  existingRequest: item.request!,
                                })
                              }
                              className='text-muted-foreground hover:text-foreground transition-colors border border-input rounded-md p-1.5'
                              aria-label='View form'
                              data-track-category='Tickets'
                              data-track-name='ViewStageFormNoApprovers'
                              data-track-metadata={JSON.stringify({
                                stageId: item.stageId,
                                formId: item.formId,
                              })}
                            >
                              <Eye size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Fill RCA Button - shown for Fix tickets */}
        {ticket?.ticketType === BaseTicketType.Fix && (
          <div className='mt-6'>
            <button
              type='button'
              onClick={handleOpenRcaPanel}
              data-track-category='Tickets'
              data-track-name={rcaTrackName}
              data-testid='fill-rca-button'
              className='group flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground shadow-sm hover:shadow-md hover:border-input transition-all'
            >
              <span className='inline-flex items-center gap-3'>
                <span className='flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground'>
                  <ClipboardCheck size={18} />
                </span>
                <span className='flex flex-col text-left'>
                  <span className='text-sm font-semibold text-foreground'>{rcaButtonTitle}</span>
                  <span className='text-xs text-muted-foreground'>{rcaButtonSubtitle}</span>
                </span>
              </span>
              <ArrowRight className='h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5' />
            </button>
          </div>
        )}

        {/* Generate/View Release Notes Button - shown for completed Release/Hotfix tickets */}
        {ticket &&
          isReleaseTicket(ticket.ticketType as BaseTicketType) &&
          ticket.statusV2 === TicketStatusV2.COMPLETED && (
            <div className='mt-4'>
              <ReleaseNotesButton
                metadata={
                  ticket.metadata as {
                    releaseNotesCanvasUrl?: string;
                    isGeneratingReleaseNotes?: boolean;
                  } | null
                }
                onGenerate={async () => await generateReleaseNotes(ticketId)}
                isGeneratingReleaseNotes={isGeneratingReleaseNotes}
                onGeneratingChange={setIsGeneratingReleaseNotes}
              />
            </div>
          )}

        {/* Sub-Tickets Section */}
        <div className='mt-6 space-y-6' data-testid='sub-tickets-section'>
          <div>
            <div className='flex items-center gap-3'>
              <p className='text-base font-semibold text-foreground'>Sub-Tickets</p>
              <span
                className='inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                data-testid='sub-tickets-count'
              >
                {subTickets.length}
              </span>
            </div>

            <div className='mt-4 space-y-3' data-testid='sub-tickets-list'>
              {subTickets.length > 0 ? (
                <div className='space-y-2'>
                  {subTickets.map(subTicket => {
                    // Extract mappedTicket once
                    const mappedTicket = subTicket?.mappedTicket;

                    const displayId =
                      mappedTicket?.xyneId || subTicket.id.substring(0, 8).toUpperCase();
                    const displayTitle = mappedTicket?.title || subTicket.title;

                    // Calculate stage progress using existing helper
                    const boardStages = mappedTicket?.boardId
                      ? stagesByBoardId.get(mappedTicket.boardId)
                      : undefined;
                    const stageProgress = getStageProgress(mappedTicket?.stageName, boardStages);
                    const displayProgress = stageProgress === 0 ? 1 : stageProgress;

                    const priority = mappedTicket?.priority;
                    const assignedTo = mappedTicket?.assignedTo;
                    const priorityIcon = priority ? getPriorityIcon(priority) : null;
                    const assigneeId = assignedTo?.replace(/^(user:|group:)/, '') || '';

                    const handleClick = (): void => {
                      if (subTicket.mappedTicketId) {
                        if (onNavigateToTicket) {
                          onNavigateToTicket(subTicket.mappedTicketId);
                        } else {
                          setMappedTicketId(subTicket.mappedTicketId);
                        }
                      } else {
                        setSelectedSubTicket(subTicket);
                        setIsCreateTicketModalOpen(true);
                      }
                    };

                    return (
                      <div
                        key={subTicket.id}
                        role='button'
                        tabIndex={0}
                        onClick={handleClick}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleClick();
                          }
                        }}
                        data-testid={`sub-ticket-item-${subTicket.id}`}
                        data-track-category='Tickets'
                        data-track-name='OpenSubTicket'
                        data-track-metadata={JSON.stringify({
                          subTicketId: subTicket.id,
                          mappedTicketId: subTicket.mappedTicketId,
                        })}
                        className='flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted transition-colors cursor-pointer'
                      >
                        <div className='flex items-center gap-3 flex-1 min-w-0'>
                          <span className='text-xs font-medium text-muted-foreground whitespace-nowrap'>
                            {displayId}
                          </span>
                          <span className='text-sm text-foreground truncate'>{displayTitle}</span>
                          {subTicket.mappedTicketId && (
                            <FileText size={14} className='text-blue-600 flex-shrink-0' />
                          )}
                        </div>
                        <div className='flex items-center gap-3 shrink-0'>
                          {/* Stage progress using TicketStatusIcon */}
                          {boardStages && boardStages.length > 0 && (
                            <div className='flex items-center gap-1.5'>
                              <TicketStageIcon progressPercentage={displayProgress} size={18} />
                              <span className='text-xs font-medium text-foreground whitespace-nowrap'>
                                {boardStages.findIndex(s => s.name === mappedTicket?.stageName) + 1}
                                /{boardStages.length}
                              </span>
                            </div>
                          )}
                          {priorityIcon && (
                            <span className='flex items-center'>{priorityIcon}</span>
                          )}
                          {assigneeId ? (
                            <UserAvatar
                              userId={assigneeId}
                              size={AvatarSize.SM}
                              shape={AvatarShape.ROUNDED}
                              showActiveStatus={false}
                            />
                          ) : (
                            <div className='h-7 w-7 rounded-lg border border-border bg-muted' />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <button
                onClick={() => setIsSubTicketModalOpen(true)}
                data-testid='create-sub-ticket-button'
                data-track-event='BUTTON_CLICK'
                data-track-category='TICKETS'
                data-track-name='CREATE_SUB_TICKET'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                className='flex items-center gap-2 mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors'
              >
                <Plus size={16} />
                Create Sub-Ticket
              </button>
            </div>
          </div>
        </div>
        {/* Related Tickets Section */}
        <div className='border-t border-border pt-6 mt-6'>
          <div>
            <div className='flex items-center gap-3'>
              <p className='text-base font-semibold text-foreground'>Related Tickets</p>
              <span className='inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                {referencesOut.length + referencesIn.length + (parentTickets?.length || 0)}
              </span>
            </div>

            <div className='mt-4 space-y-3'>
              {/* Parent Tickets */}
              {parentTickets && parentTickets.length > 0 && (
                <div className='space-y-3'>
                  {parentTickets.map(parentTicket => {
                    const link = buildTicketLink(parentTicket);
                    const priorityIcon = parentTicket.priority
                      ? getPriorityIcon(parentTicket.priority)
                      : null;
                    const boardStages = parentTicket.boardId
                      ? stagesByBoardId.get(parentTicket.boardId)
                      : undefined;
                    const stageProgress = getStageProgress(parentTicket.stageName, boardStages);
                    const displayProgress = stageProgress === 0 ? 1 : stageProgress;
                    const assigneeId =
                      parentTicket.assignedTo?.replace(/^(user:|group:)/, '') || '';

                    return (
                      <div key={parentTicket.id} className='flex flex-col gap-2'>
                        <div>
                          <span className='inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium text-foreground'>
                            Parent:
                          </span>
                        </div>
                        <div className='relative group flex items-center justify-between gap-4 rounded-lg border border-border bg-muted px-3 py-2.5 shadow-sm'>
                          <div className='flex items-center gap-3 min-w-0'>
                            <TicketStageIcon progressPercentage={displayProgress} size={18} />
                            <div className='flex items-center gap-4 min-w-0'>
                              <span className='text-sm font-medium text-muted-foreground font-mono shrink-0'>
                                {parentTicket.xyneId ||
                                  parentTicket.id.substring(0, 8).toUpperCase()}
                              </span>
                              {link ? (
                                <Link
                                  className='text-sm font-normal text-foreground truncate'
                                  to={link}
                                >
                                  {parentTicket.title || 'Untitled Ticket'}
                                </Link>
                              ) : (
                                <span className='text-sm font-normal text-foreground truncate'>
                                  {parentTicket.title || 'Untitled Ticket'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className='flex items-center gap-3 shrink-0'>
                            {priorityIcon && (
                              <span className='flex items-center'>{priorityIcon}</span>
                            )}
                            {assigneeId ? (
                              <UserAvatar
                                userId={assigneeId}
                                size={AvatarSize.SM}
                                shape={AvatarShape.ROUNDED}
                                showActiveStatus={false}
                              />
                            ) : (
                              <div className='h-7 w-7 rounded-lg border border-border bg-muted' />
                            )}
                          </div>
                          <button
                            onClick={() => {
                              if (onNavigateToTicket) {
                                onNavigateToTicket(parentTicket.id);
                              } else {
                                setMappedTicketId(parentTicket.id);
                              }
                            }}
                            className='text-sm text-foreground hover:text-muted-foreground font-medium whitespace-nowrap'
                            data-track-category='Tickets'
                            data-track-name='ViewParentTicket'
                            data-track-metadata={JSON.stringify({
                              parentTicketId: parentTicket.id,
                            })}
                          >
                            View
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Regular Related Tickets */}
              {referencesOut.length + referencesIn.length > 0 && (
                <>
                  {referencesOut.map(reference =>
                    renderRelatedTicketRow(
                      reference,
                      reference.targetTicket,
                      formatReferenceLabel(reference.relationType),
                      reference.relationType !== TicketReferenceRelation.MERGED_INTO,
                    ),
                  )}
                  {referencesIn.map(reference =>
                    renderRelatedTicketRow(
                      reference,
                      reference.sourceTicket,
                      formatIncomingReferenceLabel(reference.relationType),
                      false,
                      reference.relationType === TicketReferenceRelation.MERGED_INTO
                        ? () => {
                            void handleUnmerge(reference.sourceTicket?.id || '');
                          }
                        : undefined,
                    ),
                  )}
                </>
              )}

              {!parentTickets?.length && referencesOut.length + referencesIn.length === 0 && (
                <p className='text-sm text-muted-foreground'>No related tickets yet.</p>
              )}

              <div
                className={`rounded-lg border border-border px-3 py-2 flex items-center ${
                  isReferenceSaving ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                <EntitySelector
                  options={referenceTicketOptions}
                  selectedValue={null}
                  onSelect={value => handleAddReference(value)}
                  placeholder='+ Add ticket'
                  searchPlaceholder='Search by ID or name'
                  isOpen={isAddTicketMenuOpen}
                  onOpenChange={handleAddTicketMenuOpenChange}
                  onSearchChange={handleAddTicketMenuSearchChange}
                  onScrollEnd={handleAddTicketMenuScrollEnd}
                  hasMore={projectTicketHasMore}
                  isLoading={
                    isLoadingProjectTickets && (!projectTickets || projectTickets.length === 0)
                  }
                  disableClientFiltering={true}
                  width='100%'
                  noBorder
                />
              </div>
              {referenceError && <p className='text-xs text-destructive'>{referenceError}</p>}
            </div>
          </div>
        </div>
        <TicketActivity
          activities={activities}
          users={users}
          userGroups={userGroups}
          boards={boards}
        />
      </div>
      {/* SubTicket Modal */}
      {ticket?.conversationId && (
        <SubTicketModal
          isOpen={isSubTicketModalOpen}
          onClose={() => setIsSubTicketModalOpen(false)}
          ticketId={ticketId}
          conversationId={ticket.conversationId}
          onSuccess={() => {
            // Subtickets are automatically synced via Zero
          }}
        />
      )}
      {/* CreateTicket Modal for SubTicket */}
      {ticket?.projectId && selectedSubTicket && isCreateTicketModalOpen && (
        <CreateTicketModal
          isOpen={isCreateTicketModalOpen}
          onClose={() => {
            setIsCreateTicketModalOpen(false);
            setSelectedSubTicket(null);
          }}
          channelId={ticket.conversation?.channelId || ''}
          projectId={ticket.projectId}
          isFromSubTicket={true}
          initialTitle={selectedSubTicket?.title ?? ''}
          initialDescription={selectedSubTicket?.description ?? ''}
          onTicketCreated={createdTicket => {
            // Update subticket with mappedTicketId and assignedTo
            if (!selectedSubTicket) return;
            const timestamp = Date.now();
            void zero.mutate(
              mutators.subTicket.update({
                subTicketId: selectedSubTicket.id,
                mappedTicketId: createdTicket.id,
                conversationId: createdTicket.conversationId,
                timestamp,
              }),
            );
            setIsCreateTicketModalOpen(false);
            setSelectedSubTicket(null);
          }}
        />
      )}
      {/* Mapped Ticket Modal */}
      {mappedTicketId && (
        <MappedTicketModal
          mappedTicketId={mappedTicketId}
          onClose={() => setMappedTicketId(null)}
          onNavigateToParent={setMappedTicketId}
        />
      )}
      {/* Workflow Trigger Modal */}
      {ticket && (
        <WorkflowTriggerModal
          isOpen={isWorkflowModalOpen}
          onClose={() => setIsWorkflowModalOpen(false)}
          ticketId={ticket.id}
        />
      )}
      {/* Stage Form Modal */}
      {stageFormModal && (
        <StageFormModal
          isOpen={!!stageFormModal}
          onClose={() => setStageFormModal(null)}
          ticket={stageFormModal.ticket!}
          targetStage={stageFormModal.targetStage}
          sourceStageName={stageFormModal.sourceStageName}
          formId={stageFormModal.formId}
          isReviewer={stageFormModal.isReviewer ?? false}
          hasApprovers={stageFormModal.hasApprovers ?? false}
          existingRequest={stageFormModal.existingRequest ?? null}
          onSuccess={() => setStageFormModal(null)}
        />
      )}
      {/* Backward movement confirmation dialog */}
      {backwardStageChange && (
        <Dialog
          open={showBackwardConfirmDialog}
          onOpenChange={setShowBackwardConfirmDialog}
          title='Confirm Stage Change'
        >
          <div className='p-6'>
            <p className='text-sm text-muted-foreground mb-6'>
              Moving to a previous stage will clear all status change requests for status after this
              one. These requests will need to be submitted again. Do you want to continue?
            </p>

            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setShowBackwardConfirmDialog(false)}
                data-track-category='Tickets'
                data-track-name='CancelBackwardStageChange'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (backwardStageChange) {
                    // Clean up stage approvals and form entity values for stages being skipped
                    void zero.mutate(
                      mutators.cleanupStageApprovals({
                        ticketId: ticket.id,
                        fromSequenceNumber: backwardStageChange.fromSequenceNumber,
                      }),
                    );

                    // Directly update the stage for backward movement
                    void zero.mutate(
                      mutators.ticket.update({
                        id: ticket.id,
                        stageName: backwardStageChange.stageName,
                        ...(backwardStageChange.newStatus && {
                          statusV2: backwardStageChange.newStatus,
                        }),
                        updatedAt: Date.now(),
                      }),
                    );

                    setShowBackwardConfirmDialog(false);
                  }
                }}
                className='bg-sidebar-badge-accent text-sidebar-badge-accent-foreground hover:opacity-90'
                data-track-category='Tickets'
                data-track-name='ConfirmBackwardStageChange'
                data-track-metadata={JSON.stringify({ stageName: backwardStageChange?.stageName })}
              >
                Confirm
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Archive Confirmation Dialog */}
      {showArchiveConfirmDialog && (
        <Dialog
          open={showArchiveConfirmDialog}
          onOpenChange={setShowArchiveConfirmDialog}
          title='Archive Ticket'
        >
          <div className='p-6'>
            <div className='flex items-center gap-3 mb-4'>
              <div className='p-2 rounded-full bg-destructive/10'>
                <AlertCircle className='w-6 h-6 text-destructive' />
              </div>
              <h3 className='text-lg font-semibold'>This action is irreversible</h3>
            </div>
            <p className='text-sm text-muted-foreground mb-6'>
              Once archived, this ticket cannot be unarchived. All data associated with this ticket
              will be preserved but the ticket will be hidden from active views.
            </p>

            <div className='flex justify-end gap-3'>
              <Button variant='secondary' onClick={() => setShowArchiveConfirmDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleArchiveTicket}
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              >
                Archive Ticket
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Title Change Confirmation Dialog (email desk tickets only) */}
      {pendingTitleValue !== null && (
        <Dialog
          open={showTitleChangeConfirmDialog}
          onOpenChange={open => {
            if (!open) setTitleValue(ticket.title);
            setShowTitleChangeConfirmDialog(open);
          }}
          title='Confirm Title Change'
        >
          <div className='p-6'>
            <p className='text-sm text-muted-foreground mb-6'>
              Changing the ticket title will also update the email subject. Do you want to continue?
            </p>
            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => {
                  setTitleValue(ticket.title);
                  setShowTitleChangeConfirmDialog(false);
                }}
                data-track-category='Support'
                data-track-name='CancelTitleChange'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void zero.mutate(
                    mutators.ticket.update({
                      id: ticket.id,
                      title: pendingTitleValue,
                      updatedAt: Date.now(),
                    }),
                  );
                  setShowTitleChangeConfirmDialog(false);
                }}
                data-track-category='Support'
                data-track-name='ConfirmTitleChange'
              >
                Confirm
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Board Change Confirmation Dialog */}
      {showBoardChangeConfirmDialog && (
        <Dialog
          open={showBoardChangeConfirmDialog}
          onOpenChange={setShowBoardChangeConfirmDialog}
          title='Confirm Board Change'
        >
          <div className='p-6'>
            <p className='text-sm text-muted-foreground mb-6'>
              Changing the board will move this ticket to the first stage of the selected board. All
              previous stage progress and change requests will be permanently removed.
            </p>

            <div className='flex justify-end gap-3'>
              <Button variant='secondary' onClick={() => setShowBoardChangeConfirmDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmBoardChange}
                className='bg-sidebar-badge-accent text-sidebar-badge-accent-foreground hover:opacity-90'
              >
                Confirm
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
