import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useZero } from '../../../hooks/useZero';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Archive } from 'lucide-react';
import { KanbanBoard as SquareKanban } from '@xyne/icons';
import {
  Tag,
  PlusDefault as Plus,
  MultipleCrossCancelDefault as X,
  CheckTickSingle as Check,
  FileText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LinkChainHorizontal as LinkIcon,
  MinimizeTwoArrow as Minimize2,
  SparkleAi02 as Sparkles,
  CalendarDefault as Calendar,
  ClockDefault as Clock,
  EyeOn as Eye,
  AlertCircle,
  ClipboardCheck,
  ArrowRight,
  ArrowTurnLeftUp,
  ExternalLink as SquareArrowOutUpRight,
  GitBranch,
  LinkBrokenSlant as Unlink,
  ThreeDotsMenuHorizontal,
} from '@xyne/icons';
import type { QueryResultType } from '@rocicorp/zero';
import type {
  SubTicket,
  Ticket,
  TicketReferenceMapping,
  FormFields,
  FormEntityValues,
  TicketStageRequest,
  BoardMetadata,
  FlowPlan,
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
  BoardType,
  isManualSubTicketBoard,
  linkedSubTicketId,
  ApproverType,
  ReenterMode,
  isFieldActive,
  parseFieldOptionValues,
  FlowPlanModel,
  normalizeFlowPlan,
  flowGateOf,
  FLOW_STAGE_NAMES,
  deriveEtaManagementView,
  parseTicketEtaManagement,
  parseBoardEtaManagement,
  resolveTicketDescription,
} from '@xyne/shared';
import { useNavigate, Link, useLocation, useNavigationType } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';
import { useCurrentUserRoleIds } from '../../../hooks/useRoles';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { TicketActivity } from '../TicketActivity';
import { buildStageVisitFormValues } from '../TicketActivity/formSubmission';
import { UserSelector } from '../CreateTicketModal/UserSelector';
import { resolveAssigneeRef } from '../../../hooks/useTicketAssignee';
import { UserGroupSelector } from '../CreateTicketModal/UserGroupSelector';
import { SubTicketModal } from '../SubTicketModal/SubTicketModal';
import { CreateTicketModal } from '../CreateTicketModal/CreateTicketModal';
import { MappedTicketModal } from '../MappedTicketModal/MappedTicketModal';
import { EditableFormField } from './EditableFormField';
import { queries } from '../../../zero/queries';
import { useChannel, useAllChannels } from '../../../hooks/useChannels';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import UserAvatar, { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { Selector } from './Selector';
import { DetailChip, DetailChipButton, DetailChipLabel, DetailChipMarker } from './DetailChip';
import { DetailFieldRow, DetailRowGate, DetailSection, DetailSectionGate } from './DetailSection';
import { TicketPriorityIcon } from '../../../assets/icons';
import { StageIndicator } from '../../../utils/board/stageStatusIcon';
import { mutators } from '../../../zero/mutators';
import { apiInstance } from '../../../services/clients/apiClient';
import { getReachableStageIds, findMatchingTransition } from '../../../utils/stageTransitionUtils';
import { useUsers } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useAuth } from '../../../hooks/useAuth';
import {
  useSubTicketLinkSearch,
  VESPA_MAX_BOARD_FILTER_VALUES,
} from '../../../hooks/useSubTicketLinkSearch';
import { getSubTicketLinkErrorMessage, subTicketService } from '../../../services/subTicketService';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import {
  ticketTrackingMetadata,
  trackTicketOutcome,
} from '../../../services/Analytics/ticketTracking';
import { readTrackSource } from '../../../services/Analytics/trackSource';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import {
  formatIncomingReferenceLabel,
  formatReferenceLabel,
  useTicketReferences,
} from '../../../hooks/useTicketReferences';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { calculateETADeadline, calculateWorkingDurationMs } from '../../../utils/etaCalculation';
import { formatETADisplay, getLocalISOString, getStatusBadgeConfig } from '../utils';
import { cn } from '../../../utils/classNames';
import { getApiErrorMessage } from '../../../utils/apiError';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import Button from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Popover } from '../../ui/Popover/Popover';
import { FileBubble } from '../../ui/FileBubble/FileBubble';
import { StageFormModal } from '../StageFormModal/StageFormModal';
import { StageFormInlinePanel } from '../StageFormInlinePanel/StageFormInlinePanel';
import { getFlowMeta } from '../../Board/FlowRun/flowRun.utils';
import { FormViewerDialog } from './FormViewerDialog';
import { BoardTicketNav } from '../BoardTicketNav';
import Tooltip from '../../ui/Tooltip';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { useEmailChannelPreference } from '../../../hooks/useEmailChannelPreference';
import { isReleaseTicket, isDeskChannelType } from '@xyne/shared';
import { generateReleaseNotes } from '../../../services/ticketBoardService';
import { searchService } from '../../../services/searchService';
import { AIClassificationPanel } from './AIClassificationPanel';
import type { TicketClassificationData } from '../../../types/classification';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import {
  resolveBoardAdditionalFields,
  resolveLeftoverFieldValues,
  type ResolvedBoardAdditionalField,
  type LeftoverFieldValue,
} from '../../../utils/board/boardFormEntityValues';
import { resolveDisplayFormFields } from '../../../utils/board/resolveDisplayFormFields';
import { AddToStreamButton } from '../../Streams/components/AddToStreamMenu/AddToStreamMenu';

type SubTicketTreeMapping = QueryResultType<typeof queries.subTicketMappingsForTickets>[number];
type SubTicketTreeSubTicket = NonNullable<SubTicketTreeMapping['subTicket']>;

interface SubTicketTreeNode {
  subTicket: SubTicketTreeSubTicket;
  /** ticket_sub_ticket_mappings row id — the edge that `subTicket.unlink` removes. */
  mappingId: string;
  parentTicketId: string;
  depth: number;
  children: SubTicketTreeNode[];
}

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
  approvers?: readonly {
    userId: string | null;
    roleId: string | null | undefined;
    approverType: string | null | undefined;
    stageId: string | null;
  }[];
  formId?: string | null;
  eta: number | null;
}

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
  title: result.title?.replace(/<\/?hi>/gi, '') ?? '',
  ...(result.searchContext?.xyneId !== undefined
    ? { xyneId: result.searchContext.xyneId ?? null }
    : {}),
  ...(result.searchContext?.tags ? { searchContext: { tags: result.searchContext.tags } } : {}),
});

const fetchProjectTicketsPageFromVespa = async (
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
  formField?:
    | (FormFields & {
        globalField?:
          | {
              fieldName?: string | null;
              fieldType?: FormFieldType | null;
              fieldEnum?: unknown;
              fieldOptions?: unknown;
            }
          | null
          | undefined;
        form?: {
          formContextMappings?: Array<{ contextId: string; contextType: string }>;
        };
      })
    | null;
  globalField?: {
    fieldName?: string | null;
    fieldType?: FormFieldType | null;
    fieldEnum?: unknown;
    fieldOptions?: unknown;
  } | null;
}

const getFormEntityFieldName = (
  fieldValue: FormEntityValueWithField | ResolvedBoardAdditionalField,
): string => {
  const withGlobal = fieldValue.formField as FormEntityValueWithField['formField'];
  return (
    fieldValue.globalField?.fieldName ??
    withGlobal?.globalField?.fieldName ??
    fieldValue.formField?.fieldName ??
    'Unknown Field'
  );
};

const getFormEntityFieldType = (
  fieldValue: FormEntityValueWithField | ResolvedBoardAdditionalField,
): FormFieldType => {
  const withGlobal = fieldValue.formField as FormEntityValueWithField['formField'];
  return (
    fieldValue.globalField?.fieldType ??
    withGlobal?.globalField?.fieldType ??
    fieldValue.formField?.fieldType ??
    FormFieldType.STRING
  );
};

const getFormEntityFieldEnum = (
  fieldValue: FormEntityValueWithField | ResolvedBoardAdditionalField,
): string[] | undefined => {
  const withGlobal = fieldValue.formField as FormEntityValueWithField['formField'];
  // Prefer the canonical {id,value}[] (fieldOptions); fall back to the legacy fieldEnum
  // string[] projection for rows written before the fieldOptions column existed.
  const fieldEnum =
    fieldValue.globalField?.fieldOptions ??
    fieldValue.globalField?.fieldEnum ??
    withGlobal?.globalField?.fieldOptions ??
    withGlobal?.globalField?.fieldEnum ??
    fieldValue.formField?.fieldOptions ??
    fieldValue.formField?.fieldEnum;
  const options = parseFieldOptionValues(fieldEnum);
  return options.length > 0 ? options : undefined;
};

/** Plain-text formatting for a retired field's read-only value — no edit affordance, so no need for the richer per-type widgets EditableFormField uses. */
const formatLeftoverFieldValue = (
  field: LeftoverFieldValue,
  userById: ReadonlyMap<string, { id: string; name?: string | null; email?: string | null }>,
): string => {
  const raw = field.actualFieldValue ?? field.fieldValue;
  if (raw === null || raw === undefined || raw === '') return '—';

  if (field.fieldType === FormFieldType.BOOLEAN) {
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'yes') return 'Yes';
      if (normalized === 'false' || normalized === 'no') return 'No';
    }
  }

  if (field.fieldType === FormFieldType.USER) {
    const ids = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
    if (ids.length === 0) return '—';
    return ids
      .map(id => {
        const normalizedId = id.startsWith('user:') ? id.slice('user:'.length) : id;
        const user = userById.get(normalizedId);
        return user ? getUserDisplayName(user) : id;
      })
      .join(', ');
  }

  if (Array.isArray(raw)) return raw.map(String).join(', ') || '—';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
};

// ── Stage Form Submissions Component ──────────────────────────────────────────
interface StageFormSubmissionsProps {
  stageVisitFormValues: Array<{
    stageName: string;
    stageId: string;
    version: number;
    enteredAt: number;
    formValues: FormEntityValueWithField[];
  }>;
}

const StageFormSubmissions: React.FC<StageFormSubmissionsProps> = ({ stageVisitFormValues }) => {
  const [viewingForm, setViewingForm] = useState<{
    stageName: string;
    version: number;
    formValues: FormEntityValueWithField[];
  } | null>(null);

  return (
    <div className='mt-8'>
      <h3 className='text-base font-semibold text-foreground mb-4 flex items-center gap-2'>
        Stage Form Submissions
        <span className='text-xs font-normal bg-muted text-muted-foreground px-1.5 py-0.5 rounded'>
          {stageVisitFormValues.length}
        </span>
      </h3>
      {stageVisitFormValues.length === 0 && (
        <p className='text-sm text-muted-foreground'>
          No form submissions yet. Form data will appear here when a ticket is moved through a stage
          with a required form.
        </p>
      )}
      <div className='flex flex-col gap-2'>
        {stageVisitFormValues.map(sv => {
          const key = `${sv.stageId}:${sv.version}`;
          const date = new Date(sv.enteredAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          return (
            <div key={key} className='rounded-lg border border-border overflow-hidden'>
              <button
                type='button'
                onClick={() =>
                  setViewingForm({
                    stageName: sv.stageName,
                    version: sv.version,
                    formValues: sv.formValues,
                  })
                }
                data-track-category='ticket_details'
                data-track-name='view_form_submission'
                className='w-full flex items-center justify-between px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left'
              >
                <div className='flex items-center gap-2'>
                  <div className='w-2 h-2 rounded-full bg-[#6276be] shrink-0' />
                  <span className='text-sm font-medium text-foreground'>{sv.stageName}</span>
                  {sv.version > 1 && (
                    <span className='text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-full'>
                      Visit #{sv.version}
                    </span>
                  )}
                  <span className='text-xs text-muted-foreground'>{date}</span>
                </div>
                <span className='text-xs text-primary/80 shrink-0'>
                  View {sv.formValues.length} field{sv.formValues.length !== 1 ? 's' : ''}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {viewingForm && (
        <FormViewerDialog
          isOpen
          onClose={() => setViewingForm(null)}
          stageName={viewingForm.stageName}
          visitIndex={viewingForm.version}
          formValues={
            viewingForm.formValues as Parameters<typeof FormViewerDialog>[0]['formValues']
          }
        />
      )}
    </div>
  );
};
const TICKET_ATTACHMENT_PREVIEW_LIMIT = 5;

const EXPANDED_HEADER_ICON_BUTTON =
  'size-[30px] rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground';

// Debounce window for title/description auto-save while the user is typing.
const FIELD_AUTOSAVE_DEBOUNCE_MS = 600;

interface TicketDetailsProps {
  ticketId: string;
  onNavigateToTicket?: (ticketId: string) => void;
  expandedView?: boolean;
  /**
   * Drop the back chevron and the ticket id from the expanded header.
   *
   * For hosts that already name the ticket in their own chrome and have no
   * "back" to offer — a Streams column is the ticket, so the id would read
   * twice and the chevron would point nowhere.
   */
  hideBackNav?: boolean;
  onMinimize?: () => void;
  onFillRCA?: () => void;
  /** Display the current stage without exposing manual lifecycle transitions. */
  stageReadOnly?: boolean;
  /** Show only the Relationships section, for hosts that give it its own tab. */
  relationshipsOnly?: boolean;
  /** Drop the Relationships section — for hosts that render it in a sibling tab. */
  hideRelationships?: boolean;
  /**
   * Where the open came from, for hosts that show a ticket without navigating
   * (the SDLC track list). Route-driven hosts leave it unset and TICKET_VIEWED
   * reads `location.state.trackSource` instead.
   */
  trackSource?: string;
}

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
  hideBackNav = false,
  onMinimize,
  onFillRCA,
  stageReadOnly = false,
  relationshipsOnly = false,
  hideRelationships = false,
  trackSource,
}) => {
  const zero = useZero();
  const navigate = useNavigate();
  const shareableOrigin = useShareableOrigin();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { isMobile, isMac: isMacPlatform } = usePlatform();
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
  const [expandedSubTicketTicketIds, setExpandedSubTicketTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [mappedTicketId, setMappedTicketId] = useState<string | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [stageFormModal, setStageFormModal] = useState<{
    ticket: typeof ticket;
    targetStage: StageInfo;
    sourceStageName: string;
    formId: string;
    isReviewer?: boolean;
    hasApprovers: boolean;
    existingRequest?: TicketStageRequest | null;
    showPersistedDocValues?: boolean;
  } | null>(null);

  const [nonFormReviewDialog, setNonFormReviewDialog] = useState<{
    requestId: string;
    stageId: string;
    kind: 'APPROVE' | 'REJECT';
    stageName: string;
  } | null>(null);
  const [nonFormReviewComment, setNonFormReviewComment] = useState('');

  const [editingStageETA, setEditingStageETA] = useState(false);
  const [stageEtaValue, setStageEtaValue] = useState('');
  const stageEtaInputRef = useRef<HTMLInputElement>(null);
  const [editingETA, setEditingETA] = useState(false);
  const [etaValue, setEtaValue] = useState('');
  const etaInputRef = useRef<HTMLInputElement>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [needsReadMore, setNeedsReadMore] = useState(false);
  const [showAllAttachments, setShowAllAttachments] = useState(false);
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

  // TICKET_VIEWED: one event per ticket arrival, whichever way the user got here
  // (kanban card, list row, chat link, notification, keyboard, deep link, back
  // button). Waits for the row so the dimensions ride along, then latches on
  // ticketId so re-renders and tab switches inside the same ticket don't refire.
  // `source` follows the CHANNEL_VIEWED rule (see readTrackSource); a host that
  // shows the ticket without navigating passes `trackSource` instead.
  // No event label: the title is user content and eventLabel is stored unmasked.
  const viewedTicketIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ticket || !ticketId) return;
    if (viewedTicketIdRef.current === ticketId) return;
    viewedTicketIdRef.current = ticketId;

    const source = trackSource ?? readTrackSource(location.state, navigationType, location.key);
    const path = location.pathname;
    const surface = path.includes('/projects')
      ? 'projects'
      : path.includes('/sdlc')
        ? 'sdlc'
        : path.includes('/activity')
          ? 'activity'
          : path.includes('/chat')
            ? 'chat'
            : 'other';

    globalClickTracker.trackManualEvent('Tickets', 'TICKET_VIEWED', undefined, {
      ...ticketTrackingMetadata(ticket),
      source,
      surface,
      openedFromNotification: source === 'notification',
      expandedView,
    });
  }, [
    ticket,
    ticketId,
    trackSource,
    location.state,
    location.key,
    location.pathname,
    navigationType,
    expandedView,
  ]);
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

  // Group assignments by role. Role-driven rows carry roleId (with a related
  // role row for the name); legacy enum rows carry userResponsibility. We
  // group by whichever key is set so both old and new tickets render their
  // assigned users. `role` may be undefined if the backend hasn't been
  // updated yet — fall back to a generic label in that case.
  const roleGroups = useMemo(() => {
    const groups = new Map<string, { label: string; userIds: string[] }>();
    for (const a of ticketAssignments) {
      const userId = a.userId;
      if (!userId) continue;
      const key = a.roleId ?? a.userResponsibility;
      if (!key) continue;
      const label =
        (a.roleId && (a as { role?: { name?: string } | null }).role?.name) ||
        a.userResponsibility ||
        'Role';
      const existing = groups.get(key);
      if (existing) {
        existing.userIds.push(userId);
      } else {
        groups.set(key, { label, userIds: [userId] });
      }
    }
    return Array.from(groups.values());
  }, [ticketAssignments]);
  // Check if description needs truncation by comparing scrollHeight with clientHeight
  useEffect(() => {
    if (!descriptionRef.current || showFullDescription) return;

    const checkTruncation = (): void => {
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

    return (): void => {
      resizeObserver.disconnect();
    };
  }, [ticket?.description, showFullDescription]);

  // Query all users for assignee dropdown
  const users = useUsers();

  // Query all user groups for activity display
  const userGroups = useUserGroups();
  const { user: currentUser } = useAuth();
  const currentUserRoleIds = useCurrentUserRoleIds();

  const handleNonFormReviewSubmit = async (): Promise<void> => {
    if (!nonFormReviewDialog || !ticket) return;
    const trimmedComment = nonFormReviewComment.trim();
    if (nonFormReviewDialog.kind === 'REJECT' && !trimmedComment) {
      toast.error('Please add a comment explaining the rejection');
      return;
    }
    const isApprove = nonFormReviewDialog.kind === 'APPROVE';
    const commentMessageId = trimmedComment ? uuidv4() : undefined;
    try {
      const result = await zero.mutate(
        mutators.ticketStageRequest.upsert({
          id: nonFormReviewDialog.requestId,
          ticketId: ticket.id,
          stageId: nonFormReviewDialog.stageId,
          status: isApprove ? TicketStageRequestStatus.APPROVED : TicketStageRequestStatus.REJECTED,
          updatedBy: currentUser?.id || '',
          reviewedBy: currentUser?.id,
          updatedAt: Date.now(),
          ...(isApprove ? { approvedActivityId: uuidv4() } : { rejectedActivityId: uuidv4() }),
          ...(commentMessageId && { commentMessageId, comment: trimmedComment }),
        }),
      ).server;
      if (result.type === 'error') {
        toast.error(result.error.message || 'Failed to update stage request');
        return;
      }
      toast.success(isApprove ? 'Stage approved' : 'Stage rejected');
      setNonFormReviewDialog(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || 'Failed to update stage request');
    }
  };

  // Query stages if ticket has a boardId
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: ticket?.boardId ?? '' }), {
    enabled: !!ticket?.boardId,
  });

  // Query board details to detect non-linear boards
  const [boardData] = useCachedQuery(queries.boardDetailById({ boardId: ticket?.boardId ?? '' }), {
    enabled: !!ticket?.boardId,
  });
  const flowRootTicketId = ticket ? (getFlowMeta(ticket)?.rootTicketId ?? '') : '';
  const [flowRootTicket] = useCachedQuery(queries.ticketRowById({ ticketId: flowRootTicketId }), {
    enabled: !!flowRootTicketId,
  });
  const isFlowRunPaused = flowRootTicket?.statusV2 === TicketStatusV2.PAUSED;

  const isNonLinearBoard = boardData?.boardType === BoardType.NON_LINEAR;
  const showNextStageFormInTicketDetails =
    !isNonLinearBoard &&
    ((boardData?.metadata as BoardMetadata | null | undefined)?.showNextStageFormInTicketDetails ??
      false) === true;

  // ETA risk/overdue display state. The banner/badge is shown to everyone; the backend
  // (`canUserModifyTicketControl`, wired into `acknowledgeEtaRisk`) is the sole authority
  // on who may act, and rejects an unauthorized attempt with a clear error.
  const etaManagementView = useMemo(() => {
    if (!ticket) return null;
    return deriveEtaManagementView({
      ticketEtaManagement: parseTicketEtaManagement(ticket.metadata),
      boardEtaManagement: parseBoardEtaManagement(
        boardData?.metadata ?? null,
        boardData?.boardType ?? BoardType.DEFAULT,
      ),
      ticketEta: ticket.eta ?? null,
      ticketStatus: ticket.statusV2,
      now: Date.now(),
    });
  }, [ticket, boardData]);

  const [acknowledgeReason, setAcknowledgeReason] = useState('');
  const [showAcknowledgeInput, setShowAcknowledgeInput] = useState(false);
  const [submittingAcknowledge, setSubmittingAcknowledge] = useState(false);

  const handleAcknowledgeRisk = useCallback(async () => {
    if (!ticket || !acknowledgeReason.trim()) return;
    const ticketEtaManagement = parseTicketEtaManagement(ticket.metadata);
    const fingerprint = ticketEtaManagement.planningRisk.fingerprint;
    if (!fingerprint) return;
    setSubmittingAcknowledge(true);
    try {
      const result = zero.mutate(
        mutators.ticket.acknowledgeEtaRisk({
          ticketId: ticket.id,
          expectedFingerprint: fingerprint,
          reason: acknowledgeReason.trim(),
          clientTimestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Failed to acknowledge planning risk', {
          description:
            res.error.message || 'The risk state may have changed - refresh and try again.',
          duration: 6000,
        });
      } else {
        toast.success('Planning risk acknowledged');
        setShowAcknowledgeInput(false);
        setAcknowledgeReason('');
      }
    } catch (error) {
      toast.error('Failed to acknowledge planning risk', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        duration: 6000,
      });
    } finally {
      setSubmittingAcknowledge(false);
    }
  }, [ticket, acknowledgeReason, zero]);

  // Plan-node titles for FLOW boards — form values are scoped by planNodeId,
  // so submissions/activity resolve their label through this map.
  const flowNodeTitleById = useMemo(() => {
    if (boardData?.boardType !== BoardType.FLOW) return null;
    if (typeof boardData.flowPlan !== 'string') return null;
    const flowPlan = normalizeFlowPlan(JSON.parse(boardData.flowPlan) as FlowPlan);
    return new Map(flowPlan.nodes.map(node => [node.id, node.title]));
  }, [boardData?.boardType, boardData?.flowPlan]);

  // Flow step ticket: surface the step's gate form as a prefillable inline
  // form — flow boards behave as if "Prefillable forms" is always ON.
  const flowStepForm = useMemo(() => {
    if (boardData?.boardType !== BoardType.FLOW || !ticket) return null;
    const planNodeId = getFlowMeta(ticket)?.planNodeId;
    if (!planNodeId) return null; // the run's main ticket has no gate form
    const flowMeta = getFlowMeta(ticket);
    const snapshot = flowMeta?.nodeSnapshot;
    const flowPlan =
      typeof boardData.flowPlan === 'string'
        ? normalizeFlowPlan(JSON.parse(boardData.flowPlan) as FlowPlan)
        : null;
    const planNode = flowPlan ? new FlowPlanModel(flowPlan).getNode(planNodeId) : null;
    const gate = snapshot?.gate ?? (planNode ? flowGateOf(planNode) : null);
    if (!gate) return null;
    if (gate.type !== 'form' || !gate.formId) return null;
    return {
      planNodeId,
      formId: gate.formId,
      stepTitle: snapshot?.title ?? planNode?.title ?? ticket.title,
      settled:
        ticket.statusV2 === TicketStatusV2.COMPLETED ||
        ticket.statusV2 === TicketStatusV2.CANCELLED,
    };
  }, [boardData?.boardType, boardData?.flowPlan, ticket]);

  const [flowForm] = useCachedQuery(queries.getFormById({ formId: flowStepForm?.formId ?? '' }), {
    enabled: !!flowStepForm,
  });
  const flowFormName = flowStepForm ? (flowForm?.formName ?? 'Form') : null;

  const completeFlowStep = useCallback(async (): Promise<void> => {
    if (!ticket) return;
    const result = zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        statusV2: TicketStatusV2.COMPLETED,
        stageName: FLOW_STAGE_NAMES.COMPLETED,
        updatedAt: Date.now(),
      }),
    );
    const response = await result.server;
    if (response?.type === 'error') {
      throw new Error(response.error.message || 'Failed to complete the step');
    }
  }, [zero, ticket]);

  // Transitions (with approvers) are fetched via the dedicated query, not embedded in boardDetailById.
  const [boardStageTransitions] = useCachedQuery(
    queries.getStageTransitionsByBoardId({ boardId: ticket?.boardId ?? '' }),
    {
      enabled: !!ticket?.boardId && isNonLinearBoard,
    },
  );

  // Only NON_LINEAR boards use transition-based gating; linear boards keep the legacy path.
  const stageTransitions = useMemo(() => {
    if (!isNonLinearBoard || !boardStageTransitions) return [];
    return boardStageTransitions;
  }, [isNonLinearBoard, boardStageTransitions]);

  // Always-current refs so the async .server.then() handler can look up the latest
  // transition/form data even when the render-time closure is stale.
  const stageTransitionsRef = useRef(stageTransitions);
  stageTransitionsRef.current = stageTransitions;
  const stagesRef = useRef(stages);
  stagesRef.current = stages;

  // Create a map of stageId -> formId for quick lookup.
  // Includes both stage-level forms (formContextMappings) and transition-level forms
  // (from stageTransitions.formId) so NON_LINEAR boards with per-transition forms are covered.
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
    stageTransitions.forEach(t => {
      if (t.formId) {
        map.set(t.toStageId, t.formId);
      }
    });
    return map;
  }, [stages, stageTransitions]);

  // Create stages array with formId and approvers included
  const stagesWithFormInfo = useMemo(() => {
    if (!stages) return [];
    return stages.map(stage => ({
      ...stage,
      formId: stageFormMap.get(stage.id) ?? null,
    }));
  }, [stages, stageFormMap]);

  // Compute the set of stage names reachable from the current stage.
  // Used to grey out unreachable options in the stage selector.
  // Returns null (no restriction) for linear boards, or NON_LINEAR boards with no graph at
  // all (legacy → unrestricted). On a NON_LINEAR board with a graph, returns the current
  // stage's reachable targets — an EMPTY set for a terminal stage (not "unrestricted").
  const reachableStageNamesForSelector = useMemo<Set<string> | null>(() => {
    if (!stages || !ticket?.stageName) return null;

    // Linear boards don't restrict navigation
    if (!isNonLinearBoard) return null;

    if (stageTransitions.length === 0) return null;

    const currentStageObj = stages.find(s => s.name === ticket.stageName);
    if (!currentStageObj) return null;

    const reachableIds = getReachableStageIds(stageTransitions, currentStageObj.id);
    if (reachableIds === null) return null;

    return new Set(stages.filter(s => reachableIds.has(s.id)).map(s => s.name));
  }, [isNonLinearBoard, stageTransitions, stages, ticket?.stageName]);

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

  // A stage the ticket cannot transition to from its current stage.
  const isStageUnreachable = useCallback(
    (item: { name: string; sequenceNumber?: number }): boolean => {
      // NON_LINEAR (or any board with transitions): only configured edges are reachable.
      if (reachableStageNamesForSelector !== null) {
        return !reachableStageNamesForSelector.has(item.name);
      }
      // Linear boards with forms/approval: only the immediate next stage is reachable forward;
      // moving backward to any earlier stage stays allowed.
      if (!shouldEnforceSequentialMovement) return false;
      const currentStageSeq = stages?.find(s => s.name === ticket?.stageName)?.sequenceNumber;
      if (currentStageSeq === undefined || item.sequenceNumber === undefined) return false;
      if (item.sequenceNumber > currentStageSeq) {
        return item.sequenceNumber !== currentStageSeq + 1;
      }
      return false;
    },
    [reachableStageNamesForSelector, shouldEnforceSequentialMovement, stages, ticket?.stageName],
  );

  // Stage list for the status selector: list ONLY the stages the ticket can move to, plus the
  // current stage (so the selected value still renders). Unreachable stages are removed entirely
  // rather than shown greyed/disabled.
  const selectorStages = useMemo(
    () => (stages ?? []).filter(s => s.name === ticket?.stageName || !isStageUnreachable(s)),
    [stages, ticket?.stageName, isStageUnreachable],
  );

  const nextStageDetailsConfig = useMemo(() => {
    if (
      !showNextStageFormInTicketDetails ||
      !ticket?.stageName ||
      stagesWithFormInfo.length === 0
    ) {
      return null;
    }

    const currentStage = stagesWithFormInfo.find(stage => stage.name === ticket.stageName);
    if (!currentStage) return null;

    if (isNonLinearBoard && stageTransitions.length > 0) {
      const outgoingTransitions = stageTransitions
        .filter(transition => transition.fromStageId === currentStage.id)
        .map(transition => ({
          transition,
          targetStage: stagesWithFormInfo.find(stage => stage.id === transition.toStageId),
        }))
        .filter(
          (
            item,
          ): item is {
            transition: (typeof stageTransitions)[number];
            targetStage: (typeof stagesWithFormInfo)[number];
          } => !!item.targetStage,
        )
        .sort(
          (a, b) =>
            (a.targetStage.sequenceNumber ?? Number.MAX_SAFE_INTEGER) -
            (b.targetStage.sequenceNumber ?? Number.MAX_SAFE_INTEGER),
        );

      const nextTransition = outgoingTransitions[0];
      if (!nextTransition) return null;

      return {
        sourceStageName: currentStage.name,
        targetStage: nextTransition.targetStage,
        formId: nextTransition.transition.formId ?? null,
        hasApprovers:
          (nextTransition.transition.requiresApproval ?? false) ||
          (nextTransition.transition.transitionApprovers?.length ?? 0) > 0,
        reenterMode: nextTransition.transition.onReenter ?? null,
      };
    }

    const targetStage = stagesWithFormInfo.find(
      stage => stage.sequenceNumber === currentStage.sequenceNumber + 1,
    );
    if (!targetStage) return null;

    return {
      sourceStageName: currentStage.name,
      targetStage,
      formId: targetStage.formId ?? null,
      hasApprovers: (targetStage.approvers?.length ?? 0) > 0,
      reenterMode: null as ReenterMode | null,
    };
  }, [
    isNonLinearBoard,
    showNextStageFormInTicketDetails,
    stageTransitions,
    stagesWithFormInfo,
    ticket?.stageName,
  ]);

  const getStageEtas = useCallback(
    (stageId: string) =>
      (ticket?.stageEtaEntries ?? [])
        .filter(eta => eta.stageId === stageId)
        .map(eta => ({
          id: eta.id,
          stageId: eta.stageId,
          version: eta.version ?? null,
          stageEnteredAt: eta.stageEnteredAt,
        })),
    [ticket?.stageEtaEntries],
  );

  const nextStageEtas = useMemo(
    () => (nextStageDetailsConfig ? getStageEtas(nextStageDetailsConfig.targetStage.id) : []),
    [getStageEtas, nextStageDetailsConfig],
  );

  const stageFormModalEtas = useMemo(
    () => (stageFormModal ? getStageEtas(stageFormModal.targetStage.id) : []),
    [getStageEtas, stageFormModal],
  );

  const stageFormModalReenterMode = useMemo<ReenterMode | null>(() => {
    if (!stageFormModal || !isNonLinearBoard) return null;
    const current = stagesWithFormInfo.find(stage => stage.name === stageFormModal.sourceStageName);
    if (!current) return null;
    const transition = stageTransitions.find(
      t => t.fromStageId === current.id && t.toStageId === stageFormModal.targetStage.id,
    );
    return (transition?.onReenter as ReenterMode | null) ?? null;
  }, [isNonLinearBoard, stageFormModal, stageTransitions, stagesWithFormInfo]);

  // Query channel if ticket has conversation with channelId
  const channelId = ticket?.conversation?.channelId;
  const channel = useChannel(channelId || '');

  const allChannels = useAllChannels();
  const channelTypeMap = useMemo(
    () => new Map(allChannels.map(c => [c.id, c.type])),
    [allChannels],
  );

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
  }, [ticket?.id]);

  const loadProjectTicketsPage = useCallback(
    async (offset: number, replace: boolean): Promise<void> => {
      const normalizedQuery = projectTicketSearch.trim();
      const requestId = ++projectTicketsRequestIdRef.current;
      const isInitialLoad = replace || offset === 0;

      if (isInitialLoad) {
        setIsLoadingProjectTickets(true);
      } else {
        setIsLoadingMoreProjectTickets(true);
      }

      try {
        const response = await fetchProjectTicketsPageFromVespa(normalizedQuery, offset);

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

        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[TicketDetails] Failed to load Vespa project tickets'),
          context: [
            {
              offset,
              query: normalizedQuery || '*',
              error,
            },
          ],
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
    [projectTicketSearch],
  );

  useEffect(() => {
    if (!isAddTicketMenuOpen) {
      return;
    }

    setProjectTickets(null);
    setProjectTicketNextOffset(0);
    setProjectTicketHasMore(false);
    if (projectTicketSearch.trim()) {
      void loadProjectTicketsPage(0, true);
    }
  }, [isAddTicketMenuOpen, loadProjectTicketsPage, projectTicketSearch]);

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
      // Eager on manual boards too: TicketActivity names boards from this list.
      enabled:
        !!ticket?.projectId &&
        (hasBoardDropdownOpened || isManualSubTicketBoard(boardData?.boardType)),
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

  const stageRingLabel = useMemo(() => {
    if (!stages || stages.length === 0 || !ticket?.stageName) return '';
    const index = stages.findIndex(s => s.name === ticket.stageName);
    if (index < 0) return '';
    return `${index + 1}/${stages.length}`;
  }, [stages, ticket?.stageName]);

  const isDeadlineLive =
    ticket?.statusV2 !== TicketStatusV2.COMPLETED && ticket?.statusV2 !== TicketStatusV2.CANCELLED;

  const isTicketOverdue = Boolean(
    ticket?.eta && new Date(ticket.eta) < new Date() && isDeadlineLive,
  );

  const isStageOverdue = Boolean(
    currentStageEntry?.stageEta &&
    new Date(currentStageEntry.stageEta) < new Date() &&
    isDeadlineLive,
  );

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

  useEffect(() => {
    setExpandedSubTicketTicketIds(new Set());
  }, [ticketId]);

  const subTicketTreeParentIds = useMemo(
    () => [ticketId, ...Array.from(expandedSubTicketTicketIds)],
    [expandedSubTicketTicketIds, ticketId],
  );

  const [subTicketMappings] = useCachedQuery(
    queries.subTicketMappingsForTickets({ ticketIds: subTicketTreeParentIds }),
    { enabled: !!ticketId },
  );

  const subTicketMappingsByParentTicketId = useMemo(() => {
    const map = new Map<string, SubTicketTreeMapping[]>();

    subTicketMappings?.forEach(mapping => {
      const mappings = map.get(mapping.ticketId);
      if (mappings) {
        mappings.push(mapping);
      } else {
        map.set(mapping.ticketId, [mapping]);
      }
    });

    return map;
  }, [subTicketMappings]);

  const subTickets = useMemo(
    () =>
      subTicketMappingsByParentTicketId
        .get(ticketId)
        ?.map(mapping => mapping.subTicket)
        .filter((st): st is SubTicketTreeSubTicket => st !== null && st !== undefined) || [],
    [subTicketMappingsByParentTicketId, ticketId],
  );

  const loadedSubTickets = useMemo(
    () =>
      subTicketMappings
        ?.map(mapping => mapping.subTicket)
        .filter((st): st is SubTicketTreeSubTicket => st !== null && st !== undefined) || [],
    [subTicketMappings],
  );

  const subTicketTreeNodes = useMemo(() => {
    const buildTree = (
      parentTicketId: string,
      depth: number,
      visitedTicketIds: Set<string>,
    ): SubTicketTreeNode[] => {
      const mappings = subTicketMappingsByParentTicketId.get(parentTicketId) ?? [];

      return mappings
        .filter(
          (mapping): mapping is SubTicketTreeMapping & { subTicket: SubTicketTreeSubTicket } =>
            mapping.subTicket !== null && mapping.subTicket !== undefined,
        )
        .map(mapping => {
          const subTicket = mapping.subTicket;
          const mappedTicketId = subTicket.mappedTicketId ?? undefined;
          const canRenderChildren =
            mappedTicketId &&
            expandedSubTicketTicketIds.has(mappedTicketId) &&
            !visitedTicketIds.has(mappedTicketId);

          return {
            subTicket,
            mappingId: mapping.id,
            parentTicketId,
            depth,
            children: canRenderChildren
              ? buildTree(mappedTicketId, depth + 1, new Set([...visitedTicketIds, mappedTicketId]))
              : [],
          };
        });
    };

    return buildTree(ticketId, 0, new Set([ticketId]));
  }, [expandedSubTicketTicketIds, subTicketMappingsByParentTicketId, ticketId]);

  const toggleSubTicketBranch = useCallback((mappedTicketId: string): void => {
    setExpandedSubTicketTicketIds(prev => {
      const next = new Set(prev);
      if (next.has(mappedTicketId)) {
        next.delete(mappedTicketId);
      } else {
        next.add(mappedTicketId);
      }
      return next;
    });
  }, []);

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

  const boardCustomFieldsFormId = formMapping?.formId;

  const allFormFields = useMemo(() => {
    if (!ticket?.workspaceId) return [];
    const allFields = resolveBoardAdditionalFields({
      formMapping: formMapping ?? undefined,
      formEntityValues: formEntityValues as FormEntityValueWithField[] | undefined,
      boardId: ticket.boardId,
      ticketId,
      workspaceId: ticket.workspaceId,
    });

    // Only show fields that either have no parent, or whose parent's current value
    // matches the specific branch they belong to. Keyed by fv.fieldId (the coalesced id used
    // everywhere FormEntityValues.fieldId is stored) rather than fv.formField?.id — a
    // global-sourced field's value row only resolves the sibling fv.globalField relation,
    // never fv.formField, so filtering on formField alone silently drops every such field
    // (which is what any field created through the reusable/global-fields UI actually is).
    // Prefers the canonical {id,value}[] (fieldOptions) so branch resolution can match
    // option ids; fieldEnum is the legacy fallback.
    const allFieldDefs = (allFields as FormEntityValueWithField[]).map(fv => ({
      id: fv.fieldId,
      fieldEnum:
        fv.globalField?.fieldOptions ??
        fv.globalField?.fieldEnum ??
        fv.formField?.globalField?.fieldOptions ??
        fv.formField?.globalField?.fieldEnum ??
        fv.formField?.fieldOptions ??
        fv.formField?.fieldEnum,
    }));
    const getFieldEffectiveValue = (fieldId: string): string | undefined => {
      const parentEntry = allFields.find(fv => fv.fieldId === fieldId);
      const parentRaw = parentEntry?.actualFieldValue ?? parentEntry?.fieldValue;
      return typeof parentRaw === 'string' ? parentRaw : undefined;
    };

    // parentOptionId lives only on the per-form membership row (form_fields), not on either
    // relation a FormEntityValue resolves — a global-sourced field's saved value row only
    // resolves fv.globalField (no parentOptionId there), so read it from the membership
    // list directly, keyed by the same coalesced id used everywhere else.
    const parentOptionIdByFieldId = new Map(
      (formMapping?.formFields ?? []).map(row => [
        row.globalFieldId ?? row.id,
        row.parentOptionId ?? null,
      ]),
    );

    // resolveBoardAdditionalFields already returns fields ordered by sequenceNumber
    // (via resolveDisplayFormFields), so no re-sort is needed here.
    return allFields.filter(fieldValue => {
      const parentOptionId = parentOptionIdByFieldId.get(fieldValue.fieldId) ?? null;
      if (!parentOptionId) return true;
      return isFieldActive({ parentOptionId }, allFieldDefs, getFieldEffectiveValue);
    });
  }, [formMapping, formEntityValues, ticketId, ticket?.boardId, ticket?.workspaceId]);

  const gateFormId = nextStageDetailsConfig?.formId ?? null;
  const gateStageName = nextStageDetailsConfig?.targetStage.name ?? null;

  const [gateMembershipRows] = useCachedQuery(
    queries.getFormFieldsByFormId({ formId: gateFormId ?? '' }),
    { enabled: !!gateFormId },
  );

  // Fields the board says must be filled before this ticket can enter the next stage:
  // the transition form's non-optional, branch-active fields that have no value yet.
  const gateMissingFields = useMemo(() => {
    if (!gateFormId) return [];
    const rows = Array.isArray(gateMembershipRows) ? gateMembershipRows : [];
    const fields = resolveDisplayFormFields(gateFormId, rows);
    const valueByFieldId = new Map<string, unknown>();
    (formEntityValues ?? []).forEach(value => {
      const raw = value.actualFieldValue ?? value.fieldValue;
      if (raw === null || raw === undefined || raw === '') return;
      valueByFieldId.set(value.fieldId, raw);
    });
    const getFieldEffectiveValue = (fieldId: string): string | undefined => {
      const raw = valueByFieldId.get(fieldId);
      return typeof raw === 'string' ? raw : undefined;
    };
    return fields.filter(
      field =>
        !field.isOptional &&
        isFieldActive(field, fields, getFieldEffectiveValue) &&
        !valueByFieldId.has(field.id),
    );
  }, [gateFormId, gateMembershipRows, formEntityValues]);

  // An archived ticket is read-only everywhere (the archived-guard overlay blocks clicks),
  // so the field rows should say so rather than look editable and swallow the click.
  const fieldsAreReadOnly = Boolean(ticket?.isArchived);

  const [showEmptyFields, setShowEmptyFields] = useState(false);

  const isFormFieldEmpty = (fieldValue: (typeof allFormFields)[number]): boolean => {
    const raw = fieldValue.actualFieldValue ?? fieldValue.fieldValue;
    if (raw === null || raw === undefined) return true;
    if (typeof raw === 'string') return raw.trim() === '';
    if (Array.isArray(raw)) {
      return raw.every(
        entry => entry === null || entry === undefined || String(entry).trim() === '',
      );
    }
    return false;
  };

  const hiddenEmptyFieldCount = allFormFields.filter(isFormFieldEmpty).length;

  const orderedFormFields = [...allFormFields].sort(
    (a, b) => Number(isFormFieldEmpty(a)) - Number(isFormFieldEmpty(b)),
  );

  const visibleFormFields = showEmptyFields
    ? orderedFormFields
    : orderedFormFields.filter(fieldValue => !isFormFieldEmpty(fieldValue));

  // Values this ticket has saved for fields no longer part of the board's current form —
  // e.g. left behind by a "Copy Board Configuration" run that swapped in another board's
  // form. Never deleted, just unreachable through the lookup above; shown separately and
  // read-only rather than silently dropped.
  const leftoverFieldValues = useMemo(
    () =>
      resolveLeftoverFieldValues({
        formMapping: formMapping ?? undefined,
        formEntityValues: formEntityValues as FormEntityValueWithField[] | undefined,
        boardId: ticket?.boardId,
      }),
    [formMapping, formEntityValues, ticket?.boardId],
  );

  const leftoverFieldUserById = useMemo(() => {
    const list = Array.isArray(users) ? users : [];
    return new Map(list.map(user => [user.id, user]));
  }, [users]);

  // Group form values by stage+version — shared with the Messages thread (StageMoveFormBlock)
  // so both surfaces render the exact same "Form submission" block.
  const stageVisitFormValues = useMemo(
    () =>
      buildStageVisitFormValues(formEntityValues as FormEntityValueWithField[] | undefined, [
        ...(stagesWithFormInfo ?? []),
        ...Array.from(flowNodeTitleById?.entries() ?? []).map(([id, name]) => ({ id, name })),
      ]),
    [flowNodeTitleById, formEntityValues, stagesWithFormInfo],
  );

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
        // For NON_LINEAR boards approvers live on the transition, not the stage.
        const hasApprovers = isNonLinearBoard
          ? stageTransitions.some(
              t => t.toStageId === req.stageId && (t.transitionApprovers?.length ?? 0) > 0,
            )
          : stage?.approvers && stage.approvers.length > 0;

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
          // "Status Change Requests" is for transitions awaiting approval. Only surface a
          // submitted form here when the transition into this stage actually requires an
          // approver. No-approval form submissions are shown in the activity timeline (and,
          // on NON_LINEAR boards, the Stage Form Submissions panel), so listing them here too
          // is redundant and misreads as a pending request.
          const stageHasApprovers = isNonLinearBoard
            ? stageTransitions.some(
                t => t.toStageId === stage.id && (t.transitionApprovers?.length ?? 0) > 0,
              )
            : (stage.approvers?.length ?? 0) > 0;
          if (!stageHasApprovers) {
            return;
          }
          // On linear boards, hide form data from "future" stages (stale data from backward moves).
          // On non-linear boards stage order has no meaning, so always show all form data.
          if (
            !isNonLinearBoard &&
            stage.sequenceNumber !== undefined &&
            stage.sequenceNumber > currentStageSeq
          ) {
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
  }, [
    ticket?.ticketStageRequests,
    formEntityValues,
    stagesWithFormInfo,
    ticket?.stageName,
    isNonLinearBoard,
    stageTransitions,
  ]);

  // A stage-change request that is waiting on THIS user — the banner the design puts at the
  // very top of the panel, so an approver never has to scroll to find the thing blocking them.
  const pendingApprovalForMe = useMemo(() => {
    const submitted = formsToShow.filter(
      item => item.type === 'request' && item.status === TicketStageRequestStatus.SUBMITTED,
    );
    for (const item of submitted) {
      const stage = stagesWithFormInfo?.find(s => s.id === item.stageId);
      const approvers = isNonLinearBoard
        ? stageTransitions
            .filter(t => t.toStageId === item.stageId)
            .flatMap(t => t.transitionApprovers ?? [])
        : (stage?.approvers ?? []);
      const isApprover = approvers.some(approver => {
        const type = (approver.approverType ?? ApproverType.USER) as string;
        if (type === String(ApproverType.ROLE)) {
          return !!approver.roleId && currentUserRoleIds.includes(approver.roleId);
        }
        return approver.userId === currentUser?.id;
      });
      if (isApprover) {
        const previousStage = stagesWithFormInfo?.find(
          s => s.sequenceNumber === (stage?.sequenceNumber ?? 0) - 1,
        );
        return { item, stage, previousStage, stageName: stage?.name ?? 'the next stage' };
      }
    }
    return null;
  }, [
    formsToShow,
    stagesWithFormInfo,
    isNonLinearBoard,
    stageTransitions,
    currentUserRoleIds,
    currentUser?.id,
  ]);

  const workflowActionableCount =
    formsToShow.length +
    (flowStepForm ? 1 : 0) +
    (!stageReadOnly && nextStageDetailsConfig ? 1 : 0);

  const [approvalBannerOpen, setApprovalBannerOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [relationshipsOpen, setRelationshipsOpen] = useState(false);

  const moreMenuItems: {
    label: string;
    icon: React.ReactElement;
    trackName: string;
    disabled?: boolean;
    run: () => void;
  }[] = [
    {
      label: 'Copy link',
      icon: <LinkIcon size={18} />,
      trackName: 'COPY_TICKET_LINK',
      run: () => handleCopyTicketViewLink(),
    },
    {
      label: 'Summarize thread',
      icon: <Sparkles size={18} />,
      trackName: 'SUMMARIZE_THREAD',
      run: () => {
        if (!ticket) return;
        void navigate(`${baseRoute}/${ticket.channelId}/${ticket.conversationId}#thread-summary`);
      },
    },
    {
      label: 'Archive ticket',
      icon: <Archive size={18} />,
      trackName: 'OPEN_ARCHIVE_TICKET_CONFIRM',
      disabled: ticket?.isArchived ?? false,
      run: () => setShowArchiveConfirmDialog(true),
    },
  ];

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

    loadedSubTickets.forEach(subTicket => {
      if (subTicket?.mappedTicket?.boardId) {
        boardIds.add(subTicket.mappedTicket.boardId);
      }
    });

    // Exclude ticket's own board — stagesByBoard already covers it
    if (ticket.boardId) {
      boardIds.delete(ticket.boardId);
    }

    return Array.from(boardIds);
  }, [referencesOut, referencesIn, ticket, loadedSubTickets]);
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

  // Initialize edit values when ticket changes. Skip the field currently being
  // edited: a debounced auto-save mutates `ticket`, and re-syncing here mid-edit
  // would clobber the user's in-progress text (and jump the caret).
  useEffect(() => {
    if (ticket && !editingTitle) {
      setTitleValue(ticket.title);
    }
  }, [ticket, editingTitle]);
  useEffect(() => {
    if (ticket && !editingDescription) {
      setDescriptionValue(resolveTicketDescription(ticket));
    }
  }, [ticket, editingDescription]);
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

  useEffect(() => {
    if (!editingDescription) return;
    const el = descriptionTextareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [editingDescription, descriptionValue]);

  // Consume the Zero mutator's server result so ticket-detail field edits surface
  // rejections instead of silently rolling back the optimistic update. Server-side
  // rules (e.g. Euler board constraints) reject some updates; previously the error was
  // dropped via `void zero.mutate(...)`, so the user got no feedback (e.g. an unassign
  // appeared to do nothing). Declared before the loading guard so the debounced
  // auto-save effects below can reuse it.
  // Every field edit on this screen funnels through applyTicketUpdate, so the
  // "it actually saved" outcome is reported once here rather than per handler.
  // Callers must snapshot the row BEFORE awaiting the mutation: Zero applies
  // the update optimistically, so by the time `.server` settles `ticketRef`
  // already holds the new values and `previous` would equal `to`.
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;
  const outcomeStagesRef = useRef(stages);
  outcomeStagesRef.current = stages;
  type TicketUpdate = Parameters<typeof mutators.ticket.update>[0];
  type TicketRow = NonNullable<typeof ticket>;
  const trackDetailsOutcome = useCallback(
    (
      update: TicketUpdate,
      before: TicketRow | null | undefined,
      stagesBefore = outcomeStagesRef.current,
    ): void => {
      if (!before) return;
      const u = update as Record<string, unknown>;
      const surface = 'details' as const;
      if (u['isArchived'] === true) {
        trackTicketOutcome('TICKET_ARCHIVED', before, { surface });
        return;
      }
      // One update can carry several fields (a stage move also sets statusV2;
      // a form save can change type and group). Report each so a multi-field
      // update never hides the second change behind the first.
      if (typeof u['stageName'] === 'string') {
        const list = stagesBefore ?? [];
        const fromSeq = list.find(s => s.name === before.stageName)?.sequenceNumber;
        const toSeq = list.find(s => s.name === u['stageName'])?.sequenceNumber;
        trackTicketOutcome('TICKET_STAGE_CHANGED', before, {
          surface,
          to: u['stageName'],
          previous: before.stageName ?? null,
          ...(typeof u['statusV2'] === 'string' && { toStatus: u['statusV2'] }),
          ...(typeof fromSeq === 'number' &&
            typeof toSeq === 'number' && { isBackward: toSeq < fromSeq }),
        });
      } else if (typeof u['statusV2'] === 'string') {
        // Status riding a stage move is reported as `toStatus` above, not twice.
        trackTicketOutcome('TICKET_STATUS_CHANGED', before, {
          surface,
          to: u['statusV2'],
          previous: before.statusV2 ?? null,
        });
      }
      if ('assignedTo' in u) {
        const next = u['assignedTo'];
        trackTicketOutcome('TICKET_ASSIGNED', before, {
          surface,
          unassigned: !next,
          selfAssigned: !!next && next === currentUser?.id,
          hadAssignee: !!before.assignedTo,
        });
      }
      const enumOutcomes = [
        ['priority', 'TICKET_PRIORITY_CHANGED'],
        ['boardId', 'TICKET_BOARD_CHANGED'],
      ] as const;
      for (const [key, event] of enumOutcomes) {
        if (typeof u[key] === 'string') {
          trackTicketOutcome(event, before, {
            surface,
            to: u[key],
            previous: before[key] ?? null,
          });
        }
      }
      const fieldNames: Record<string, string> = {
        title: 'title',
        description: 'description',
        ticketType: 'ticketType',
        userGroupId: 'userGroup',
        eta: 'eta',
      };
      for (const [key, field] of Object.entries(fieldNames)) {
        if (key in u) trackTicketOutcome('TICKET_FIELD_UPDATED', before, { surface, field });
      }
    },
    [currentUser?.id],
  );

  const applyTicketUpdate = useCallback(
    async (
      update: Parameters<typeof mutators.ticket.update>[0],
      errorFallback = 'Failed to update ticket',
    ): Promise<boolean> => {
      // Snapshot before the await — see trackDetailsOutcome.
      const before = ticketRef.current;
      const stagesBefore = outcomeStagesRef.current;
      try {
        const result = await zero.mutate(mutators.ticket.update(update)).server;
        if (result.type === 'error') {
          toast.error(result.error.message || errorFallback);
          return false;
        }
        trackDetailsOutcome(update, before, stagesBefore);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(message || errorFallback);
        return false;
      }
    },
    [zero, trackDetailsOutcome],
  );

  // Debounced auto-save while editing — persist the title as the user types
  // rather than only on blur/exit. The blur/Enter handler still flushes an
  // immediate save; leaving edit mode flips `editingTitle`, whose cleanup clears
  // any pending debounce, so there's no duplicate write. Email-desk tickets are
  // excluded: a title change there rewrites the email subject via a confirmation
  // dialog, which must not fire on every keystroke.
  useEffect(() => {
    if (!ticket || !editingTitle || isEmailDeskTicket) return;
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === ticket.title) return;
    const ticketId = ticket.id;
    const timeoutId = setTimeout(() => {
      void applyTicketUpdate(
        { id: ticketId, title: trimmed, updatedAt: Date.now() },
        'Failed to update title',
      );
    }, FIELD_AUTOSAVE_DEBOUNCE_MS);
    return (): void => clearTimeout(timeoutId);
  }, [titleValue, editingTitle, isEmailDeskTicket, ticket, applyTicketUpdate]);

  // Debounced auto-save while editing the description (no subject side effect, so
  // it applies to all ticket types).
  useEffect(() => {
    if (!ticket || !editingDescription) return;
    const next = descriptionValue.trim();
    if (next === resolveTicketDescription(ticket)) return;
    const ticketId = ticket.id;
    const timeoutId = setTimeout(() => {
      void applyTicketUpdate(
        { id: ticketId, description: next, updatedAt: Date.now() },
        'Failed to update description',
      );
    }, FIELD_AUTOSAVE_DEBOUNCE_MS);
    return (): void => clearTimeout(timeoutId);
  }, [descriptionValue, editingDescription, ticket, applyTicketUpdate]);

  // Auto-focus tag input when dropdown opens
  useEffect(() => {
    if (showTagDropdown && tagInputRef.current) {
      tagInputRef.current.focus({ preventScroll: true });
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

  const canManageSubTicketLinks = isManualSubTicketBoard(boardData?.boardType);

  // Workspace-wide, like Create Sub-Ticket: a linked sub-ticket may live in any project.
  const [workspaceBoards] = useCachedQuery(queries.getAllBoardsList(), {
    enabled: canManageSubTicketLinks,
  });

  // FLOW/RELEASE boards own their mappings, so their tickets are never linkable by hand.
  const manualBoardIds = useMemo(
    () =>
      (workspaceBoards ?? [])
        .filter(board => isManualSubTicketBoard(board.boardType))
        .map(b => b.id),
    [workspaceBoards],
  );
  // Past the API's cap the filter is dropped; subTicketPickerOptions filters instead.
  const manualBoardIdsFilter = useMemo(
    () =>
      manualBoardIds.length > 0 && manualBoardIds.length <= VESPA_MAX_BOARD_FILTER_VALUES
        ? manualBoardIds.join(',')
        : '',
    [manualBoardIds],
  );

  // Own search state — the Related Tickets picker below keeps its own.
  const [isAddSubTicketMenuOpen, setIsAddSubTicketMenuOpen] = useState(false);
  const [isLinkingSubTicket, setIsLinkingSubTicket] = useState(false);
  const [unlinkingMappingIds, setUnlinkingMappingIds] = useState<Set<string>>(new Set());
  const subTicketSearch = useSubTicketLinkSearch({
    boardIds: manualBoardIdsFilter,
    isActive: isAddSubTicketMenuOpen,
  });

  // The component is reused across tickets rather than remounted.
  useEffect(() => {
    setIsAddSubTicketMenuOpen(false);
    setIsLinkingSubTicket(false);
    setUnlinkingMappingIds(new Set());
  }, [ticketId]);

  const handleAddSubTicketMenuOpenChange = useCallback((open: boolean): void => {
    setIsAddSubTicketMenuOpen(open);
  }, []);

  // Everything already in the loaded tree, so a deeper child is not offered again.
  const linkedSubTicketMappedIds = useMemo(() => {
    const ids = new Set<string>();
    loadedSubTickets.forEach(st => {
      if (st.mappedTicketId) ids.add(st.mappedTicketId);
    });
    return ids;
  }, [loadedSubTickets]);

  const subTicketPickerOptions = useMemo<SelectorOption[]>(() => {
    // Direct parents only — deeper ancestors aren't loaded here, and the server's
    // ancestor walk rejects those with a toast rather than silently linking a loop.
    const parentIds = new Set(parentTicketIds);
    // Backstop for the Vespa board filter, which is dropped past its value cap.
    const manualBoardIdSet = new Set(manualBoardIds);
    return (subTicketSearch.tickets ?? [])
      .filter(
        candidate =>
          candidate.id !== ticketId &&
          !linkedSubTicketMappedIds.has(candidate.id) &&
          !parentIds.has(candidate.id) &&
          (manualBoardIdSet.size === 0 ||
            !candidate.boardId ||
            manualBoardIdSet.has(candidate.boardId)),
      )
      .map(candidate => ({
        value: candidate.id,
        label: candidate.title || candidate.xyneId || candidate.id,
        subtitle: candidate.xyneId || candidate.id,
        icon: null,
      }));
  }, [
    subTicketSearch.tickets,
    ticketId,
    linkedSubTicketMappedIds,
    parentTicketIds,
    manualBoardIds,
  ]);

  const handleLinkSubTicket = useCallback(
    (mappedTicketId: string | null): void => {
      if (!mappedTicketId || !ticket?.id || isLinkingSubTicket) {
        return;
      }

      const candidate = subTicketSearch.tickets?.find(entry => entry.id === mappedTicketId);
      setIsAddSubTicketMenuOpen(false);
      subTicketSearch.reset();
      setIsLinkingSubTicket(true);

      // The row appears once the write replicates back through Zero, not optimistically.
      void subTicketService
        .link(
          ticket.id,
          mappedTicketId,
          // Fallback only — the row renders from the linked ticket itself.
          candidate?.xyneId || candidate?.title || 'Subticket',
        )
        .then(() => {
          trackTicketOutcome('TICKET_LINKED', ticket, {
            surface: 'details',
            relation: 'sub_ticket',
          });
        })
        .catch((error: unknown) => {
          toast.error(getSubTicketLinkErrorMessage(error, 'Failed to link sub-ticket'));
        })
        .finally(() => {
          setIsLinkingSubTicket(false);
        });
    },
    [isLinkingSubTicket, subTicketSearch, ticket?.id],
  );

  const handleUnlinkSubTicket = useCallback(
    (mappingId: string): void => {
      if (unlinkingMappingIds.has(mappingId)) {
        return;
      }

      setUnlinkingMappingIds(previous => new Set(previous).add(mappingId));

      const clearInFlight = (): void => {
        setUnlinkingMappingIds(previous => {
          const next = new Set(previous);
          next.delete(mappingId);
          return next;
        });
      };

      void subTicketService
        .unlink(mappingId)
        .then(() => {
          trackTicketOutcome('TICKET_UNLINKED', ticketRef.current, {
            surface: 'details',
            relation: 'sub_ticket',
          });
        })
        .catch((error: unknown) => {
          toast.error(getSubTicketLinkErrorMessage(error, 'Failed to unlink sub-ticket'));
        })
        .finally(clearInFlight);
    },
    [unlinkingMappingIds],
  );

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

  const handleUnmerge = async (
    sourceTicketId: string,
    sourceTicketXyneId?: string | null,
  ): Promise<void> => {
    // Guard against a missing/empty source ticket id — without this the request
    // URL collapses to `/tickets//unmerge` (empty path segment). The call site
    // also avoids invoking us without an id, but this keeps the API boundary safe.
    if (!sourceTicketId) return;
    try {
      await apiInstance.post(`/tickets/${sourceTicketId}/unmerge`);
      toast.success('Ticket unmerged successfully');

      // Navigate to the unmerged ticket
      if (sourceTicketXyneId) {
        const channelId = ticket.channelId || ticket.conversation?.channelId;
        if (channelId) {
          const pathParts = location.pathname.split('/').filter(Boolean);
          const supportIdx = pathParts.indexOf('support');
          const basePath =
            supportIdx >= 0 ? '/' + pathParts.slice(0, supportIdx + 1).join('/') : '/support';
          void navigate(`${basePath}/${channelId}/${sourceTicketXyneId}`);
        }
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to unmerge ticket'));
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
      void applyTicketUpdate(
        {
          id: ticket.id,
          title: titleValue.trim(),
          updatedAt: Date.now(),
        },
        'Failed to update title',
      );
    }
    setEditingTitle(false);
  };

  const handleSaveDescription = (): void => {
    if (descriptionValue !== resolveTicketDescription(ticket)) {
      void applyTicketUpdate(
        {
          id: ticket.id,
          description: descriptionValue.trim(),
          updatedAt: Date.now(),
        },
        'Failed to update description',
      );
    }
    setEditingDescription(false);
  };

  const handlePriorityChange = (priority: string): void => {
    void applyTicketUpdate(
      {
        id: ticket.id,
        priority: priority as TicketPriority,
        updatedAt: Date.now(),
      },
      'Failed to update priority',
    );
  };

  const handleAssigneeChange = (userId: string | null): void => {
    void applyTicketUpdate(
      {
        id: ticket.id,
        assignedTo: userId,
        updatedAt: Date.now(),
      },
      'Failed to update assignee',
    );
  };

  const handleTicketTypeChange = (type: string): void => {
    void applyTicketUpdate(
      {
        id: ticket.id,
        ticketType: type,
        updatedAt: Date.now(),
      },
      'Failed to update ticket type',
    );
  };

  const handleUserGroupChange = (groupId: string | null): void => {
    void applyTicketUpdate(
      {
        id: ticket.id,
        userGroupId: groupId ?? undefined,
        updatedAt: Date.now(),
      },
      'Failed to update team',
    );
  };

  const handleStageChange = (stageName: string): void => {
    if (!ticket) return;
    // Re-selecting the current stage has no edge to itself — skip the edge gate below.
    // Scoped to NON_LINEAR so the linear flow is untouched.
    if (isNonLinearBoard && stageName === ticket.stageName) return;

    const hasTransitionsDefined = stageTransitions.length > 0;

    // Shared helper: open the stage form modal given a target stage + formId.
    const openStageForm = (
      targetStageObj: StageInfo,
      formId: string,
      hasApprovers: boolean,
    ): void => {
      // Only pass an active (SUBMITTED/DRAFT) request — an APPROVED/REJECTED request from
      // a prior visit would lock the form fields and show "Form approved", blocking revisits.
      const existingRequest = ticket.ticketStageRequests?.find(
        r =>
          r.stageId === targetStageObj.id &&
          (r.status === TicketStageRequestStatus.SUBMITTED ||
            r.status === TicketStageRequestStatus.DRAFT),
      );
      setStageFormModal({
        ticket,
        targetStage: { ...targetStageObj, formId },
        sourceStageName: ticket.stageName || '',
        formId,
        isReviewer: false,
        hasApprovers,
        existingRequest: existingRequest || null,
      });
    };

    // Shared helper: apply form gate → approval gate → nonLinear.transition for a found transition.
    const execTransition = (
      mt: {
        formId?: string | null;
        requiresApproval?: boolean | null; // NULL treated as false in code
        transitionApprovers?: ReadonlyArray<{
          userId: string | null;
          roleId: string | null;
          approverType?: string | null; // NULL treated as USER in code
        }>;
      },
      _currentStageObj: { id: string; name: string },
      targetStageObj: StageInfo,
    ): void => {
      // Forms on NON_LINEAR boards are EDGE-specific: only the matched transition's formId may
      // gate this move. Do NOT fall back to stageFormMap — it aggregates formIds by target stage
      // (from stage-level mappings AND every transition into that stage), so it would open the
      // form on EVERY move into the stage (e.g. COMPLETED→IN PROGRESS firing the form configured
      // on BACKLOG→IN PROGRESS). If the edge's formId lags in the Zero cache, the server form-gate
      // + recovery path opens the modal. Other board types keep the stageFormMap fallback.
      const resolvedFormId: string | null = isNonLinearBoard
        ? (mt.formId ?? null)
        : (mt.formId ?? stageFormMap.get(targetStageObj.id) ?? null);

      if (resolvedFormId) {
        const hasApproversForTarget = isNonLinearBoard
          ? (mt.transitionApprovers?.length ?? 0) > 0
          : (mt.transitionApprovers?.length ?? 0) > 0 ||
            stageTransitions.some(
              t => t.toStageId === targetStageObj.id && (t.transitionApprovers?.length ?? 0) > 0,
            );
        openStageForm(targetStageObj, resolvedFormId, hasApproversForTarget);
        return;
      }
      if (mt.requiresApproval) {
        const isApprover =
          mt.transitionApprovers?.some(a => {
            const type = (a.approverType ?? 'USER') as 'USER' | 'ROLE';
            if (type === 'ROLE') return !!a.roleId && currentUserRoleIds.includes(a.roleId);
            return a.userId === currentUser?.id;
          }) ?? false;
        if (!isApprover) {
          // Reuse the existing record's ID for revisits (unique constraint on ticketId+stageId)
          const existingForStage = ticket.ticketStageRequests?.find(
            r => r.stageId === targetStageObj.id,
          );
          void zero.mutate(
            mutators.ticketStageRequest.upsert({
              id: existingForStage?.id ?? uuidv4(),
              ticketId: ticket.id,
              stageId: targetStageObj.id,
              status: TicketStageRequestStatus.SUBMITTED,
              updatedBy: currentUser?.id || '',
              updatedAt: Date.now(),
              requestActivityId: uuidv4(),
            }),
          );
          toast.success('Stage change request submitted for approval');
          return;
        }
      }
      // Fire optimistic mutation. If Zero cache lagged and the server finds a form gate,
      // it returns the formId in error.details — open the form from there.
      const capturedTargetStage = targetStageObj;
      const capturedBoardId = ticket.boardId;
      const capturedCurrentStageName = ticket.stageName;
      const transitionResult = zero.mutate(
        mutators.nonLinear.transition({
          ticketId: ticket.id,
          toStageName: stageName,
          now: Date.now(),
        }),
      );
      void (
        transitionResult as {
          server: Promise<
            | {
                type: string;
                error?: { type: string; message: string; details?: { formId?: string } };
              }
            | undefined
          >;
        }
      ).server.then(async serverResult => {
        if (
          serverResult?.type === 'error' &&
          serverResult.error?.message === 'This transition requires a form to be submitted'
        ) {
          // 2. Try latest transitions from ref (Zero may have synced by now).
          const latestTransitions = stageTransitionsRef.current;
          const currentStageObj = stagesRef.current?.find(s => s.name === capturedCurrentStageName);
          const latestMt =
            latestTransitions.length > 0 && currentStageObj
              ? latestTransitions.find(
                  t =>
                    t.fromStageId === currentStageObj.id && t.toStageId === capturedTargetStage.id,
                )
              : undefined;

          // 1. Try server error details (fastest path).
          const directFormId = serverResult.error.details?.formId;
          if (directFormId) {
            const hasApproversT1 = (latestMt?.transitionApprovers?.length ?? 0) > 0;
            openStageForm(capturedTargetStage, directFormId, hasApproversT1);
            return;
          }

          // Use formId from the matched transition only — stageFormMap is ambiguous when
          // multiple transitions go to the same stage with different formIds.
          const refFormId = latestMt?.formId ?? null;
          if (refFormId) {
            openStageForm(
              capturedTargetStage,
              refFormId,
              (latestMt?.transitionApprovers?.length ?? 0) > 0,
            );
            return;
          }

          // 3. Force-fetch from Zero server as final fallback.
          // No try/catch: Zero queries resolve through the cache and don't throw here.
          if (capturedBoardId) {
            const freshTransitions = await zero.run(
              queries.getStageTransitionsByBoardId({ boardId: capturedBoardId }),
              { type: 'complete' },
            );
            if (freshTransitions) {
              const freshMt = freshTransitions.find(
                t =>
                  t.fromStageId === currentStageObj?.id && t.toStageId === capturedTargetStage.id,
              );
              const freshFormId = freshMt?.formId ?? null;
              if (freshFormId) {
                openStageForm(
                  capturedTargetStage,
                  freshFormId,
                  (freshMt?.transitionApprovers?.length ?? 0) > 0,
                );
              }
            }
          }
        }
      });
    };

    if (isNonLinearBoard) {
      // ticket.stageName===null means initial stage placement — skip transition restrictions.
      if (hasTransitionsDefined && ticket.stageName !== null) {
        const currentStageObj = stages?.find(s => s.name === ticket.stageName);
        const targetStageObj = stages?.find(s => s.name === stageName);
        // If stages haven't finished loading, fall through to the direct nonLinear.transition call.
        if (currentStageObj && targetStageObj) {
          // NON_LINEAR is edge-gated: a move must match an edge. A terminal stage (no outgoing
          // edges) matches none and is blocked here (mirrors the backend mutator).
          const matchingTransition = findMatchingTransition(
            stageTransitions,
            currentStageObj.id,
            targetStageObj.id,
          );
          if (!matchingTransition) {
            toast.error('This stage transition is not allowed');
            return;
          }
          execTransition(matchingTransition, currentStageObj, targetStageObj);
          return;
        }
      }
      // No transition graph on the board, or stages still loading — perform the move directly.
      const currentStageObj = stages?.find(s => s.name === ticket.stageName);
      const targetStageObj = stages?.find(s => s.name === stageName);
      if (currentStageObj && targetStageObj) {
        execTransition({}, currentStageObj, targetStageObj);
      } else {
        void zero.mutate(
          mutators.nonLinear.transition({
            ticketId: ticket.id,
            toStageName: stageName,
            now: Date.now(),
          }),
        );
      }
      return;
    }

    // Transition-based gate: linear boards with explicit transitions defined
    if (hasTransitionsDefined) {
      const currentStageObj = stages?.find(s => s.name === ticket.stageName);
      const targetStageObj = stages?.find(s => s.name === stageName);
      if (!currentStageObj || !targetStageObj) {
        toast.error('Stage not found');
        return;
      }
      const matchingTransition = findMatchingTransition(
        stageTransitions,
        currentStageObj.id,
        targetStageObj.id,
      );
      if (matchingTransition) {
        execTransition(matchingTransition, currentStageObj, targetStageObj);
        return;
      }
      // No matching transition — fall through to legacy gate
    }

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
      const existingRequest = ticket.ticketStageRequests?.find(
        r =>
          r.stageId === targetStage.id &&
          (r.status === TicketStageRequestStatus.SUBMITTED ||
            r.status === TicketStageRequestStatus.DRAFT),
      );
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
    void applyTicketUpdate(
      {
        id: ticket.id,
        stageName,
        ...(newStatus && { statusV2: newStatus }),
        updatedAt: Date.now(),
      },
      'Failed to update stage',
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

    void zero
      .mutate(
        mutators.ticketStageEta.update({
          id: entryId,
          stageEta: newStageEtaDate.getTime(),
          updatedAt: Date.now(),
          ticketId: ticket.id,
          stageId: currentStage.id,
        }),
      )
      .server.then(result => {
        if (result.type !== 'error') {
          trackTicketOutcome('TICKET_FIELD_UPDATED', ticket, {
            surface: 'details',
            field: 'stageEta',
          });
        }
      })
      .catch((err: unknown) => {
        logger.error(LogEvent.ZERO_MUTATION_ERROR, {
          component: 'TicketDetails',
          mutator: 'ticketStageEta.update',
          error: err instanceof Error ? err.message : String(err),
        });
      });

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

    void applyTicketUpdate(updateData, 'Failed to update due date');
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

    void applyTicketUpdate(
      {
        id: ticket.id,
        boardId: pendingBoardChange,
        updatedAt: Date.now(),
      },
      'Failed to change board',
    );

    setShowBoardChangeConfirmDialog(false);
    setPendingBoardChange(null);
  };

  const handleToggleTag = (tagName: string): void => {
    const existingTag = tags?.find(t => t.tagName === tagName);

    const tagMutation = existingTag
      ? zero.mutate(
          mutators.ticketTagV2.delete({
            tagId: existingTag.id,
            mappingId: existingTag.id,
          }),
        )
      : zero.mutate(
          mutators.ticketTagV2.create({
            ticketId: ticket.id,
            tagId: uuidv4(),
            projectTagId: uuidv4(),
            mappingId: uuidv4(),
            projectId: ticket.projectId,
            tagName: tagName.trim(),
          }),
        );
    // Outcome only once the server confirmed, not on the optimistic apply.
    void surfaceMutationError(tagMutation, 'Failed to update labels').then(ok => {
      if (ok) {
        trackTicketOutcome('TICKET_FIELD_UPDATED', ticket, {
          surface: 'details',
          field: 'tags',
          action: existingTag ? 'remove' : 'add',
        });
      }
    });

    setTagSearchQuery('');
  };

  const handleRemoveTag = (tagId: string): void => {
    void surfaceMutationError(
      zero.mutate(
        mutators.ticketTagV2.delete({
          tagId,
          mappingId: tagId,
        }),
      ),
      'Failed to remove label',
    ).then(ok => {
      if (ok) {
        trackTicketOutcome('TICKET_FIELD_UPDATED', ticket, {
          surface: 'details',
          field: 'tags',
          action: 'remove',
        });
      }
    });
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

    void applyTicketUpdate(
      { id: ticket.id, isArchived: true, updatedAt: Date.now() },
      'Failed to archive ticket',
    ).then(ok => {
      if (ok) toast.success('Ticket archived successfully');
    });
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

  const handleFormFieldSave = (
    formEntityValueId: string,
    newValue: string[],
    isPlaceholder: boolean,
    formId?: string,
  ): void => {
    // Check if this is a placeholder field (no existing record)
    const formFieldId = isPlaceholder
      ? formEntityValueId.replace(/^(placeholder|prefill)-/, '')
      : '';
    let fieldMutation: Parameters<typeof surfaceMutationError>[0];

    if (isPlaceholder) {
      const resolvedFormId = formId ?? boardCustomFieldsFormId;
      if (!resolvedFormId) {
        toast.error('Cannot save field', {
          description: 'Board custom fields form is not available yet. Please try again.',
        });
        return;
      }

      // Create a new form entity value record
      fieldMutation = zero.mutate(
        mutators.formEntityValue.createV2({
          id: uuidv4(),
          entityId: ticketId,
          entityType: FormEntityType.TICKET,
          fieldId: formFieldId,
          formId: resolvedFormId,
          newValue,
          timestamp: Date.now(),
          contextId: ticket.boardId,
        }),
      );
    } else {
      // Update existing record
      fieldMutation = zero.mutate(
        mutators.formEntityValue.update({
          formEntityValueId,
          newValue,
          updatedAt: Date.now(),
        }),
      );
    }
    // Field id only — the value is user content. Reported once the server
    // confirmed, not on the optimistic apply.
    void surfaceMutationError(fieldMutation, 'Failed to save field').then(ok => {
      if (ok) {
        trackTicketOutcome('TICKET_FIELD_UPDATED', ticket, {
          surface: 'details',
          field: 'dynamicField',
          isPlaceholder,
          valueCount: newValue.length,
        });
      }
    });
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
    const assigneeId = relatedTicket?.assignedTo?.replace(/^(user:|group:)/, '') || '';
    const priorityIcon = relatedTicket?.priority ? getPriorityIcon(relatedTicket.priority) : null;
    const title = getReferenceTitle(relatedTicket);

    return (
      <div
        key={reference.id}
        className='group flex h-11 items-center gap-3 rounded-[11px] border border-border bg-background px-3 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-muted-foreground/40 hover:shadow-[0_1px_3px_rgba(20,22,26,0.06)]'
      >
        {allowEdit ? (
          <div className='relative inline-flex shrink-0 items-center'>
            <select
              className='h-[21px] cursor-pointer appearance-none rounded-[5px] border border-border bg-muted pl-2 pr-5 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
              value={reference.relationType}
              onChange={event =>
                handleReferenceRelationChange(
                  reference.id,
                  event.target.value as TicketReferenceRelation,
                )
              }
              aria-label='Relation type'
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
            <ChevronDown className='pointer-events-none absolute right-1 h-3 w-3 text-muted-foreground' />
          </div>
        ) : isFlowRunPaused ? (
          <span
            className='inline-flex h-[21px] shrink-0 items-center rounded-[5px] border border-border bg-muted px-2 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-muted-foreground'
            title='Flow run is paused. Resume main ticket before completing this step.'
          >
            Paused
          </span>
        ) : (
          <span className='inline-flex h-[21px] shrink-0 items-center rounded-[5px] border border-border bg-muted px-2 text-[10.5px] font-semibold uppercase tracking-[0.3px] text-muted-foreground'>
            {label}
          </span>
        )}

        <span className='shrink-0 font-mono text-[12.5px] tracking-[0.2px] text-muted-foreground'>
          {relatedTicket?.xyneId || relatedTicket?.id || '—'}
        </span>

        {link ? (
          onNavigateToTicket ? (
            <button
              type='button'
              onClick={() => onNavigateToTicket(relatedTicket!.id!)}
              className='min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold text-foreground hover:underline'
              data-track-category='Tickets'
              data-track-name='NavigateToRelatedTicket'
            >
              {title}
            </button>
          ) : (
            <Link
              className='min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground'
              to={link}
              state={{ trackSource: 'related_ticket' }}
            >
              {title}
            </Link>
          )
        ) : (
          <span className='min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground'>
            {title}
          </span>
        )}

        <span className='flex shrink-0 items-center gap-1.5'>
          <StageIndicator stages={boardStages} stageName={relatedTicket?.stageName} size={16} />
          <span className='text-[11px] font-semibold uppercase tracking-[0.3px] text-muted-foreground'>
            {relatedTicket?.stageName ?? '—'}
          </span>
        </span>

        {priorityIcon && <span className='flex shrink-0 items-center'>{priorityIcon}</span>}

        {assigneeId ? (
          <UserAvatar
            userId={assigneeId}
            size={AvatarSize.SM}
            shape={AvatarShape.ROUNDED}
            showActiveStatus={false}
          />
        ) : (
          <span className='h-[22px] w-[22px] shrink-0 rounded-md border border-border bg-muted' />
        )}

        {onUnmerge && (
          <button
            type='button'
            onClick={onUnmerge}
            data-ph-capture-attribute-track-id='unmerge_ticket'
            className='shrink-0 whitespace-nowrap text-[12px] font-medium text-primary hover:text-primary/80'
            data-track-category='Tickets'
            data-track-name='UnmergeTicket'
          >
            Unmerge
          </button>
        )}

        {allowEdit && (
          <button
            type='button'
            className='flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100'
            onClick={() => handleRemoveReference(reference.id)}
            data-ph-capture-attribute-track-id='remove_ticket_reference'
            aria-label={`Unlink ${relatedTicket?.xyneId ?? 'ticket'}`}
            title='Unlink'
            data-track-category='Tickets'
            data-track-name='RemoveReference'
            data-track-metadata={JSON.stringify({ referenceId: reference.id })}
          >
            <X size={15} />
          </button>
        )}
      </div>
    );
  };

  const openMappedSubTicket = (
    mappedTicketId: string | null | undefined,
    mappedTicket?: {
      channelId: string;
      xyneId?: string | null;
      conversationId?: string | null;
    } | null,
  ): void => {
    if (!mappedTicketId) return;

    if (mappedTicket) {
      const channelType = channelTypeMap.get(mappedTicket.channelId);
      if (isDeskChannelType(channelType) && mappedTicket.xyneId) {
        const workspaceId = location.pathname.split('/')[1];
        void navigate(
          `/${workspaceId}/support/${mappedTicket.channelId}/${mappedTicket.xyneId}?selectedTab=thread`,
          { state: { trackSource: 'ticket_details' } },
        );
        return;
      }
    }

    if (onNavigateToTicket) {
      onNavigateToTicket(mappedTicketId);
    } else {
      setMappedTicketId(mappedTicketId);
    }
  };

  const renderSubTicketNode = (node: SubTicketTreeNode): React.ReactElement => {
    const { subTicket } = node;
    const isFlowBoard = boardData?.boardType === BoardType.FLOW;
    const mappedTicket = subTicket.mappedTicket;
    const mappedTicketId = subTicket.mappedTicketId ?? undefined;
    const canExpand = Boolean(mappedTicketId) && !isFlowBoard;
    const isExpanded = mappedTicketId
      ? canExpand && expandedSubTicketTicketIds.has(mappedTicketId)
      : false;
    const displayId = mappedTicket?.xyneId || subTicket.id.substring(0, 8).toUpperCase();
    const displayTitle = mappedTicket?.title || subTicket.title;
    const boardStages = mappedTicket?.boardId
      ? stagesByBoardId.get(mappedTicket.boardId)
      : undefined;
    const priority = mappedTicket?.priority;
    const assignedTo = mappedTicket?.assignedTo;
    const priorityIcon = priority ? getPriorityIcon(priority) : null;
    const assigneeId = assignedTo?.replace(/^(user:|group:)/, '') || '';
    // Mirrors subTicket.unlink: only rows carrying the derived id are unlinkable. Keyed on
    // `node.parentTicketId`, so a nested row is checked against its own parent.
    const canUnlink =
      Boolean(mappedTicketId) &&
      subTicket.id === linkedSubTicketId(node.parentTicketId, mappedTicketId ?? '');
    const isUnlinking = unlinkingMappingIds.has(node.mappingId);

    const handleRowClick = (): void => {
      if (mappedTicketId) {
        if (mappedTicket) {
          const channelType = channelTypeMap.get(mappedTicket.channelId);
          if (isDeskChannelType(channelType) && mappedTicket.xyneId) {
            const pathParts = location.pathname.split('/');
            const workspaceId = pathParts[1];
            void navigate(
              `/${workspaceId}/support/${mappedTicket.channelId}/${mappedTicket.xyneId}?selectedTab=thread`,
              { state: { trackSource: 'ticket_details' } },
            );
          } else {
            const workspaceId = location.pathname.split('/')[1];
            const base = buildChannelRoute(
              `${mappedTicket.channelId}/${mappedTicket.conversationId}/${mappedTicket.id}`,
              { selectedTab: 'thread' },
            );
            void navigate(`/${workspaceId}${base}#origin=${mappedTicket.conversationId}`, {
              state: { trackSource: 'sub_ticket' },
            });
          }
        }
        return;
      }

      setSelectedSubTicket(subTicket);
      setIsCreateTicketModalOpen(true);
    };

    return (
      <React.Fragment key={subTicket.id}>
        <div
          role='button'
          tabIndex={0}
          onClick={handleRowClick}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleRowClick();
            }
          }}
          data-testid={`sub-ticket-item-${subTicket.id}`}
          data-track-category='Tickets'
          data-track-name='OpenSubTicket'
          data-track-metadata={JSON.stringify({
            subTicketId: subTicket.id,
            parentTicketId: node.parentTicketId,
            mappedTicketId: subTicket.mappedTicketId,
            depth: node.depth,
          })}
          className='flex h-11 cursor-pointer items-center justify-between gap-3 rounded-[11px] border border-border bg-background px-3 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-muted-foreground/40 hover:shadow-[0_1px_3px_rgba(20,22,26,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          style={{ marginLeft: node.depth * 18 }}
        >
          <div className='flex items-center gap-2 flex-1 min-w-0'>
            {canExpand ? (
              <button
                type='button'
                className='flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
                onClick={event => {
                  event.stopPropagation();
                  if (mappedTicketId) toggleSubTicketBranch(mappedTicketId);
                }}
                aria-label={isExpanded ? 'Collapse sub-ticket tree' : 'Expand sub-ticket tree'}
                data-track-category='Tickets'
                data-track-name={isExpanded ? 'CollapseSubTicketTree' : 'ExpandSubTicketTree'}
                data-track-metadata={JSON.stringify({
                  subTicketId: subTicket.id,
                  mappedTicketId,
                  depth: node.depth,
                })}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className='h-5 w-5 shrink-0' />
            )}
            <span className='shrink-0 whitespace-nowrap font-mono text-[12.5px] tracking-[0.2px] text-muted-foreground'>
              {displayId}
            </span>
            <span className='truncate text-[13.5px] font-semibold text-foreground'>
              {displayTitle}
            </span>
          </div>
          <div className='flex items-center gap-3 shrink-0'>
            {mappedTicketId && (
              <Tooltip content='Open ticket'>
                <button
                  type='button'
                  className='flex h-7 w-7 items-center justify-center rounded-md text-blue-600 transition-colors hover:bg-background'
                  onClick={event => {
                    event.stopPropagation();
                    openMappedSubTicket(mappedTicketId, mappedTicket);
                  }}
                  aria-label='Open mapped ticket'
                  data-track-category='Tickets'
                  data-track-name='OpenMappedSubTicket'
                  data-track-metadata={JSON.stringify({
                    subTicketId: subTicket.id,
                    mappedTicketId,
                    depth: node.depth,
                  })}
                >
                  <FileText size={14} />
                </button>
              </Tooltip>
            )}
            {canUnlink && (
              <Tooltip content='Unlink sub-ticket'>
                <button
                  type='button'
                  disabled={isUnlinking}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
                    isUnlinking
                      ? 'cursor-not-allowed opacity-50'
                      : 'hover:bg-background hover:text-destructive',
                  )}
                  onClick={event => {
                    event.stopPropagation();
                    handleUnlinkSubTicket(node.mappingId);
                  }}
                  aria-label='Unlink sub-ticket'
                  data-track-category='Tickets'
                  data-track-name='UnlinkSubTicket'
                  data-track-metadata={JSON.stringify({
                    subTicketId: subTicket.id,
                    mappingId: node.mappingId,
                    mappedTicketId,
                    depth: node.depth,
                  })}
                >
                  <Unlink size={14} />
                </button>
              </Tooltip>
            )}
            {boardStages && boardStages.length > 0 && (
              <div className='flex items-center gap-1.5'>
                <StageIndicator
                  stages={boardStages}
                  stageName={mappedTicket?.stageName}
                  size={18}
                />
                <span className='whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.3px] text-foreground'>
                  {mappedTicket?.stageName ?? '—'}
                </span>
                <span className='whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground/80'>
                  {boardStages.findIndex(stage => stage.name === mappedTicket?.stageName) + 1}/
                  {boardStages.length}
                </span>
              </div>
            )}
            {priorityIcon && <span className='flex items-center'>{priorityIcon}</span>}
            {assigneeId ? (
              <UserAvatar
                userId={assigneeId}
                size={AvatarSize.SM}
                shape={AvatarShape.ROUNDED}
                showActiveStatus={false}
              />
            ) : (
              <span className='h-[22px] w-[22px] shrink-0 rounded-md border border-border bg-muted' />
            )}
          </div>
        </div>
        {!isFlowBoard && isExpanded && node.children.length > 0 && (
          <div className='space-y-2'>{node.children.map(renderSubTicketNode)}</div>
        )}
      </React.Fragment>
    );
  };

  const renderParentTicketRow = (
    parentTicket: NonNullable<typeof parentTickets>[number],
  ): React.ReactElement => {
    const boardStages = parentTicket.boardId
      ? stagesByBoardId.get(parentTicket.boardId)
      : undefined;
    const stageIndex = boardStages?.findIndex(stage => stage.name === parentTicket.stageName) ?? -1;
    const priorityIcon = parentTicket.priority ? getPriorityIcon(parentTicket.priority) : null;
    const assigneeId = parentTicket.assignedTo?.replace(/^(user:|group:)/, '') || '';

    const navigateToParentTicket = (): void => {
      const channelType = channelTypeMap.get(parentTicket.channelId);
      if (isDeskChannelType(channelType) && parentTicket.xyneId) {
        const pathParts = location.pathname.split('/');
        const workspaceId = pathParts[1];
        void navigate(
          `/${workspaceId}/support/${parentTicket.channelId}/${parentTicket.xyneId}?selectedTab=thread`,
          { state: { trackSource: 'ticket_details' } },
        );
      } else {
        const workspaceId = location.pathname.split('/')[1];
        const base = buildChannelRoute(
          `${parentTicket.channelId}/${parentTicket.conversationId}/${parentTicket.id}`,
          { selectedTab: 'thread' },
        );
        void navigate(`/${workspaceId}${base}#origin=${parentTicket.conversationId}`, {
          state: { trackSource: 'parent_ticket' },
        });
      }
    };

    const openParentTicket = (): void => {
      if (onNavigateToTicket) {
        onNavigateToTicket(parentTicket.id);
      } else {
        setMappedTicketId(parentTicket.id);
      }
    };

    return (
      <div
        key={parentTicket.id}
        role='button'
        tabIndex={0}
        onClick={navigateToParentTicket}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigateToParentTicket();
          }
        }}
        data-testid={`parent-ticket-item-${parentTicket.id}`}
        className='flex h-11 cursor-pointer items-center justify-between gap-3 rounded-[11px] border border-border bg-background px-3 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-muted-foreground/40 hover:shadow-[0_1px_3px_rgba(20,22,26,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        data-track-category='Tickets'
        data-track-name='ViewParentTicket'
        data-track-metadata={JSON.stringify({ parentTicketId: parentTicket.id })}
      >
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className='flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground/70'>
            <ArrowTurnLeftUp size={14} />
          </span>
          <span className='shrink-0 whitespace-nowrap font-mono text-[12.5px] tracking-[0.2px] text-muted-foreground'>
            {parentTicket.xyneId || parentTicket.id.substring(0, 8).toUpperCase()}
          </span>
          <span className='truncate text-[13.5px] font-semibold text-foreground'>
            {parentTicket.title || 'Untitled Ticket'}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-3'>
          <Tooltip content='Open ticket'>
            <button
              type='button'
              className='flex h-7 w-7 items-center justify-center rounded-md text-blue-600 transition-colors hover:bg-background'
              onClick={event => {
                event.stopPropagation();
                openParentTicket();
              }}
              aria-label='Open parent ticket'
              data-track-category='Tickets'
              data-track-name='OpenParentTicket'
              data-track-metadata={JSON.stringify({ parentTicketId: parentTicket.id })}
            >
              <FileText size={14} />
            </button>
          </Tooltip>
          {boardStages && boardStages.length > 0 && (
            <div className='flex items-center gap-1.5'>
              <StageIndicator stages={boardStages} stageName={parentTicket.stageName} size={18} />
              <span className='whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.3px] text-foreground'>
                {parentTicket.stageName ?? '—'}
              </span>
              <span className='whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground/80'>
                {stageIndex + 1}/{boardStages.length}
              </span>
            </div>
          )}
          {priorityIcon && <span className='flex items-center'>{priorityIcon}</span>}
          {assigneeId ? (
            <UserAvatar
              userId={assigneeId}
              size={AvatarSize.SM}
              shape={AvatarShape.ROUNDED}
              showActiveStatus={false}
            />
          ) : (
            <span className='h-[22px] w-[22px] shrink-0 rounded-md border border-border bg-muted' />
          )}
        </div>
      </div>
    );
  };

  // Hidden only on machine-owned boards. A sub-ticket can take sub-tickets of its own —
  // trees nest, and the server rejects anything that would close a loop.
  const addSubTicketPicker = !canManageSubTicketLinks ? null : (
    <div
      className={cn(
        'mt-3 rounded-lg border border-border px-3 py-2 flex items-center',
        isLinkingSubTicket ? 'opacity-60 pointer-events-none' : undefined,
      )}
      data-testid='add-sub-ticket-picker'
    >
      <EntitySelector
        options={subTicketPickerOptions}
        selectedValue={null}
        onSelect={value => handleLinkSubTicket(value)}
        placeholder='+ Add existing sub-ticket'
        searchPlaceholder='Search by ticket ID or name'
        isOpen={isAddSubTicketMenuOpen}
        onOpenChange={handleAddSubTicketMenuOpenChange}
        onSearchChange={subTicketSearch.handleSearchChange}
        onScrollEnd={subTicketSearch.handleScrollEnd}
        hasMore={subTicketSearch.hasMore}
        isLoading={subTicketSearch.isLoading}
        disableClientFiltering={true}
        width='100%'
        noBorder
        testId='add-sub-ticket-selector'
      />
    </div>
  );

  const createSubTicketButton =
    boardData?.boardType === BoardType.FLOW ? null : (
      <button
        onClick={() => setIsSubTicketModalOpen(true)}
        data-testid='create-sub-ticket-button'
        data-track-event='BUTTON_CLICK'
        data-track-category='Tickets'
        data-track-name='CREATE_SUB_TICKET'
        data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
        className='flex items-center gap-2 mt-3 pl-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground'
      >
        <Plus size={16} />
        Create Sub-Ticket
      </button>
    );

  return (
    <div className='mx-auto px-[20px] pb-[72px] h-full overflow-auto no-scrollbar bg-background'>
      {expandedView && (
        <div className='flex h-14 items-center justify-between gap-3'>
          <div className='-ml-3 flex min-w-0 items-center gap-1'>
            {!hideBackNav && (
              <>
                <button
                  type='button'
                  onClick={handleBackFromExpandedView}
                  aria-label='Back'
                  className={cn(
                    'flex shrink-0 items-center justify-center transition-colors',
                    EXPANDED_HEADER_ICON_BUTTON,
                  )}
                  data-track-category='Tickets'
                  data-track-name='BackFromExpandedView'
                >
                  <ChevronLeft size={16} />
                </button>
                <Tooltip content='Copy ticket ID'>
                  <button
                    type='button'
                    onClick={() => {
                      void navigator.clipboard.writeText(ticket.xyneId);
                      toast.success('Copied', {
                        description: 'Ticket ID copied to clipboard',
                        duration: 2000,
                      });
                    }}
                    aria-label={`Copy ticket ID ${ticket.xyneId}`}
                    className='truncate font-mono text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground'
                    data-track-category='Tickets'
                    data-track-name='COPY_TICKET_ID'
                  >
                    {ticket.xyneId}
                  </button>
                </Tooltip>
              </>
            )}
          </div>
          <div className='-mr-2 flex shrink-0 items-center gap-0.5'>
            <BoardTicketNav ticketId={ticketId} />
            {/* A control of its own rather than an item in an overflow menu,
                because this header has no overflow menu to put it in. Carries
                the channel and conversation so the column has a way across to
                the discussion under the ticket — a ticket column without them
                renders fine and dead-ends, which is the thing a stream exists
                not to be. */}
            <AddToStreamButton
              source={{
                kind: 'ticket',
                ticketId,
                ...(ticket.channelId ? { channelId: ticket.channelId } : {}),
                ...(ticket.conversationId ? { conversationId: ticket.conversationId } : {}),
              }}
              className='h-[30px] w-[30px] rounded-lg hover:bg-muted'
            />
            <Tooltip content='Copy Ticket Link'>
              <Button
                className={EXPANDED_HEADER_ICON_BUTTON}
                variant='ghost'
                size='iconSm'
                onClick={handleCopyTicketViewLink}
                data-track-category='Tickets'
                data-track-name='COPY_TICKET_LINK'
                data-track-metadata={JSON.stringify(ticketTrackingMetadata(ticket))}
                aria-label='Copy Ticket'
              >
                <LinkIcon size={16} />
              </Button>
            </Tooltip>
            <Tooltip content='Summarize thread'>
              <Button
                variant='ghost'
                size='iconSm'
                className={EXPANDED_HEADER_ICON_BUTTON}
                onClick={() => {
                  void navigate(
                    `${baseRoute}/${ticket.channelId}/${ticket.conversationId}#thread-summary`,
                  );
                }}
                data-track-category='Tickets'
                data-track-name='SUMMARIZE_THREAD'
                data-track-metadata={JSON.stringify({
                  ticketId: ticket?.id,
                  channelId: ticket?.channelId,
                })}
                title='Summarize thread'
              >
                <Sparkles size={16} />
              </Button>
            </Tooltip>
            <Tooltip content={'Archive Ticket'}>
              <Button
                className={EXPANDED_HEADER_ICON_BUTTON}
                variant='ghost'
                size='iconSm'
                onClick={() => setShowArchiveConfirmDialog(true)}
                data-track-category='Tickets'
                data-track-name='OPEN_ARCHIVE_TICKET_CONFIRM'
                data-track-metadata={JSON.stringify({ ticketId: ticket?.id })}
                disabled={ticket?.isArchived}
                aria-label='Archive Ticket'
              >
                <Archive size={16} />
              </Button>
            </Tooltip>
            <Tooltip content='Minimize View'>
              <Button
                className={EXPANDED_HEADER_ICON_BUTTON}
                variant='ghost'
                size='iconSm'
                onClick={onMinimize ?? handleMinimizeExpandedView}
                data-track-category='Tickets'
                data-track-name='MINIMIZE_EXPANDED_VIEW'
                data-track-metadata={JSON.stringify({ ticketId: ticket?.id })}
                aria-label='Minimize View'
              >
                <Minimize2 size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative',
          // Hide the sibling sections instead of re-parenting the relationships one.
          relationshipsOnly &&
            '[&>*:not([data-testid=relationships-section]):not(.archived-guard)]:hidden',
        )}
      >
        {/* Archived overlay - blocks all interactions on content */}
        {ticket?.isArchived && (
          <div
            className='archived-guard absolute inset-0 z-50 cursor-not-allowed'
            style={{ backgroundColor: 'transparent' }}
          />
        )}

        {ticket?.isArchived && (
          <div className='archived-guard mb-4 p-3 bg-muted border border-border rounded-lg flex items-center gap-3'>
            <Archive className='w-5 h-5 text-muted-foreground shrink-0' />
            <div className='flex-1'>
              <p className='text-sm font-medium text-foreground'>
                This ticket is archived and is Read-only
              </p>
            </div>
          </div>
        )}

        {/* Approval banner — the one thing an approver must act on, above the fold. */}
        {pendingApprovalForMe && (
          <div className='mt-4 overflow-hidden rounded-[11px] border border-amber-500/40 bg-amber-500/[0.09]'>
            <button
              type='button'
              onClick={() => setApprovalBannerOpen(prev => !prev)}
              aria-expanded={approvalBannerOpen}
              className='flex min-h-[38px] w-full items-center gap-[9px] px-[11px] py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              data-track-category='Tickets'
              data-track-name='ToggleApprovalBanner'
            >
              <Clock
                size={15}
                className='shrink-0 text-amber-700 [[data-theme=midnight]_&]:text-amber-400'
              />
              <span className='whitespace-nowrap text-[12.5px] font-medium text-foreground'>
                Move to {pendingApprovalForMe.stageName}
              </span>
              <span className='min-w-0 truncate text-[12.5px] text-muted-foreground'>
                needs your approval
              </span>
              <div className='min-w-[6px] flex-1' />
              <ChevronDown
                size={14}
                className={cn(
                  'shrink-0 text-muted-foreground transition-transform duration-150',
                  approvalBannerOpen && 'rotate-180',
                )}
              />
            </button>
            {approvalBannerOpen && (
              <div className='px-[11px] pb-[11px] duration-150 animate-in fade-in slide-in-from-top-1'>
                <p className='mb-[11px] text-[13px] leading-[1.6] text-muted-foreground [text-wrap:pretty]'>
                  Approve to move this ticket into {pendingApprovalForMe.stageName}, or request
                  changes to send it back to the requester.
                </p>
                <div className='flex flex-wrap gap-2'>
                  {pendingApprovalForMe.item.formId ? (
                    <Button
                      onClick={() =>
                        setStageFormModal({
                          ticket,
                          targetStage: pendingApprovalForMe.stage ?? {
                            id: pendingApprovalForMe.item.stageId,
                            name: 'Unknown Stage',
                            sequenceNumber: 0,
                            boardId: ticket.boardId || '',
                            eta: null,
                          },
                          sourceStageName:
                            pendingApprovalForMe.previousStage?.name || 'Unknown Stage',
                          formId: pendingApprovalForMe.item.formId,
                          isReviewer: true,
                          hasApprovers: true,
                          existingRequest: pendingApprovalForMe.item.request!,
                        })
                      }
                      data-track-category='Tickets'
                      data-track-name='ReviewStageFormFromBanner'
                    >
                      Review request
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => {
                          setNonFormReviewComment('');
                          setNonFormReviewDialog({
                            requestId: pendingApprovalForMe.item.id,
                            stageId: pendingApprovalForMe.item.stageId,
                            kind: 'APPROVE',
                            stageName: pendingApprovalForMe.stageName,
                          });
                        }}
                        data-track-category='Tickets'
                        data-track-name='ApproveFromBanner'
                      >
                        Approve
                      </Button>
                      <Button
                        variant='secondary'
                        onClick={() => {
                          setNonFormReviewComment('');
                          setNonFormReviewDialog({
                            requestId: pendingApprovalForMe.item.id,
                            stageId: pendingApprovalForMe.item.stageId,
                            kind: 'REJECT',
                            stageName: pendingApprovalForMe.stageName,
                          });
                        }}
                        data-track-category='Tickets'
                        data-track-name='RequestChangesFromBanner'
                      >
                        Request changes
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Title Section */}
        <div className={cn('flex items-start gap-3', expandedView ? 'pt-[8px]' : 'pt-[24px]')}>
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
                className='flex-1 -mx-[7px] rounded-lg bg-muted/50 px-[7px] py-[3px] text-[20px] font-semibold leading-[1.34] tracking-[-0.35px] text-foreground outline-none ring-1 ring-inset ring-border'
                data-track-category='Tickets'
                data-track-name='EditTicketTitle'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
              />
            </div>
          ) : (
            <div
              role='button'
              tabIndex={0}
              className='flex-1 -mx-[7px] cursor-text rounded-lg px-[7px] py-[3px] text-[20px] font-semibold leading-[1.34] tracking-[-0.35px] text-foreground break-words hover:bg-muted/50'
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

        <div className='mt-[6px] -mx-[5px] flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground'>
          <span className='px-[5px]'>
            Created {formatTimestamp(ticket.createdAt)} by{' '}
            {getUserDisplayName(createdByUser) || 'Merchant User'}
          </span>
          <span className='text-muted-foreground/50'>·</span>
          <span className='flex items-center rounded-[5px] px-[5px] hover:bg-muted'>
            <EntitySelector
              options={(boards ?? []).map(board => ({
                value: board.id,
                label: board.name,
                icon: <SquareKanban size={15} className='text-purple-600' />,
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
          </span>
          <span className='text-muted-foreground/50'>·</span>
          {channel ? (
            <button
              type='button'
              onClick={() => void navigate(buildChannelRoute(channel.id))}
              className='rounded-[5px] px-[5px] transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              title='Source channel · created from a message here'
              data-track-category='Tickets'
              data-track-name='OpenSourceChannel'
              data-track-metadata={JSON.stringify({
                ticketId: ticket.id,
                channelId: channel.id,
              })}
            >
              #{channel.name}
            </button>
          ) : (
            <span className='rounded-[5px] px-[5px]'>XyneSpace</span>
          )}
        </div>
        {/* Ticket MetaData Key Value */}
        <div className='mt-[6px] mb-[8px] flex w-full flex-wrap items-center gap-2'>
          <DetailChip
            className='pl-2 pr-[11px]'
            data-testid='ticket-detail-status-selector'
            data-track-event='SELECTOR_CHANGE'
            data-track-category='Tickets'
            data-track-name='CHANGE_STATUS'
            data-track-metadata={JSON.stringify({
              ticketId: ticket.id,
              boardId: ticket.boardId,
              currentStatus: ticket.stageName,
            })}
          >
            {stageReadOnly ? (
              <span className='inline-flex items-center gap-2'>
                <StageIndicator
                  stages={stages}
                  stageName={ticket.stageName}
                  fallbackStatus={ticket.statusV2}
                  isNonLinearBoard={isNonLinearBoard}
                />
                <span className='text-[11px] font-semibold uppercase tracking-[0.3px]'>
                  {ticket.stageName || 'Not set'}
                </span>
              </span>
            ) : (
              <Selector
                items={selectorStages}
                selectedValue={ticket.stageName}
                onValueChange={handleStageChange}
                placeholder='Set Status'
                icon={
                  <StageIndicator
                    stages={stages}
                    stageName={ticket.stageName}
                    fallbackStatus={ticket.statusV2}
                    isNonLinearBoard={isNonLinearBoard}
                  />
                }
                getItemIcon={item => (
                  <StageIndicator
                    stages={stages}
                    stageName={item.name}
                    isNonLinearBoard={isNonLinearBoard}
                  />
                )}
                noBorder={true}
                inputClassName='bg-transparent text-[11px] font-semibold uppercase tracking-[0.3px]'
                isItemDisabled={item => item.name === ticket.stageName}
              />
            )}
            {stageRingLabel && (
              <span className='font-mono text-[11px] font-normal text-muted-foreground/80'>
                {stageRingLabel}
              </span>
            )}
            {((): React.ReactElement | null => {
              if (!ticket.ticketStageRequests || !stagesWithFormInfo) return null;
              const currentStage = stagesWithFormInfo.find(s => s.name === ticket.stageName);
              if (!currentStage) return null;
              const nextStage = stagesWithFormInfo.find(
                s => s.sequenceNumber === currentStage.sequenceNumber + 1,
              );
              if (!nextStage) return null;
              const hasPendingRequest = ticket.ticketStageRequests.some(
                req =>
                  req.status === TicketStageRequestStatus.SUBMITTED && req.stageId === nextStage.id,
              );
              return hasPendingRequest ? (
                <Tooltip content='Pending Status Approval'>
                  <AlertCircle size={14} className='text-orange-500' />
                </Tooltip>
              ) : null;
            })()}
          </DetailChip>

          <DetailChip className='pl-[6px] pr-2'>
            <UserSelector
              selectedUserId={resolveAssigneeRef(ticket.assignedTo).userId}
              onUserSelect={handleAssigneeChange}
              channelId={ticket.channelId ?? undefined}
              noBorder={true}
            />
          </DetailChip>

          <DetailChip
            className='pl-2 pr-[10px]'
            data-testid='ticket-detail-priority-selector'
            data-track-event='SELECTOR_CHANGE'
            data-track-category='Tickets'
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
              inputClassName='bg-transparent'
            />
          </DetailChip>

          {Boolean(currentStageInfo?.eta) &&
            (editingStageETA ? (
              <div className='flex items-center gap-2' data-testid='ticket-detail-stage-eta-input'>
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
                  className='h-[27px] rounded-full border border-input bg-background px-3 text-[12.5px] outline-none focus:border-border'
                  data-track-category='Tickets'
                  data-track-name='StageETAInput'
                  data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                />
              </div>
            ) : (
              <DetailChipButton
                className={cn(
                  'pl-2 pr-[10px] gap-[7px]',
                  isStageOverdue && 'border-destructive/25',
                )}
                dashed={!currentStageEntry?.stageEta}
                data-testid='ticket-detail-stage-eta-display'
                data-track-category='Tickets'
                data-track-name='EditStageDeadline'
                data-track-metadata={JSON.stringify({
                  ticketId: ticket.id,
                  stageId: currentStageEntry?.stageId,
                })}
                title={
                  currentStageEntry?.stageEta
                    ? `Stage ETA · when ${ticket.stageName ?? 'this stage'} should be done`
                    : `Stage ETA · not set for ${ticket.stageName ?? 'this stage'}`
                }
                onClick={() => {
                  if (currentStageEntry?.stageEta) {
                    setStageEtaValue(getLocalISOString(currentStageEntry.stageEta));
                  }
                  setEditingStageETA(true);
                }}
              >
                <Clock
                  size={14}
                  className={isStageOverdue ? 'text-destructive' : 'text-muted-foreground'}
                />
                {currentStageEntry?.stageEta ? (
                  <>
                    <DetailChipLabel>Stage</DetailChipLabel>
                    <span className={isStageOverdue ? 'text-destructive' : 'text-foreground'}>
                      {formatETADisplay(currentStageEntry.stageEta)}
                    </span>
                    {isStageOverdue && <DetailChipMarker tone='danger'>Breached</DetailChipMarker>}
                  </>
                ) : (
                  <span className='text-muted-foreground'>Stage ETA</span>
                )}
              </DetailChipButton>
            ))}

          {editingETA ? (
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
                className='h-[27px] rounded-full border border-input bg-background px-3 text-[12.5px] text-foreground outline-none focus:border-border'
                data-track-category='Tickets'
                data-track-name='StageETAInput'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
              />
            </div>
          ) : (
            <DetailChipButton
              className={cn('pl-2 pr-[10px] gap-[7px]', isTicketOverdue && 'border-destructive/25')}
              dashed={!ticket.eta}
              data-testid='ticket-detail-eta-display'
              data-track-category='TicketDetails'
              data-track-name='EditStageETA'
              data-track-metadata={JSON.stringify({
                ticketId: ticket.id,
                stageId: currentStageEntry?.stageId,
              })}
              title={
                ticket.eta
                  ? etaManagementView?.autoEnabled
                    ? 'Ticket ETA · derived from the stage ETA'
                    : 'Ticket ETA · set manually'
                  : 'Ticket ETA · not set'
              }
              onClick={() => {
                if (ticket.eta) {
                  setEtaValue(getLocalISOString(ticket.eta));
                }
                setEditingETA(true);
              }}
            >
              <Calendar
                size={14}
                className={isTicketOverdue ? 'text-destructive' : 'text-muted-foreground'}
              />
              {ticket.eta ? (
                <>
                  <DetailChipLabel>Ticket</DetailChipLabel>
                  <span className={isTicketOverdue ? 'text-destructive' : 'text-foreground'}>
                    {formatETADisplay(ticket.eta)}
                  </span>
                  {isTicketOverdue && <DetailChipMarker tone='danger'>Breached</DetailChipMarker>}
                  {etaManagementView?.severity === 'PLANNING_RISK' && (
                    <DetailChipMarker tone='warning'>
                      Planning Risk{etaManagementView.isPaused ? ' (paused)' : ''}
                    </DetailChipMarker>
                  )}
                  {etaManagementView?.forecastStatus === 'INCOMPLETE' && (
                    <DetailChipMarker>Estimate Incomplete</DetailChipMarker>
                  )}
                </>
              ) : (
                <span className='text-muted-foreground'>Ticket ETA</span>
              )}
            </DetailChipButton>
          )}

          {ticket.statusV2 === TicketStatusV2.PAUSED && ticket.statusUpdatedAt && (
            <DetailChip className='gap-[7px] pl-2 pr-[10px]'>
              <Clock size={14} className='text-muted-foreground' />
              <DetailChipLabel>Projected</DetailChipLabel>
              <span className='text-foreground'>
                {((): string => {
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
                  return formatETADisplay(projectedEta ?? undefined);
                })()}
              </span>
            </DetailChip>
          )}

          {ticket?.ticketType === BaseTicketType.Fix && (
            <DetailChipButton
              className='gap-[7px] pl-2 pr-[10px]'
              data-testid='fill-rca-button'
              title={rcaButtonSubtitle}
              onClick={handleOpenRcaPanel}
              data-track-category='Tickets'
              data-track-name={rcaTrackName}
            >
              <ClipboardCheck size={14} className='text-muted-foreground' />
              {rcaButtonTitle}
            </DetailChipButton>
          )}

          {tags?.map((tag, index) => {
            const labelDot = [
              'bg-cyan-400',
              'bg-yellow-400',
              'bg-purple-400',
              'bg-green-400',
              'bg-pink-400',
              'bg-blue-400',
            ] as const;
            const dot = labelDot[index % labelDot.length]!;

            return (
              <DetailChip key={tag.id} className='gap-[7px]'>
                <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
                {tag.tagName}
                <button
                  onClick={() => void handleRemoveTag(tag.id)}
                  data-ph-capture-attribute-track-id='remove_ticket_tag'
                  className='-mr-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground'
                  aria-label='Remove label'
                  data-track-category='Tickets'
                  data-track-name='RemoveTag'
                  data-track-metadata={JSON.stringify({
                    tagId: tag.id,
                    tagName: tag.tagName,
                  })}
                >
                  <X size={12} />
                </button>
              </DetailChip>
            );
          })}

          <div className='relative flex items-center' ref={tagDropdownRef}>
            <DetailChipButton
              dashed
              className='gap-[7px]'
              aria-label='Add label'
              onClick={() => setShowTagDropdown(!showTagDropdown)}
              data-track-category='Tickets'
              data-track-name='ToggleTagDropdown'
              data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
            >
              <Plus size={14} />
              <span>{tags && tags.length > 0 ? 'Label' : 'Add label'}</span>
            </DetailChipButton>

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
                    placeholder='Search or create label...'
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
                      data-ph-capture-attribute-track-id='create_ticket_tag'
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
                        data-ph-capture-attribute-track-id='toggle_ticket_tag'
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

          <Popover
            open={moreMenuOpen}
            onOpenChange={setMoreMenuOpen}
            align='end'
            sideOffset={6}
            className='w-[226px] rounded-xl border border-border bg-background p-1.5 shadow-[0_16px_44px_rgba(20,22,26,0.2)]'
            trigger={
              <button
                type='button'
                aria-label='More actions'
                title='More actions'
                className='flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-background text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                data-track-category='Tickets'
                data-track-name='OpenTicketMoreMenu'
              >
                <ThreeDotsMenuHorizontal className='size-[17px]' />
              </button>
            }
          >
            {moreMenuItems.map(item => (
              <button
                key={item.label}
                type='button'
                onClick={() => {
                  setMoreMenuOpen(false);
                  item.run();
                }}
                disabled={item.disabled ?? false}
                className='flex h-9 w-full items-center gap-[11px] rounded-lg px-[9px] text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50'
                data-track-category='Tickets'
                data-track-name={item.trackName}
              >
                <span className='flex w-[22px] items-center justify-center text-muted-foreground'>
                  {item.icon}
                </span>
                <span className='flex-1 text-[13px] text-foreground'>{item.label}</span>
              </button>
            ))}
          </Popover>
        </div>

        {roleGroups.length > 0 && (
          <div className='mb-[18px] flex flex-wrap items-center gap-x-5 gap-y-2'>
            {roleGroups.map(group => (
              <div key={group.label} className='flex items-center gap-2'>
                <span className='text-[11px] font-semibold uppercase tracking-[0.45px] text-muted-foreground/80'>
                  {group.userIds.length > 1 ? `${group.label}s` : group.label}
                </span>
                {group.userIds.map(userId => {
                  const user = users?.find(
                    (u: { id: string; name: string; displayName?: string | null }) =>
                      u.id === userId,
                  );
                  return (
                    <span key={userId} className='flex items-center gap-1.5 text-[12.5px]'>
                      <UserAvatar
                        userId={userId}
                        size={AvatarSize.SM}
                        shape={AvatarShape.CIRCULAR}
                        showActiveStatus={false}
                      />
                      {getUserDisplayName(user) || 'Unknown'}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {etaManagementView?.severity === 'PLANNING_RISK' &&
          etaManagementView.planningRiskState === 'ACTIVE' && (
            <div className='mx-0 mb-4 px-3 py-2.5 rounded-md border border-amber-200 bg-amber-50 text-sm'>
              <div className='flex items-start justify-between gap-2'>
                <div className='text-amber-800'>
                  <p className='font-medium'>Planning risk</p>
                  <p className='text-xs text-amber-700 mt-0.5'>
                    The current stage deadline
                    {etaManagementView.stageDeadline
                      ? ` (${formatETADisplay(etaManagementView.stageDeadline)})`
                      : ''}{' '}
                    is later than the ticket due date
                    {etaManagementView.ticketDue
                      ? ` (${formatETADisplay(etaManagementView.ticketDue)})`
                      : ''}
                    .
                    {etaManagementView.autoEnabled
                      ? ' Automatic recalculation is active for this board.'
                      : ' Automatic recalculation is off for this board.'}
                  </p>
                </div>
                {!showAcknowledgeInput && (
                  <Button
                    variant='secondary'
                    onClick={() => setShowAcknowledgeInput(true)}
                    data-track-category='TicketDetails'
                    data-track-name='OpenAcknowledgeEtaRisk'
                  >
                    Acknowledge
                  </Button>
                )}
              </div>
              {showAcknowledgeInput && (
                <div className='mt-2 flex items-center gap-2'>
                  <input
                    type='text'
                    value={acknowledgeReason}
                    onChange={e => setAcknowledgeReason(e.target.value)}
                    placeholder='Reason for keeping the current dates...'
                    className='flex-1 text-sm bg-background border border-input rounded px-2 py-1 outline-none focus:border-border'
                    data-testid='acknowledge-eta-risk-reason'
                    data-track-category='TicketDetails'
                    data-track-name='AcknowledgeEtaRiskReasonInput'
                  />
                  <Button
                    variant='secondary'
                    onClick={() => void handleAcknowledgeRisk()}
                    disabled={submittingAcknowledge || !acknowledgeReason.trim()}
                    data-track-category='TicketDetails'
                    data-track-name='SubmitAcknowledgeEtaRisk'
                  >
                    {submittingAcknowledge ? 'Saving...' : 'Confirm'}
                  </Button>
                  <Button
                    variant='ghost'
                    onClick={() => {
                      setShowAcknowledgeInput(false);
                      setAcknowledgeReason('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        <div className='-mx-[9px] rounded-xl border border-transparent bg-background transition-colors hover:border-border'>
          {editingDescription ? (
            <div className='rounded-xl border border-border bg-background'>
              <textarea
                ref={descriptionTextareaRef}
                value={descriptionValue}
                onChange={e => setDescriptionValue(e.target.value)}
                onBlur={handleSaveDescription}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveDescription();
                    return;
                  }
                  if (e.key === 'Escape') {
                    setDescriptionValue(resolveTicketDescription(ticket));
                    setEditingDescription(false);
                  }
                }}
                className='min-h-[150px] w-full resize-none overflow-y-auto bg-transparent px-[15px] py-[11px] text-[14px] leading-[1.7] text-foreground outline-none'
                data-track-category='Tickets'
                data-track-name='EditDescription'
                data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
              />
              <div className='flex items-center gap-[9px] border-t border-border/60 px-[14px] py-2.5'>
                <Button
                  onClick={handleSaveDescription}
                  data-track-category='Tickets'
                  data-track-name='SaveDescription'
                >
                  Save
                </Button>
                <button
                  type='button'
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setDescriptionValue(resolveTicketDescription(ticket));
                    setEditingDescription(false);
                  }}
                  className='text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground'
                  data-track-category='Tickets'
                  data-track-name='CancelDescription'
                >
                  Cancel
                </button>
                <div className='flex-1' />
                <span className='flex items-center gap-1.5 text-[11.5px] text-muted-foreground'>
                  <span className='rounded-[5px] border border-border bg-background px-[5px] py-0.5 font-mono text-[11px] font-medium'>
                    {isMacPlatform ? '⌘↵' : 'Ctrl↵'}
                  </span>
                  to save
                </span>
              </div>
            </div>
          ) : (
            <div
              role='button'
              tabIndex={0}
              className='flex cursor-text flex-col px-[15px] py-[11px] text-foreground'
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
              {!resolveTicketDescription(ticket) ? (
                <p className='text-sm text-muted-foreground italic'>Add description</p>
              ) : (
                <>
                  <div className='relative'>
                    <p
                      ref={descriptionRef}
                      className={cn(
                        'whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-muted-foreground [text-wrap:pretty]',
                        !showFullDescription && 'overflow-hidden line-clamp-5 sm:line-clamp-5',
                      )}
                    >
                      <RenderMessageWithHTML message={resolveTicketDescription(ticket)} />
                    </p>
                    {!showFullDescription && needsReadMore && (
                      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-[62px] bg-gradient-to-b from-transparent to-background' />
                    )}
                  </div>
                  {(needsReadMore || showFullDescription) && (
                    <button
                      className='w-fit cursor-pointer self-start py-[5px] text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground'
                      onClick={event => {
                        event.stopPropagation();
                        setShowFullDescription(prev => !prev);
                      }}
                      data-track-category='Tickets'
                      data-track-name={
                        showFullDescription ? 'ViewLessDescription' : 'ReadMoreDescription'
                      }
                    >
                      {showFullDescription ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {/* Display Ticket Files */}
          {ticketAttachments && ticketAttachments.length > 0 && (
            <div className='flex flex-col gap-2 px-[13px] pb-[11px] pt-0.5'>
              <div className='flex flex-wrap items-center gap-2'>
                {(showAllAttachments
                  ? ticketAttachments
                  : ticketAttachments.slice(0, TICKET_ATTACHMENT_PREVIEW_LIMIT)
                ).map(attachment => (
                  <FileBubble
                    key={attachment.id}
                    compact
                    createdBy={attachment.createdBy}
                    createdAt={attachment.createdAt}
                    attachment={attachment}
                    siblings={ticketAttachments}
                  />
                ))}
              </div>
              {ticketAttachments.length > TICKET_ATTACHMENT_PREVIEW_LIMIT && (
                <button
                  className='text-xs font-semibold cursor-pointer self-start underline py-1'
                  onClick={() => setShowAllAttachments(prev => !prev)}
                  data-track-category='Tickets'
                  data-track-name={
                    showAllAttachments ? 'ViewLessAttachments' : 'ViewMoreAttachments'
                  }
                  data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                >
                  {showAllAttachments
                    ? 'View less'
                    : `View more (${ticketAttachments.length - TICKET_ATTACHMENT_PREVIEW_LIMIT})`}
                </button>
              )}
            </div>
          )}
        </div>

        <DetailSection
          title='Fields'
          {...(gateMissingFields.length > 0 && gateStageName
            ? {
                badge: (
                  <DetailSectionGate>
                    {gateMissingFields.length} required to reach {gateStageName}
                  </DetailSectionGate>
                ),
              }
            : {})}
        >
          <div className='flex flex-col gap-px pt-2 pl-[21px]'>
            {ticket.ticketType && (
              <DetailFieldRow label='Type' locked={fieldsAreReadOnly}>
                <Selector
                  items={ticketTypeOptions}
                  selectedValue={ticket.ticketType}
                  onValueChange={handleTicketTypeChange}
                  placeholder='Set Type'
                  noBorder={true}
                  isLoading={isTicketTypeLoading}
                  inputClassName='bg-transparent text-[13px] font-medium'
                  onOpenChange={open => {
                    if (open && !ticketTypeDropdownOpened) {
                      setTicketTypeDropdownOpened(true);
                    }
                  }}
                />
              </DetailFieldRow>
            )}

            <DetailFieldRow label='User Group' locked={fieldsAreReadOnly}>
              <UserGroupSelector
                selectedGroupId={ticket.userGroupId ?? null}
                onGroupSelect={handleUserGroupChange}
                noBorder
              />
            </DetailFieldRow>

            {ticket.merchantId && (
              <DetailFieldRow label='Merchant ID' locked>
                <span className='text-[13px] font-medium text-foreground'>{ticket.merchantId}</span>
              </DetailFieldRow>
            )}

            {visibleFormFields.map(fieldValue => (
              <EditableFormField
                key={fieldValue.resolvedFieldId}
                readOnly={fieldsAreReadOnly}
                fieldName={getFormEntityFieldName(fieldValue)}
                fieldValue={fieldValue.actualFieldValue ?? fieldValue.fieldValue}
                fieldType={getFormEntityFieldType(fieldValue)}
                fieldEnum={getFormEntityFieldEnum(fieldValue)}
                onSave={newValue =>
                  handleFormFieldSave(
                    fieldValue.id,
                    newValue,
                    fieldValue.isPlaceholder,
                    fieldValue.formId,
                  )
                }
              />
            ))}

            {leftoverFieldValues.map(field => (
              <DetailFieldRow
                key={field.resolvedFieldId}
                label={field.fieldName}
                locked
                note='no longer defined on this board'
              >
                <span className='break-words text-[13px] font-medium text-muted-foreground'>
                  {formatLeftoverFieldValue(field, leftoverFieldUserById)}
                </span>
              </DetailFieldRow>
            ))}

            {gateMissingFields
              .filter(
                field =>
                  !visibleFormFields.some(
                    shown => getFormEntityFieldName(shown) === field.fieldName,
                  ),
              )
              .map(field => (
                <DetailFieldRow
                  key={`gate-${field.id}`}
                  label={field.fieldName}
                  gate={
                    gateStageName ? (
                      <DetailRowGate>required to reach {gateStageName}</DetailRowGate>
                    ) : undefined
                  }
                >
                  <span className='text-[13px] text-muted-foreground/60'>Empty</span>
                </DetailFieldRow>
              ))}

            {(hiddenEmptyFieldCount > 0 || showEmptyFields) && (
              <div className='flex items-center gap-4 pt-[11px]'>
                <button
                  type='button'
                  onClick={() => setShowEmptyFields(prev => !prev)}
                  className='text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground'
                  data-track-category='Tickets'
                  data-track-name='ToggleEmptyFields'
                >
                  {showEmptyFields
                    ? 'Hide empty fields'
                    : `Show ${hiddenEmptyFieldCount} empty field${hiddenEmptyFieldCount === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </div>
        </DetailSection>

        {ticket?.classificationData && channelId && (
          <DetailSection title='AI Classification' defaultOpen={false}>
            <div className='pt-2 pl-[21px]'>
              <AIClassificationPanel
                ticketId={ticket.id}
                channelId={channelId}
                classificationData={
                  ticket.classificationData as unknown as TicketClassificationData
                }
                userGroups={userGroups.map(g => ({ id: g.id, name: g.name }))}
                hasFormFields={!!(allFormFields && allFormFields.length > 0)}
              />
            </div>
          </DetailSection>
        )}

        <DetailSection
          title='Workflow'
          defaultOpen={workflowActionableCount > 0}
          summary={
            workflowActionableCount > 0 ? `${workflowActionableCount} pending` : 'nothing pending'
          }
        >
          <div className='flex flex-col gap-2 pt-2 pl-[21px]'>
            {/* Flow step gate form — prefillable by default on flow boards; same
            inline panel as linear-board prefillable forms */}
            {flowStepForm &&
              ticket &&
              (flowStepForm.settled ? (
                <StageFormInlinePanel
                  ticket={ticket}
                  targetStage={{ id: flowStepForm.planNodeId, name: flowStepForm.stepTitle }}
                  sourceStageName=''
                  formId={flowStepForm.formId}
                  hasApprovers={false}
                  isNonLinearBoard={false}
                  headerTitle={flowFormName ?? 'Form'}
                  headerSubtitle={`${flowStepForm.stepTitle} form · Submitted answers`}
                  saveOnly
                  saveSuccessMessage='Submitted form updated'
                  editableOnDemand
                />
              ) : (
                <StageFormInlinePanel
                  ticket={ticket}
                  targetStage={{ id: flowStepForm.planNodeId, name: flowStepForm.stepTitle }}
                  sourceStageName=''
                  formId={flowStepForm.formId}
                  hasApprovers={false}
                  isNonLinearBoard={false}
                  headerTitle={flowFormName ?? 'Form'}
                  headerSubtitle={`${flowStepForm.stepTitle} form`}
                  onCommit={completeFlowStep}
                  commitSuccessMessage='Step completed'
                />
              ))}

            {!stageReadOnly &&
              nextStageDetailsConfig &&
              (nextStageDetailsConfig.formId ? (
                <StageFormInlinePanel
                  ticket={ticket}
                  targetStage={nextStageDetailsConfig.targetStage}
                  sourceStageName={nextStageDetailsConfig.sourceStageName}
                  formId={nextStageDetailsConfig.formId}
                  hasApprovers={nextStageDetailsConfig.hasApprovers}
                  isNonLinearBoard={isNonLinearBoard}
                  reenterMode={nextStageDetailsConfig.reenterMode}
                  targetStageEtas={nextStageEtas}
                />
              ) : (
                <div className='my-4 rounded-lg border border-border bg-background p-4'>
                  <div className='flex items-center justify-between gap-4'>
                    <div>
                      <p className='text-base font-semibold text-foreground'>Next stage</p>
                      <p className='mt-1 text-sm text-muted-foreground'>
                        <span className='font-medium text-foreground'>
                          {nextStageDetailsConfig.sourceStageName}
                        </span>
                        <span className='mx-2'>→</span>
                        <span className='font-medium text-foreground'>
                          {nextStageDetailsConfig.targetStage.name}
                        </span>
                      </p>
                    </div>
                    <Tooltip
                      content={
                        nextStageDetailsConfig.hasApprovers
                          ? 'Submit the form for approval'
                          : 'Move to the next stage'
                      }
                    >
                      <Button
                        onClick={() => handleStageChange(nextStageDetailsConfig.targetStage.name)}
                        data-track-category='Tickets'
                        data-track-name='MoveToNextStageFromDetails'
                        data-track-metadata={JSON.stringify({
                          stageId: nextStageDetailsConfig.targetStage.id,
                        })}
                      >
                        {nextStageDetailsConfig.hasApprovers ? 'Submit for approval' : 'Submit'}
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ))}

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
                      // For NON_LINEAR boards approvers live on the transition, not the stage.
                      const isApprover = isNonLinearBoard
                        ? stageTransitions.some(
                            t =>
                              t.toStageId === item.stageId &&
                              t.transitionApprovers?.some(a => {
                                const type = (a.approverType ?? ApproverType.USER) as
                                  | 'USER'
                                  | 'ROLE';
                                if (type === 'ROLE')
                                  return !!a.roleId && currentUserRoleIds.includes(a.roleId);
                                return a.userId === currentUser?.id;
                              }),
                          )
                        : (stage?.approvers?.some(a => {
                            const type = (a.approverType ?? 'USER') as 'USER' | 'ROLE';
                            if (type === 'ROLE')
                              return !!a.roleId && currentUserRoleIds.includes(a.roleId);
                            return a.userId === currentUser?.id;
                          }) ?? false);
                      const hasApprovers = isNonLinearBoard
                        ? stageTransitions.some(
                            t =>
                              t.toStageId === item.stageId &&
                              (t.transitionApprovers?.length ?? 0) > 0,
                          )
                        : stage?.approvers && stage.approvers.length > 0;

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
                                {previousStage?.name || 'Start'} &rarr;{' '}
                                {stage?.name || 'Unknown Stage'}
                              </p>

                              {/* Status Badge - only show for stages with approvers */}
                              {hasApprovers &&
                                item.status &&
                                ((): React.ReactElement | null => {
                                  const config = getStatusBadgeConfig(item.status);
                                  return config ? (
                                    <span
                                      className={config.className.replace('text-xs', 'text-sm')}
                                    >
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
                                            eta: null,
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
                                      data-ph-capture-attribute-track-id='submit_stage_request'
                                      className='text-sm text-foreground hover:text-muted-foreground font-medium whitespace-nowrap'
                                      data-track-category='Tickets'
                                      data-track-name='SubmitStageRequest'
                                      data-track-metadata={JSON.stringify({
                                        stageId: item.stageId,
                                      })}
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
                                                eta: null,
                                              },
                                              sourceStageName:
                                                previousStage?.name || 'Unknown Stage',
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
                                                eta: null,
                                              },
                                              sourceStageName:
                                                previousStage?.name || 'Unknown Stage',
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
                                            eta: null,
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
                                        onClick={() => {
                                          setNonFormReviewComment('');
                                          setNonFormReviewDialog({
                                            requestId: item.id,
                                            stageId: item.stageId,
                                            kind: 'APPROVE',
                                            stageName: stage?.name ?? 'Unknown Stage',
                                          });
                                        }}
                                        className='text-sm font-medium whitespace-nowrap px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600'
                                        data-track-category='Tickets'
                                        data-track-name='ApproveStageRequest'
                                        data-track-metadata={JSON.stringify({
                                          stageId: item.stageId,
                                        })}
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => {
                                          setNonFormReviewComment('');
                                          setNonFormReviewDialog({
                                            requestId: item.id,
                                            stageId: item.stageId,
                                            kind: 'REJECT',
                                            stageName: stage?.name ?? 'Unknown Stage',
                                          });
                                        }}
                                        className='text-sm font-medium whitespace-nowrap px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600'
                                        data-track-category='Tickets'
                                        data-track-name='RejectStageRequest'
                                        data-track-metadata={JSON.stringify({
                                          stageId: item.stageId,
                                        })}
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
                                            eta: null,
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
                                        toast.success(
                                          'Stage change request resubmitted for approval',
                                        );
                                      }}
                                      data-ph-capture-attribute-track-id='resubmit_stage_request'
                                      className='text-sm text-foreground hover:text-muted-foreground font-medium whitespace-nowrap'
                                      data-track-category='Tickets'
                                      data-track-name='ResubmitStageRequest'
                                      data-track-metadata={JSON.stringify({
                                        stageId: item.stageId,
                                      })}
                                    >
                                      Resubmit request
                                    </button>
                                  )}
                                </>
                              ) : (
                                // Stages WITHOUT approvers: Just show View Form button
                                <button
                                  onClick={() => {
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
                                      showPersistedDocValues: item.type === 'form',
                                    });
                                  }}
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
          </div>
        </DetailSection>

        {ticket && isReleaseTicket(ticket.ticketType as BaseTicketType) && ticket.projectId && (
          <div className='mt-4'>
            <button
              type='button'
              onClick={() =>
                void navigate(`/listProjects/${ticket.projectId}/releases/${ticket.id}`, {
                  state: { returnToUrl: location.pathname + location.search },
                })
              }
              data-track-category='Tickets'
              data-track-name='OpenReleaseViewFromTicket'
              data-testid='open-release-view-button'
              className='group flex items-center justify-between gap-3 w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground shadow-sm hover:shadow-md hover:border-input transition-all'
            >
              <span className='inline-flex items-center gap-3'>
                <span className='flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground'>
                  <SquareArrowOutUpRight size={18} />
                </span>
                <span className='flex flex-col text-left'>
                  <span className='text-sm font-semibold text-foreground'>Open release view</span>
                  <span className='text-xs text-muted-foreground'>
                    Dev tickets, envs, migrations &amp; timeline for this release
                  </span>
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

        {/* Relationships — sub-tickets and linked tickets, the panel's own tab. */}
        {!hideRelationships && (
          <div className={relationshipsOnly ? '' : 'pt-6'} data-testid='relationships-section'>
            {/* When Relationships IS the tab, the tab strip already names it. */}
            {!relationshipsOnly && (
              <div className='flex h-[34px] items-center gap-[9px]'>
                <button
                  type='button'
                  onClick={() => setRelationshipsOpen(prev => !prev)}
                  aria-expanded={relationshipsOpen}
                  className='flex items-center gap-[9px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  data-track-category='Tickets'
                  data-track-name='ToggleRelationshipsSection'
                >
                  <ChevronRight
                    size={12}
                    className={cn(
                      'w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
                      relationshipsOpen && 'rotate-90',
                    )}
                  />
                  <span className='text-[11px] font-semibold uppercase tracking-[0.45px] text-muted-foreground'>
                    Relationships
                  </span>
                  <span className='font-mono text-[11px] tabular-nums text-muted-foreground/70'>
                    {subTickets.length +
                      (parentTickets?.length ?? 0) +
                      referencesOut.length +
                      referencesIn.length}
                  </span>
                </button>
                <div className='h-px flex-1 bg-border/60' />
              </div>
            )}

            {(relationshipsOnly || relationshipsOpen) && (
              <div className='flex flex-col gap-1.5 pt-2'>
                {parentTickets && parentTickets.length > 0 && (
                  <>
                    <div className='flex items-center gap-2 py-0.5'>
                      <span className='text-[10px] font-semibold uppercase tracking-[0.4px] text-muted-foreground/80'>
                        Parent
                      </span>
                      <span
                        className='font-mono text-[10.5px] tabular-nums text-muted-foreground/60'
                        data-testid='parent-tickets-count'
                      >
                        {parentTickets.length}
                      </span>
                    </div>
                    <div className='flex flex-col gap-1.5' data-testid='parent-tickets-section'>
                      {parentTickets.map(renderParentTicketRow)}
                    </div>
                  </>
                )}
                <div
                  className={cn(
                    'flex items-center gap-2 py-0.5',
                    parentTickets && parentTickets.length > 0 && 'pt-2.5',
                  )}
                >
                  <span className='text-[10px] font-semibold uppercase tracking-[0.4px] text-muted-foreground/80'>
                    Sub-tickets
                  </span>
                  <span
                    className='font-mono text-[10.5px] tabular-nums text-muted-foreground/60'
                    data-testid='sub-tickets-count'
                  >
                    {subTickets.length}
                  </span>
                  {subTickets.length > 0 && boardData?.boardType !== BoardType.FLOW && (
                    <span className='inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground'>
                      <GitBranch size={11} />
                      Tree
                    </span>
                  )}
                </div>

                <div className='flex flex-col gap-1.5' data-testid='sub-tickets-list'>
                  {subTickets.length > 0 && subTicketTreeNodes.map(renderSubTicketNode)}
                  {createSubTicketButton}
                  {addSubTicketPicker}
                </div>

                <div className='flex items-center gap-2 pt-2.5 pb-0.5'>
                  <span className='text-[10px] font-semibold uppercase tracking-[0.4px] text-muted-foreground/80'>
                    Linked
                  </span>
                  <span className='font-mono text-[10.5px] tabular-nums text-muted-foreground/60'>
                    {referencesOut.length + referencesIn.length}
                  </span>
                </div>

                <div className='flex flex-col gap-1.5'>
                  {referencesOut.map(reference =>
                    renderRelatedTicketRow(
                      reference,
                      reference.targetTicket,
                      formatReferenceLabel(reference.relationType),
                      reference.relationType !== TicketReferenceRelation.MERGED_INTO,
                    ),
                  )}
                  {referencesIn.map(reference => {
                    const unmergeSourceTicketId = reference.sourceTicket?.id;
                    return renderRelatedTicketRow(
                      reference,
                      reference.sourceTicket,
                      formatIncomingReferenceLabel(reference.relationType),
                      false,
                      reference.relationType === TicketReferenceRelation.MERGED_INTO &&
                        unmergeSourceTicketId
                        ? () => {
                            void handleUnmerge(
                              unmergeSourceTicketId,
                              reference.sourceTicket?.xyneId,
                            );
                          }
                        : undefined,
                    );
                  })}

                  <div
                    className={cn(
                      'flex items-center rounded-[11px] border border-border px-3 py-2 transition-colors hover:border-muted-foreground/40',
                      isReferenceSaving && 'pointer-events-none opacity-60',
                    )}
                  >
                    <EntitySelector
                      options={referenceTicketOptions}
                      selectedValue={null}
                      onSelect={value => handleAddReference(value)}
                      placeholder='+ Link a ticket'
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
                  {referenceError && (
                    <p className='text-[12px] text-destructive'>{referenceError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Stage Form Submissions — per-stage-visit forms are a NON_LINEAR concept.
            On linear boards the single board-level form lives in the form panel above,
            so hide this panel entirely rather than rendering an empty state. */}
        {isNonLinearBoard && <StageFormSubmissions stageVisitFormValues={stageVisitFormValues} />}
        {/* Stage-transition form submissions belong in the activity timeline on every board
            type (linear boards support per-transition forms too — e.g. In Progress → Review).
            ActivityComponent matches a submission to a move by stage name, so board-level
            custom-field values (contextId = boardId, never a stage name) can't leak in. */}
        <TicketActivity
          activities={activities}
          users={users}
          userGroups={userGroups}
          boards={boards}
          stageVisitFormValues={stageVisitFormValues}
          {...(flowStepForm?.planNodeId ? { flowFormContextId: flowStepForm.planNodeId } : {})}
        />
      </div>
      {/* SubTicket Modal */}
      {ticket?.conversationId && (
        <SubTicketModal
          isOpen={isSubTicketModalOpen}
          onClose={() => setIsSubTicketModalOpen(false)}
          ticketId={ticketId}
          trackSource='sub_ticket_modal'
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
          trackSource='sub_ticket_modal'
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
          isNonLinearBoard={isNonLinearBoard}
          showPersistedDocValues={stageFormModal.showPersistedDocValues ?? false}
          reenterMode={stageFormModalReenterMode}
          targetStageEtas={stageFormModalEtas}
          onSuccess={() => setStageFormModal(null)}
        />
      )}
      {nonFormReviewDialog && (
        <Dialog
          open={!!nonFormReviewDialog}
          onOpenChange={open => {
            if (!open) setNonFormReviewDialog(null);
          }}
          title={
            nonFormReviewDialog.kind === 'APPROVE'
              ? `Approve stage change to ${nonFormReviewDialog.stageName}`
              : `Reject stage change to ${nonFormReviewDialog.stageName}`
          }
        >
          <div className='p-6'>
            <label
              htmlFor='non-form-reviewer-comment'
              className='block text-sm font-medium text-foreground mb-1'
            >
              Comment{' '}
              <span className='text-xs text-muted-foreground'>
                {nonFormReviewDialog.kind === 'REJECT' ? '(required)' : '(optional)'}
              </span>
            </label>
            <textarea
              id='non-form-reviewer-comment'
              value={nonFormReviewComment}
              onChange={e => setNonFormReviewComment(e.target.value)}
              placeholder='Explain your decision…'
              rows={3}
              className='w-full px-3 py-2 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y'
              data-track-category='Tickets'
              data-track-name='NonFormStageReviewerCommentInput'
            />
            <div className='mt-4 flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setNonFormReviewDialog(null)}
                data-track-category='Tickets'
                data-track-name='CancelNonFormStageReview'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void handleNonFormReviewSubmit();
                }}
                data-track-category='Tickets'
                data-track-name={
                  nonFormReviewDialog.kind === 'APPROVE'
                    ? 'ConfirmNonFormStageApprove'
                    : 'ConfirmNonFormStageReject'
                }
              >
                {nonFormReviewDialog.kind === 'APPROVE' ? 'Approve' : 'Reject'}
              </Button>
            </div>
          </div>
        </Dialog>
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
                    const backwardUpdate = {
                      id: ticket.id,
                      stageName: backwardStageChange.stageName,
                      ...(backwardStageChange.newStatus && {
                        statusV2: backwardStageChange.newStatus,
                      }),
                      updatedAt: Date.now(),
                    };
                    const beforeBackward = ticketRef.current;
                    const stagesBeforeBackward = outcomeStagesRef.current;
                    void zero
                      .mutate(mutators.ticket.update(backwardUpdate))
                      .server.then(result => {
                        if (result.type !== 'error')
                          trackDetailsOutcome(backwardUpdate, beforeBackward, stagesBeforeBackward);
                      })
                      .catch((err: unknown) => {
                        logger.error(LogEvent.ZERO_MUTATION_ERROR, {
                          component: 'TicketDetails',
                          mutator: 'ticket.update',
                          error: err instanceof Error ? err.message : String(err),
                        });
                      });

                    setShowBackwardConfirmDialog(false);
                  }
                }}
                className='bg-primary text-primary-foreground hover:opacity-90'
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
              <Button
                variant='secondary'
                onClick={() => setShowArchiveConfirmDialog(false)}
                data-track-category='Tickets'
                data-track-name='CANCEL_ARCHIVE_TICKET'
              >
                Cancel
              </Button>
              <Button
                onClick={handleArchiveTicket}
                data-track-category='Tickets'
                data-track-name='CONFIRM_ARCHIVE_TICKET'
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
              <Button
                variant='secondary'
                onClick={() => setShowBoardChangeConfirmDialog(false)}
                data-track-category='Tickets'
                data-track-name='CANCEL_BOARD_CHANGE'
              >
                Cancel
              </Button>
              <Button
                onClick={confirmBoardChange}
                data-track-category='Tickets'
                data-track-name='CONFIRM_BOARD_CHANGE'
                className='bg-primary text-primary-foreground hover:opacity-90'
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
