import { logger, Event as LogEvent } from '../../../utils/logger';
import { useCallback } from 'react';
import { SelectMenuAlignment, SingleSelect } from '@juspay/blend-design-system';
import { useForm } from '@tanstack/react-form';
import { useStore } from '@tanstack/react-store';
import { useZero } from '../../../hooks/useZero';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { isTestEnv } from '../../../config';
import {
  AttachmentEntityType,
  BaseTicketType,
  BoardType,
  ChannelScopeType,
  FormContextType,
  FormEntityType,
  FormFieldType,
  LookupType,
  TicketPriority,
  TicketStatusV2,
  isFieldActive,
  orderFieldsWithBranchChildrenAfterParent,
  toSelectOptions,
  type User as UserType,
} from '@xyne/shared';
import { KanbanBoard as SquareKanban, TicketToken as Ticket, PauseCircle } from '@xyne/icons';
import {
  CheckTickCircle as CircleCheck,
  CircleDashed,
  CircleDot,
  MultipleCrossCancelCircle as CircleX,
  CopyDefault as Copy,
  ThreeDotsMenuHorizontal as Ellipsis,
  Hashtag as Hash,
  LinkChainHorizontal as LinkIcon,
  Spinner as Loader2,
  PaperclipSlant as Paperclip,
  ExternalLink as SquareArrowOutUpRight,
  Tag,
  DeleteDustbin01 as Trash2,
  UserDefault as User,
  UserTwo as Users,
  MultipleCrossCancelDefault as X,
} from '@xyne/icons';
import React, { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../../hooks/useAuth';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useDuplicateTicketCheck } from '../../../hooks/useDuplicateTicketCheck';
import { useTitleGenerator } from '../../../hooks/useTitleGenerator';
import { useChannelAssignGate } from '../../../hooks/useChannelAssignGate';
import { useActiveUsers, useUsers, useSelf } from '../../../hooks/useUsers';
import { channelMembersFirst, currentUserFirst } from '../../../utils/channelMembersFirst';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useBoardSuggestion } from '../../../hooks/useBoardSuggestion';
import { apiInstance } from '../../../services/clients/apiClient';
import { cn } from '../../../utils/classNames';
import { mutators } from '../../../zero/mutators';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { queries } from '../../../zero/queries';
import { SubTicketCountIcon } from '../../../assets/icons';
import Avatar from '../../ui/Avatar/Avatar';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { EntityMultiSelector } from '../../ui/EntitySelector/EntityMultiSelector';
import { RepoDot, repoColor } from '../../Release/repoVisual';
import { AttachmentPreview } from '../../ui/files/AttachmentPreview';
import type { UploadedFile } from '../../ui/files/Files.types';
import Input from '../../ui/Input';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import MultiSelect from '../../ui/MultiSelect';
import RadioGroup, { Radio } from '../../ui/RadioGroup';
import Textarea from '../../ui/Textarea';
import Tooltip from '../../ui/Tooltip';
import { getFilesDimensions } from '../../ui/utils/files';
import {
  buildCreateTicketShareLink,
  filterActiveDynamicFieldValues,
  getMissingMandatoryFieldMessage,
  getPriorityOptions,
  hasCreateTicketFlag,
  parseAssignee,
  readCreateTicketPrefillFromUrl,
  serializeDynamicFields,
  snapshotTicketForm,
  TAG_COLORS,
  ticketFormSnapshotsEqual,
  writeCreateTicketFields,
  type TicketFormSnapshot,
} from './createTicket.utils';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { TextShimmer } from '../../ui/ShimmerText';
import { SearchUserV2 } from '../../ui/SearchUser/SearchUserV2';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import type { BoardMetadata } from '../../Board/BoardTicketFormConfig';
import { isReleaseBoard, isMainReleaseBoard } from '../../../utils/boardUtils';
import { useDraftAttachments } from '../../../hooks/useDraft';
import { usePlatform } from '../../../hooks/usePlatform';
import { openCreateTicketWindow, subscribeCreateTicketResult } from '../../../utils/electronApp';
import { getUserDisplayName, withYouLabel, matchesUserQuery } from '../../../utils/userDisplayName';
import {
  resolveDisplayFormFields,
  type ResolvedDisplayFormField,
} from '../../../utils/board/resolveDisplayFormFields';

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  standalone?: boolean;
  standaloneSeed?: {
    workflowType?: string;
    excludedChatAttachmentIds?: string[];
  };
  enableUrlSync?: boolean;
  channelId: string;
  projectId?: string;
  defaultStageId?: string | undefined;
  selectedBoardId?: string | null;
  selectedBoardName?: string | undefined;
  initialTitle?: string;
  initialDescription?: string;
  initialSubTickets?: Array<{ title: string; description?: string }>;
  initialAssignee?: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
  initialEta?: Date | null;
  initialPriority?: TicketPriority | null;
  initialStatus?: TicketStatusV2 | null;
  initialStageName?: string | null;
  initialTags?: string[];
  initialTicketKind?: 'task' | 'release';
  releaseOnly?: boolean;
  releaseChannelIds?: string[];
  sourceConversation?: ConversationWithTicket | undefined;
  isFromSubTicket?: boolean;
  isFromAI?: boolean;
  ticketSequence?: { current: number; total: number };
  parentTicketId?: string;
  onBeforeCreate?: (description: string, files: File[]) => Promise<void>;
  onTicketCreated?: (ticket: {
    id: string;
    conversationId?: string;
    xyneId?: string;
    workflowType?: string;
  }) => void;
}

export interface CreateTicketFormData {
  title: string;
  description: string;
  priority: TicketPriority | null;
  status: TicketStatusV2;
  assignee: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
  eta: Date | null;
  tags: string[];
  boardId: string;
  channelId: string;
  workflowType: string;
  files: File[];
  dynamicFields: Record<string, string | string[]>;
  merchantId?: string;
  ticketType?: string;
}

interface TicketResponse {
  id: string;
  conversationId?: string;
  xyneId?: string;
}

interface FieldErrorProps {
  error?: string | undefined;
}

type SubTicketDraft = {
  title: string;
  description?: string;
};

const EMPTY_TAGS: string[] = [];

const PRIMARY_RANGE_FIELD_NAMES = ['branch', 'deployedCommitId', 'newCommitId'];

const PRIMARY_DF_KEY = {
  branch: 'branch',
  deployedCommit: 'deployedCommitId',
  newCommit: 'newCommitId',
} as const;

const normalizeSubTicketDrafts = (
  value?: Array<{ title: string; description?: string }>,
): SubTicketDraft[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      const title = item?.title?.trim() ?? '';
      const description = item?.description?.trim();
      return description ? { title, description } : { title };
    })
    .filter(item => item.title.length > 0);
};

const newLocalFileId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

export const CreateTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  channelId,
  projectId,
  selectedBoardId,
  initialTitle = '',
  initialDescription = '',
  initialSubTickets,
  initialAssignee = null,
  initialEta = null,
  initialPriority = null,
  initialStatus = null,
  initialStageName = null,
  initialTags = EMPTY_TAGS,
  initialTicketKind = 'task',
  releaseOnly = false,
  releaseChannelIds,
  isFromSubTicket = false,
  isFromAI = false,
  ticketSequence,
  parentTicketId,
  sourceConversation,
  onBeforeCreate,
  onTicketCreated,
  standalone = false,
  standaloneSeed,
  enableUrlSync = false,
}) => {
  const zero = useZero();
  const shareableOrigin = useShareableOrigin();
  const { user } = useAuth();
  const {
    addDroppedFiles: providerAddDroppedFiles,
    removeDroppedFile: providerRemoveDroppedFile,
    clearDroppedFiles: providerClearDroppedFiles,
    getDroppedFilesForEntity,
  } = useDraftAttachments();

  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  const tab = searchParams.get('tab');

  const displayConversation = useMemo(
    () => (sourceConversation && isOpen ? sourceConversation : undefined),
    [sourceConversation, isOpen],
  );

  // Determine if we're creating from conversation or tickets tab
  const isFromTicketsTab = tab === 'tickets' && !sourceConversation;
  // Fetch existing CHAT attachments from INITIAL MESSAGE ONLY using Zero

  const messageIdForQuery =
    sourceConversation && isOpen && displayConversation?.initialMessageId
      ? displayConversation.initialMessageId
      : undefined;

  const [chatAttachments] = useCachedQuery(
    queries.attachmentsByInitialMessage({ initialMessageId: messageIdForQuery || 'nonexistent' }),
    { enabled: !!messageIdForQuery },
  );

  // Track which chat attachments to exclude from the ticket
  const [excludedChatAttachmentIds, setExcludedChatAttachmentIds] = useState<Set<string>>(
    () => new Set(standaloneSeed?.excludedChatAttachmentIds ?? []),
  );

  // Track assignee search
  const [assigneeSearchValue, setAssigneeSearchValue] = useState('');
  // Persist the selected option so the pill stays visible after search resets on close
  const [selectedAssigneeOption, setSelectedAssigneeOption] = useState<{
    value: string;
    label: string;
    icon: React.ReactNode;
  } | null>(null);

  // Track dynamic field errors
  const [dynamicFieldErrors, setDynamicFieldErrors] = useState<Record<string, string>>({});

  const hasPopulatedDeployedCommitId = useRef(false);
  const [selectedRepoBoardIds, setSelectedRepoBoardIds] = useState<string[]>([]);
  const [repoRanges, setRepoRanges] = useState<
    Record<string, { branch: string; deployedCommit: string; newCommit: string }>
  >({});
  const hasPopulatedRepoDeployed = useRef<Set<string>>(new Set());
  const [ticketKind, setTicketKind] = useState<'task' | 'release'>(initialTicketKind);
  const seedSnapshotRef = useRef<TicketFormSnapshot | null>(null);
  const baselineAttachmentCountRef = useRef<number | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const markAutoApplied = useCallback((patch: Partial<TicketFormSnapshot>): void => {
    if (!seedSnapshotRef.current) return;
    seedSnapshotRef.current = { ...seedSnapshotRef.current, ...patch };
  }, []);
  // Prefilled subtickets (used by proactive nudge review flow)
  const [subTickets, setSubTickets] = useState<SubTicketDraft[]>([]);
  const [editingSubTicketIndex, setEditingSubTicketIndex] = useState<number | null>(null);
  const [editingSubTicketTitle, setEditingSubTicketTitle] = useState('');
  const [editingSubTicketDescription, setEditingSubTicketDescription] = useState('');

  // File handling state
  const [isDraggingOverModal, setIsDraggingOverModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const { isMobile } = usePlatform();

  // Dynamic field USER search state
  const [dynamicFieldSearchQueries, setDynamicFieldSearchQueries] = useState<
    Record<string, string>
  >({});
  const [dynamicFieldOpenStates, setDynamicFieldOpenStates] = useState<Record<string, boolean>>({});

  const [ticketLocalFiles, setTicketLocalFiles] = useState<Array<{ id: string; file: File }>>([]);

  // Load attachments from DraftProvider (conversation case) or use local state (tickets tab)
  const [attachmentsMap, setAttachmentsMap] = useState<Map<string, File | UploadedFile>>(new Map());

  // Load attachments based on source
  useEffect(() => {
    const loadAttachments = () => {
      if (!isOpen) {
        baselineAttachmentCountRef.current = null;
        return;
      }

      if (!isFromTicketsTab) {
        // Load from DraftProvider (DB-backed)
        try {
          const map = getDroppedFilesForEntity(
            channelId,
            sourceConversation?.conversationId ?? null,
          );
          setAttachmentsMap(map);
          if (baselineAttachmentCountRef.current === null) {
            baselineAttachmentCountRef.current = map.size;
          }
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Failed to load attachments:'),
            error: error,
          });
        }
      } else {
        // For tickets tab, local state only
        setAttachmentsMap(new Map());
        if (baselineAttachmentCountRef.current === null) {
          baselineAttachmentCountRef.current = 0;
        }
      }
    };

    void loadAttachments();
  }, [isOpen, isFromTicketsTab, sourceConversation, channelId, getDroppedFilesForEntity]);

  // Unified add file handler
  const addFile = useCallback(
    async (file: File): Promise<void> => {
      if (!isFromTicketsTab) {
        // Use DraftProvider (DB-backed)
        await providerAddDroppedFiles(file, channelId, sourceConversation?.conversationId);
      } else {
        // Use local state (memory only)
        setTicketLocalFiles(prev => [...prev, { id: newLocalFileId(), file }]);
      }
    },
    [isFromTicketsTab, providerAddDroppedFiles, channelId, sourceConversation],
  );

  // Unified remove file handler
  const removeFile = useCallback(
    async (attachmentId: string, _file: File): Promise<void> => {
      if (!isFromTicketsTab) {
        // Use DraftProvider
        await providerRemoveDroppedFile(attachmentId);
      } else {
        // Use local state — remove only the entry matching the stable random id
        setTicketLocalFiles(prev => prev.filter(entry => entry.id !== attachmentId));
      }
    },
    [isFromTicketsTab, providerRemoveDroppedFile],
  );

  // Clear all files handler
  const clearFiles = useCallback(async () => {
    if (!isFromTicketsTab) {
      await providerClearDroppedFiles(channelId, sourceConversation?.conversationId ?? null);
    } else {
      setTicketLocalFiles([]);
    }
  }, [isFromTicketsTab, providerClearDroppedFiles, channelId, sourceConversation]);

  const channels = useAllVisibleChannels().filter(c => c.scopeType === ChannelScopeType.DEFAULT);

  // Track if title has been auto-generated for this modal session
  const [hasTitleBeenGenerated, setHasTitleBeenGenerated] = useState(false);

  const [newTags, setNewTags] = useState<string[]>([]);

  // Title generator hook
  const {
    title: generatedTitle,
    ticketType: generatedTicketType,
    isGenerating: isTitleGenerating,
    generateFromDescription,
    cancelGeneration,
  } = useTitleGenerator({
    maxLength: 100,
    onError: error => {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Title generation error:'),
        error: error,
      });
    },
  });

  // While the title is being AI-generated the title input is replaced by a shimmer,
  // so the Dialog's open-autofocus can't land on it. Once generation finishes, focus
  // the title input (desktop only) — unless the user has already moved into another field.
  const prevIsTitleGenerating = useRef(isTitleGenerating);
  useEffect(() => {
    const finishedGenerating = prevIsTitleGenerating.current && !isTitleGenerating;
    prevIsTitleGenerating.current = isTitleGenerating;
    if (!finishedGenerating || isMobile || !isOpen) return;
    if (document.activeElement === descriptionTextareaRef.current) return;
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [isTitleGenerating, isMobile, isOpen]);

  // Form state
  const form = useForm({
    defaultValues: {
      title: initialTitle,
      description: initialDescription,
      priority: initialPriority,
      status: initialStatus ?? TicketStatusV2.TODO,
      eta: initialEta,
      tags: initialTags,
      assignee: initialAssignee,
      userGroupId: null,
      boardId: selectedBoardId || '',
      channelId: channelId,
      workflowType: standaloneSeed?.workflowType ?? '',
      files: [],
      dynamicFields: {},
      merchantId: '',
      ticketType: BaseTicketType.Fix,
    } as CreateTicketFormData,
    onSubmit: async ({ value }) => {
      if (!user) return;
      await handleCreateTicket(value);
    },
  });

  const formValues = useStore(form.store, state => state.values);
  const selectedChannelId = formValues?.channelId;

  // Channel-membership gate for assignee selection (badge + add-to-channel snackbar).
  const {
    shouldGate: assigneeShouldGate,
    memberIds: assigneeMemberIds,
    gatedAssign: gatedAssignUser,
  } = useChannelAssignGate(selectedChannelId);

  // Find selected channel to get its projectId
  const selectedChannel = useMemo(
    () => channels?.find(c => c.id === selectedChannelId),
    [channels, selectedChannelId],
  );

  // Fetch boards for the selected channel's project (or default projectId)
  const selectedChannelProjectId =
    (isFromSubTicket || isFromAI) && selectedChannel?.projectId
      ? selectedChannel.projectId
      : projectId;
  const effectiveChannelId =
    isFromSubTicket || isFromAI ? (selectedChannelId ?? channelId) : channelId;
  const [channelBoardMappings, mappingDetails] = useCachedQuery(
    queries.boardsByChannel({ channelId: effectiveChannelId }),
    { enabled: !!effectiveChannelId },
  );
  // main's board resolution (channel-board-mapping with a project-boards fallback)
  // must define `boards` before the release additions below read it.
  const [projectBoards] = useCachedQuery(
    queries.boardsListByProject({ projectId: selectedChannelProjectId ?? '' }),
    { enabled: !!selectedChannelProjectId },
  );
  const boards = useMemo(() => {
    const mappingSynced = mappingDetails.type === 'complete';
    const mappedBoards = channelBoardMappings?.map(m => m.board) ?? [];
    const filtered = mappedBoards.filter((b): b is NonNullable<typeof b> => Boolean(b));
    const projectBoardsList = projectBoards ?? [];
    if (filtered.length > 0) {
      logger.debug(LogEvent.KANBAN_ENTITY_LOADED, {
        source: 'CreateTicketModal',
        resolution: 'channel-board-mapping',
        channelId: effectiveChannelId,
        mappedCount: filtered.length,
        projectBoardsCount: projectBoardsList.length,
      });
      return filtered;
    }
    // Only fall back to project boards once the mapping query has fully synced —
    // an empty result before that is just the zero cache warming up, not a truly
    // unmapped channel.
    if (!mappingSynced) {
      return projectBoardsList;
    }
    logger.debug(LogEvent.KANBAN_ENTITY_LOADED, {
      source: 'CreateTicketModal',
      resolution: 'project-boards-fallback',
      channelId: effectiveChannelId,
      mappedCount: 0,
      projectBoardsCount: projectBoardsList.length,
    });
    return projectBoardsList;
  }, [channelBoardMappings, mappingDetails.type, projectBoards, effectiveChannelId]);

  // Read by the open-reset effect without adding `boards` to its deps.
  const boardsRef = useRef(boards);
  boardsRef.current = boards;

  // Services grouped by main release board → read-only chips under each repo.
  const [releaseApplications] = useCachedQuery(
    queries.applicationsByProjectId({ projectId: selectedChannelProjectId ?? '' }),
    { enabled: !!selectedChannelProjectId },
  );
  const servicesByMainBoard = useMemo(() => {
    const map = new Map<string, string[]>();
    const list =
      !releaseApplications || releaseApplications instanceof Error ? [] : releaseApplications;
    for (const app of list) {
      if (!app.mainReleaseBoardId) continue;
      const names = map.get(app.mainReleaseBoardId) ?? [];
      names.push(app.name);
      map.set(app.mainReleaseBoardId, names);
    }
    return map;
  }, [releaseApplications]);

  // Get selected board's metadata for ticket form configuration
  const selectedBoard = useMemo(
    () => boards?.find(b => b.id === formValues.boardId),
    [boards, formValues.boardId],
  );
  const isFlowRootTicket = selectedBoard?.boardType === BoardType.FLOW && !parentTicketId;
  const isReleaseLine = ticketKind === 'release';
  // Only main release boards are selectable (repos); services show as chips below.
  // Keep the currently-primary board even if it lacks a provider.
  const releaseBoardOptions = useMemo(
    () =>
      (boards ?? [])
        .filter(b => isMainReleaseBoard(b) || b.id === formValues.boardId)
        .filter(b => isReleaseBoard(b.boardType))
        .map(b => ({ label: b.name, value: b.id, icon: <RepoDot color={repoColor(b.id)} /> })),
    [boards, formValues.boardId],
  );

  const boardMetadata = selectedBoard?.metadata as BoardMetadata | null;

  const ticketFormConfig = boardMetadata?.ticketFormConfig;

  // Determine which fields to show based on board configuration
  const showUserGroupsOnly = ticketFormConfig?.userGroupsOnly?.enabled ?? false;
  const showAssignee = ticketFormConfig?.assignedTo?.enabled ?? true;
  const showDueDate = ticketFormConfig?.dueDate?.enabled ?? true;
  const showTodo = ticketFormConfig?.todo?.enabled ?? true;
  const showLabels = ticketFormConfig?.labels?.enabled ?? true;
  const showMerchantId = ticketFormConfig?.merchantId?.enabled ?? false;
  const showTicketType = ticketFormConfig?.ticketType?.enabled ?? true;

  // Determine which fields are mandatory
  const mandatoryUserGroupsOnly = ticketFormConfig?.userGroupsOnly?.mandatory ?? false;
  const mandatoryAssignee = ticketFormConfig?.assignedTo?.mandatory ?? false;
  const mandatoryDueDate = ticketFormConfig?.dueDate?.mandatory ?? false;
  const mandatoryTodo = ticketFormConfig?.todo?.mandatory ?? false;
  const mandatoryLabels = ticketFormConfig?.labels?.mandatory ?? false;
  const mandatoryMerchantId = ticketFormConfig?.merchantId?.mandatory ?? false;
  const mandatoryTicketType = ticketFormConfig?.ticketType?.mandatory ?? false;

  // Fetch form mapping for the selected board (TICKET entity type)
  const [formMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: formValues.boardId || 'nonexistent',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!formValues.boardId },
  );

  const resolvedFormFields = useMemo(
    (): ResolvedDisplayFormField[] =>
      formMapping?.formFields
        ? resolveDisplayFormFields(formMapping.formId, [...formMapping.formFields])
        : [],
    [formMapping?.formFields, formMapping?.formId],
  );

  const titleValue = formValues?.title ?? '';
  const descriptionValue = formValues?.description ?? '';

  // Reset dynamic fields when board changes
  useEffect(() => {
    if (ticketKind === 'release') return;
    if (formValues?.boardId) {
      form.setFieldValue('dynamicFields', {});
      markAutoApplied({ dynamicFields: serializeDynamicFields({}) });
    }
    setSelectedRepoBoardIds([]);
    setRepoRanges({});
    hasPopulatedRepoDeployed.current = new Set();
  }, [formValues?.boardId, form, markAutoApplied, ticketKind]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedRepoBoardIds([]);
      setRepoRanges({});
      hasPopulatedRepoDeployed.current = new Set();
    }
  }, [isOpen]);

  useEffect(() => {
    if (ticketKind === 'release') {
      form.setFieldValue('ticketType', BaseTicketType.Release);
      markAutoApplied({ ticketType: BaseTicketType.Release });
      return;
    }
    if (!selectedBoard) return;

    const ticketType = isFlowRootTicket
      ? BaseTicketType.Epic
      : isReleaseBoard(selectedBoard.boardType)
        ? BaseTicketType.Release
        : BaseTicketType.Fix;
    form.setFieldValue('ticketType', ticketType);
    markAutoApplied({ ticketType });
  }, [ticketKind, selectedBoard, isFlowRootTicket, form, markAutoApplied]);

  useEffect(() => {
    if (!isOpen || resolvedFormFields.length === 0) return;
    if (!selectedBoard || !isReleaseBoard(selectedBoard.boardType)) return;

    const hasDeployedCommitField = resolvedFormFields.some(
      field => field.fieldName === 'deployedCommitId',
    );
    if (!hasDeployedCommitField) return;

    const currentDeployedCommitId = getSingleStringValue(
      formValues?.dynamicFields?.['deployedCommitId'] || '',
    );

    if (currentDeployedCommitId || hasPopulatedDeployedCommitId.current) return;

    const fetchLatestDeployedCommitId = async () => {
      try {
        const response = await apiInstance.get<{ latestCommitId: string }>(
          '/commits/analyze/latest-deployed-commit',
          { params: { mainReleaseBoardId: selectedBoard.id } },
        );

        if (response.data?.latestCommitId) {
          const nextDynamicFields = {
            ...formValues?.dynamicFields,
            deployedCommitId: response.data.latestCommitId,
          };
          form.setFieldValue('dynamicFields', nextDynamicFields);
          markAutoApplied({ dynamicFields: serializeDynamicFields(nextDynamicFields) });
          hasPopulatedDeployedCommitId.current = true;
        }
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to fetch latest deployed commit ID:'),
          error: error,
        });
      }
    };

    void fetchLatestDeployedCommitId();
  }, [isOpen, resolvedFormFields, selectedBoard, form, formValues?.dynamicFields, markAutoApplied]);

  useEffect(() => {
    if (!isOpen || !isReleaseLine) return;
    for (const boardId of selectedRepoBoardIds) {
      if (hasPopulatedRepoDeployed.current.has(boardId)) continue;
      if (repoRanges[boardId]?.deployedCommit) continue;
      hasPopulatedRepoDeployed.current.add(boardId);
      void apiInstance
        .get<{ latestCommitId: string }>('/commits/analyze/latest-deployed-commit', {
          params: { mainReleaseBoardId: boardId },
        })
        .then(response => {
          const latest = response.data?.latestCommitId;
          if (!latest) return;
          setRepoRanges(prev =>
            prev[boardId]?.deployedCommit
              ? prev
              : {
                  ...prev,
                  [boardId]: {
                    branch: prev[boardId]?.branch ?? '',
                    deployedCommit: latest,
                    newCommit: prev[boardId]?.newCommit ?? '',
                  },
                },
          );
        })
        .catch(() => {});
    }
  }, [isOpen, isReleaseLine, selectedRepoBoardIds, repoRanges]);
  const {
    duplicateCheck,
    // duplicateCandidate,
    candidateLinks,
    // duplicateCheckError,
    isCheckingDuplicate,
    resetDuplicateState,
  } = useDuplicateTicketCheck({
    title: titleValue,
    description: descriptionValue,
    projectId: selectedBoard?.projectId ?? '',
    boardId: formValues?.boardId,
    isOpen: isOpen && !isReleaseLine,
    debounceMs: 2000,
  });

  // Retrieval always returns its top-ranked tickets, so a non-empty candidate list means
  // "closest matches", not "duplicate". Only surface the panel once the analysis has actually
  // confirmed a duplicate and named a ticket — otherwise unrelated tickets get shown as similar.
  const showDuplicatePanel = Boolean(
    duplicateCheck?.analysis?.isDuplicate &&
    duplicateCheck?.analysis?.duplicateTicketId &&
    duplicateCheck?.candidates?.length,
  );

  // Once the user acts on the board (manual select, accept, or reject), suppress all further AI suggestions
  const [boardAISuggestionSuppressed, setBoardAISuggestionSuppressed] = useState(false);
  const [boardSelectorOpen, setBoardSelectorOpen] = useState(false);

  // Reset suppression when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setBoardAISuggestionSuppressed(false);
      setBoardSelectorOpen(false);
    }
  }, [isOpen]);

  const { boardSuggestion, isCheckingBoard, resetBoardSuggestionState } = useBoardSuggestion({
    title: titleValue,
    description: descriptionValue,
    projectId: selectedChannelProjectId ?? '',
    currentBoardId: formValues?.boardId || '',
    isOpen: isOpen && !boardAISuggestionSuppressed && !selectedBoardId,
    debounceMs: 2000,
  });

  // Project-level tags — lazy-loaded when the label dropdown is first opened
  const [tagsQueried, setTagsQueried] = useState(false);
  const [projectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: selectedBoard?.projectId ?? '' }),
    { enabled: tagsQueried && !!selectedBoard?.projectId },
  );

  const userGroupOptions = useUserGroups();

  const [ticketTypeOptions] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.TICKET_TYPE }),
  );
  // Full active-user list; we filter and rank it below so channel members are
  // actually present to float to the top (a pre-sliced top-N search would drop
  // them before we could rank).
  const activeUsers = useActiveUsers();
  const selfId = useSelf()?.id;

  // Fetch all users for dynamic USER fields
  const allUsers = useUsers();

  // Create a map for O(1) user lookups by ID
  const userMap = useMemo<Map<string, UserType>>(() => {
    if (!allUsers) return new Map();
    return new Map(allUsers.map(user => [user.id, user]));
  }, [allUsers]);

  useEffect(() => {
    const assignee = formValues.assignee;
    if (!assignee?.value) return;
    const expectedValue =
      assignee.type === 'assigneeTo' ? `user:${assignee.value}` : `userGroup:${assignee.value}`;
    if (selectedAssigneeOption?.value === expectedValue) return;
    if (assignee.type === 'assigneeTo') {
      const u = userMap.get(assignee.value);
      if (u) {
        setSelectedAssigneeOption({
          value: expectedValue,
          label: u.name || u.email,
          icon: (
            <Avatar
              userId={u.id}
              size='sm'
              showActiveStatus={false}
              className='rounded-md size-4 flex items-center justify-center'
            />
          ),
        });
      }
    } else {
      const group = userGroupOptions?.find(g => g.id === assignee.value);
      if (group) {
        setSelectedAssigneeOption({
          value: expectedValue,
          label: group.name,
          icon: <Users className='size-3.5' />,
        });
      }
    }
  }, [formValues.assignee, userMap, userGroupOptions, selectedAssigneeOption]);

  // Combine chat attachments and newly uploaded files for display
  const allAttachments = useMemo(() => {
    const result: Array<{
      id?: string;
      name?: string;
      originalFilename?: string;
      mimetype?: string;
      size?: number;
      url?: string;
      thumbnailUrl?: string | undefined;
      isFromChat?: boolean;
      file?: File | UploadedFile;
    }> = [];

    // Add chat attachments only if creating from a conversation (draft)
    // Exclude any that the user has chosen to remove
    if (sourceConversation && chatAttachments) {
      const chatAtts = chatAttachments
        .filter(
          a => a.entityType === AttachmentEntityType.CHAT && !excludedChatAttachmentIds.has(a.id),
        )
        .map(a => ({
          id: a.id,
          originalFilename: a.originalFilename,
          mimetype: a.mimetype,
          size: a.size,
          url: a.url,
          thumbnailUrl: a.thumbnailUrl ?? undefined,
          isFromChat: true,
        }));
      result.push(...chatAtts);
    }

    // Add newly uploaded files (from DraftProvider or local state)
    if (!isFromTicketsTab) {
      // From DraftProvider (DB)
      const draftFiles = Array.from(attachmentsMap.entries()).map(([attachmentId, file]) => ({
        attachmentId,
        file,
      }));
      draftFiles.forEach(({ attachmentId, file }) => {
        result.push({
          id: attachmentId,
          name: file instanceof File ? file.name : file.originalName,
          file,
          isFromChat: false,
        });
      });
    } else {
      // From local state (memory only)
      ticketLocalFiles.forEach(({ id, file }) => {
        result.push({
          id,
          name: file.name,
          file,
          isFromChat: false,
        });
      });
    }

    return result;
  }, [
    chatAttachments,
    attachmentsMap,
    sourceConversation,
    excludedChatAttachmentIds,
    isFromTicketsTab,
    ticketLocalFiles,
  ]);

  // Reset form when modal opens/closes, and set initial values
  useEffect(() => {
    if (isOpen) {
      form.reset();
      setTicketKind(initialTicketKind);
      setHasTitleBeenGenerated(false); // Reset flag when modal opens
      hasPopulatedDeployedCommitId.current = false;
      seedSnapshotRef.current = null;
      setShowDiscardConfirm(false);
      setSubTickets(normalizeSubTicketDrafts(initialSubTickets));
      setEditingSubTicketIndex(null);
      setEditingSubTicketTitle('');
      setEditingSubTicketDescription('');
      // Set initial values after reset to ensure they are applied
      if (initialTitle) {
        form.setFieldValue('title', initialTitle);
      }
      if (initialDescription) {
        form.setFieldValue('description', initialDescription);
      }
      if (initialPriority) {
        form.setFieldValue('priority', initialPriority);
      }
      if (initialStatus) {
        form.setFieldValue('status', initialStatus);
      }
      form.setFieldValue('tags', initialTags);
      // Release boards are created only via the Release Manager; don't preselect one here.
      const preselectedBoard = selectedBoardId
        ? boardsRef.current?.find(b => b.id === selectedBoardId)
        : undefined;
      if (selectedBoardId && !(preselectedBoard && isReleaseBoard(preselectedBoard.boardType))) {
        form.setFieldValue('boardId', selectedBoardId);
      }
      if (enableUrlSync && hasCreateTicketFlag(searchParamsRef.current)) {
        const prefill = readCreateTicketPrefillFromUrl(searchParamsRef.current);
        if (prefill.priority !== undefined) form.setFieldValue('priority', prefill.priority);
        if (prefill.status !== undefined) form.setFieldValue('status', prefill.status);
        if (prefill.boardId !== undefined) form.setFieldValue('boardId', prefill.boardId);
        if (prefill.assignee !== undefined) form.setFieldValue('assignee', prefill.assignee);
        if (prefill.eta !== undefined) form.setFieldValue('eta', prefill.eta);
        if (prefill.tags !== undefined) form.setFieldValue('tags', prefill.tags);
        if (prefill.workflowType !== undefined) {
          form.setFieldValue('workflowType', prefill.workflowType);
        }
      }
      resetDuplicateState();
      seedSnapshotRef.current = snapshotTicketForm(form.state.values);
    }
  }, [
    isOpen,
    form,
    enableUrlSync,
    initialTitle,
    initialDescription,
    initialPriority,
    initialStatus,
    initialSubTickets,
    initialTags,
    initialTicketKind,
    resetDuplicateState,
    selectedBoardId,
  ]);

  useEffect(() => {
    if (!enableUrlSync || !isOpen) return;
    const handle = setTimeout(() => {
      setSearchParamsRef.current(
        prev =>
          writeCreateTicketFields(new URLSearchParams(prev), {
            priority: formValues.priority,
            status: formValues.status,
            boardId: formValues.boardId,
            assignee: formValues.assignee,
            eta: formValues.eta,
            tags: formValues.tags,
            workflowType: formValues.workflowType,
          }),
        { replace: true },
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [enableUrlSync, isOpen, formValues]);

  // If a board is currently set but no longer exists in the list, clear it so AI can re-suggest
  useEffect(() => {
    if (boards && boards.length > 0) {
      const currentBoardId = form.getFieldValue('boardId');
      if (currentBoardId && !boards.some(board => board.id === currentBoardId)) {
        form.setFieldValue('boardId', '');
        markAutoApplied({ boardId: '' });
      }
    }
  }, [boards, form, markAutoApplied]);

  // Auto-select first board when board suggestion returns null (test env only — in prod
  // the user picks a board explicitly if no suggestion is available).
  useEffect(() => {
    if (!isTestEnv) return;
    if (isCheckingBoard || boardSuggestion?.analysis.suggestedBoardId) return;
    if (form.getFieldValue('boardId')) return;
    const firstBoard = boards?.[0];
    if (firstBoard) {
      form.setFieldValue('boardId', firstBoard.id);
      markAutoApplied({ boardId: firstBoard.id });
    }
  }, [isCheckingBoard, boardSuggestion, boards, form, markAutoApplied]);

  // Auto-generate title when modal opens with a description but no title
  useEffect(() => {
    if (
      isOpen &&
      initialDescription &&
      !initialTitle &&
      !hasTitleBeenGenerated &&
      !isTitleGenerating
    ) {
      // Generate title from description
      setHasTitleBeenGenerated(true); // Set flag to prevent re-triggering
      void generateFromDescription(initialDescription);
    }

    return () => {
      if (isTitleGenerating) {
        cancelGeneration();
      }
    };
  }, [isOpen, initialDescription, initialTitle, hasTitleBeenGenerated, isTitleGenerating]);

  // Update form title and ticket type when generated values are ready
  useEffect(() => {
    if (generatedTitle && !form.getFieldValue('title')) {
      form.setFieldValue('title', generatedTitle);
      markAutoApplied({ title: generatedTitle.trim() });
    }
    // FLOW root tickets are always Epic and release lines are always Release;
    // AI classification only applies elsewhere.
    if (
      generatedTicketType &&
      !isFlowRootTicket &&
      ticketKind !== 'release' &&
      !isReleaseBoard(selectedBoard?.boardType)
    ) {
      form.setFieldValue('ticketType', generatedTicketType);
      markAutoApplied({ ticketType: generatedTicketType });
    }
  }, [
    form,
    generatedTitle,
    generatedTicketType,
    isFlowRootTicket,
    ticketKind,
    selectedBoard?.boardType,
    markAutoApplied,
  ]);

  // File handling functions
  const handleModalDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverModal(true);
  };

  const handleModalDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverModal(true);
  };

  const handleModalDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the modal content itself
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDraggingOverModal(false);
    }
  };

  const handleModalDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverModal(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    droppedFiles.forEach(file => void addFile(file));
  };

  const handlePaperclipClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFiles = Array.from(e.target.files || []);
    selectedFiles.forEach(file => void addFile(file));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePreviewFile = (_file: File): void => {
    // File preview handled by Attachments component
  };

  const beginEditSubTicket = (index: number): void => {
    const target = subTickets[index];
    if (!target) return;
    setEditingSubTicketIndex(index);
    setEditingSubTicketTitle(target.title);
    setEditingSubTicketDescription(target.description || '');
  };

  const saveEditedSubTicket = (): void => {
    if (editingSubTicketIndex === null) return;
    const title = editingSubTicketTitle.trim();
    if (!title) {
      toast.error('Sub-ticket title cannot be empty');
      return;
    }

    setSubTickets(prev => {
      const next = [...prev];
      next[editingSubTicketIndex] = {
        title,
        ...(editingSubTicketDescription.trim()
          ? { description: editingSubTicketDescription.trim() }
          : {}),
      };
      return next;
    });
    setEditingSubTicketIndex(null);
    setEditingSubTicketTitle('');
    setEditingSubTicketDescription('');
  };

  const deleteSubTicket = (index: number): void => {
    setSubTickets(prev => prev.filter((_, currentIndex) => currentIndex !== index));
    if (editingSubTicketIndex === index) {
      setEditingSubTicketIndex(null);
      setEditingSubTicketTitle('');
      setEditingSubTicketDescription('');
      return;
    }
    if (editingSubTicketIndex !== null && index < editingSubTicketIndex) {
      setEditingSubTicketIndex(editingSubTicketIndex - 1);
    }
  };

  // Helper function to process ticket creation response
  const processTicketCreationResponse = (
    response: { data?: TicketResponse },
    workflowType: string,
  ): void => {
    if (onTicketCreated && response.data?.id) {
      const ticketData: {
        id: string;
        conversationId: string;
        xyneId?: string;
        workflowType?: string;
      } = {
        id: response.data.id,
        conversationId: response.data.conversationId || '',
        ...(response.data.xyneId && { xyneId: response.data.xyneId }),
      };

      if (workflowType) {
        ticketData.workflowType = workflowType;
      }

      onTicketCreated(ticketData);
    }
  };

  const missingMandatoryFieldMessage = useMemo(
    () =>
      getMissingMandatoryFieldMessage({
        formValues,
        boards,
        formMapping: { formFields: resolvedFormFields },
        showUserGroupsOnly,
        showAssignee,
        showTodo,
        showDueDate,
        showLabels,
        showMerchantId,
        showTicketType,
        mandatoryUserGroupsOnly,
        mandatoryAssignee,
        mandatoryTodo,
        mandatoryDueDate,
        mandatoryLabels,
        mandatoryMerchantId,
        mandatoryTicketType,
        isRelease: ticketKind === 'release',
        releaseOnly,
      }),
    [
      formValues,
      boards,
      resolvedFormFields,
      ticketKind,
      showUserGroupsOnly,
      showAssignee,
      showTodo,
      showDueDate,
      showLabels,
      showMerchantId,
      showTicketType,
      mandatoryUserGroupsOnly,
      mandatoryAssignee,
      mandatoryTodo,
      mandatoryDueDate,
      mandatoryLabels,
      mandatoryMerchantId,
      mandatoryTicketType,
      releaseOnly,
    ],
  );

  const releaseGateMessage = useMemo(() => {
    if (ticketKind !== 'release') return null;
    if (!formValues?.boardId) return 'Select at least one repository';
    const df = formValues?.dynamicFields ?? {};
    const filled = (v: string | string[] | undefined): boolean =>
      Array.isArray(v) ? Boolean(v[0]?.trim()) : Boolean(v?.trim());
    const primaryComplete =
      filled(df['branch']) && filled(df['deployedCommitId']) && filled(df['newCommitId']);
    const additionalsComplete = selectedRepoBoardIds.every(
      id =>
        Boolean(repoRanges[id]?.branch?.trim()) &&
        Boolean(repoRanges[id]?.deployedCommit?.trim()) &&
        Boolean(repoRanges[id]?.newCommit?.trim()),
    );
    if (!primaryComplete || !additionalsComplete) {
      return 'Enter the branch and deployed → new commit range for every selected repository';
    }
    return null;
  }, [
    ticketKind,
    formValues?.boardId,
    formValues?.dynamicFields,
    selectedRepoBoardIds,
    repoRanges,
  ]);

  const submitGateMessage = missingMandatoryFieldMessage ?? releaseGateMessage;

  const isFormReadyForSubmit = useMemo(() => {
    if (!form.state.isValid || !form.state.isDirty) return false;
    if (submitGateMessage) return false;
    if (Object.keys(dynamicFieldErrors).length > 0) return false;
    return true;
  }, [form.state.isValid, form.state.isDirty, submitGateMessage, dynamicFieldErrors]);

  const handleCreateTicket = async (formData: CreateTicketFormData) => {
    if (!user) return;
    try {
      // Validate mandatory board-configured fields
      const mandatoryFieldErrors: string[] = [];

      if (
        !releaseOnly &&
        showUserGroupsOnly &&
        mandatoryUserGroupsOnly &&
        !formData.assignee?.value
      ) {
        mandatoryFieldErrors.push('User Group is required');
      }
      if (
        !releaseOnly &&
        !showUserGroupsOnly &&
        showAssignee &&
        mandatoryAssignee &&
        !formData.assignee?.value
      ) {
        mandatoryFieldErrors.push('Assignee is required');
      }
      if (!releaseOnly && showDueDate && mandatoryDueDate && !formData.eta) {
        mandatoryFieldErrors.push('Due Date is required');
      }
      if (showTodo && mandatoryTodo && !formData.status) {
        mandatoryFieldErrors.push('Todo/Status is required');
      }
      if (
        !releaseOnly &&
        showLabels &&
        mandatoryLabels &&
        (!formData.tags || formData.tags.length === 0)
      ) {
        mandatoryFieldErrors.push('Labels are required');
      }
      if (showMerchantId && mandatoryMerchantId && !formData.merchantId?.trim()) {
        mandatoryFieldErrors.push('Merchant ID is required');
      }

      if (mandatoryFieldErrors.length > 0) {
        toast.error('Missing Required Fields', {
          description: mandatoryFieldErrors.join(', '),
        });
        return;
      }

      // Validate dynamic fields if form mapping exists
      if (resolvedFormFields.length > 0) {
        const allFields = resolvedFormFields;
        const getFieldEffectiveValue = (fieldId: string): string | undefined => {
          const parentField = allFields.find(f => f.id === fieldId);
          const parentRaw = parentField
            ? formData.dynamicFields?.[parentField.fieldName]
            : undefined;
          return typeof parentRaw === 'string' ? parentRaw : undefined;
        };

        const errors: Record<string, string> = {};
        let hasErrors = false;

        for (const field of allFields) {
          // Only validate required fields (isOptional must be true to skip, otherwise validate)
          if (field.isOptional === true) continue;
          // Inactive branch fields were never shown to fill in — same rule the backend uses.
          if (!isFieldActive(field, allFields, getFieldEffectiveValue)) continue;

          const fieldName = field.fieldName;
          const value = formData.dynamicFields[fieldName];

          if (
            !value ||
            (typeof value === 'string' && !value.trim()) ||
            (Array.isArray(value) && value.length === 0)
          ) {
            errors[fieldName] = `${fieldName} is required`;
            hasErrors = true;
          }
        }

        if (hasErrors) {
          setDynamicFieldErrors(errors);
          return;
        }
      }

      // Drop any stale value left over for a field switched out of its active branch — the
      // backend rejects the whole ticket if a value is present for an inactive field.
      const filteredDynamicFields =
        resolvedFormFields.length > 0
          ? filterActiveDynamicFieldValues(resolvedFormFields, formData.dynamicFields)
          : formData.dynamicFields;

      const submitDynamicFields: Record<string, string | string[]> =
        isReleaseLine && !!formData.boardId
          ? {
              ...filteredDynamicFields,
              releaseRepos: JSON.stringify([
                {
                  mainReleaseBoardId: formData.boardId,
                  branch: getSingleStringValue(formData.dynamicFields?.['branch'] || ''),
                  deployedCommit: getSingleStringValue(
                    formData.dynamicFields?.['deployedCommitId'] || '',
                  ),
                  newCommit: getSingleStringValue(formData.dynamicFields?.['newCommitId'] || ''),
                },
                ...selectedRepoBoardIds.map(id => ({
                  mainReleaseBoardId: id,
                  branch: repoRanges[id]?.branch ?? '',
                  deployedCommit: repoRanges[id]?.deployedCommit ?? '',
                  newCommit: repoRanges[id]?.newCommit ?? '',
                })),
              ]),
            }
          : filteredDynamicFields;

      // Split assignee into assignedTo and userGroupId
      const assignedTo = formData.assignee?.type === 'assigneeTo' ? formData.assignee.value : null;
      const userGroupId = formData.assignee?.type === 'userGroup' ? formData.assignee.value : null;
      let createdTicketResponse: TicketResponse | null = null;

      // 1. EXECUTE MESSAGE SENDING FIRST (if handler provided)
      if (onBeforeCreate) {
        // Send the text description as a message immediately
        // Note: We are passing [] for files here so files are only attached to the ticket
        // Change to `sharedAttachments` if you want files on the message instead
        await onBeforeCreate(formData.description, []);
      }

      // Collect draft attachment IDs from DraftProvider (for conversation case)
      const draftAttachmentIds = !isFromTicketsTab ? Array.from(attachmentsMap.keys()) : [];

      // Get files to send - combine both sources
      const draftFiles = !isFromTicketsTab
        ? Array.from(attachmentsMap.values()).filter((f): f is File => f instanceof File)
        : ticketLocalFiles.map(entry => entry.file);

      // 2. PROCEED WITH TICKET CREATION
      let response;
      if (draftFiles.length > 0) {
        const formDataPayload = new FormData();

        // Add text fields
        formDataPayload.append('title', formData.title.trim());
        formDataPayload.append('description', formData.description.trim());
        formDataPayload.append('boardId', formData.boardId);
        // For subtickets, AI-initiated tickets, or a release-only launch, use the
        // channel picked in the form; otherwise use the prop (the current channel).
        formDataPayload.append(
          'channelId',
          isFromSubTicket || isFromAI || releaseOnly ? formData.channelId : channelId,
        );
        if (selectedBoard?.projectId) {
          formDataPayload.append('projectId', selectedBoard.projectId);
        }

        if (assignedTo) {
          formDataPayload.append('assignedTo', assignedTo);
        }
        if (formData.priority) {
          formDataPayload.append('priority', formData.priority);
        }
        if (userGroupId) {
          formDataPayload.append('userGroupId', userGroupId);
        }
        if (formData.status) {
          formDataPayload.append('statusV2', formData.status);
        }
        if (initialStageName) {
          formDataPayload.append('stageName', initialStageName);
        }
        if (formData.workflowType) {
          formDataPayload.append('workflowType', formData.workflowType);
        }
        if (formData.eta) {
          formDataPayload.append('eta', formData.eta.toISOString());
        }
        if (formData.tags && formData.tags.length > 0) {
          formData.tags.forEach(tag => {
            formDataPayload.append('tags[]', tag);
          });
        }
        if (formData.merchantId) {
          formDataPayload.append('merchantId', formData.merchantId);
        }
        if (parentTicketId) {
          formDataPayload.append('parentTicketId', parentTicketId);
        }
        if (formData.ticketType) {
          formDataPayload.append('ticketType', formData.ticketType);
        }

        // Send dynamicFields on the multipart path too, else releaseRepos/commit
        // range are dropped when a release ticket has an attachment.
        formDataPayload.append('dynamicFields', JSON.stringify(submitDynamicFields));

        // Add draft attachment IDs if creating from conversation
        if (draftAttachmentIds.length > 0) {
          draftAttachmentIds.forEach(id => {
            formDataPayload.append('draftAttachmentIds[]', id);
          });
        }

        if (sourceConversation) {
          formDataPayload.append('sourceConversationId', sourceConversation.conversationId);
          if (excludedChatAttachmentIds.size > 0) {
            excludedChatAttachmentIds.forEach(id => {
              formDataPayload.append('excludedChatAttachmentIds[]', id);
            });
          }
        }

        // Extract dimensions for all files (images/videos only)
        const dimensionsMap = await getFilesDimensions(draftFiles);

        // Build file metadata with dimensions
        const fileMetadata: Array<{
          fileIndex: number;
          hasThumbnail: boolean;
          width?: number;
          height?: number;
        }> = [];

        // Add shared attachments (files added via conversation)
        if (draftFiles.length > 0) {
          draftFiles.forEach((file: File, fileIndex: number) => {
            formDataPayload.append('files', file);

            // Get dimensions for this file (null for non-media files)
            const dimensions = dimensionsMap.get(file);
            fileMetadata.push({
              fileIndex,
              hasThumbnail: false,
              ...(dimensions && { width: dimensions.width, height: dimensions.height }),
            });
          });

          // Add file metadata as JSON
          formDataPayload.append('fileMetadata', JSON.stringify(fileMetadata));
        }

        formDataPayload.append('fromTicketsTab', String(isFromTicketsTab));
        response = await apiInstance.post<TicketResponse>('/tickets', formDataPayload);
        createdTicketResponse = response.data;
        processTicketCreationResponse(response, formData.workflowType);
      } else {
        // No files, use JSON
        response = await apiInstance.post<TicketResponse>('/tickets', {
          title: formData.title.trim(),
          description: formData.description.trim(),
          priority: formData.priority,
          statusV2: formData.status,
          ...(initialStageName ? { stageName: initialStageName } : {}),
          assignedTo: assignedTo || undefined,
          userGroupId: userGroupId || undefined,
          boardId: formData.boardId,
          // Use the form channel for subtickets/AI/releaseOnly; else the prop. Matches the multipart branch.
          channelId: isFromSubTicket || isFromAI || releaseOnly ? formData.channelId : channelId,
          fromTicketsTab: isFromTicketsTab,
          ...(selectedBoard?.projectId && { projectId: selectedBoard.projectId }),
          ticketType: formData.ticketType,
          ...(draftAttachmentIds.length > 0 && { draftAttachmentIds }),
          ...(sourceConversation && { eta: formData.eta?.toISOString() }),
          ...(formData.tags && formData.tags.length > 0 && { tags: formData.tags }),
          ...(sourceConversation && { sourceConversationId: sourceConversation.conversationId }),
          ...(formData.workflowType && { workflowType: formData.workflowType }),
          ...(sourceConversation &&
            excludedChatAttachmentIds.size > 0 && {
              excludedChatAttachmentIds: Array.from(excludedChatAttachmentIds),
            }),
          ...(formData.merchantId && { merchantId: formData.merchantId }),
          ...(parentTicketId && { parentTicketId }),
          // Include dynamic fields (pruned of any now-inactive branch field's stale value)
          dynamicFields: submitDynamicFields,
        });

        createdTicketResponse = response.data;
        processTicketCreationResponse(response, formData.workflowType);
      }
      const subticketsToCreate = normalizeSubTicketDrafts(subTickets);
      if (createdTicketResponse?.id && subticketsToCreate.length > 0) {
        const baseTimestamp = Date.now();
        const masterTicketId = createdTicketResponse.id;
        const masterConversationId = createdTicketResponse.conversationId;
        subticketsToCreate.forEach((subTicket, index) => {
          void surfaceMutationError(
            zero.mutate(
              mutators.subTicket.create({
                subTicketId: uuidv4(),
                mappingId: uuidv4(),
                timestamp: baseTimestamp + index,
                title: subTicket.title,
                ...(subTicket.description ? { description: subTicket.description } : {}),
                ticketId: masterTicketId,
                ...(masterConversationId ? { conversationId: masterConversationId } : {}),
              }),
            ),
            `Failed to create sub-ticket "${subTicket.title}"`,
          );
        });
      }

      // Don't auto-close if part of a sequence - let the parent handle it
      if (!ticketSequence || ticketSequence.current === ticketSequence.total) {
        onClose();
      }
    } catch (error) {
      // Handle file upload failures and other API errors
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to create ticket:'),
        error: error,
      });

      toast.error('Ticket Creation Failed', {
        description:
          error instanceof Error ? error.message : 'Failed to create ticket. Please try again.',
      });
    }
  };

  const handleClose = (): void => {
    if (isFromTicketsTab) {
      void clearFiles();
    }
    setExcludedChatAttachmentIds(new Set());
    setEditingSubTicketIndex(null);
    setEditingSubTicketTitle('');
    setEditingSubTicketDescription('');
    resetDuplicateState();
    onClose();
  };

  const hasUnsavedChanges = (): boolean => {
    const seed = seedSnapshotRef.current;
    if (!seed) return false;

    if (!ticketFormSnapshotsEqual(snapshotTicketForm(form.state.values), seed)) return true;

    const seededSubTickets = normalizeSubTicketDrafts(initialSubTickets);
    if (JSON.stringify(normalizeSubTicketDrafts(subTickets)) !== JSON.stringify(seededSubTickets)) {
      return true;
    }

    if (editingSubTicketIndex !== null) {
      const editing = subTickets[editingSubTicketIndex];
      if (
        editingSubTicketTitle.trim() !== (editing?.title ?? '').trim() ||
        editingSubTicketDescription.trim() !== (editing?.description ?? '').trim()
      ) {
        return true;
      }
    }

    if (isFromTicketsTab) {
      if (ticketLocalFiles.length > 0) return true;
    } else if (attachmentsMap.size > (baselineAttachmentCountRef.current ?? 0)) {
      return true;
    }
    const seededExclusions = standaloneSeed?.excludedChatAttachmentIds?.length ?? 0;
    if (excludedChatAttachmentIds.size !== seededExclusions) return true;

    return false;
  };

  const requestClose = (): void => {
    if (hasUnsavedChanges()) {
      setShowDiscardConfirm(true);
      return;
    }
    handleClose();
  };

  const handleConfirmDiscard = (): void => {
    setShowDiscardConfirm(false);
    handleClose();
  };

  const canPopOut = !standalone && !ticketSequence;

  const handlePopOut = (): void => {
    const popoutId = uuidv4();

    const disposeResultListener = onTicketCreated
      ? subscribeCreateTicketResult(popoutId, onTicketCreated)
      : undefined;

    const values = form.state.values;
    const opened = openCreateTicketWindow({
      popoutId,
      workspaceId: user?.workspaceId,
      channelId,
      ...(projectId ? { projectId } : {}),
      tab: tab || undefined,
      sourceConversationId: sourceConversation?.conversationId,
      initialMessageId: sourceConversation?.initialMessageId,
      parentTicketId,
      isFromSubTicket,
      isFromAI,
      subTickets: subTickets.length > 0 ? subTickets : undefined,
      excludedChatAttachmentIds:
        excludedChatAttachmentIds.size > 0 ? Array.from(excludedChatAttachmentIds) : undefined,
      form: {
        title: values.title || undefined,
        description: values.description || undefined,
        priority: values.priority ?? undefined,
        status: values.status,
        assignee: values.assignee ?? undefined,
        eta: values.eta ? values.eta.toISOString() : undefined,
        tags: values.tags,
        boardId: values.boardId || selectedBoardId || undefined,
        workflowType: values.workflowType || undefined,
        merchantId: values.merchantId || undefined,
        ticketType: values.ticketType,
        dynamicFields: values.dynamicFields,
      },
    });

    if (opened) {
      onClose();
    } else {
      disposeResultListener?.();
    }
  };

  const hasShareableContent = Boolean(
    formValues.boardId ||
    formValues.assignee?.value ||
    formValues.priority ||
    formValues.eta ||
    (formValues.tags && formValues.tags.length > 0) ||
    formValues.workflowType ||
    (formValues.status && formValues.status !== TicketStatusV2.TODO),
  );

  const handleShareCreateTicketLink = (): void => {
    const link = buildCreateTicketShareLink(searchParams, {
      priority: formValues.priority,
      status: formValues.status,
      boardId: formValues.boardId,
      assignee: formValues.assignee,
      eta: formValues.eta,
      tags: formValues.tags,
      workflowType: formValues.workflowType,
    });

    navigator.clipboard
      .writeText(link)
      .then(() => {
        toast.success('Link Copied', {
          description: 'A prefilled create-ticket link was copied to your clipboard.',
          duration: 2000,
        });
      })
      .catch(() => {
        toast.error('Link Copy Failed', {
          description: 'Failed to copy the link to your clipboard.',
          duration: 2000,
        });
      });
  };

  // Handle duplicate ticket copy link
  const handleDuplicateTicketCopyLink = (link: string): void => {
    const ticketUrl = `${shareableOrigin}${link}`;

    navigator.clipboard
      .writeText(ticketUrl)
      .then(() => {
        toast.success('Link Copied', {
          description: 'The link has been copied to your clipboard.',
          duration: 2000,
        });
      })
      .catch(() => {
        toast.error('Link Copy Failed', {
          description: 'Failed to copy the link to your clipboard.',
          duration: 2000,
        });
      });
  };

  // get unique tags from project_tags
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

  // Helper functions for dynamic field value normalization
  const getSingleStringValue = (value: string | string[]): string => {
    if (Array.isArray(value)) {
      return value[0] || '';
    }
    return value;
  };

  const getStringArrayValue = (value: string | string[]): string[] => {
    if (Array.isArray(value)) {
      return value;
    }
    // Only wrap non-empty strings in array
    if (typeof value === 'string' && value.trim()) {
      return [value];
    }
    return []; // Return empty array for empty/undefined values
  };

  const getRepoRange = (
    id: string,
  ): { branch: string; deployedCommit: string; newCommit: string } => {
    if (id === formValues?.boardId) {
      return {
        branch: getSingleStringValue(formValues?.dynamicFields?.['branch'] ?? ''),
        deployedCommit: getSingleStringValue(formValues?.dynamicFields?.['deployedCommitId'] ?? ''),
        newCommit: getSingleStringValue(formValues?.dynamicFields?.['newCommitId'] ?? ''),
      };
    }
    return repoRanges[id] ?? { branch: '', deployedCommit: '', newCommit: '' };
  };

  const setRepoRangeField = (
    id: string,
    key: 'branch' | 'deployedCommit' | 'newCommit',
    value: string,
  ): void => {
    if (id === formValues?.boardId) {
      form.setFieldValue('dynamicFields', {
        ...formValues?.dynamicFields,
        [PRIMARY_DF_KEY[key]]: value,
      });
      return;
    }
    setRepoRanges(prev => ({
      ...prev,
      [id]: { branch: '', deployedCommit: '', newCommit: '', ...prev[id], [key]: value },
    }));
  };

  const toggleRepoBoard = (id: string): void => {
    if (id === formValues?.boardId) {
      const [next, ...rest] = selectedRepoBoardIds;
      if (next) {
        const range = repoRanges[next] ?? { branch: '', deployedCommit: '', newCommit: '' };
        form.setFieldValue('boardId', next);
        form.setFieldValue('dynamicFields', {
          ...formValues?.dynamicFields,
          branch: range.branch,
          deployedCommitId: range.deployedCommit,
          newCommitId: range.newCommit,
        });
        setSelectedRepoBoardIds(rest);
      } else {
        const nextFields = { ...formValues?.dynamicFields };
        delete nextFields['branch'];
        delete nextFields['deployedCommitId'];
        delete nextFields['newCommitId'];
        form.setFieldValue('boardId', '');
        form.setFieldValue('dynamicFields', nextFields);
      }
      return;
    }
    if (selectedRepoBoardIds.includes(id)) {
      setSelectedRepoBoardIds(prev => prev.filter(x => x !== id));
      return;
    }
    if (!formValues?.boardId) {
      form.setFieldValue('boardId', id);
      const df = formValues?.dynamicFields ?? {};
      if (!getSingleStringValue(df['branch'] ?? '').trim()) {
        form.setFieldValue('dynamicFields', { ...df, branch: 'main' });
      }
    } else {
      setSelectedRepoBoardIds(prev => [...prev, id]);
      setRepoRanges(prev => ({
        ...prev,
        [id]: prev[id] ?? { branch: 'main', deployedCommit: '', newCommit: '' },
      }));
    }
  };

  const boardOptions = useMemo(
    () =>
      boards
        ?.filter(board => !isReleaseBoard(board.boardType))
        .map(board => ({
          label: board.name,
          value: board.id,
          icon: (
            <span className='bg-primary text-primary-foreground text-xs aspect-square size-4 rounded text-center'>
              {board.name.charAt(0)}
            </span>
          ),
        })) ?? [],
    [boards],
  );

  // Get status options and memomize them
  const statusOptions = [
    {
      label: 'Todo',
      value: 'TODO',
      icon: <CircleDashed strokeWidth={2.5} className='size-3.5 text-orange-500' />,
    },
    {
      label: 'Started',
      value: 'STARTED',
      icon: <CircleDot strokeWidth={2.5} className='size-3.5 text-blue-500' />,
    },
    {
      label: 'Paused',
      value: 'PAUSED',
      icon: <PauseCircle strokeWidth={2.5} className='size-3.5 text-teal-500' />,
    },
    {
      label: 'Cancelled',
      value: 'CANCELLED',
      icon: <CircleX strokeWidth={2.5} className='size-3.5 text-red-500' />,
    },
    {
      label: 'Completed',
      value: 'COMPLETED',
      icon: <CircleCheck strokeWidth={2.5} className='size-3.5 text-green-500' />,
    },
  ];

  // Channel options for subticket creation
  const channelOptions = useMemo(
    () =>
      channels?.map(channel => ({
        ...channel,
        label: channel.name,
        value: channel.id,
        icon: <Hash className='size-3.5' strokeWidth={2.33} />,
      })) ?? [],
    [channels],
  );

  const [allChannels] = useCachedQuery(queries.userAllChannels({}), { enabled: releaseOnly });
  const releaseChannelOptions = useMemo(() => {
    const ids = new Set(releaseChannelIds ?? []);
    if (ids.size === 0) return channelOptions;
    return (allChannels ?? [])
      .filter(ch => ids.has(ch.id))
      .map(ch => ({
        ...ch,
        label: ch.name,
        value: ch.id,
        icon: <Hash className='size-3.5' strokeWidth={2.33} />,
      }));
  }, [channelOptions, releaseChannelIds, allChannels]);

  const assigneeOptions = useMemo(() => {
    const query = assigneeSearchValue.trim().toLowerCase();
    const matchedUsers = !query
      ? activeUsers
      : activeUsers.filter(user => matchesUserQuery(user, assigneeSearchValue));
    // You first, then channel members, then cap the rows (this list isn't
    // virtualized). Deactivated users aren't shown here — the source is active-only.
    const membersFirst = channelMembersFirst(matchedUsers, user => user.id, assigneeMemberIds);
    const rankedUsers = currentUserFirst(membersFirst, user => user.id, selfId).slice(0, 25);
    const userOptions = rankedUsers.map(user => ({
      ...user,
      label: withYouLabel(getUserDisplayName(user), user.id === selfId),
      value: `user:${user.id}`,
      icon: (
        <Avatar
          userId={user.id}
          size={'sm'}
          showActiveStatus={false}
          className='rounded-md size-4 flex items-center justify-center'
        />
      ),
      type: 'user' as const,
      badge: assigneeShouldGate && !assigneeMemberIds.has(user.id) ? 'Not in channel' : undefined,
    }));

    const filteredGroups = assigneeSearchValue.trim()
      ? userGroupOptions
          ?.filter(group => group.isActive !== false)
          .filter(group => group.name.toLowerCase().includes(assigneeSearchValue.toLowerCase()))
      : userGroupOptions?.filter(group => group.isActive !== false);

    const groupOptions =
      filteredGroups?.map(userGroup => ({
        ...userGroup,
        label: userGroup.name,
        value: `userGroup:${userGroup.id}`,
        icon: <Users className='size-3.5' />,
        type: 'userGroup' as const,
      })) || [];

    // Users keep their channel-members-first rank; groups follow, alphabetical.
    const sortedGroups = [...groupOptions].sort((a, b) => a.label.localeCompare(b.label));

    // Always include the selected option so the pill stays visible when it
    // falls outside the current search result window (e.g. after close resets the query).
    const options = showUserGroupsOnly ? sortedGroups : [...userOptions, ...sortedGroups];

    if (selectedAssigneeOption && !options.some(o => o.value === selectedAssigneeOption.value)) {
      return [selectedAssigneeOption as (typeof options)[number], ...options];
    }
    return options;
  }, [
    activeUsers,
    userGroupOptions,
    assigneeSearchValue,
    showUserGroupsOnly,
    selectedAssigneeOption,
    assigneeShouldGate,
    assigneeMemberIds,
    selfId,
  ]);

  // Get tag options
  const tagOptions = useMemo(() => {
    const selectedTags = formValues?.tags ?? [];
    const allTags = [...new Set([...availableTags, ...newTags, ...initialTags, ...selectedTags])];

    return allTags
      .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
      .map((tag, index) => ({
        label: tag,
        value: tag,
        icon: <span className={cn('size-2 rounded-full', TAG_COLORS[index % TAG_COLORS.length])} />,
      }));
  }, [availableTags, newTags, initialTags, formValues?.tags]);

  const requiredDynamicFields = useMemo(() => {
    const visibilityMap = boardMetadata?.customFieldVisibility;
    const allFields = visibilityMap
      ? resolvedFormFields.filter(f => visibilityMap[f.id] !== false)
      : resolvedFormFields;
    const bySequence = [...allFields].sort(
      (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
    );
    return orderFieldsWithBranchChildrenAfterParent(bySequence);
  }, [resolvedFormFields, boardMetadata]);

  // Of those, only the ones currently active given the parent values selected so far.
  const activeDynamicFields = useMemo(() => {
    const allFields = resolvedFormFields;
    const getFieldEffectiveValue = (fieldId: string): string | undefined => {
      const parentField = allFields.find(f => f.id === fieldId);
      const parentRaw = parentField
        ? formValues?.dynamicFields?.[parentField.fieldName]
        : undefined;
      return typeof parentRaw === 'string' ? parentRaw : undefined;
    };
    return requiredDynamicFields.filter(field =>
      isFieldActive(field, allFields, getFieldEffectiveValue),
    );
  }, [requiredDynamicFields, resolvedFormFields, formValues?.dynamicFields]);

  const visibleDynamicFields = useMemo(
    () =>
      isReleaseLine
        ? activeDynamicFields.filter(f => !PRIMARY_RANGE_FIELD_NAMES.includes(f.fieldName))
        : activeDynamicFields,
    [activeDynamicFields, isReleaseLine],
  );

  // Field error
  const FieldError: React.FC<FieldErrorProps> = ({ error }) => {
    const errorMessage = typeof error === 'string' ? error : undefined;

    return (
      <div
        id='field-error'
        role='alert'
        aria-live='polite'
        className={cn(
          'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
          error ? 'max-h-10 opacity-100 mt-1' : 'max-h-0 opacity-0',
        )}
      >
        <p className='text-xs text-red-600'>{errorMessage}</p>
      </div>
    );
  };

  if (!isOpen) {
    return null;
  }

  const modalContent = (
    <div
      onDragOver={handleModalDragOver}
      onDragEnter={handleModalDragEnter}
      onDragLeave={handleModalDragLeave}
      onDrop={handleModalDrop}
      className={cn('relative', standalone ? '' : 'overflow-y-auto max-h-[80vh]')}
    >
      {/* Drag overlay */}
      {isDraggingOverModal && (
        <div className='absolute inset-0 bg-blue-50 bg-opacity-90 rounded-lg flex items-center justify-center z-50 pointer-events-none'>
          <div className='text-center'>
            <Paperclip className='w-12 h-12 text-blue-500 mx-auto mb-2' />
            <p className='text-blue-700 font-medium'>Drop files to attach</p>
          </div>
        </div>
      )}

      <div className='w-full px-4 pt-4 pb-3 flex items-center justify-between'>
        <h2 className='text-xs leading-5 font-medium text-foreground/80 select-none'>
          {ticketSequence
            ? `${ticketKind === 'release' ? 'New Release' : 'New Ticket'} (${ticketSequence.current}/${ticketSequence.total})`
            : ticketKind === 'release'
              ? 'New Release'
              : 'New Ticket'}
        </h2>
        <div className='flex items-center gap-1'>
          {enableUrlSync && (
            <Button
              variant='ghost'
              size='icon'
              onClick={handleShareCreateTicketLink}
              disabled={form.state.isSubmitting || !hasShareableContent}
              className='size-6'
              aria-label='Copy shareable link'
              title={
                hasShareableContent
                  ? 'Copy shareable link'
                  : 'Fill in a field to share a prefilled link'
              }
              data-track-category='Tickets'
              data-track-name='ShareCreateTicketModal'
            >
              <LinkIcon strokeWidth={2.33} className='size-3.5' />
            </Button>
          )}
          {canPopOut && (
            <Button
              variant='ghost'
              size='icon'
              onClick={handlePopOut}
              disabled={form.state.isSubmitting}
              className='size-6'
              aria-label='Open in new window'
              title='Open in new window'
              data-track-category='Tickets'
              data-track-name='PopOutCreateTicketModal'
            >
              <SquareArrowOutUpRight strokeWidth={2.33} className='size-3.5' />
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon'
            onClick={requestClose}
            disabled={form.state.isSubmitting}
            className='size-6 '
            data-track-category='Tickets'
            data-track-name='CloseCreateTicketModal'
          >
            <X strokeWidth={2.33} className='size-3.5' />
          </Button>
        </div>
      </div>

      <form
        onSubmit={e => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        className='px-4 pt-1.5 space-y-0'
      >
        {/* Title Field */}
        <form.Field
          name='title'
          validators={{
            onChange: ({ value }) => {
              if (!value?.trim()) return 'Title is required';
              if (value.length < 3) return 'Title must be at least 3 characters';
              if (value.length > 100) return 'Title must be 100 characters or less';
              return undefined;
            },
          }}
        >
          {field => (
            <div className='space-y-1'>
              {isTitleGenerating ? (
                <div className='flex h-8 items-center'>
                  <TextShimmer
                    glassEffect={false}
                    className='text-left leading-tight font-bold text-[20px]'
                  >
                    Adding AI generated title
                  </TextShimmer>
                </div>
              ) : (
                <Input
                  ref={titleInputRef}
                  value={field.state.value}
                  required={true}
                  onChange={e => {
                    // If user starts typing, cancel the ongoing generation
                    if (isTitleGenerating) {
                      cancelGeneration();
                    }
                    field.handleChange(e.target.value);
                  }}
                  aria-label='Ticket Title'
                  placeholder={
                    ticketKind === 'release' ? 'Enter Release Title...' : 'Enter Ticket Title...'
                  }
                  data-testid='ticket-title-input'
                  data-track-category='Tickets'
                  data-track-name='EDIT_TICKET_TITLE'
                  data-track-metadata={JSON.stringify({ boardId: selectedBoardId, channelId })}
                  className={cn(
                    '!text-xl !leading-tight truncate',
                    'px-0 border-none focus-visible:ring-0',
                    'font-bold text-foreground placeholder:text-xl placeholder:text-muted-foreground/50',
                    field.state.meta.errors.length > 0 && 'text-red-600',
                  )}
                />
              )}
              <FieldError error={field.state.meta.errors[0]} />
            </div>
          )}
        </form.Field>

        {/* Description Field */}
        <form.Field
          name='description'
          validators={{
            onChange: ({ value }) => {
              if (!value?.trim()) return 'Description is required';
              if (value.length < 5) return 'Description must be at least 5 characters';
              return undefined;
            },
          }}
        >
          {field => (
            <div className='space-y-1'>
              <Textarea
                ref={descriptionTextareaRef}
                rows={2}
                required={true}
                aria-required='true'
                id='ticket-description'
                value={field.state.value || ''}
                aria-invalid={field.state.meta.errors.length > 0}
                placeholder='Enter Ticket Description...'
                aria-label='Ticket Description'
                data-testid='ticket-description-input'
                data-track-category='Tickets'
                data-track-name='EDIT_TICKET_DESCRIPTION'
                data-track-metadata={JSON.stringify({ boardId: selectedBoardId, channelId })}
                onChange={e => {
                  const newValue = e.target.value;
                  field.handleChange(newValue);
                  // Dynamically adjust the height
                  const target = e.target;
                  target.style.height = 'auto'; // Reset height to recalculate
                  target.style.height = `${target.scrollHeight}px`; // Set to scroll height
                }}
                className={cn(
                  'border-none focus-visible:ring-0 focus-visible:border-none rounded-none p-0 min-h-16',
                  'max-h-[25vh]', // can occupy max 25% of vertical height
                  'resize-none overflow-y-auto',
                  'placeholder:text-muted-foreground/50 text-foreground/80 leading-5 font-semibold',
                  field.state.meta.errors.length > 0 && 'text-red-600',
                )}
              />
              <FieldError error={field.state.meta.errors[0]} />
            </div>
          )}
        </form.Field>

        {subTickets.length > 0 && (
          <div className='mt-2 rounded-md border border-border bg-muted p-3'>
            <div className='mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground'>
              <SubTicketCountIcon className='shrink-0 text-foreground' />
              <span>{subTickets.length} Sub-tickets</span>
            </div>
            <div className='space-y-2'>
              {subTickets.map((subTicket, index) => {
                const isEditing = editingSubTicketIndex === index;
                return (
                  <div
                    key={`subticket-${index}`}
                    className='rounded-lg border border-border bg-background p-[11px]'
                  >
                    {isEditing ? (
                      <div className='flex flex-col gap-2'>
                        <div className='flex items-center justify-between gap-2'>
                          <div className='flex min-w-0 items-center gap-2'>
                            <span className='font-mono text-[12px] font-medium leading-[1.1] text-muted-foreground'>
                              {index + 1}
                            </span>
                            <Input
                              value={editingSubTicketTitle}
                              onChange={e => setEditingSubTicketTitle(e.target.value)}
                              placeholder='Sub-ticket title'
                              className='h-auto border-none p-0 text-[14px] font-medium leading-[18px] text-foreground focus-visible:ring-0'
                            />
                          </div>
                          <button
                            type='button'
                            onClick={saveEditedSubTicket}
                            className='text-[14px] leading-[18px] text-muted-foreground hover:text-muted-foreground'
                            data-track-category='Tickets'
                            data-track-name='SaveEditedSubTicket'
                            data-track-metadata={JSON.stringify({ subTicketId: subTicket.title })}
                          >
                            Done
                          </button>
                        </div>
                        <Textarea
                          value={editingSubTicketDescription}
                          onChange={e => setEditingSubTicketDescription(e.target.value)}
                          placeholder='Sub-ticket description (optional)'
                          rows={2}
                          className='min-h-0 resize-none border-none p-0 text-[14px] leading-[18px] text-muted-foreground focus-visible:ring-0'
                        />
                      </div>
                    ) : (
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex min-w-0 items-center gap-2'>
                            <span className='font-mono text-[12px] font-medium leading-[1.1] text-muted-foreground'>
                              {index + 1}
                            </span>
                            <div className='truncate text-[14px] font-medium leading-[18px] text-foreground'>
                              {subTicket.title}
                            </div>
                          </div>
                          {subTicket.description && (
                            <div className='mt-1 text-[14px] leading-[18px] text-muted-foreground'>
                              {subTicket.description}
                            </div>
                          )}
                        </div>
                        <div className='flex shrink-0 items-center gap-4'>
                          <button
                            type='button'
                            onClick={() => beginEditSubTicket(index)}
                            className='text-[14px] leading-[18px] text-muted-foreground hover:text-muted-foreground'
                            data-track-category='Tickets'
                            data-track-name='EditSubTicket'
                            data-track-metadata={JSON.stringify({ subTicketId: subTicket.title })}
                          >
                            Edit
                          </button>
                          <button
                            type='button'
                            onClick={() => deleteSubTicket(index)}
                            aria-label={`Delete subticket ${index + 1}`}
                            className='text-muted-foreground hover:text-muted-foreground'
                            data-track-category='Tickets'
                            data-track-name='DeleteSubTicket'
                            data-track-metadata={JSON.stringify({ subTicketId: subTicket.title })}
                          >
                            <Trash2 className='size-[14px]' />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Channel and Board Selection */}
        <div className={cn('flex items-center gap-2.5 pb-2', subTickets.length > 0 && 'pt-4')}>
          {/* Channel Selection */}
          {(isFromSubTicket || isFromAI || releaseOnly) && (
            <form.Field
              name='channelId'
              validators={{
                onChange: ({ value }) => {
                  if (!value?.trim())
                    return releaseOnly ? 'Release channel is required' : 'Channel is required';
                  return undefined;
                },
              }}
            >
              {field => (
                <EntitySelector
                  variant='inline'
                  options={releaseOnly ? releaseChannelOptions : channelOptions}
                  selectedValue={field.state.value || ''}
                  onSelect={(value: string | null) =>
                    field.handleChange(value as CreateTicketFormData['channelId'])
                  }
                  searchPlaceholder={releaseOnly ? 'release channel' : 'channel'}
                  placeholder={releaseOnly ? 'Select release channel' : 'channel'}
                  inputIcon={<Hash className='size-3.5' strokeWidth={2.33} />}
                />
              )}
            </form.Field>
          )}

          {/* Board Selection */}
          <form.Field
            name='boardId'
            validators={{
              onChange: ({ value }) => {
                if (ticketKind === 'release') return undefined;
                if (!value?.trim()) return 'Board is required';
                return undefined;
              },
            }}
          >
            {field => {
              if (ticketKind === 'release') return null;
              // AI is checking — compact shimmer chip with an inline X to stop and pick manually
              if (isCheckingBoard && !boardAISuggestionSuppressed) {
                return (
                  <div className='flex items-center gap-1.5 rounded-lg border border-border bg-background pl-2 pr-1 py-0.5 h-8 w-fit overflow-hidden text-sm'>
                    <SquareKanban
                      className='size-3.5 text-muted-foreground shrink-0'
                      strokeWidth={2.33}
                    />
                    <span className='text-sm whitespace-nowrap text-muted-foreground animate-pulse'>
                      Suggesting board...
                    </span>
                    <button
                      type='button'
                      className='flex items-center justify-center size-5 rounded text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:text-foreground focus-visible:bg-accent transition-colors shrink-0'
                      title='Stop and select manually'
                      aria-label='Stop and select manually'
                      onClick={() => {
                        setBoardAISuggestionSuppressed(true);
                        resetBoardSuggestionState();
                        setTimeout(() => setBoardSelectorOpen(true), 0);
                      }}
                      data-track-category='Tickets'
                      data-track-name='CancelAISuggestedBoard'
                    >
                      <X className='size-3.5 shrink-0' strokeWidth={2.33} />
                    </button>
                  </div>
                );
              }

              // AI suggestion ready — grey outer wrapper, chip left, Accept/Reject right
              if (
                boardSuggestion?.analysis.suggestedBoardId &&
                !boardAISuggestionSuppressed &&
                !field.state.value
              ) {
                return (
                  <div className='flex items-center justify-between w-full rounded-lg bg-muted px-3 py-1.5'>
                    {/* Board name pill — clean bg inside the grey wrapper */}
                    <div className='flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-0.5 h-8 text-sm'>
                      <SquareKanban
                        className='size-3.5 text-muted-foreground shrink-0'
                        strokeWidth={2.33}
                      />
                      <span className='text-foreground whitespace-nowrap'>
                        {boardSuggestion.analysis.suggestedBoardName || 'Unknown Board'}
                      </span>
                    </div>
                    {/* Accept / Reject — separate bordered buttons on the right */}
                    <div className='flex items-center gap-1.5'>
                      <button
                        type='button'
                        className='h-8 px-3 text-sm rounded-lg border border-border bg-background text-foreground hover:bg-accent transition-colors'
                        onClick={() => {
                          if (boardSuggestion.analysis.suggestedBoardId) {
                            field.handleChange(boardSuggestion.analysis.suggestedBoardId);
                            setBoardAISuggestionSuppressed(true);
                            resetBoardSuggestionState();
                          }
                        }}
                        data-track-category='Tickets'
                        data-track-name='AcceptAISuggestedBoard'
                      >
                        Accept
                      </button>
                      <button
                        type='button'
                        className='h-8 px-3 text-sm rounded-lg border border-border bg-background text-foreground hover:bg-accent transition-colors'
                        onClick={() => {
                          setBoardAISuggestionSuppressed(true);
                          resetBoardSuggestionState();
                          // Defer open until EntitySelector has mounted in DOM
                          setTimeout(() => setBoardSelectorOpen(true), 0);
                        }}
                        data-track-category='Tickets'
                        data-track-name='RejectAISuggestedBoard'
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              }

              // Normal selector (default / after reject / after accept — shows chevron to change)
              return (
                <EntitySelector
                  showSearch={false}
                  options={boardOptions}
                  selectedValue={field.state.value || ''}
                  onSelect={(value: string | null) => {
                    field.handleChange(value as CreateTicketFormData['boardId']);
                    setBoardAISuggestionSuppressed(true);
                    setBoardSelectorOpen(false);
                  }}
                  searchPlaceholder='board'
                  placeholder='Select board'
                  inputIcon={<SquareKanban className='size-3.5' strokeWidth={2.33} />}
                  inputClassName='!h-8 rounded-lg'
                  showIndicator={true}
                  testId='ticket-board-selector'
                  isOpen={boardSelectorOpen}
                  onOpenChange={setBoardSelectorOpen}
                />
              );
            }}
          </form.Field>
        </div>

        {isReleaseLine && (
          <div className='space-y-2'>
            <div className='flex items-baseline justify-between'>
              <span className='font-mono text-[10px] uppercase tracking-wide text-muted-foreground'>
                Repositories
              </span>
              <span className='font-mono text-[11px] text-muted-foreground'>
                {(formValues?.boardId ? 1 : 0) + selectedRepoBoardIds.length} selected
              </span>
            </div>

            {releaseBoardOptions.map(o => {
              const id = o.value;
              const isPrimary = id === formValues?.boardId;
              const selected = isPrimary || selectedRepoBoardIds.includes(id);
              const range = getRepoRange(id);
              const setField = (key: 'branch' | 'deployedCommit' | 'newCommit', value: string) =>
                setRepoRangeField(id, key, value);
              const toggle = () => toggleRepoBoard(id);
              return (
                <div
                  key={id}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 transition-colors',
                    selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20',
                  )}
                >
                  <div className='flex items-center gap-3'>
                    <button
                      type='button'
                      onClick={toggle}
                      aria-pressed={selected}
                      aria-label={selected ? `Remove ${o.label}` : `Add ${o.label}`}
                      data-track-category='CreateTicket'
                      data-track-name='ToggleReleaseRepo'
                      className={cn(
                        'grid size-[18px] shrink-0 place-items-center rounded-[5px] border text-[11px] font-semibold transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-transparent hover:border-primary/60',
                      )}
                    >
                      ✓
                    </button>
                    <RepoDot color={repoColor(id)} className={selected ? '' : 'opacity-50'} />
                    <button
                      type='button'
                      onClick={toggle}
                      data-track-category='CreateTicket'
                      data-track-name='ToggleReleaseRepoLabel'
                      className={cn(
                        'min-w-0 flex-1 truncate text-left text-sm font-semibold',
                        selected ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {o.label}
                    </button>
                    {isPrimary && (
                      <span className='shrink-0 rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary'>
                        Primary
                      </span>
                    )}
                    {selected ? (
                      <div className='flex shrink-0 items-center gap-1.5'>
                        <input
                          value={range.deployedCommit}
                          onChange={e => setField('deployedCommit', e.target.value)}
                          placeholder='deployed'
                          className='w-[92px] rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none'
                          data-track-category='CreateTicket'
                          data-track-name='RepoDeployedCommit'
                        />
                        <span className='text-muted-foreground'>→</span>
                        <input
                          value={range.newCommit}
                          onChange={e => setField('newCommit', e.target.value)}
                          placeholder='new'
                          className='w-[92px] rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none'
                          data-track-category='CreateTicket'
                          data-track-name='RepoNewCommit'
                        />
                      </div>
                    ) : (
                      <div className='flex shrink-0 items-center gap-1.5 opacity-40'>
                        <span className='w-[92px] rounded-md border border-border px-2 py-1 text-center font-mono text-[11px] text-muted-foreground'>
                          —
                        </span>
                        <span className='text-muted-foreground'>→</span>
                        <span className='w-[92px] rounded-md border border-border px-2 py-1 text-center font-mono text-[11px] text-muted-foreground'>
                          —
                        </span>
                      </div>
                    )}
                  </div>
                  {selected && (
                    <div className='mt-2 flex items-center gap-2 pl-[30px]'>
                      <label
                        htmlFor={`repo-branch-${id}`}
                        className='font-mono text-[10px] uppercase tracking-wide text-muted-foreground'
                      >
                        Branch
                      </label>
                      <input
                        id={`repo-branch-${id}`}
                        value={range.branch}
                        onChange={e => setField('branch', e.target.value)}
                        placeholder='main'
                        className='w-40 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none'
                        data-track-category='CreateTicket'
                        data-track-name='RepoBranch'
                      />
                    </div>
                  )}
                  {(servicesByMainBoard.get(id)?.length ?? 0) > 0 && (
                    <div className='mt-2 flex flex-wrap items-center gap-1.5 pl-[30px]'>
                      <span className='font-mono text-[10px] uppercase tracking-wide text-muted-foreground'>
                        Services
                      </span>
                      {servicesByMainBoard.get(id)!.map(name => (
                        <span
                          key={name}
                          className='rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Dynamic Form Fields */}
        {visibleDynamicFields.length > 0 && (
          <div className='space-y-2'>
            <div className='text-sm font-bold text-foreground pb-2'>Additional Information</div>
            <div className='space-y-2 h-full max-h-56 overflow-scroll -mx-4 px-4'>
              {visibleDynamicFields.map(field => {
                const fieldName = field.fieldName;
                const fieldType = field.fieldType;
                const rawValue = formValues?.dynamicFields?.[fieldName] || '';
                const error = dynamicFieldErrors[fieldName];
                const isOptional = field.isOptional === true;

                // Normalize value based on field type
                const stringValue = getSingleStringValue(rawValue);
                const arrayValue = getStringArrayValue(rawValue);

                return (
                  <div key={field.id} className='mb-1'>
                    {(fieldType === FormFieldType.STRING || fieldType === FormFieldType.NUMBER) && (
                      <>
                        <label className='text-sm font-medium text-foreground'>{`${fieldName}${!isOptional ? '*' : ''}`}</label>
                        <Input
                          value={stringValue}
                          onChange={e => {
                            const value = e.target.value;
                            form.setFieldValue('dynamicFields', {
                              ...formValues?.dynamicFields,
                              [fieldName]: value,
                            });
                            if (value.trim() && error) {
                              setDynamicFieldErrors(prev => {
                                const newErrors = { ...prev };
                                delete newErrors[fieldName];
                                return newErrors;
                              });
                            }
                          }}
                          type={fieldType === FormFieldType.NUMBER ? 'number' : 'text'}
                          placeholder={`Enter ${fieldName.toLowerCase()}`}
                          className={cn(
                            'px-0 border-none focus-visible:ring-0',
                            'font-semibold text-muted-foreground placeholder:text-muted-foreground/80',
                            error && 'text-red-600',
                          )}
                        />
                        <FieldError error={error} />
                      </>
                    )}
                    {fieldType === FormFieldType.DATE && (
                      <>
                        <label className='text-sm font-medium text-foreground'>{fieldName} *</label>
                        <Input
                          value={stringValue}
                          onChange={e => {
                            const value = e.target.value ?? '';
                            form.setFieldValue('dynamicFields', {
                              ...formValues?.dynamicFields,
                              [fieldName]: value,
                            });
                            if (value && error) {
                              setDynamicFieldErrors(prev => {
                                const newErrors = { ...prev };
                                delete newErrors[fieldName];
                                return newErrors;
                              });
                            }
                          }}
                          type='date'
                          className={cn(
                            'px-0 border-none focus-visible:ring-0',
                            'font-semibold text-muted-foreground',
                            error && 'text-red-600',
                          )}
                        />
                        <FieldError error={error} />
                      </>
                    )}
                    {fieldType === FormFieldType.BOOLEAN && (
                      <RadioGroup
                        label={`${fieldName}${!isOptional ? '*' : ''}`}
                        value={stringValue}
                        className='text-xs'
                        onChange={value => {
                          form.setFieldValue('dynamicFields', {
                            ...formValues?.dynamicFields,
                            [fieldName]: value,
                          });
                          if (value && error) {
                            setDynamicFieldErrors(prev => {
                              const newErrors = { ...prev };
                              delete newErrors[fieldName];
                              return newErrors;
                            });
                          }
                        }}
                      >
                        <div className='flex gap-3'>
                          <Radio value='true'>Yes</Radio>
                          <Radio value='false'>No</Radio>
                        </div>
                      </RadioGroup>
                    )}
                    {fieldType === FormFieldType.SINGLE_SELECT && (
                      <SingleSelect
                        label={`${fieldName}${!isOptional ? ' *' : ''}`}
                        placeholder={`Select ${fieldName.toLowerCase()}`}
                        items={[
                          {
                            items: toSelectOptions(field.fieldEnum),
                          },
                        ]}
                        selected={stringValue}
                        onSelect={selected => {
                          form.setFieldValue('dynamicFields', {
                            ...formValues?.dynamicFields,
                            [fieldName]: selected ?? '',
                          });
                          if (selected && error) {
                            setDynamicFieldErrors(prev => {
                              const newErrors = { ...prev };
                              delete newErrors[fieldName];
                              return newErrors;
                            });
                          }
                        }}
                        enableSearch
                        searchPlaceholder='Search...'
                        alignment={SelectMenuAlignment.START}
                        error={!!error}
                        {...(error && { errorMessage: error })}
                      />
                    )}
                    {fieldType === FormFieldType.MULTI_SELECT && (
                      <MultiSelect
                        label={`${fieldName}${!isOptional ? ' *' : ''}`}
                        placeholder={`Select ${fieldName.toLowerCase()}`}
                        options={toSelectOptions(field.fieldEnum)}
                        selectedValues={arrayValue}
                        onChange={newValues => {
                          const cleanedValues = (newValues ?? []).filter(
                            v => !!v && v.trim().length > 0,
                          );

                          form.setFieldValue('dynamicFields', {
                            ...formValues?.dynamicFields,
                            [fieldName]: cleanedValues,
                          });
                          if (!isOptional && cleanedValues.length === 0) {
                            setDynamicFieldErrors(prev => ({
                              ...prev,
                              [fieldName]: `${fieldName} is required`,
                            }));
                          } else {
                            setDynamicFieldErrors(prev => {
                              const next = { ...prev };
                              delete next[fieldName];
                              return next;
                            });
                          }
                        }}
                        error={error || ''}
                      />
                    )}
                    {fieldType === FormFieldType.USER && (
                      <>
                        <label className='text-sm font-medium text-foreground'>{`${fieldName}${!isOptional ? ' *' : ''}`}</label>
                        <div className='border border-input rounded'>
                          <SearchUserV2
                            options={allUsers || []}
                            selectedUsers={arrayValue
                              .map(userId => userMap.get(userId))
                              .filter((user): user is UserType => user !== undefined)}
                            searchQuery={dynamicFieldSearchQueries[fieldName] || ''}
                            onSearchChange={query => {
                              setDynamicFieldSearchQueries(prev => ({
                                ...prev,
                                [fieldName]: query,
                              }));
                            }}
                            onSelect={selectedUsers => {
                              const cleanedValues = selectedUsers
                                .map(u => u.id)
                                .filter(v => !!v && v.trim().length > 0);

                              form.setFieldValue('dynamicFields', {
                                ...formValues?.dynamicFields,
                                [fieldName]: cleanedValues,
                              });
                              if (!isOptional && cleanedValues.length === 0) {
                                setDynamicFieldErrors(prev => ({
                                  ...prev,
                                  [fieldName]: `${fieldName} is required`,
                                }));
                              } else {
                                setDynamicFieldErrors(prev => {
                                  const next = { ...prev };
                                  delete next[fieldName];
                                  return next;
                                });
                              }
                            }}
                            isOpen={dynamicFieldOpenStates[fieldName] || false}
                            setIsOpen={isOpen => {
                              setDynamicFieldOpenStates(prev => ({
                                ...prev,
                                [fieldName]: isOpen,
                              }));
                            }}
                          />
                        </div>
                        {error && <p className='text-xs text-red-600 mt-1'>{error}</p>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className='py-2'>
          {isCheckingDuplicate && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' />
              <span>Checking for duplicates...</span>
            </div>
          )}
          {showDuplicatePanel && (
            <div className='rounded-lg border border-border bg-muted p-4 mb-2 transition-all duration-200 ease-out'>
              <div className='space-y-2'>
                <div className='flex items-center justify-between pb-0.5'>
                  <span className='flex items-center gap-2'>
                    <Copy className='size-3' strokeWidth={2.5} />
                    <p className='text-sm font-medium text-foreground leading-5'>
                      Duplicate ticket found
                    </p>
                  </span>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={resetDuplicateState}
                    data-track-category='Tickets'
                    data-track-name='RESET_DUPLICATE_STATE'
                    className='size-6 '
                  >
                    <X strokeWidth={2.33} className='size-3.5' />
                  </Button>
                </div>
                {duplicateCheck?.candidates?.slice(0, 1)?.map(candidate => {
                  const candidateLink = candidateLinks.get(candidate.id);

                  return (
                    <div
                      key={candidate.id}
                      className='border border-border rounded-lg p-2.5 flex items-center justify-between gap-2 group bg-background'
                    >
                      <span className='flex items-center gap-2 overflow-hidden cursor-default'>
                        <p className='text-foreground text-sm font-medium truncate'>
                          <RenderMessageWithHTML message={candidate.title} />
                        </p>
                      </span>
                      <span className='opacity-0 flex items-center gap-1 group-hover:opacity-100 transition-opacity duration-300 '>
                        {candidateLink && (
                          <Tooltip
                            content='Copy Ticket'
                            side='top'
                            className='text-[10px] font-semibold leading-3  p-1.5'
                          >
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              className='size-6'
                              onClick={() => {
                                handleDuplicateTicketCopyLink(candidateLink);
                              }}
                              data-track-category='Tickets'
                              data-track-name='CopyDuplicateTicketLink'
                            >
                              <LinkIcon className='size-3.5' />
                            </Button>
                          </Tooltip>
                        )}
                        {candidateLink && (
                          <Tooltip
                            content='Open in new page'
                            side='top'
                            className='text-[10px] font-semibold leading-3 p-1.5 '
                          >
                            <Link to={candidateLink}>
                              <Button type='button' variant='ghost' size='icon' className='size-6'>
                                <SquareArrowOutUpRight className='size-3.5' />
                              </Button>
                            </Link>
                          </Tooltip>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {allAttachments.length > 0 && (
          <div
            className={cn(
              allAttachments.length === 1
                ? 'flex flex-col'
                : allAttachments.length === 2
                  ? 'flex flex-row'
                  : 'grid grid-cols-2',
              'gap-2 py-3',
            )}
          >
            {allAttachments.map(attachment => {
              if (attachment.isFromChat) {
                if (!attachment.id) return null;
                const attachmentId = attachment.id;
                return (
                  <AttachmentPreview
                    key={`chat-${attachmentId}`}
                    file={{
                      id: attachmentId,
                      originalName: attachment.originalFilename || 'Unknown',
                      fileName: attachment.originalFilename || 'Unknown',
                      fileSize: attachment.size || 0,
                      mimeType: attachment.mimetype || 'application/octet-stream',
                      fileUrl: attachment.url || '',
                      thumbnailUrl: attachment.thumbnailUrl ?? '',
                    }}
                    onRemove={() => {
                      // Exclude this chat attachment from the ticket
                      setExcludedChatAttachmentIds(prev => new Set([...prev, attachmentId]));
                    }}
                    onPreview={() => undefined}
                    isUploading={form.state.isSubmitting}
                    variant='detailed'
                  />
                );
              }

              // Handle new uploaded files (removable)
              if (attachment.file) {
                const isFileObject = attachment.file instanceof File;
                let fileKey: string;
                if (isFileObject) {
                  const fileObj = attachment.file as File;
                  fileKey =
                    attachment.id || `file-${fileObj.name}-${fileObj.size}-${fileObj.lastModified}`;
                } else {
                  const uploadedFile = attachment.file as UploadedFile;
                  fileKey =
                    attachment.id ||
                    `file-${uploadedFile.originalName}-${uploadedFile.fileSize}-${Date.now()}`;
                }
                const fileId = attachment.id || '';
                return (
                  <AttachmentPreview
                    key={fileKey}
                    file={attachment.file}
                    onRemove={() => {
                      if (fileId) {
                        void removeFile(fileId, {} as File);
                      }
                    }}
                    onPreview={() => {
                      if (isFileObject) {
                        handlePreviewFile(attachment.file as File);
                      }
                    }}
                    isUploading={form.state.isSubmitting}
                    variant='detailed'
                  />
                );
              }

              return null;
            })}
          </div>
        )}

        <div className='flex flex-wrap items-center gap-2.5 mt-2'>
          {/* Assignee Selection */}
          {!releaseOnly && (
            <form.Field name='assignee'>
              {field => (
                <EntitySelector
                  options={assigneeOptions}
                  selectedValue={
                    field.state.value
                      ? field.state.value.type === 'assigneeTo'
                        ? `user:${field.state.value.value}`
                        : `${field.state.value.type}:${field.state.value.value}`
                      : null
                  }
                  onSelect={(value: string | null) => {
                    const applyAssignee = (val: string | null): void => {
                      field.handleChange(parseAssignee(val));
                      if (val) {
                        const picked = assigneeOptions.find(o => o.value === val);
                        setSelectedAssigneeOption(
                          picked
                            ? { value: picked.value, label: picked.label, icon: picked.icon }
                            : null,
                        );
                      } else {
                        setSelectedAssigneeOption(null);
                      }
                    };
                    // Gate individual users by channel membership; groups pass through.
                    if (value && value.startsWith('user:')) {
                      const uid = value.slice('user:'.length);
                      const name =
                        assigneeOptions.find(o => o.value === value)?.label ?? 'This user';
                      gatedAssignUser({
                        userId: uid,
                        userName: name,
                        assign: () => applyAssignee(value),
                      });
                    } else {
                      applyAssignee(value);
                    }
                  }}
                  onSearchChange={setAssigneeSearchValue}
                  searchPlaceholder={
                    showUserGroupsOnly
                      ? `User Groups${mandatoryUserGroupsOnly ? ' *' : ''}`
                      : `Select assignee${mandatoryAssignee ? ' *' : ''}`
                  }
                  placeholder={
                    showUserGroupsOnly
                      ? `User Groups${mandatoryUserGroupsOnly ? ' *' : ''}`
                      : `Assignee${mandatoryAssignee ? ' *' : ''}`
                  }
                  inputIcon={
                    showUserGroupsOnly ? (
                      <Users className='size-3.5' strokeWidth={2.33} />
                    ) : (
                      <User className='size-3.5' strokeWidth={2.33} />
                    )
                  }
                  inputClassName='rounded-md h-7'
                  disableClientFiltering={true}
                  showIndicator={false}
                  testId='ticket-assignee-selector'
                />
              )}
            </form.Field>
          )}

          {/* Status Selection (Todo) - conditionally rendered */}
          {showTodo && (
            <form.Field name='status'>
              {field => (
                <EntitySelector
                  showSearch={false}
                  options={statusOptions}
                  selectedValue={field.state.value}
                  onSelect={(value: string | null) =>
                    field.handleChange(value as CreateTicketFormData['status'])
                  }
                  searchPlaceholder={`status${mandatoryTodo ? ' *' : ''}`}
                  placeholder={`status${mandatoryTodo ? ' *' : ''}`}
                  inputIcon={<Ellipsis className='size-3.5' strokeWidth={2.33} />}
                  inputClassName='rounded-md h-7'
                  showClearButton={true}
                  showIndicator={false}
                  testId='ticket-status-selector'
                />
              )}
            </form.Field>
          )}

          {/* Due Date - conditionally rendered */}
          {showDueDate && !releaseOnly && (
            <form.Field name='eta'>
              {field => {
                const yesterday = new Date(new Date().setDate(new Date().getDate() - 1));
                return (
                  <DatePicker
                    selectedDate={field.state.value}
                    onSelect={date => field.handleChange(date)}
                    placeholder={`Due Date${mandatoryDueDate ? ' *' : ''}`}
                    minDate={yesterday}
                    showClearButton
                  />
                );
              }}
            </form.Field>
          )}

          {/* Priority Selection */}
          {!releaseOnly && (
            <form.Field name='priority'>
              {field => {
                return (
                  <EntitySelector
                    showSearch={false}
                    options={getPriorityOptions()}
                    selectedValue={field.state.value}
                    onSelect={(value: string | null) =>
                      field.handleChange(value as CreateTicketFormData['priority'])
                    }
                    searchPlaceholder='priority'
                    placeholder='priority'
                    inputIcon={<Ellipsis className='size-3.5' strokeWidth={2.33} />}
                    inputClassName='rounded-md h-7'
                    showClearButton={true}
                    showIndicator={false}
                    testId='ticket-priority-selector'
                  />
                );
              }}
            </form.Field>
          )}

          {/* Tags Selection - conditionally rendered */}
          {showLabels && !releaseOnly && (
            <form.Field name='tags'>
              {field => (
                <EntityMultiSelector
                  options={tagOptions}
                  selectedValues={field.state.value}
                  onMultiSelect={(tags: string[]) => field.handleChange(tags)}
                  allowCreate={true}
                  onCreateOption={(value: string) => {
                    setNewTags(prev => [...prev, value]);
                    field.handleChange([...field.state.value, value]);
                  }}
                  onOpenChange={open => {
                    if (open && !tagsQueried) setTagsQueried(true);
                  }}
                  placeholder={`Label${mandatoryLabels ? ' *' : ''}`}
                  searchPlaceholder='Search labels'
                  showSearch={true}
                  collapseSelectedAfter={3}
                  collapsedLabel='labels'
                  inputIcon={<Tag strokeWidth={2.33} className='size-3.5' />}
                />
              )}
            </form.Field>
          )}

          {/* Ticket Type Selection - conditionally rendered */}
          {showTicketType && !releaseOnly && (
            <form.Field name='ticketType'>
              {field => {
                const typeOptions = isFlowRootTicket
                  ? [
                      {
                        label: BaseTicketType.Epic,
                        value: BaseTicketType.Epic,
                        icon: <Ticket className='size-3.5' strokeWidth={2.33} />,
                      },
                    ]
                  : (ticketTypeOptions?.map(type => ({
                      label: type.value,
                      value: type.value,
                      icon: <Ticket className='size-3.5' strokeWidth={2.33} />,
                    })) ?? []);

                return (
                  <EntitySelector
                    showSearch={false}
                    options={typeOptions}
                    selectedValue={field.state.value || ''}
                    onSelect={(value: string | null) =>
                      field.handleChange(value as CreateTicketFormData['ticketType'])
                    }
                    searchPlaceholder='ticket type'
                    placeholder={`ticket type${mandatoryTicketType ? ' *' : ''}`}
                    inputIcon={<Ticket className='size-3.5' strokeWidth={2.33} />}
                    inputClassName='rounded-md h-7'
                    showClearButton={!isFlowRootTicket}
                    showIndicator={false}
                  />
                );
              }}
            </form.Field>
          )}

          {/* Merchant ID - conditionally rendered */}
          {showMerchantId && (
            <form.Field name='merchantId'>
              {field => (
                <Input
                  type='text'
                  value={field.state.value || ''}
                  onChange={e => field.handleChange(e.target.value)}
                  placeholder={`Merchant ID${mandatoryMerchantId ? ' *' : ''}`}
                  className='text-sm'
                />
              )}
            </form.Field>
          )}
        </div>
        <div className='flex justify-between items-center pt-6 pb-4'>
          <Button
            type='button'
            onClick={handlePaperclipClick}
            variant='ghost'
            size='icon'
            title='Attach files'
            disabled={form.state.isSubmitting}
            className='size-6'
            data-testid='ticket-attachment-button'
            data-track-category='Tickets'
            data-track-name='ATTACH_FILE'
            data-track-metadata={JSON.stringify({
              boardId: selectedBoardId,
              channelId,
              fileCount: allAttachments.length,
            })}
          >
            <Paperclip strokeWidth={2.33} className='size-3.5 text-muted-foreground' />
          </Button>
          <div className='flex items-center gap-3'>
            {submitGateMessage ? (
              <Tooltip content={submitGateMessage} side='top'>
                <span className='cursor-not-allowed'>
                  <Button
                    type='submit'
                    loading={form.state.isSubmitting}
                    disabled={form.state.isSubmitting || !isFormReadyForSubmit}
                    className='pointer-events-none'
                    data-testid='ticket-submit-button'
                    data-track-category='Tickets'
                    data-track-name='SUBMIT_CREATE_TICKET_MODAL'
                    data-track-metadata={JSON.stringify({
                      boardId: selectedBoardId,
                      channelId,
                      hasAttachments: allAttachments.length > 0,
                      isFromAI,
                    })}
                  >
                    {form.state.isSubmitting
                      ? 'Creating...'
                      : ticketKind === 'release'
                        ? 'Create Release'
                        : 'Create Ticket'}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                type='submit'
                loading={form.state.isSubmitting}
                disabled={form.state.isSubmitting || !isFormReadyForSubmit}
                data-testid='ticket-submit-button'
                data-track-category='Tickets'
                data-track-name='SUBMIT_CREATE_TICKET_MODAL'
                data-track-metadata={JSON.stringify({
                  boardId: selectedBoardId,
                  channelId,
                  hasAttachments: allAttachments.length > 0,
                  isFromAI,
                })}
              >
                {form.state.isSubmitting
                  ? 'Creating...'
                  : ticketKind === 'release'
                    ? 'Create Release'
                    : 'Create Ticket'}
              </Button>
            )}
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type='file'
              multiple
              onChange={handleFileInputChange}
              className='hidden'
              data-testid='ticket-attachment-input'
            />
          </div>
        </div>
      </form>

      {showDiscardConfirm && (
        <Dialog
          open={true}
          onOpenChange={open => {
            if (!open) setShowDiscardConfirm(false);
          }}
          title='Discard this ticket?'
          description='The details you have filled in will be lost.'
          zIndexClassName='z-[60]'
          className='max-w-sm rounded-xl border border-border'
          testId='discard-ticket-confirm'
        >
          <div className='p-5'>
            <h2 className='text-[15px] font-semibold text-foreground mb-1.5'>
              Discard this ticket?
            </h2>
            <p className='text-[13px] leading-5 text-muted-foreground mb-5'>
              You have unsaved details. Closing now will lose everything you have filled in.
            </p>
            <div className='flex justify-end gap-2'>
              <Button
                type='button'
                variant='secondary'
                onClick={() => setShowDiscardConfirm(false)}
                data-track-category='Tickets'
                data-track-name='KeepEditingCreateTicket'
              >
                Keep editing
              </Button>
              <Button
                type='button'
                variant='destructive'
                onClick={handleConfirmDiscard}
                data-track-category='Tickets'
                data-track-name='DiscardCreateTicket'
              >
                Discard
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );

  if (standalone) {
    return (
      <div className='h-screen w-full overflow-y-auto bg-background'>
        <div className='mx-auto w-full max-w-screen-md'>{modalContent}</div>
      </div>
    );
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) requestClose();
      }}
      onInteractOutside={event => {
        if (event.detail.originalEvent.type === 'focusin') return;
        event.preventDefault();
        requestClose();
      }}
      onEscapeKeyDown={event => {
        event.preventDefault();
        requestClose();
      }}
      title='Create Ticket'
      description='Create and edit ticket details before submitting.'
      {...(!isMobile ? { focusRef: titleInputRef } : {})}
      data-testid='create-ticket-modal'
      className={cn(
        'w-full max-w-screen-md max-h-1/2 rounded-xl border border-border',
        'top-1/3 !-translate-y-1/3',
      )}
    >
      {modalContent}
    </Dialog>
  );
};
