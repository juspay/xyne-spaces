import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CircleCheck,
  Archive,
  ChevronDown,
  GitBranch,
  Hash,
  PanelRight,
  PauseCircle,
  SkipForward,
  Ticket as TicketIcon,
  X,
  XCircle,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ActivityType,
  FLOW_STAGE_NAMES,
  TicketStatusV2,
  type FlowPlanNode,
  type FormFields,
} from '@xyne/shared';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { getStatusOption } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { gateOf } from '../FlowPlanEditor/FlowPlanEditor';
import { StageFormInlinePanel } from '../../Tickets/StageFormInlinePanel/StageFormInlinePanel';
import {
  isFlowStepBacklogged,
  isFlowStepSkipped,
  normalizeUserId,
  type FlowRunTicket,
} from './flowRun.utils';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useQuery } from '@xyne/shared/hooks';
import { useUsersById } from '../../../hooks/useUsers';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import UserAvatar, { AvatarSize } from '../../UserAvatar/UserAvatar';

/** Activity payloads this panel reads; `field` is a plain string on the wire. */
interface FlowActivityValue {
  field?: string;
  newValue?: string;
  fieldName?: string;
  isAutomation?: boolean;
}

// The status change and the form write are logged by two independent backend
// handlers, so a normal Submit's timestamps can land in either order — only an
// edit past this window is a real post-completion edit.
const FLOW_FORM_EDIT_GRACE_MS = 10_000;

const FLOW_STEP_INFO_STYLE = {
  skipped: {
    verb: 'Skipped',
    verbColor: 'text-teal-600',
    surfaceColor: 'border-teal-500/15 bg-teal-500/[0.05]',
  },
  backlog: {
    verb: 'Moved to backlog',
    verbColor: 'text-amber-600',
    surfaceColor: 'border-amber-500/15 bg-amber-500/[0.05]',
  },
  completed: {
    verb: 'Confirmed',
    verbColor: 'text-emerald-600',
    surfaceColor: 'border-emerald-500/15 bg-emerald-500/[0.05]',
  },
  cancelled: {
    verb: 'Cancelled',
    verbColor: 'text-red-500',
    surfaceColor: 'border-red-500/15 bg-red-500/[0.05]',
  },
} as const;

const FlowStepCompletionInfo: React.FC<{
  ticketId: string;
  status?: TicketStatusV2;
  /** Stage-move byline: read the BACKLOG/SKIPPED stageName activity instead of a status one. */
  stage?: 'BACKLOG' | 'SKIPPED';
  highlighted?: boolean;
  /** Scopes the "Updated by" byline to this form's own fields. */
  gateFormId?: string;
}> = ({ ticketId, status, stage, highlighted = false, gateFormId = '' }) => {
  // Subscribed live (not via the shared query cache): the byline must appear
  // as soon as the mutation commits, like the status chip does.
  const [activities] = useQuery(queries.ticketActivities({ ticketId }));
  const [gateFormFields] = useCachedQuery(queries.getFormFieldsByFormId({ formId: gateFormId }), {
    enabled: !!gateFormId,
  });
  // Includes deactivated users — a completion by a since-removed teammate must
  // still carry their name, not "Someone".
  const usersById = useUsersById();
  const resolveActor = useCallback(
    (updatedBy: string): { id: string; name: string } => {
      const id = normalizeUserId(updatedBy) ?? updatedBy;
      const user = usersById.get(id);
      return { id, name: user ? getUserDisplayName(user) : 'Someone' };
    },
    [usersById],
  );
  const kind = stage
    ? stage === 'SKIPPED'
      ? 'skipped'
      : 'backlog'
    : status === TicketStatusV2.COMPLETED
      ? 'completed'
      : 'cancelled';
  // The Zero mutator logs a stage move as STATUS, the REST/group path as STAGE_NAME.
  const activity = useMemo(
    () =>
      (activities ?? []).find(row => {
        if (stage) {
          const value = row.value as { field?: string; newValue?: string } | null;
          return (
            (row.activityType === ActivityType.STATUS ||
              row.activityType === ActivityType.STAGE_NAME) &&
            value?.field === 'stageName' &&
            value.newValue === stage
          );
        }
        if (row.activityType !== ActivityType.STATUS) return false;
        const value = row.value as { field?: string; newValue?: string } | null;
        if (value?.field === 'stageName') return false;
        return value?.newValue === status;
      }) ?? null,
    [activities, stage, status],
  );
  // A gate-form value edited by a person after the step completed. The flow
  // already moved on with the original answers; only the byline changes.
  const lastEditActivity = useMemo(() => {
    if (stage || status !== TicketStatusV2.COMPLETED || !activity || !gateFormId) return null;
    const gateFieldNames = new Set(
      ((gateFormFields ?? []) as Array<FormFields & { globalField?: { fieldName?: string } }>)
        .map(row => row.globalField?.fieldName ?? row.fieldName)
        .filter((fieldName): fieldName is string => !!fieldName),
    );
    if (gateFieldNames.size === 0) return null;
    // Activities come back newest-first, so the first match is the latest edit.
    return (
      (activities ?? []).find(row => {
        if (row.activityType !== ActivityType.METADATA) return false;
        if (row.timestamp <= activity.timestamp + FLOW_FORM_EDIT_GRACE_MS) return false;
        const value = row.value as FlowActivityValue | null;
        // 'customField' covers ordinary fields, 'stageFormFile' file fields.
        if (value?.field !== 'customField' && value?.field !== 'stageFormFile') return false;
        // Automation writes are not a person revising the answer.
        if (value.isAutomation) return false;
        return !!value.fieldName && gateFieldNames.has(value.fieldName);
      }) ?? null
    );
  }, [activities, activity, stage, status, gateFormId, gateFormFields]);
  if (!activity) return null;
  const { verb, verbColor, surfaceColor } = FLOW_STEP_INFO_STYLE[kind];
  const row = lastEditActivity
    ? {
        ...resolveActor(lastEditActivity.updatedBy),
        verb: 'Updated',
        verbColor: 'text-amber-600',
        surfaceColor: 'border-amber-500/15 bg-amber-500/[0.05]',
        when: new Date(lastEditActivity.timestamp).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        title:
          'This form was edited after the step completed — the flow already moved on with the original answers.',
      }
    : {
        ...resolveActor(activity.updatedBy),
        verb,
        verbColor,
        surfaceColor,
        when: new Date(activity.timestamp).toLocaleDateString(undefined, { dateStyle: 'medium' }),
        title: undefined,
      };
  return (
    <div
      className={`flex items-center gap-2 border-t ${
        highlighted ? `${row.surfaceColor} px-3 py-2.5` : 'border-border/60 pt-2.5'
      }`}
      {...(row.title && { title: row.title })}
    >
      <UserAvatar userId={row.id} showActiveStatus={false} size={AvatarSize.SM} />
      <p className='min-w-0 truncate text-[11px] text-muted-foreground'>
        <span className={`font-semibold ${row.verbColor}`}>{row.verb} by</span>{' '}
        <span className='font-medium text-foreground'>{row.name}</span>
        <span className='mx-1 text-border'>·</span>
        {row.when}
      </p>
    </div>
  );
};

export interface FlowNodeSelection {
  planNode: FlowPlanNode | null; // null = the run's main ticket
  ticket: FlowRunTicket | null; // null = ghost (not yet instantiated)
  skipped: boolean;
  skipReason?: 'decision' | 'blocked';
}

interface FlowNodeSidePanelProps {
  node: FlowNodeSelection;
  backlogSteps?: FlowNodeSelection[];
  /** True when a pause above this step (main ticket or a pass-over) locks it */
  locked: boolean;
  /** Why Backlog/Skip cannot fire right now (gates both settle actions). */
  settleBlockedReason?: string | undefined;
  onClose: () => void;
  onShowDetails?: (ticket: FlowRunTicket) => void;
  onChangeStatus: (ticketId: string, statusV2: TicketStatusV2) => Promise<void>;
  onBacklog: (ticketId: string) => Promise<void>;
  onSkip: (ticketId: string) => Promise<void>;
  onSelectBacklog?: (step: FlowNodeSelection) => void;
}

// The main ticket drives the run: it only starts/pauses/cancels. Completion is
// automatic once every step settles, so there is no manual "Mark complete".
const ROOT_ACTIONS: Partial<Record<TicketStatusV2, Array<{ label: string; to: TicketStatusV2 }>>> =
  {
    [TicketStatusV2.TODO]: [
      { label: 'Start', to: TicketStatusV2.STARTED },
      { label: 'Cancel', to: TicketStatusV2.CANCELLED },
    ],
    [TicketStatusV2.PAUSED]: [
      { label: 'Resume', to: TicketStatusV2.STARTED },
      { label: 'Cancel', to: TicketStatusV2.CANCELLED },
    ],
    [TicketStatusV2.STARTED]: [
      { label: 'Pause', to: TicketStatusV2.PAUSED },
      { label: 'Cancel', to: TicketStatusV2.CANCELLED },
    ],
  };

/**
 * Side panel for a node in a flow run. Main ticket: start / pause / cancel.
 * Steps complete only through their gate — confirmation ("Confirm & move") or
 * form ("Save" / "Submit & move"). Steps can also be cancelled or backlogged;
 * while the main ticket is paused every step is locked.
 */
export const FlowNodeSidePanel: React.FC<FlowNodeSidePanelProps> = ({
  node,
  backlogSteps = [],
  locked,
  settleBlockedReason,
  onClose,
  onShowDetails,
  onChangeStatus,
  onBacklog,
  onSkip,
  onSelectBacklog,
}) => {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { planNode, ticket, skipped, skipReason } = node;
  const isRoot = planNode === null;
  const handleStatusAction = useCallback(
    async (ticketId: string, statusV2: TicketStatusV2): Promise<void> => {
      if (statusV2 === TicketStatusV2.CANCELLED) {
        const confirmed = await confirm({
          title: isRoot ? 'Cancel flow run?' : 'Cancel this step?',
          description: isRoot
            ? 'This will cancel the entire flow run and all remaining steps.'
            : 'This will cancel the step. Steps that depend on it will not be reached.',
          confirmLabel: isRoot ? 'Cancel run' : 'Cancel step',
          cancelLabel: isRoot ? 'Keep run' : 'Keep step',
          variant: 'destructive',
        });
        if (!confirmed) return;
      }
      try {
        await onChangeStatus(ticketId, statusV2);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update status');
      }
    },
    [confirm, isRoot, onChangeStatus],
  );
  const handleBacklogAction = useCallback(
    async (ticketId: string, stepTitle: string): Promise<void> => {
      const confirmed = await confirm({
        title: `Move "${stepTitle}" to backlog?`,
        description:
          'Dependent steps can continue, but the run will not complete until this step is ' +
          'completed, cancelled or skipped.',
        confirmLabel: 'Move to backlog',
        cancelLabel: 'Keep step',
      });
      if (!confirmed) return;
      try {
        await onBacklog(ticketId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to move step to backlog');
      }
    },
    [confirm, onBacklog],
  );
  const handleSkipAction = useCallback(
    async (ticketId: string, stepTitle: string): Promise<void> => {
      const confirmed = await confirm({
        title: `Skip "${stepTitle}"?`,
        description:
          'Dependent steps will continue and the run can still complete. This cannot be undone.',
        confirmLabel: 'Skip step',
        cancelLabel: 'Keep step',
      });
      if (!confirmed) return;
      try {
        await onSkip(ticketId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to skip step');
      }
    },
    [confirm, onSkip],
  );
  const backlogged = !isRoot && isFlowStepBacklogged(ticket);
  const manuallySkipped = !isRoot && isFlowStepSkipped(ticket);
  const statusOption =
    ticket && !backlogged && !manuallySkipped ? getStatusOption(ticket.statusV2) : null;
  const gate = planNode ? gateOf(planNode) : null;
  const stepActive =
    !isRoot &&
    !!ticket &&
    (ticket.statusV2 === TicketStatusV2.PAUSED || ticket.statusV2 === TicketStatusV2.STARTED);
  const rootActions = isRoot && ticket ? (ROOT_ACTIONS[ticket.statusV2] ?? []) : [];
  const hasActiveForm = stepActive && !locked && gate?.type === 'form';
  const formId = gate?.type === 'form' ? gate.formId : '';
  const [form] = useCachedQuery(queries.getFormById({ formId }), {
    enabled: gate?.type === 'form',
  });
  const formName = form?.formName ?? 'Form';

  // Secondary step actions live in one menu; actions that cannot fire in the
  // current state are hidden rather than disabled.
  const canSkip = !!ticket && !settleBlockedReason;
  const canBacklog = canSkip && !backlogged;
  const stepTitle = ticket?.title ?? planNode?.title ?? '';
  const stepTicketId = ticket?.id ?? '';
  const stepMoreActions = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type='button'
          aria-label='More step actions'
          data-track-category='flow_board'
          data-track-name='open_step_actions'
          className='inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground transition outline-none hover:bg-secondary/80 focus-visible:ring-[3px] focus-visible:ring-ring/50'
        >
          More actions
          <ChevronDown size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={6}
          align='end'
          className='z-50 w-[var(--radix-dropdown-menu-trigger-width)] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
        >
          {canBacklog && (
            <DropdownMenu.Item
              onSelect={() => void handleBacklogAction(stepTicketId, stepTitle)}
              data-track-category='flow_board'
              data-track-name='backlog_step'
              className='flex cursor-pointer select-none items-center justify-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted'
            >
              <Archive size={13} className='shrink-0 text-amber-600' />
              Move to backlog
            </DropdownMenu.Item>
          )}
          {canSkip && (
            <DropdownMenu.Item
              onSelect={() => void handleSkipAction(stepTicketId, stepTitle)}
              data-track-category='flow_board'
              data-track-name='skip_step'
              className='flex cursor-pointer select-none items-center justify-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted'
            >
              <SkipForward size={13} className='shrink-0 text-teal-600' />
              Skip
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            onSelect={() => void handleStatusAction(stepTicketId, TicketStatusV2.CANCELLED)}
            data-track-category='flow_board'
            data-track-name='cancel_step'
            className='flex cursor-pointer select-none items-center justify-center gap-2 rounded-sm px-2 py-1.5 text-xs text-red-500 outline-none hover:bg-red-500/10 focus:bg-red-500/10'
          >
            <XCircle size={13} className='shrink-0' />
            Cancel step
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  return (
    <div
      className={`flex w-[390px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ${
        hasActiveForm ? 'h-full min-h-0' : 'max-h-full'
      }`}
    >
      <div className='flex items-center gap-2.5 px-4 py-3 border-b border-border'>
        <span className='flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#6276be]/10'>
          {isRoot ? (
            <GitBranch size={13} className='text-[#6276be]' />
          ) : (
            <TicketIcon size={13} className='text-[#6276be]' />
          )}
        </span>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground truncate'>
            {isRoot ? 'Main ticket' : (ticket?.xyneId ?? 'Step')}
          </span>
          {backlogged ? (
            <span className='flex items-center gap-1 text-[11px] font-medium text-amber-600'>
              <Archive size={12} />
              Backlog
            </span>
          ) : manuallySkipped ? (
            <span className='flex items-center gap-1 text-[11px] font-medium text-teal-600'>
              <SkipForward size={12} />
              Skipped
            </span>
          ) : statusOption ? (
            <span className='flex items-center gap-1 text-[11px] font-medium text-muted-foreground'>
              {statusOption.icon}
              {statusOption.label}
            </span>
          ) : null}
        </div>
        {ticket && (
          <div className='flex items-center gap-0.5'>
            {/* The thread panel only renders its close button for a ticket
                thread — without a conversation it would open with no way out. */}
            {onShowDetails && ticket.conversationId && (
              <Tooltip content='Show details' side='bottom' sideOffset={6}>
                <button
                  type='button'
                  aria-label='Show details'
                  onClick={() => onShowDetails(ticket)}
                  data-track-category='flow_board'
                  data-track-name='show_node_details'
                  className='rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                >
                  <PanelRight size={14} />
                </button>
              </Tooltip>
            )}
            {ticket.channelId && ticket.conversationId && (
              <Tooltip content='Go to channel' side='bottom' sideOffset={6}>
                <button
                  type='button'
                  aria-label='Go to channel'
                  onClick={() =>
                    void navigate(
                      `/chat/dir/${ticket.channelId}/${ticket.conversationId}/${ticket.id}`,
                    )
                  }
                  data-track-category='flow_board'
                  data-track-name='go_to_node_channel'
                  className='rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                >
                  <Hash size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        )}
        <Tooltip content='Close panel' side='bottom' sideOffset={6}>
          <button
            type='button'
            aria-label='Close panel'
            onClick={onClose}
            data-track-category='flow_board'
            data-track-name='close_node_panel'
            className='rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          >
            <X size={13} />
          </button>
        </Tooltip>
      </div>

      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 ${
          hasActiveForm ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        <div className='flex flex-col gap-1'>
          <p className='text-[14px] font-semibold text-foreground leading-[20px]'>
            {ticket?.title ?? planNode?.title}
          </p>
          {planNode?.description && (
            <p className='text-[12px] text-muted-foreground leading-[18px]'>
              {planNode.description}
            </p>
          )}
        </div>

        {ticket ? (
          <>
            {rootActions.length > 0 && (
              <div className='flex gap-2'>
                {rootActions.map(action => (
                  <Button
                    key={action.to}
                    variant='secondary'
                    size='sm'
                    className={
                      action.to === TicketStatusV2.CANCELLED
                        ? undefined
                        : 'flex-1 bg-[#6276BE] hover:bg-[#5060A0] text-white'
                    }
                    onClick={() => void handleStatusAction(ticket.id, action.to)}
                    data-track-category='flow_board'
                    data-track-name={`run_status_${action.to.toLowerCase()}`}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}

            {isRoot && backlogSteps.length > 0 && (
              <div className='flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-amber-600'>
                    <Archive size={12} />
                    Backlog steps
                  </span>
                  <span className='rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700'>
                    {backlogSteps.length}
                  </span>
                </div>
                <p className='text-[11px] leading-[16px] text-muted-foreground'>
                  No active steps are waiting. Open a deferred step to complete it.
                </p>
                <div className='flex flex-col gap-1.5'>
                  {backlogSteps.map(step => (
                    <button
                      key={step.planNode?.id ?? step.ticket?.id}
                      type='button'
                      onClick={() => onSelectBacklog?.(step)}
                      data-track-category='flow_board'
                      data-track-name='open_backlog_step'
                      className='flex items-center gap-2 rounded-md border border-amber-500/15 bg-background px-2.5 py-2 text-left transition-colors hover:border-amber-500/35 hover:bg-amber-500/[0.04]'
                    >
                      <Archive size={12} className='shrink-0 text-amber-600' />
                      <span className='min-w-0 flex-1 truncate text-[12px] font-medium text-foreground'>
                        {step.ticket?.title ?? step.planNode?.title}
                      </span>
                      {step.ticket?.xyneId && (
                        <span className='shrink-0 font-mono text-[10px] text-muted-foreground'>
                          {step.ticket.xyneId}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {stepActive && locked && (
              <div className='flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-3'>
                <PauseCircle size={15} className='mt-0.5 shrink-0 text-muted-foreground' />
                <p className='text-[12px] text-muted-foreground leading-[18px]'>
                  A step above this one is paused — this step is locked until it is resumed.
                </p>
              </div>
            )}

            {stepActive && !locked && gate?.type === 'confirmation' && (
              <div className='flex flex-col gap-2.5 rounded-lg border border-[#6276be]/25 bg-[#6276be]/[0.04] px-3 py-3'>
                <p className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-[#6276be]'>
                  <CircleCheck size={12} />
                  Needs confirmation
                </p>
                <p className='text-[12px] text-foreground leading-[18px]'>
                  {gate.prompt?.trim() || 'Confirm this step is done to continue the flow.'}
                </p>
                <div className='flex flex-col gap-2 pt-0.5'>
                  <Button
                    size='sm'
                    className='w-full bg-[#6276BE] hover:bg-[#5060A0] text-white'
                    onClick={() => void handleStatusAction(ticket.id, TicketStatusV2.COMPLETED)}
                    data-track-category='flow_board'
                    data-track-name='confirm_step'
                  >
                    {backlogged ? 'Confirm' : 'Confirm & move'}
                  </Button>
                  {stepMoreActions}
                </div>
              </div>
            )}

            {hasActiveForm && gate?.type === 'form' && (
              <div className='flex min-h-0 flex-1 flex-col gap-3'>
                {gate.formId ? (
                  <StageFormInlinePanel
                    ticket={{ id: ticket.id }}
                    targetStage={{ id: planNode.id, name: planNode.title }}
                    sourceStageName={
                      backlogged ? FLOW_STAGE_NAMES.BACKLOG : FLOW_STAGE_NAMES.PAUSED
                    }
                    formId={gate.formId}
                    hasApprovers={false}
                    isNonLinearBoard={false}
                    headerTitle={formName}
                    onCommit={() => onChangeStatus(ticket.id, TicketStatusV2.COMPLETED)}
                    commitSuccessMessage='Step completed'
                    actionsPlacement='footer'
                    embedded
                  />
                ) : (
                  <p className='text-[12px] text-muted-foreground'>
                    No form attached to this step — edit the plan to attach one.
                  </p>
                )}
                {stepMoreActions}
              </div>
            )}

            {/* Submitted FLOW forms stay compact until explicitly opened for editing. */}
            {!isRoot && manuallySkipped && (
              <div className='flex flex-col gap-2.5 rounded-lg border border-teal-500/25 bg-teal-500/[0.05] px-3 py-3'>
                <p className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-teal-600'>
                  <SkipForward size={12} />
                  Skipped
                </p>
                <p className='text-[12px] leading-[18px] text-muted-foreground'>
                  This step was skipped manually. Dependent steps continue and the run can still
                  complete.
                </p>
                <FlowStepCompletionInfo ticketId={ticket.id} stage='SKIPPED' />
              </div>
            )}

            {/* Submitted FLOW forms stay compact until explicitly opened for editing. */}
            {!isRoot &&
              !manuallySkipped &&
              ticket.statusV2 === TicketStatusV2.COMPLETED &&
              gate?.type === 'form' && (
                <div className='flex min-h-0 flex-col gap-2.5'>
                  {gate.formId && (
                    <StageFormInlinePanel
                      ticket={{ id: ticket.id }}
                      targetStage={{ id: planNode.id, name: planNode.title }}
                      sourceStageName=''
                      formId={gate.formId}
                      hasApprovers={false}
                      isNonLinearBoard={false}
                      headerTitle={formName}
                      saveOnly
                      saveSuccessMessage='Submitted form updated'
                      editableOnDemand
                      submittedHeader
                      actionsPlacement='footer'
                      embedded
                    />
                  )}
                  <FlowStepCompletionInfo
                    highlighted
                    ticketId={ticket.id}
                    status={TicketStatusV2.COMPLETED}
                    gateFormId={formId}
                  />
                </div>
              )}

            {/* Completed confirmation: preserve the prompt as evidence. */}
            {!isRoot &&
              !manuallySkipped &&
              ticket.statusV2 === TicketStatusV2.COMPLETED &&
              gate?.type !== 'form' && (
                <div className='flex flex-col gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] px-3 py-3'>
                  <p className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-emerald-600'>
                    <CircleCheck size={12} />
                    Confirmed
                  </p>
                  {gate?.type === 'confirmation' && gate.prompt?.trim() && (
                    <p className='text-[12px] text-foreground leading-[18px]'>
                      {gate.prompt.trim()}
                    </p>
                  )}
                  <FlowStepCompletionInfo ticketId={ticket.id} status={TicketStatusV2.COMPLETED} />
                </div>
              )}

            {/* Cancelled step: who cancelled it */}
            {!isRoot && ticket.statusV2 === TicketStatusV2.CANCELLED && (
              <div className='flex flex-col gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.05] px-3 py-3'>
                <p className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-red-500'>
                  <XCircle size={12} />
                  Cancelled
                </p>
                <FlowStepCompletionInfo ticketId={ticket.id} status={TicketStatusV2.CANCELLED} />
              </div>
            )}

            {!isRoot && backlogged && (
              <div className='flex flex-col gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-3'>
                <p className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-amber-600'>
                  <Archive size={12} />
                  Moved to backlog
                </p>
                <p className='text-[12px] leading-[18px] text-muted-foreground'>
                  This step is deferred — dependent steps can continue, but the run waits for it.
                </p>
                <FlowStepCompletionInfo ticketId={ticket.id} stage='BACKLOG' />
              </div>
            )}
          </>
        ) : (
          <div className='rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3'>
            <p className='text-[12px] text-muted-foreground leading-[18px]'>
              {isRoot
                ? 'No run yet. Create a ticket on this board to start a run.'
                : skipped
                  ? skipReason === 'decision'
                    ? 'This step was not reached because another decision path was chosen.'
                    : 'This step was not reached because an earlier step was cancelled.'
                  : planNode.parentIds.length > 1
                    ? 'This step is To Do. It is created automatically once ALL of its parent steps complete.'
                    : 'This step is To Do. It is created automatically when its parent completes.'}
            </p>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </div>
  );
};
