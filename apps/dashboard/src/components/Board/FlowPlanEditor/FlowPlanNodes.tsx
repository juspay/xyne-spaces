import React, { useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  FileText,
  GitFork,
  Plus,
  Settings2,
  Ticket,
  Trash2,
  UserCheck,
  UserPlus,
  Search,
  X,
} from 'lucide-react';
import type { FlowPlanDecision, FlowPlanNode, FlowStepGate } from '@xyne/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import UserAvatar, { AvatarSize } from '../../UserAvatar/UserAvatar';
import { useActiveUsers } from '../../../hooks/useUsers';
import { getUserDisplayName, matchesUserQuery } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { FlowGroupNode, type FlowGroupNodeData } from '../FlowRun/FlowGroupNode';
import { Popover } from '../../ui/Popover/Popover';

export type AddStepKind = FlowStepGate['type'] | 'group' | 'decision';

export interface PlanNodeData {
  planNode: FlowPlanNode | null;
  detached: boolean;
  onUpdate: (patch: Partial<FlowPlanNode>) => void;
  onDelete: () => void;
  onAddStep: (kind: AddStepKind) => void;
  onConfigure: () => void;
  configuring: boolean;
  readOnly: boolean;
  canAddGroup: boolean;
  canAddDecision: boolean;
  routesThroughDecision: boolean;
  validationWarning?: string;
}

interface DecisionNodeData {
  decision: FlowPlanDecision;
  onConfigure: () => void;
  onDelete: () => void;
  configuring: boolean;
  readOnly: boolean;
  validationWarning?: string;
}

export type EditorNodeData = PlanNodeData | FlowGroupNodeData | DecisionNodeData;

export const DEFAULT_GATE: FlowStepGate = { type: 'confirmation' };

export function gateOf(node: FlowPlanNode): FlowStepGate {
  return node.gate ?? DEFAULT_GATE;
}

const AssigneeSummary: React.FC<{ userId: string | null }> = ({ userId }) => {
  const users = useActiveUsers();
  const assigneeId = userId?.replace(/^(user:|group:)/, '') || '';
  if (!assigneeId) return <span className='text-muted-foreground'>Unassigned</span>;
  const user = users?.find(candidate => candidate.id === assigneeId);
  return (
    <span className='flex items-center gap-1.5 min-w-0 font-medium text-foreground'>
      <UserAvatar userId={assigneeId} showActiveStatus={false} size={AvatarSize.SM} />
      <span className='truncate'>{user ? getUserDisplayName(user) : '…'}</span>
    </span>
  );
};

export const StepAssigneePicker: React.FC<{
  value: string | null;
  onChange: (userId: string | null) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const users = useActiveUsers();
  const assigneeId = value?.replace(/^(user:|group:)/, '') || '';
  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter(user => matchesUserQuery(user, search));
  }, [users, search]);
  const pick = (userId: string | null): void => {
    onChange(userId);
    setOpen(false);
    setSearch('');
  };
  const assignee = users?.find(candidate => candidate.id === assigneeId);

  return (
    <Popover
      trigger={
        <button
          type='button'
          onClick={event => {
            event.stopPropagation();
            setOpen(previous => !previous);
          }}
          className='flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-[12px] hover:bg-muted transition-colors'
          title={assigneeId ? 'Change default assignee' : 'Set default assignee for this step'}
          data-track-category='flow_plan_editor'
          data-track-name='toggle_step_assignee'
        >
          {assigneeId ? (
            <UserAvatar userId={assigneeId} showActiveStatus={false} size={AvatarSize.SM} />
          ) : (
            <span className='inline-flex items-center justify-center w-5 h-5 rounded-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground'>
              <UserPlus className='w-3 h-3' />
            </span>
          )}
          <span
            className={cn(
              'flex-1 min-w-0 truncate text-left',
              assigneeId ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {assigneeId ? (assignee ? getUserDisplayName(assignee) : '…') : 'Unassigned'}
          </span>
        </button>
      }
      open={open}
      onOpenChange={setOpen}
      modal
      align='end'
      sideOffset={4}
      className='p-0 w-64 z-[9999]'
    >
      <div className='flex flex-col max-h-72'>
        <div className='p-2 border-b border-border'>
          <div className='relative'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground' />
            <input
              type='text'
              placeholder='Search users...'
              value={search}
              onChange={event => setSearch(event.target.value)}
              className='w-full pl-8 pr-2 py-1.5 border border-input rounded-md bg-background text-xs text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none'
              data-track-category='flow_plan_editor'
              data-track-name='search_step_assignee'
            />
          </div>
        </div>
        <div className='overflow-y-auto flex-1'>
          <button
            type='button'
            onClick={event => {
              event.stopPropagation();
              pick(null);
            }}
            className={cn(
              'w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2',
              !assigneeId && 'bg-muted',
            )}
            data-track-category='flow_plan_editor'
            data-track-name='clear_step_assignee'
          >
            <span className='flex items-center justify-center w-5 h-5 rounded-sm bg-border'>
              <X className='w-3 h-3 text-muted-foreground' />
            </span>
            <span className='text-foreground'>Unassigned</span>
          </button>
          {filteredUsers.map(user => (
            <button
              key={user.id}
              type='button'
              onClick={event => {
                event.stopPropagation();
                pick(user.id);
              }}
              className={cn(
                'w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2',
                assigneeId === user.id && 'bg-muted',
              )}
              data-track-category='flow_plan_editor'
              data-track-name='select_step_assignee'
            >
              <UserAvatar userId={user.id} showActiveStatus={false} size={AvatarSize.SM} />
              <div className='flex-1 min-w-0'>
                <div className='text-foreground truncate'>{getUserDisplayName(user)}</div>
                {user.email ? (
                  <div className='text-[10px] text-muted-foreground truncate'>{user.email}</div>
                ) : null}
              </div>
            </button>
          ))}
          {filteredUsers.length === 0 && (
            <div className='px-3 py-3 text-xs text-muted-foreground text-center'>
              No users found
            </div>
          )}
        </div>
      </div>
    </Popover>
  );
};

const PlanNodeCard: React.FC<NodeProps<PlanNodeData>> = ({ data, selected }) => {
  const { planNode, onUpdate, onDelete, onAddStep, onConfigure, readOnly } = data;
  const isRoot = planNode === null;
  const warning =
    data.validationWarning ??
    (data.detached ? 'Not connected to the flow — connect it before saving' : undefined);

  return (
    <div
      className={`w-[240px] bg-background rounded-[10px] border-2 shadow-[0px_2px_8px_0px_rgba(5,5,6,0.07)] transition-all ${
        selected
          ? 'border-[#6276be]'
          : warning
            ? 'border-amber-400'
            : isRoot
              ? 'border-[#6276be]/50'
              : 'border-border'
      }`}
    >
      {!isRoot && (
        <Handle
          type='target'
          position={Position.Top}
          isConnectable={!readOnly}
          className='!w-3 !h-3 !bg-[#6276be] !border-2 !border-background !rounded-full'
          style={{ top: -7 }}
        />
      )}
      <Handle
        type='source'
        position={Position.Bottom}
        isConnectable={!readOnly}
        className='!w-3 !h-3 !bg-[#6276be] !border-2 !border-background !rounded-full'
        style={{ bottom: -7 }}
      />

      <div className='flex items-center justify-between px-3 py-2 border-b border-border'>
        <span className='flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.5px]'>
          <Ticket size={12} className='text-[#6276be]' />
          {isRoot ? 'Main ticket' : 'Sub ticket'}
        </span>
        {!isRoot && (
          <div className='flex items-center gap-1 nodrag' onPointerDown={e => e.stopPropagation()}>
            {warning && (
              <span
                className='flex items-center text-amber-500'
                title={warning}
                aria-label={warning}
              >
                <AlertTriangle size={12} />
              </span>
            )}
            {!readOnly && (
              <>
                <button
                  type='button'
                  onClick={onConfigure}
                  data-track-category='flow_plan_editor'
                  data-track-name='configure_step_gate'
                  className={`p-1 rounded-md transition-colors ${
                    data.configuring
                      ? 'bg-[#6276be] text-white'
                      : 'hover:bg-muted text-muted-foreground hover:text-[#6276be]'
                  }`}
                  title='Configure what this step waits on'
                >
                  <Settings2 size={12} />
                </button>
                <button
                  type='button'
                  onClick={onDelete}
                  data-track-category='flow_plan_editor'
                  data-track-name='delete_step'
                  className='p-1 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors'
                  title='Delete step'
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className='px-3 py-3'>
        {isRoot ? (
          <p className='text-[12px] text-muted-foreground leading-[18px]'>
            Each run starts from a main ticket. Steps below it are created as the run progresses.
          </p>
        ) : (
          <>
            <input
              type='text'
              value={planNode.title}
              readOnly={readOnly}
              onChange={e => onUpdate({ title: e.target.value })}
              placeholder='Step title...'
              data-track-category='flow_plan_editor'
              data-track-name='input_step_title'
              className='nodrag w-full text-[13px] font-medium text-foreground bg-transparent border-none focus:outline-none'
              onPointerDown={e => e.stopPropagation()}
            />
            <div className='mt-2 flex flex-col gap-1 text-[11px]'>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-muted-foreground'>Waits for</span>
                <span className='flex items-center gap-1 font-medium text-foreground'>
                  {gateOf(planNode).type === 'form' ? (
                    <>
                      <FileText size={11} className='text-[#6276be]' /> Form
                    </>
                  ) : (
                    <>
                      <UserCheck size={11} className='text-[#6276be]' /> Confirmation
                    </>
                  )}
                </span>
              </div>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-muted-foreground'>Assignee</span>
                <AssigneeSummary userId={planNode.assignedTo ?? null} />
              </div>
            </div>
          </>
        )}
      </div>

      {!readOnly && !data.routesThroughDecision && (
        <div className='px-3 pb-2.5'>
          <DropdownMenu>
            <DropdownMenuTrigger
              className='nodrag flex items-center gap-1.5 w-full justify-center border border-dashed border-[#6276be]/50 hover:border-[#6276be] rounded-lg px-2 py-1 text-[11px] text-[#6276be] hover:text-[#4f61a8] font-medium transition-colors outline-none'
              onPointerDown={e => e.stopPropagation()}
              data-track-category='flow_plan_editor'
              data-track-name='add_step'
            >
              <Plus size={11} /> Add step
            </DropdownMenuTrigger>
            <DropdownMenuContent align='center' sideOffset={18} className='z-[9999]'>
              {data.canAddGroup && (
                <DropdownMenuItem
                  onSelect={() => onAddStep('group')}
                  className='flex items-center gap-2'
                >
                  <Boxes size={13} className='text-[#8b5cf6]' />
                  <div className='flex flex-col'>
                    <span className='text-[12px] font-medium'>Group section</span>
                    <span className='text-[11px] text-muted-foreground'>
                      A sub-flow that acts as one step of the plan
                    </span>
                  </div>
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className='flex items-center gap-2'>
                  <Ticket size={13} className='text-[#6276be]' />
                  <div className='flex flex-col flex-1'>
                    <span className='text-[12px] font-medium'>Step</span>
                    <span className='text-[11px] text-muted-foreground'>
                      One ticket that waits at a gate
                    </span>
                  </div>
                  <ChevronRight size={13} className='shrink-0 text-muted-foreground' />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={10} className='z-[9999]'>
                  <DropdownMenuItem
                    onSelect={() => onAddStep('confirmation')}
                    className='flex items-center gap-2'
                  >
                    <UserCheck size={13} className='text-[#6276be]' />
                    <div className='flex flex-col'>
                      <span className='text-[12px] font-medium'>Waits for confirmation</span>
                      <span className='text-[11px] text-muted-foreground'>
                        Someone confirms before it completes
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onAddStep('form')}
                    className='flex items-center gap-2'
                  >
                    <FileText size={13} className='text-[#6276be]' />
                    <div className='flex flex-col'>
                      <span className='text-[12px] font-medium'>Waits for a form</span>
                      <span className='text-[11px] text-muted-foreground'>
                        Someone fills a form before it completes
                      </span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {data.canAddDecision && (
                <DropdownMenuItem
                  onSelect={() => onAddStep('decision')}
                  className='flex items-center gap-2'
                >
                  <GitFork size={13} className='text-amber-600' />
                  <div className='flex flex-col'>
                    <span className='text-[12px] font-medium'>Decision</span>
                    <span className='text-[11px] text-muted-foreground'>
                      Route using a required form field
                    </span>
                  </div>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
};

const DecisionNodeCard: React.FC<NodeProps<DecisionNodeData>> = ({ data, selected }) => (
  <div
    className={cn(
      'relative w-[240px] rounded-xl border-2 bg-[hsl(var(--flow-decision-bg))] shadow-[0_2px_8px_rgba(5,5,6,0.07)]',
      selected || data.configuring
        ? 'border-amber-500'
        : data.validationWarning
          ? 'border-red-400'
          : 'border-[hsl(var(--flow-decision-border))]',
    )}
  >
    <Handle
      id='decision'
      type='target'
      position={Position.Top}
      isConnectable={false}
      className='!h-3 !w-3 !rounded-full !border-2 !border-background !bg-amber-500'
      style={{ top: -7 }}
    />
    <div className='flex items-center justify-between border-b border-[hsl(var(--flow-decision-divider))] px-3 py-2'>
      <span className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-[hsl(var(--flow-decision-fg))]'>
        <GitFork size={12} /> Decision
      </span>
      <div className='flex items-center gap-1 nodrag'>
        {data.validationWarning && (
          <span
            className='flex items-center text-amber-600'
            title={data.validationWarning}
            aria-label={data.validationWarning}
          >
            <AlertTriangle size={12} />
          </span>
        )}
        {!data.readOnly && (
          <>
            <button
              type='button'
              onClick={data.onConfigure}
              data-track-category='flow_plan_editor'
              data-track-name='configure_decision'
              className='rounded p-1 hover:bg-[hsl(var(--flow-decision-hover))]'
            >
              <Settings2 size={12} />
            </button>
            <button
              type='button'
              onClick={data.onDelete}
              data-track-category='flow_plan_editor'
              data-track-name='delete_decision'
              className='rounded p-1 hover:bg-red-50 hover:text-red-500'
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
    <div className='px-3 py-3'>
      <p className='truncate text-[12px] font-semibold text-foreground'>
        {data.decision.fieldName || 'Choose a required field'}
      </p>
      {data.decision.fieldType === 'STRING' && (
        <p className='mt-1 text-[10px] text-muted-foreground'>
          {`${data.decision.operator === 'notEquals' ? 'Does not equal' : 'Equals'} “${data.decision.comparisonValue ?? ''}”`}
        </p>
      )}
      {data.decision.routes.map((route, index) => (
        <Handle
          key={route.key}
          id={route.key}
          type='source'
          position={Position.Bottom}
          isConnectable={!data.readOnly}
          className='!h-2.5 !w-2.5 !border-2 !border-background !bg-amber-500'
          style={{
            left: `${((index + 1) / (data.decision.routes.length + 1)) * 100}%`,
            bottom: -6,
          }}
        />
      ))}
    </div>
  </div>
);

export const FLOW_PLAN_NODE_TYPES = {
  flowPlanNode: PlanNodeCard,
  flowGroupNode: FlowGroupNode,
  flowDecisionNode: DecisionNodeCard,
};
