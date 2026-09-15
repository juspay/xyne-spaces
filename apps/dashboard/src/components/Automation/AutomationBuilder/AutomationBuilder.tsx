import { logger, Event as LogEvent } from '../../../utils/logger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Check,
  Copy,
  GitBranch,
  History,
  Pencil,
  Power,
  Save as SaveIcon,
  Send,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { Dialog } from '../../ui/Dialog/Dialog';
import Textarea from '../../ui/Textarea/Textarea';
import { Tooltip } from '../../ui/Tooltip';
import {
  type ActionStepConfig,
  type AutomationConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type SwitchStepConfig,
  type ScheduleConfig,
  CONDITIONAL_STEP_TYPE,
  SWITCH_STEP_TYPE,
  AutomationStatusValues,
  makeStepId,
  type SaveResult,
  type ValidationResult,
} from '../Automation.types';
import { useIsAutomationsAdmin } from '../useIsAutomationsAdmin';
import {
  fetchAutomationVersions,
  fetchOperators,
  fetchStepCatalog,
  fetchStepSchema,
  fetchTriggerCatalog,
  fetchTriggerSchema,
  validateAutomation,
} from '../../../api/automationsApi';
import { useZero } from '../../../hooks/useZero';
import { useSelf } from '../../../hooks/useUsers';
import { mutators } from '../../../zero/mutators';
import { v4 as uuid } from 'uuid';
import { triggerTypeToEventType } from '../automation.adapter';
import { TriggerCard } from './TriggerCard/TriggerCard';
import { StepCard } from './StepCard/StepCard';
import { ConditionalCard } from './ConditionalCard/ConditionalCard';
import { SwitchCard } from './SwitchCard/SwitchCard';
import type { ControlFlowRenderProps } from './BranchSteps/BranchSteps';
import { AddStepRow } from './AddStepRow/AddStepRow';
import { ScheduleCard } from './ScheduleCard/ScheduleCard';
import { ValidationBanner } from './ValidationBanner/ValidationBanner';
import { WebhookEndpointPanel } from './WebhookEndpointPanel';
import {
  buildVariableSources,
  collectStepTypes,
  emptyConfig,
  issuesUnder,
  moveStep,
} from './AutomationBuilder.utils';
import type { AutomationBuilderProps } from './AutomationBuilder.types';
import type { StepSchema } from '../Automation.types';

const MAX_AUTOMATION_NAME_LENGTH = 80;

const STATUS_PILL: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  ACTIVE:
    'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400 dark:border-green-500/40',
  DISABLED: 'bg-muted text-muted-foreground border-border',
  PENDING_APPROVAL:
    'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400 dark:border-amber-500/40',
  REJECTED: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400 dark:border-red-500/40',
  REVOKED: 'bg-muted text-muted-foreground border-border',
  AUTO_REVOKED: 'bg-muted text-muted-foreground border-border',
  ARCHIVED: 'bg-muted text-muted-foreground border-border',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  DISABLED: 'Disabled',
  PENDING_APPROVAL: 'Pending approval',
  REJECTED: 'Rejected',
  REVOKED: 'Revoked',
  AUTO_REVOKED: 'Auto-revoked',
  ARCHIVED: 'Archived',
};

const renderConditionalCard = (
  step: ConditionalStepConfig,
  props: ControlFlowRenderProps,
): React.ReactElement => (
  <ConditionalCard
    step={step}
    catalog={props.catalog}
    schemaCache={props.schemaCache}
    schemaLoadingFor={props.schemaLoadingFor}
    operators={props.operators}
    variableSources={props.variableSources}
    index={props.index}
    total={props.total}
    onChange={next => props.onChange(next)}
    onMoveUp={props.onMoveUp}
    onMoveDown={props.onMoveDown}
    onDelete={props.onDelete}
    issues={props.issues}
    pathPrefix={props.pathPrefix}
    readOnly={props.readOnly ?? false}
    ensureSchema={props.ensureSchema}
    renderConditionalCard={props.renderConditionalCard}
    renderSwitchCard={props.renderSwitchCard}
  />
);

const renderSwitchCard = (
  step: SwitchStepConfig,
  props: ControlFlowRenderProps,
): React.ReactElement => (
  <SwitchCard
    step={step}
    catalog={props.catalog}
    schemaCache={props.schemaCache}
    schemaLoadingFor={props.schemaLoadingFor}
    operators={props.operators}
    variableSources={props.variableSources}
    index={props.index}
    total={props.total}
    onChange={next => props.onChange(next)}
    onMoveUp={props.onMoveUp}
    onMoveDown={props.onMoveDown}
    onDelete={props.onDelete}
    issues={props.issues}
    pathPrefix={props.pathPrefix}
    readOnly={props.readOnly ?? false}
    ensureSchema={props.ensureSchema}
    renderConditionalCard={props.renderConditionalCard}
    renderSwitchCard={props.renderSwitchCard}
  />
);

export function AutomationBuilder({
  automation,
  initialConfig,
  initialName,
  initialDescription,
  forkFromSeriesId,
  forkSourceAutomationId,
  onSaved,
  approvalReviewMode = false,
  onAfterApprovalDecision,
  onBack,
  onShowRuns,
  onShowVersionHistory,
  onProposeChange,
  onCancelFork,
  readOnlyPreview = false,
}: AutomationBuilderProps): React.ReactElement {
  const [name, setName] = useState(automation?.name ?? initialName ?? '');
  const [description, setDescription] = useState(
    automation?.description ?? initialDescription ?? '',
  );
  const [config, setConfig] = useState<AutomationConfig>(
    automation?.config ?? initialConfig ?? emptyConfig(),
  );
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stepSchemaTypes, setStepSchemaTypes] = useState<string[]>(() =>
    collectStepTypes(automation?.config?.steps ?? config.steps),
  );

  const [savedId, setSavedId] = useState<string | null>(automation?.id ?? null);
  const [savedStatus, setSavedStatus] = useState<string>(
    automation?.status ?? AutomationStatusValues.DRAFT,
  );

  // Only auto-edit when there is no existing row (truly new, or a fork
  // started from a LIVE source). Every existing row — DRAFT included —
  // opens in read mode so the user sees the saved state and the
  // appropriate action buttons (Send for approval, Edit, etc.).
  // Entering edit mode for a DRAFT requires clicking Edit, which routes
  // through editConfirmOpen.
  const [editMode, setEditMode] = useState<boolean>(!automation);
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [proposeChangeConfirmOpen, setProposeChangeConfirmOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (automation?.id) setSavedId(automation.id);
    if (automation?.status) setSavedStatus(automation.status);
  }, [automation?.id, automation?.status]);

  const triggerCatalogQuery = useQuery({
    queryKey: ['automations', 'schema', 'triggers'],
    queryFn: fetchTriggerCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const stepCatalogQuery = useQuery({
    queryKey: ['automations', 'schema', 'steps'],
    queryFn: fetchStepCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const operatorsQuery = useQuery({
    queryKey: ['automations', 'schema', 'operators'],
    queryFn: fetchOperators,
    staleTime: 5 * 60 * 1000,
  });

  // Lets the header show "which version am I looking at" (e.g. "v2 of 3"). Skipped
  // in readOnlyPreview (the compare view), where the badge never renders.
  const versionsQuery = useQuery({
    queryKey: ['automation-versions', savedId],
    queryFn: () => fetchAutomationVersions(savedId!),
    enabled: !!savedId && !readOnlyPreview,
    staleTime: 5 * 60 * 1000,
  });
  const versionPosition = useMemo(() => {
    const versions = versionsQuery.data;
    if (!versions || !savedId) return null;
    // Versions come back newest-first; number chronologically (oldest = v1).
    const indexFromNewest = versions.findIndex(v => v.id === savedId);
    if (indexFromNewest === -1) return null;
    return { number: versions.length - indexFromNewest, total: versions.length };
  }, [versionsQuery.data, savedId]);

  const triggerSchemaQuery = useQuery({
    queryKey: ['automations', 'schema', 'trigger', config.trigger.type],
    queryFn: () => fetchTriggerSchema(config.trigger.type),
    enabled: !!config.trigger.type,
    staleTime: 5 * 60 * 1000,
  });

  const stepSchemaQueries = useQueries({
    queries: stepSchemaTypes
      .filter(t => t !== CONDITIONAL_STEP_TYPE)
      .map(type => ({
        queryKey: ['automations', 'schema', 'step', type],
        queryFn: () => fetchStepSchema(type),
        staleTime: 5 * 60 * 1000,
      })),
  });

  const stepSchemaCache = useMemo(() => {
    const cache: Record<string, StepSchema | undefined> = {};
    stepSchemaQueries.forEach((q, i) => {
      const type = stepSchemaTypes.filter(t => t !== CONDITIONAL_STEP_TYPE)[i];
      if (type && q.data) cache[type] = q.data;
    });
    return cache;
  }, [stepSchemaQueries, stepSchemaTypes]);

  const stepSchemaLoadingFor = useCallback(
    (type: string): boolean => {
      const idx = stepSchemaTypes.filter(t => t !== CONDITIONAL_STEP_TYPE).indexOf(type);
      if (idx < 0) return false;
      return stepSchemaQueries[idx]?.isLoading ?? false;
    },
    [stepSchemaQueries, stepSchemaTypes],
  );

  const ensureSchema = useCallback((type: string): void => {
    if (type === CONDITIONAL_STEP_TYPE) return;
    setStepSchemaTypes(prev => (prev.includes(type) ? prev : [...prev, type]));
  }, []);

  useEffect(() => {
    const types = collectStepTypes(config.steps);
    setStepSchemaTypes(prev => {
      const merged = new Set(prev);
      for (const t of types) merged.add(t);
      return Array.from(merged);
    });
  }, [config.steps]);

  const zero = useZero();
  const me = useSelf();
  const navigate = useNavigate();
  const isAutomationsAdmin = useIsAutomationsAdmin();

  const isEditableDeadStatus =
    savedStatus === AutomationStatusValues.REJECTED ||
    savedStatus === AutomationStatusValues.REVOKED ||
    savedStatus === AutomationStatusValues.ARCHIVED ||
    savedStatus === AutomationStatusValues.AUTO_REVOKED;

  const isLockedStatus = savedStatus === AutomationStatusValues.PENDING_APPROVAL;

  const isLiveRow =
    automation?.status === AutomationStatusValues.ACTIVE ||
    automation?.status === AutomationStatusValues.DISABLED;

  const canEdit =
    !isLockedStatus &&
    (savedStatus === AutomationStatusValues.DRAFT ||
      savedStatus === AutomationStatusValues.ACTIVE ||
      savedStatus === AutomationStatusValues.DISABLED ||
      isEditableDeadStatus);

  const forksOnEdit = isLiveRow || isEditableDeadStatus;

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      description: string;
      config: AutomationConfig;
    }): Promise<SaveResult> => {
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[automations] save attempted'),
        context: [
          {
            id: savedId,
            status: savedStatus,
          },
        ],
      });

      const validationResult = await validateAutomation(payload.config);
      if (!validationResult.valid) {
        const issues = validationResult.issues
          .slice(0, 3)
          .map(i => `${humanizeIssuePath(i.path)}: ${i.message}`)
          .join('; ');
        const more =
          validationResult.issues.length > 3
            ? ` (+${validationResult.issues.length - 3} more)`
            : '';
        const err = new Error(`Validation failed — ${issues}${more}`);
        (err as Error & { validation?: ValidationResult }).validation = validationResult;
        throw err;
      }

      const now = Date.now();
      const eventType = triggerTypeToEventType(payload.config.trigger.type);
      const targetId = savedId ?? uuid();

      if (savedId) {
        zero.mutate(
          mutators.automations.update({
            id: savedId,
            name: payload.name,
            metadataJson: JSON.stringify({
              description:
                payload.description.trim().length > 0 ? payload.description.trim() : null,
              createdById: me?.id ?? '',
            }),
            configJson: JSON.stringify(payload.config),
            eventType,
            timestamp: now,
          }),
        );
      } else {
        zero.mutate(
          mutators.automations.createProposal({
            id: targetId,
            name: payload.name,
            metadataJson: JSON.stringify({
              description:
                payload.description.trim().length > 0 ? payload.description.trim() : null,
              createdById: me?.id ?? '',
            }),
            configJson: JSON.stringify(payload.config),
            eventType,
            ...(forkFromSeriesId ? { automationSeriesId: forkFromSeriesId } : {}),
            timestamp: now,
          }),
        );
      }

      return {
        automation: {
          id: targetId,
          name: payload.name,
          description: payload.description,
          status: AutomationStatusValues.DRAFT as SaveResult['automation']['status'],
          config: payload.config,
          createdById: me?.id ?? '',
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          automationSeriesId: savedId ?? targetId,
          eventType,
        },
        validation: validationResult,
      };
    },
    onSuccess: result => {
      setValidation(result.validation);
      setErrorMessage(null);
      const isCreate = !savedId;
      if (isCreate) {
        setSavedId(result.automation.id);
      }
      setSavedStatus(result.automation.status);
      setEditMode(false);
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[automations] save succeeded'),
        context: [
          {
            id: result.automation.id,
            status: result.automation.status,
          },
        ],
      });
      toast.success('Saved');
      onSaved?.(result);
    },
    onError: err => {
      const message = err instanceof Error ? err.message : 'Save failed';
      const v = (err as Error & { validation?: ValidationResult }).validation;
      if (v) setValidation(v);
      setErrorMessage(message);
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[automations] save failed'),
        error: err,
      });
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      zero.mutate(mutators.automations.delete({ id }));
      return Promise.resolve();
    },
    onSuccess: () => {
      toast.success('Automation deleted');
      onBack();
    },
    onError: err => {
      const message = err instanceof Error ? err.message : 'Delete failed';
      setErrorMessage(message);
      toast.error(message);
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[automations] activate attempted'),
        context: [{ id }],
      });
      const validationResult = await validateAutomation(config);
      if (!validationResult.valid) {
        setValidation(validationResult);
        const summary = validationResult.issues
          .slice(0, 3)
          .map(i => `${i.path}: ${i.message}`)
          .join('; ');
        const more =
          validationResult.issues.length > 3
            ? ` (+${validationResult.issues.length - 3} more)`
            : '';
        throw new Error(`Cannot activate — ${summary}${more}`);
      }
      setSavedStatus(AutomationStatusValues.ACTIVE);
      setErrorMessage(null);
      setValidation(null);
      zero.mutate(mutators.automations.activate({ id, timestamp: Date.now() }));
      toast.success('Automation activated');
    },
    onError: err => {
      setErrorMessage(err instanceof Error ? err.message : 'Activate failed');
      toast.error(err instanceof Error ? err.message : 'Activate failed');
    },
  });

  const disableMutation = useMutation({
    mutationFn: ({ id, cancelQueued }: { id: string; cancelQueued: boolean }): Promise<void> => {
      setSavedStatus(AutomationStatusValues.DISABLED);
      setErrorMessage(null);
      zero.mutate(mutators.automations.disable({ id, timestamp: Date.now(), cancelQueued }));
      toast.success(
        cancelQueued ? 'Automation disabled, queued runs will not fire' : 'Automation disabled',
      );
      return Promise.resolve();
    },
    onError: err => {
      setErrorMessage(err instanceof Error ? err.message : 'Disable failed');
    },
  });

  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      setSavedStatus(AutomationStatusValues.ARCHIVED);
      setErrorMessage(null);
      zero.mutate(mutators.automations.archive({ id, timestamp: Date.now() }));
      toast.success('Automation archived');
      return Promise.resolve();
    },
    onError: err => {
      setErrorMessage(err instanceof Error ? err.message : 'Archive failed');
    },
  });

  const submitForApprovalMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const validationResult = await validateAutomation(config);
      if (!validationResult.valid) {
        setValidation(validationResult);
        const summary = validationResult.issues
          .slice(0, 3)
          .map(i => `${humanizeIssuePath(i.path)}: ${i.message}`)
          .join('; ');
        const more =
          validationResult.issues.length > 3
            ? ` (+${validationResult.issues.length - 3} more)`
            : '';
        throw new Error(`Cannot submit — ${summary}${more}`);
      }
      setValidation(null);
      setErrorMessage(null);
      setSavedStatus(AutomationStatusValues.PENDING_APPROVAL);
      zero.mutate(mutators.automations.submitForApproval({ id, timestamp: Date.now() }));
      toast.success('Sent for approval');
    },
    onError: err => {
      const message = err instanceof Error ? err.message : 'Send for approval failed';
      setErrorMessage(message);
      toast.error(message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      setSavedStatus(AutomationStatusValues.REVOKED);
      setErrorMessage(null);
      zero.mutate(mutators.automations.revoke({ id, timestamp: Date.now() }));
      toast.success('Proposal revoked');
      return Promise.resolve();
    },
    onError: err => {
      setErrorMessage(err instanceof Error ? err.message : 'Revoke failed');
    },
  });

  const handleProposeChangeNavigate = useCallback((): void => {
    if (!automation) return;
    if (onProposeChange) {
      onProposeChange(automation);
      return;
    }
    void navigate(`../new?fork=${automation.id}`, { relative: 'path' });
  }, [automation, onProposeChange, navigate]);

  // Approve / Reject — only used in approval-review mode, when an admin
  // opens a PENDING_APPROVAL proposal from the inbox. The actual auth check
  // (admin? not self-authored?) runs server-side in the Zero mutator.
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const approveMutation = useMutation({
    mutationFn: (id: string): Promise<void> => {
      zero.mutate(mutators.automations.approve({ id, note: null, timestamp: Date.now() }));
      toast.success('Proposal approved');
      return Promise.resolve();
    },
    // Stay on the page after approving — the optimistic write flips the
    // row to DISABLED (LIVE) and the Activate button appears, so the
    // admin can flip it on immediately without navigating back.
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }): Promise<void> => {
      zero.mutate(mutators.automations.reject({ id, note, timestamp: Date.now() }));
      toast.success('Proposal rejected');
      return Promise.resolve();
    },
    onSuccess: () => {
      setRejectDialogOpen(false);
      setRejectNote('');
      onAfterApprovalDecision?.();
    },
    onError: err => {
      toast.error(err instanceof Error ? err.message : 'Reject failed');
    },
  });

  const handleTriggerTypeChange = useCallback((type: string): void => {
    setConfig(prev => ({ ...prev, trigger: { type, config: {} } }));
  }, []);

  const handleTriggerConfigChange = useCallback((next: Record<string, unknown>): void => {
    setConfig(prev => ({ ...prev, trigger: { ...prev.trigger, config: next } }));
  }, []);

  const handleScheduleChange = useCallback((next: ScheduleConfig | undefined): void => {
    setConfig(prev => {
      if (!next) {
        const copy = { ...prev };
        delete copy.schedule;
        return copy;
      }
      return { ...prev, schedule: next };
    });
  }, []);

  const handleAddStep = useCallback(
    (type: string, insertAt?: number): void => {
      const insertInto = (steps: AutomationStepConfig[], step: AutomationStepConfig) => {
        if (insertAt === undefined || insertAt < 0 || insertAt > steps.length) {
          return [...steps, step];
        }
        return [...steps.slice(0, insertAt), step, ...steps.slice(insertAt)];
      };

      if (type === CONDITIONAL_STEP_TYPE) {
        const cond: ConditionalStepConfig = {
          id: makeStepId(),
          type: CONDITIONAL_STEP_TYPE,
          config: {
            condition: { variable: '', operator: 'eq', value: '' },
            if_true: [],
            if_false: [],
          },
        };
        setConfig(prev => {
          const next = insertInto(prev.steps, cond);
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_info',
            message: String('[automations] step added'),
            context: [
              {
                type,
                insertAt,
                finalIndex: next.indexOf(cond),
              },
            ],
          });
          return { ...prev, steps: next };
        });
        return;
      }
      if (type === SWITCH_STEP_TYPE) {
        const sw: SwitchStepConfig = {
          id: makeStepId(),
          type: SWITCH_STEP_TYPE,
          config: { cases: [], default: [] },
        };
        setConfig(prev => {
          const next = insertInto(prev.steps, sw);
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_info',
            message: String('[automations] step added'),
            context: [
              {
                type,
                insertAt,
                finalIndex: next.indexOf(sw),
              },
            ],
          });
          return { ...prev, steps: next };
        });
        return;
      }
      // A new "run agent" step starts with a { result: 'string' } output schema so
      // downstream steps have a usable variable by default. Other actions start empty.
      const action: ActionStepConfig = {
        id: makeStepId(),
        type,
        config: type === 'RUN_AGENT' ? { outputSchema: { result: 'string' } } : {},
      };
      setConfig(prev => {
        const next = insertInto(prev.steps, action);
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_info',
          message: String('[automations] step added'),
          context: [
            {
              type,
              insertAt,
              finalIndex: next.indexOf(action),
            },
          ],
        });
        return { ...prev, steps: next };
      });
      ensureSchema(type);
    },
    [ensureSchema],
  );

  const updateStepAt = useCallback((index: number, next: AutomationStepConfig): void => {
    setConfig(prev => {
      const copy = prev.steps.slice();
      copy[index] = next;
      return { ...prev, steps: copy };
    });
  }, []);

  const handleStepConfigChange = useCallback(
    (index: number, cfg: Record<string, unknown>): void => {
      setConfig(prev => {
        const target = prev.steps[index];
        if (!target) return prev;
        if (target.type === CONDITIONAL_STEP_TYPE) return prev;
        const copy = prev.steps.slice();
        copy[index] = {
          ...target,
          config: { ...(target as ActionStepConfig).config, ...cfg },
        } as ActionStepConfig;
        return { ...prev, steps: copy };
      });
    },
    [],
  );

  const handleDeleteStep = useCallback((index: number): void => {
    setConfig(prev => {
      const removed = prev.steps[index];
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[automations] step removed'),
        context: [
          {
            type: removed?.type,
            index,
          },
        ],
      });
      return { ...prev, steps: prev.steps.filter((_, i) => i !== index) };
    });
  }, []);

  const handleMoveStep = useCallback((index: number, direction: -1 | 1): void => {
    setConfig(prev => {
      const moved = prev.steps[index];
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[automations] step reordered'),
        context: [
          {
            type: moved?.type,
            from: index,
            to: index + direction,
          },
        ],
      });
      return { ...prev, steps: moveStep(prev.steps, index, direction) };
    });
  }, []);

  const trimmedName = name.trim();
  const nameError: string | null =
    trimmedName.length === 0
      ? 'Name is required.'
      : trimmedName.length > MAX_AUTOMATION_NAME_LENGTH
        ? `Name must be ${MAX_AUTOMATION_NAME_LENGTH} characters or fewer (currently ${trimmedName.length}).`
        : null;

  const handleSaveNow = useCallback((): void => {
    if (nameError) {
      setErrorMessage(nameError);
      toast.error(nameError);
      return;
    }
    saveMutation.mutate({ name: trimmedName, description, config });
  }, [config, description, nameError, saveMutation, trimmedName]);

  const handleActivate = useCallback((): void => {
    if (!savedId) {
      toast.error('Save the automation before activating.');
      return;
    }
    activateMutation.mutate(savedId);
  }, [activateMutation, savedId]);

  const handleDisable = useCallback((): void => {
    if (!savedId) return;
    setDisableDialogOpen(true);
  }, [savedId]);

  const handleArchive = useCallback((): void => {
    if (!savedId) return;
    archiveMutation.mutate(savedId);
  }, [archiveMutation, savedId]);

  const triggerCatalog = triggerCatalogQuery.data ?? [];
  const stepCatalog = stepCatalogQuery.data ?? [];
  const operators = operatorsQuery.data ?? [];
  const triggerSchema = triggerSchemaQuery.data ?? null;

  const [formFieldNameMap, setFormFieldNameMap] = useState<Map<string, string>>(new Map());

  const handleFormFieldNamesResolved = useCallback((map: Map<string, string>) => {
    setFormFieldNameMap(map);
  }, []);

  const triggerIssues = issuesUnder(validation?.issues, 'trigger');

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex flex-col gap-3 border-b border-border bg-background px-6 py-4'>
        <div className='flex items-center gap-3'>
          {!readOnlyPreview && (
            <Tooltip content='Back to automations' side='bottom'>
              <button
                type='button'
                onClick={onBack}
                aria-label='Back to automations list'
                data-track-category='automation-builder'
                data-track-name='back-to-list'
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
                  'hover:text-foreground hover:bg-accent/40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
                )}
              >
                <ArrowLeft className='size-4' aria-hidden='true' />
              </button>
            </Tooltip>
          )}
          <InlineEditableText
            value={name}
            onChange={setName}
            placeholder='Give this automation a name (required)'
            readOnly={!editMode}
            invalid={editMode && !!nameError}
            className='flex-1 text-base font-semibold text-foreground'
          />
          {!editMode && (
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                STATUS_PILL[savedStatus] ?? STATUS_PILL['DRAFT'],
              )}
            >
              {STATUS_LABEL[savedStatus] ?? savedStatus}
            </span>
          )}
          {!editMode && !readOnlyPreview && versionPosition && (
            <Tooltip
              content={
                versionPosition.total > 1
                  ? `Version ${versionPosition.number} of ${versionPosition.total}`
                  : 'Version 1'
              }
              side='bottom'
            >
              <button
                type='button'
                onClick={() => savedId && onShowVersionHistory?.(savedId)}
                disabled={!onShowVersionHistory}
                data-track-category='automation-builder'
                data-track-name='header-version-indicator'
                className='rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 disabled:pointer-events-none'
              >
                v{versionPosition.number}
                {versionPosition.total > 1 ? ` / ${versionPosition.total}` : ''}
              </button>
            </Tooltip>
          )}
          {!editMode &&
          !readOnlyPreview &&
          savedId &&
          savedStatus === AutomationStatusValues.DRAFT ? (
            <Tooltip content='Delete draft' side='bottom'>
              <button
                type='button'
                onClick={() => setDeleteDialogOpen(true)}
                aria-label={`Delete draft automation ${name || 'Untitled automation'}`}
                data-track-category='automation-builder'
                data-track-name='header-delete-draft'
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
                  'hover:bg-red-500/10 hover:text-red-600',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40',
                )}
              >
                <Trash2 className='size-4' aria-hidden='true' />
              </button>
            </Tooltip>
          ) : null}

          {readOnlyPreview ? null : editMode ? (
            <>
              <Button
                variant='outline'
                onClick={() => {
                  if (automation) {
                    setName(automation.name);
                    setDescription(automation.description ?? '');
                    setConfig(automation.config);
                    setErrorMessage(null);
                    setValidation(null);
                    setEditMode(false);
                    return;
                  }
                  if (forkSourceAutomationId) {
                    if (onCancelFork) {
                      onCancelFork(forkSourceAutomationId);
                    } else {
                      void navigate(`../${forkSourceAutomationId}`, { relative: 'path' });
                    }
                    return;
                  }
                  onBack();
                }}
                data-track-category='automation-builder'
                data-track-name='header-cancel-edit'
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveNow}
                loading={saveMutation.isPending}
                disabled={saveMutation.isPending || !!nameError}
                trackId='save_automation'
                data-track-category='automation-builder'
                data-track-name='header-save'
                className='font-semibold'
              >
                <SaveIcon className='size-4' />
                Save
              </Button>
            </>
          ) : (
            <>
              {savedId && onShowRuns ? (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => onShowRuns(savedId)}
                  data-track-category='automation-builder'
                  data-track-name='header-runs'
                >
                  <History className='size-4' />
                  Runs
                </Button>
              ) : null}
              {savedId && onShowVersionHistory ? (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => onShowVersionHistory(savedId)}
                  data-track-category='automation-builder'
                  data-track-name='header-version-history'
                >
                  <GitBranch className='size-4' />
                  Versions
                </Button>
              ) : null}
              {savedId ? (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => void navigate(`/automations/new?fork=${savedId}&clone=1`)}
                  data-track-category='automation-builder'
                  data-track-name='header-clone'
                >
                  <Copy className='size-4' />
                  Clone
                </Button>
              ) : null}
              {/* Activate is open to anyone for any LIVE row. Disable is
                  admin-only — pulling a running automation can have
                  wide-reaching effects, so it's gated. */}
              {isLiveRow && savedId ? (
                savedStatus === AutomationStatusValues.ACTIVE ? (
                  isAutomationsAdmin ? (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleDisable}
                      disabled={disableMutation.isPending}
                      data-track-category='automation-builder'
                      data-track-name='header-disable'
                    >
                      <Power className='size-4' />
                      Disable
                    </Button>
                  ) : null
                ) : (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleActivate}
                    disabled={activateMutation.isPending}
                    trackId='activate_automation'
                    data-track-category='automation-builder'
                    data-track-name='header-activate'
                  >
                    <Power className='size-4' />
                    Activate
                  </Button>
                )
              ) : null}
              {/* Admin-only: permanently retire an automation. Only offered once it is
                  DISABLED, so it has to be switched off first. */}
              {savedId && isAutomationsAdmin && savedStatus === AutomationStatusValues.DISABLED ? (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleArchive}
                  disabled={archiveMutation.isPending}
                  trackId='archive_automation'
                  data-track-category='automation-builder'
                  data-track-name='header-archive'
                >
                  <Archive className='size-4' />
                  Archive
                </Button>
              ) : null}
              {/* DRAFT proposals can be sent for approval. */}
              {savedId && savedStatus === AutomationStatusValues.DRAFT && !isLiveRow ? (
                <Button
                  onClick={() => submitForApprovalMutation.mutate(savedId)}
                  loading={submitForApprovalMutation.isPending}
                  disabled={submitForApprovalMutation.isPending}
                  trackId='submit_automation_for_approval'
                  data-track-category='automation-builder'
                  data-track-name='header-submit-for-approval'
                  className='font-semibold'
                >
                  <Send className='size-4' />
                  Send for approval
                </Button>
              ) : null}
              {/* PENDING_APPROVAL: the author can revoke. The proposer is the
                  row's createdById (set when the proposal was created). */}
              {savedId &&
              savedStatus === AutomationStatusValues.PENDING_APPROVAL &&
              automation?.createdById === me?.id ? (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => revokeMutation.mutate(savedId)}
                  disabled={revokeMutation.isPending}
                  trackId='revoke_automation_proposal'
                  data-track-category='automation-builder'
                  data-track-name='header-revoke'
                >
                  <Undo2 className='size-4' />
                  Revoke
                </Button>
              ) : null}
              {/* Edit a DRAFT proposal in place, or fork a new proposal
                  from a LIVE row. Both flows route through a confirm dialog
                  — the body differs per case. */}
              {canEdit ? (
                <Button
                  onClick={() => {
                    if (forksOnEdit) setProposeChangeConfirmOpen(true);
                    else setEditConfirmOpen(true);
                  }}
                  data-track-category='automation-builder'
                  data-track-name={forksOnEdit ? 'header-propose-change' : 'header-edit'}
                  className='font-semibold'
                >
                  <Pencil className='size-4' />
                  {isLiveRow ? 'Propose change' : 'Edit'}
                </Button>
              ) : null}
              {/* Approval review mode: admin opened this proposal from the
                  inbox. Inline Approve / Reject actions on the page they're
                  reviewing rather than the row card. Authors can't decide
                  on their own proposals — same rule enforced server-side. */}
              {approvalReviewMode &&
              isAutomationsAdmin &&
              savedId &&
              savedStatus === AutomationStatusValues.PENDING_APPROVAL &&
              automation?.createdById !== me?.id ? (
                <>
                  <Button
                    variant='outline'
                    onClick={() => {
                      setRejectNote('');
                      setRejectDialogOpen(true);
                    }}
                    disabled={rejectMutation.isPending || approveMutation.isPending}
                    data-track-category='automation-builder'
                    data-track-name='header-reject'
                  >
                    <X className='size-4' />
                    Reject
                  </Button>
                  <Button
                    onClick={() => approveMutation.mutate(savedId)}
                    loading={approveMutation.isPending}
                    disabled={rejectMutation.isPending || approveMutation.isPending}
                    trackId='approve_automation_proposal'
                    data-track-category='automation-builder'
                    data-track-name='header-approve'
                    className='font-semibold'
                  >
                    <Check className='size-4' />
                    Approve
                  </Button>
                </>
              ) : null}
            </>
          )}
        </div>
        {editMode && nameError ? (
          <p className='pl-11 text-xs text-red-600 dark:text-red-400' role='alert'>
            {nameError}
          </p>
        ) : null}
        <div className='pl-11'>
          <InlineEditableText
            value={description}
            onChange={setDescription}
            placeholder='Add a description (optional)'
            readOnly={!editMode}
            className='text-sm text-muted-foreground'
            multiline
          />
        </div>
      </div>

      <div
        className={cn(
          'flex-1 overflow-y-auto bg-muted/30',
          !editMode && canEdit && !readOnlyPreview && 'cursor-pointer',
        )}
        {...(!editMode && canEdit && !readOnlyPreview
          ? {
              onClick: (): void => {
                if (forksOnEdit) setProposeChangeConfirmOpen(true);
                else setEditConfirmOpen(true);
              },
            }
          : {})}
      >
        <div
          className={cn(
            'mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6',
            !editMode && 'pointer-events-none select-none opacity-90',
          )}
          aria-readonly={!editMode}
          // pointer-events-none only blocks the mouse — it doesn't remove step/trigger
          // form fields from the tab order, so they could still be focused and typed
          // into via keyboard. `inert` fully removes this subtree from focus/interaction.
          inert={readOnlyPreview}
        >
          <LockBanner status={savedStatus} isLiveRow={isLiveRow} />
          <RuleSummaryCard
            config={config}
            triggerSchema={triggerSchema}
            stepCatalog={stepCatalog}
          />
          <BuilderSection
            number={1}
            kicker='event'
            title='When this happens'
            description='The event that fires this automation.'
          >
            <TriggerCard
              view='event'
              trigger={config.trigger}
              catalog={triggerCatalog}
              schema={triggerSchema}
              schemaLoading={triggerSchemaQuery.isLoading && !!config.trigger.type}
              onChangeType={handleTriggerTypeChange}
              onConfigChange={handleTriggerConfigChange}
              issues={triggerIssues}
            />
            {config.trigger.type === 'WEBHOOK' && (
              <div className='mt-4'>
                <WebhookEndpointPanel automationId={savedId} />
              </div>
            )}
          </BuilderSection>

          <BuilderSection
            number={2}
            kicker='timing'
            title='Run timing'
            description='Run now, or wait a fixed time after a date field on the trigger.'
          >
            <ScheduleCard
              schedule={config.schedule}
              triggerSchema={triggerSchema}
              onChange={handleScheduleChange}
            />
          </BuilderSection>

          <BuilderSection
            number={3}
            kicker='condition'
            title='With these conditions'
            description='Evaluated against fresh state when the actions are about to run.'
          >
            <TriggerCard
              view='condition'
              trigger={config.trigger}
              catalog={triggerCatalog}
              schema={triggerSchema}
              schemaLoading={triggerSchemaQuery.isLoading && !!config.trigger.type}
              onChangeType={handleTriggerTypeChange}
              onConfigChange={handleTriggerConfigChange}
              issues={triggerIssues}
              onFormFieldNamesResolved={handleFormFieldNamesResolved}
            />
          </BuilderSection>

          <BuilderSection
            number={4}
            kicker='action'
            isLast
            title='Then do this'
            description='One or more actions run in order. Conditionals can branch inside a step.'
          >
            <AddStepRow catalog={stepCatalog} onPick={type => handleAddStep(type, 0)} />

            {config.steps.map((step, index) => {
              const isLast = index === config.steps.length - 1;
              const variableSources = buildVariableSources(
                triggerSchema,
                config.trigger.config,
                config.steps,
                stepSchemaCache,
                index,
                formFieldNameMap,
              );
              const stepIssues = issuesUnder(validation?.issues, `steps[${index}]`);

              const card =
                step.type === CONDITIONAL_STEP_TYPE ? (
                  <ConditionalCard
                    step={step as ConditionalStepConfig}
                    catalog={stepCatalog}
                    schemaCache={stepSchemaCache}
                    schemaLoadingFor={stepSchemaLoadingFor}
                    operators={operators}
                    variableSources={variableSources}
                    index={index + 1}
                    total={config.steps.length}
                    onChange={next => updateStepAt(index, next)}
                    onMoveUp={() => handleMoveStep(index, -1)}
                    onMoveDown={() => handleMoveStep(index, 1)}
                    onDelete={() => handleDeleteStep(index)}
                    issues={stepIssues}
                    pathPrefix={`steps[${index}]`}
                    readOnly={!editMode}
                    ensureSchema={ensureSchema}
                    renderConditionalCard={renderConditionalCard}
                    renderSwitchCard={renderSwitchCard}
                  />
                ) : step.type === SWITCH_STEP_TYPE ? (
                  <SwitchCard
                    step={step as SwitchStepConfig}
                    catalog={stepCatalog}
                    schemaCache={stepSchemaCache}
                    schemaLoadingFor={stepSchemaLoadingFor}
                    operators={operators}
                    variableSources={variableSources}
                    index={index + 1}
                    total={config.steps.length}
                    onChange={next => updateStepAt(index, next)}
                    onMoveUp={() => handleMoveStep(index, -1)}
                    onMoveDown={() => handleMoveStep(index, 1)}
                    onDelete={() => handleDeleteStep(index)}
                    issues={stepIssues}
                    pathPrefix={`steps[${index}]`}
                    readOnly={!editMode}
                    ensureSchema={ensureSchema}
                    renderConditionalCard={renderConditionalCard}
                    renderSwitchCard={renderSwitchCard}
                  />
                ) : (
                  <StepCard
                    step={step as ActionStepConfig}
                    catalogItem={
                      stepCatalog.find(c => c.type === (step as ActionStepConfig).type) ?? null
                    }
                    schema={stepSchemaCache[(step as ActionStepConfig).type] ?? null}
                    schemaLoading={stepSchemaLoadingFor((step as ActionStepConfig).type)}
                    index={index + 1}
                    total={config.steps.length}
                    variableSources={variableSources}
                    onConfigChange={cfg => handleStepConfigChange(index, cfg)}
                    onMoveUp={() => handleMoveStep(index, -1)}
                    onMoveDown={() => handleMoveStep(index, 1)}
                    onDelete={() => handleDeleteStep(index)}
                    issues={stepIssues}
                    pathPrefix={`steps[${index}].config.`}
                    readOnly={!editMode}
                  />
                );

              return (
                <div key={step.id} className='flex flex-col'>
                  {card}
                  {!isLast && (
                    <AddStepRow
                      catalog={stepCatalog}
                      onPick={type => handleAddStep(type, index + 1)}
                    />
                  )}
                </div>
              );
            })}

            {config.steps.length > 0 && (
              <AddStepRow catalog={stepCatalog} onPick={type => handleAddStep(type)} />
            )}
          </BuilderSection>
        </div>
      </div>

      <div className='border-t border-border bg-background px-6 py-3'>
        <ValidationBanner
          result={validation}
          isSaving={saveMutation.isPending}
          errorMessage={errorMessage}
        />
      </div>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title='Delete draft automation?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-4 px-5 py-4 text-sm text-foreground'>
          <p>
            Delete <strong>{name || 'this draft automation'}</strong>? This can&apos;t be undone.
          </p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setDeleteDialogOpen(false)}
              data-track-category='automation-builder'
              data-track-name='delete-draft-cancel'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={deleteMutation.isPending}
              loading={deleteMutation.isPending}
              onClick={() => {
                if (!savedId) return;
                deleteMutation.mutate(savedId);
                setDeleteDialogOpen(false);
              }}
              data-track-category='automation-builder'
              data-track-name='delete-draft-confirm'
            >
              Delete draft
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={editConfirmOpen}
        onOpenChange={setEditConfirmOpen}
        title='Edit this automation?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-4 px-5 py-4 text-sm text-foreground'>
          <p>
            Edits stay local to this tab — nothing is saved until you click <strong>Save</strong>.
            The proposal stays a draft until you hit <strong>Send for approval</strong>.
          </p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setEditConfirmOpen(false)}
              data-track-category='automation-builder'
              data-track-name='edit-confirm-cancel'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={() => {
                setEditMode(true);
                setEditConfirmOpen(false);
              }}
              data-track-category='automation-builder'
              data-track-name='edit-confirm-continue'
            >
              Continue editing
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={proposeChangeConfirmOpen}
        onOpenChange={setProposeChangeConfirmOpen}
        title='Propose a change to this automation?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-4 px-5 py-4 text-sm text-foreground'>
          <p>The live automation keeps running. Nothing changes until an admin approves.</p>
          <p className='text-muted-foreground'>
            You&apos;ll edit a copy of it. <strong className='text-foreground'>Save</strong> when
            you&apos;re done, then <strong className='text-foreground'>Send for approval</strong>.
          </p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setProposeChangeConfirmOpen(false)}
              data-track-category='automation-builder'
              data-track-name='propose-change-confirm-cancel'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={() => {
                setProposeChangeConfirmOpen(false);
                handleProposeChangeNavigate();
              }}
              data-track-category='automation-builder'
              data-track-name='propose-change-confirm-continue'
            >
              Start proposal
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={rejectDialogOpen}
        onOpenChange={open => {
          if (!open) {
            setRejectDialogOpen(false);
            setRejectNote('');
          }
        }}
        title='Reject proposal'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-3 px-5 py-4'>
          <p className='text-xs text-muted-foreground'>
            The author will get a DM with this note. Be specific so they can address it in a new
            proposal.
          </p>
          <Textarea
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder='Why are you rejecting this?'
            rows={4}
            data-track-category='automation-builder'
            data-track-name='reject-note'
          />
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                setRejectDialogOpen(false);
                setRejectNote('');
              }}
              data-track-category='automation-builder'
              data-track-name='reject-cancel'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={rejectNote.trim().length === 0 || rejectMutation.isPending}
              loading={rejectMutation.isPending}
              onClick={() => {
                if (savedId) {
                  rejectMutation.mutate({ id: savedId, note: rejectNote.trim() });
                }
              }}
              trackId='reject_automation_proposal'
              data-track-category='automation-builder'
              data-track-name='reject-confirm'
            >
              Reject
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={disableDialogOpen}
        onOpenChange={setDisableDialogOpen}
        title='Disable automation?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-2 px-5 py-4 text-sm'>
          <p className='text-base font-semibold text-foreground'>
            Disable {name || 'this automation'}?
          </p>
          <p className='text-muted-foreground'>What should happen to the runs already queued?</p>
          <div className='flex flex-wrap items-center justify-end gap-2 pt-4'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setDisableDialogOpen(false)}
              data-track-category='automation-builder'
              data-track-name='disable-cancel'
            >
              Cancel
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={disableMutation.isPending}
              onClick={() => {
                if (savedId) disableMutation.mutate({ id: savedId, cancelQueued: false });
                setDisableDialogOpen(false);
              }}
              trackId='disable_automation_keep_queued'
              data-track-category='automation-builder'
              data-track-name='disable-keep-queued'
            >
              Let them finish
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={disableMutation.isPending}
              loading={disableMutation.isPending}
              onClick={() => {
                if (savedId) disableMutation.mutate({ id: savedId, cancelQueued: true });
                setDisableDialogOpen(false);
              }}
              trackId='disable_automation_cancel_queued'
              data-track-category='automation-builder'
              data-track-name='disable-cancel-queued'
            >
              Stop them
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function LockBanner({
  status,
  isLiveRow,
}: {
  status: string;
  isLiveRow: boolean;
}): React.ReactElement | null {
  if (isLiveRow) {
    return (
      <div className='pointer-events-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground'>
        This is the live version of the automation. To change anything, start a new proposal —
        admins will review and either approve the new version or keep this one.
      </div>
    );
  }
  if (status === AutomationStatusValues.PENDING_APPROVAL) {
    return (
      <div className='pointer-events-auto rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400'>
        Waiting for admin approval. The proposal is locked until a decision is made.
      </div>
    );
  }
  if (status === AutomationStatusValues.REJECTED) {
    return (
      <div className='pointer-events-auto rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400'>
        Rejected by admin. Check your DMs for the reason, then start a new proposal to try again.
      </div>
    );
  }
  if (status === AutomationStatusValues.REVOKED) {
    return (
      <div className='pointer-events-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground'>
        You revoked this proposal. Start a new one to make further changes.
      </div>
    );
  }
  if (status === AutomationStatusValues.AUTO_REVOKED) {
    return (
      <div className='pointer-events-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground'>
        Auto-revoked — another proposal in this automation was approved first.
      </div>
    );
  }
  if (status === AutomationStatusValues.ARCHIVED) {
    return (
      <div className='pointer-events-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground'>
        Archived. This is a previous version of the automation — it no longer fires.
      </div>
    );
  }
  return null;
}

function humanizeIssuePath(path: string): string {
  if (path === 'trigger.config' || path.startsWith('trigger.config.')) return 'Conditions';
  if (path === 'trigger.type' || path === 'trigger') return 'Trigger';
  const stepMatch = /^steps\[(\d+)\]/.exec(path);
  if (stepMatch) {
    const label = `Step ${Number(stepMatch[1]) + 1}`;
    const field = path.replace(/^steps\[\d+\]\.config\.?/, '').replace(/^steps\[\d+\]\.?/, '');
    return field ? `${label} → ${field}` : label;
  }
  return path;
}

function RuleSummaryCard({
  config,
  triggerSchema,
  stepCatalog,
}: {
  config: AutomationConfig;
  triggerSchema: { type: string; name: string } | null;
  stepCatalog: Array<{ type: string; name: string }>;
}): React.ReactElement {
  const triggerLabel = triggerSchema?.name ?? config.trigger.type ?? null;
  const actionSteps = config.steps.filter(s => s.type !== CONDITIONAL_STEP_TYPE);
  const hasContent = !!triggerLabel || actionSteps.length > 0;

  return (
    <div
      data-slot='automation-summary'
      className='flex flex-col gap-4 rounded-md border border-border bg-background p-5'
    >
      <div className='flex items-center justify-between'>
        <h2 className='text-sm font-semibold text-foreground'>Summary</h2>
        {!hasContent && (
          <span className='text-[11px] text-muted-foreground'>
            Wire up the trigger and actions to see a recap here.
          </span>
        )}
      </div>

      {hasContent && (
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          <SummaryColumn label='Conditions' accent='emerald'>
            {triggerLabel ? (
              /^when\b/i.test(triggerLabel) ? (
                <SummaryRow>
                  <span className='font-medium text-foreground'>{triggerLabel}</span>
                </SummaryRow>
              ) : (
                <SummaryRow>
                  <span className='text-muted-foreground'>When</span>{' '}
                  <span className='font-medium text-foreground'>{triggerLabel}</span>
                </SummaryRow>
              )
            ) : (
              <SummaryRow muted>No trigger picked yet.</SummaryRow>
            )}
          </SummaryColumn>

          <SummaryColumn label='Actions' accent='blue'>
            {actionSteps.length === 0 ? (
              <SummaryRow muted>No actions yet.</SummaryRow>
            ) : (
              actionSteps.map((step, i) => {
                const label =
                  stepCatalog.find(c => c.type === (step as ActionStepConfig).type)?.name ??
                  (step as ActionStepConfig).type;
                return (
                  <SummaryRow key={step.id}>
                    <span className='text-muted-foreground'>{i + 1}.</span>{' '}
                    <span className='font-medium text-foreground'>{label}</span>
                  </SummaryRow>
                );
              })
            )}
          </SummaryColumn>
        </div>
      )}
    </div>
  );
}

function SummaryColumn({
  label,
  accent,
  children,
}: {
  label: string;
  accent: 'emerald' | 'blue';
  children: React.ReactNode;
}): React.ReactElement {
  const accentCls =
    accent === 'emerald'
      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
  return (
    <div className='flex flex-col gap-2'>
      <span
        className={cn(
          'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]',
          accentCls,
        )}
      >
        {label}
      </span>
      <ul className='flex flex-col gap-1.5'>{children}</ul>
    </div>
  );
}

function SummaryRow({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}): React.ReactElement {
  return (
    <li
      className={cn(
        'flex items-start gap-2 text-xs',
        muted ? 'italic text-muted-foreground' : 'text-foreground',
      )}
    >
      <span
        aria-hidden='true'
        className='mt-1.5 size-1 flex-shrink-0 rounded-full bg-muted-foreground'
      />
      <span className='leading-relaxed'>{children}</span>
    </li>
  );
}

type SectionKicker = 'event' | 'condition' | 'timing' | 'action';

const SECTION_KICKER: Record<SectionKicker, { label: string; classes: string }> = {
  event: {
    label: 'Event',
    classes: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  condition: {
    label: 'Condition',
    classes: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  },
  timing: {
    label: 'Timing',
    classes: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  action: {
    label: 'Action',
    classes: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
};

function BuilderSection({
  number,
  kicker,
  title,
  description,
  isLast,
  children,
}: {
  number: number;
  kicker: SectionKicker;
  title: string;
  description: string;
  isLast?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const k = SECTION_KICKER[kicker];
  return (
    <section className='flex gap-4'>
      <div className='flex flex-col items-center'>
        <span
          aria-hidden='true'
          className={cn(
            'flex size-6 flex-shrink-0 items-center justify-center rounded-full',
            'bg-foreground text-background text-[11px] font-semibold',
          )}
        >
          {number}
        </span>
        {!isLast && <span aria-hidden='true' className='mt-1 w-px flex-1 bg-border' />}
      </div>

      <div className='flex flex-1 flex-col gap-3 pb-6'>
        <div className='flex flex-wrap items-center gap-2'>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]',
              k.classes,
            )}
          >
            {k.label}
          </span>
          <span className='text-sm font-semibold text-foreground'>{title}</span>
          <span className='text-xs text-muted-foreground'>· {description}</span>
        </div>
        <div className='flex flex-col gap-3'>{children}</div>
      </div>
    </section>
  );
}

interface InlineEditableTextProps {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  className?: string;
  multiline?: boolean;
  readOnly?: boolean;
  /**
   * When true, the field renders with red border + red focus ring +
   * red placeholder so it's obvious the field has a validation error
   * (separate "below the field" error text alone is easy to miss).
   */
  invalid?: boolean;
}

function InlineEditableText({
  value,
  onChange,
  placeholder,
  className,
  multiline,
  readOnly,
  invalid = false,
}: InlineEditableTextProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing && !readOnly) {
    return (
      <input
        ref={inputRef}
        type='text'
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          onChange(draft);
          setEditing(false);
        }}
        onKeyDown={e => {
          if (!multiline && e.key === 'Enter') {
            e.preventDefault();
            onChange(draft);
            setEditing(false);
          }
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        data-slot='input'
        data-track-category='automation-builder'
        data-track-name='inline-edit-input'
        className={cn(
          'placeholder:text-muted-foreground w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
          'h-8 px-2',
          invalid
            ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 focus-visible:ring-[2px] placeholder:text-red-500/70'
            : 'border-input focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]',
          className,
        )}
      />
    );
  }

  if (readOnly) {
    return (
      <span
        title={value || placeholder}
        className={cn(
          'truncate rounded-md px-2 py-1 text-left',
          !value && 'text-muted-foreground',
          className,
        )}
      >
        {value || placeholder}
      </span>
    );
  }

  return (
    <button
      type='button'
      onClick={() => setEditing(true)}
      aria-label={value ? `Edit: ${value}` : placeholder}
      data-invalid={invalid || undefined}
      title={value || placeholder}
      data-track-category='automation-builder'
      data-track-name='inline-edit-text'
      className={cn(
        'cursor-text truncate rounded-md px-2 py-1 text-left',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
        !value && (invalid ? 'text-red-500' : 'text-muted-foreground'),
        invalid ? 'border border-red-500 bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-accent/40',
        className,
      )}
    >
      {value || placeholder}
    </button>
  );
}
