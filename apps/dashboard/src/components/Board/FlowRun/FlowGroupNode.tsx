import React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  Boxes,
  MoreHorizontal,
  X,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Tooltip from '../../ui/Tooltip';

/** Palette cycled per group so neighbouring groups read apart at a glance. */
const GROUP_COLORS = [
  '#8b5cf6', // violet
  '#0ea5e9', // sky
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
];

/** Deterministic color for a group — hash of its id, stable across reorders. */
export const flowGroupColor = (groupId: string): string => {
  let hash = 0;
  for (let i = 0; i < groupId.length; i += 1) {
    hash = (hash * 31 + groupId.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length]!;
};

export interface FlowGroupMemberLine {
  id: string;
  title: string;
  memberCount?: number;
  status?: React.ReactNode;
}

export interface FlowGroupNodeData {
  name: string;
  memberCount: number;
  color: string;
  /** Collapsed: the group renders as a single cover box listing its member
      steps one per line in flow order; edges connect to the cover itself. */
  collapsed: boolean;
  members?: FlowGroupMemberLine[];
  status?: React.ReactNode;
  validationWarning?: string;
  skipped?: boolean;
  notStarted?: boolean;
  connectable?: boolean;
  onToggleCollapse?: () => void;
  onMoveToBacklog?: () => void;
  backlogDisabledReason?: string;
  backlogPending?: boolean;
  onRename?: (name: string) => void;
  onUngroup?: () => void;
}

const MEMBER_LINE_HEIGHT = 24;
const COLLAPSED_HEADER_HEIGHT = 34;

export const GROUP_INPUT_HANDLE = 'group-input';
export const GROUP_OUTPUT_HANDLE = 'group-output';
export const GROUP_ENTRY_HANDLE = 'entry';
export const GROUP_EXIT_HANDLE = 'exit';

export const collapsedGroupCoverHeight = (memberCount: number): number =>
  COLLAPSED_HEADER_HEIGHT + 12 + memberCount * MEMBER_LINE_HEIGHT;

const coverHandles = (connectable: boolean, color: string): React.ReactNode => (
  <>
    <Handle
      id={GROUP_INPUT_HANDLE}
      type='target'
      position={Position.Top}
      isConnectable={connectable}
      className='!w-3 !h-3 !border-2 !border-background !rounded-full'
      style={{ top: -7, background: color }}
    />
    <Handle
      id={GROUP_OUTPUT_HANDLE}
      type='source'
      position={Position.Bottom}
      isConnectable={connectable}
      className='!w-3 !h-3 !border-2 !border-background !rounded-full'
      style={{ bottom: -7, background: color }}
    />
  </>
);

/**
 * Internal flow handles, expanded cover only: `entry` fans out from the top
 * border into entry members; terminal members flow into `exit` on the bottom
 * border. The Position prop is the edge tangent (flow always runs downward),
 * the style pins each handle to the opposite border.
 */
const coverFlowHandles = (color: string): React.ReactNode => (
  <>
    <Handle
      id={GROUP_ENTRY_HANDLE}
      type='source'
      position={Position.Bottom}
      isConnectable={false}
      className='!w-3 !h-3 !border-2 !border-background !rounded-full'
      style={{ top: -7, bottom: 'auto', background: color, pointerEvents: 'none' }}
    />
    <Handle
      id={GROUP_EXIT_HANDLE}
      type='target'
      position={Position.Top}
      isConnectable={false}
      className='!w-3 !h-3 !border-2 !border-background !rounded-full'
      style={{ bottom: -7, top: 'auto', background: color, pointerEvents: 'none' }}
    />
  </>
);

/** React Flow cover that makes a step group one outer-DAG entity. */
export const FlowGroupNode: React.FC<NodeProps<FlowGroupNodeData>> = ({ data, selected }) => {
  const {
    name,
    memberCount,
    color,
    collapsed,
    members,
    status,
    validationWarning,
    skipped = false,
    notStarted = false,
    connectable = false,
    onToggleCollapse,
    onMoveToBacklog,
    backlogDisabledReason,
    backlogPending = false,
    onRename,
    onUngroup,
  } = data;
  const neutral = skipped || notStarted;
  const displayColor = neutral ? 'hsl(var(--muted-foreground))' : color;
  const canToggleFromHeader = !!onToggleCollapse && !onRename;
  const handleHeaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!canToggleFromHeader || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onToggleCollapse();
  };

  const badge = (
    <span
      className='shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium'
      style={{ backgroundColor: `${displayColor}1a`, color: displayColor }}
    >
      {memberCount}
    </span>
  );
  const groupMenu = onMoveToBacklog ? (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type='button'
          title='Group actions'
          aria-label={`Actions for ${name || 'group'}`}
          data-track-category='flow_board'
          data-track-name='open_group_actions'
          className='nodrag shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground'
          onClick={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={6}
          align='end'
          className='z-50 min-w-[230px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
        >
          <DropdownMenu.Item
            disabled={!!backlogDisabledReason || backlogPending}
            onSelect={onMoveToBacklog}
            title={backlogDisabledReason}
            data-track-category='flow_board'
            data-track-name='backlog_group'
            className='flex cursor-pointer select-none items-start gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60'
          >
            <Archive size={13} className='mt-0.5 shrink-0 text-amber-600' />
            <span className='flex min-w-0 flex-col'>
              <span>{backlogPending ? 'Moving to backlog…' : 'Move group to backlog'}</span>
              {backlogDisabledReason && (
                <span className='mt-0.5 max-w-[200px] text-[10px] leading-4 text-muted-foreground'>
                  {backlogDisabledReason}
                </span>
              )}
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ) : null;

  if (collapsed) {
    return (
      // pointer-events-auto: React Flow disables pointer events on wrappers of
      // non-draggable, non-selectable nodes — keep the cover clickable either way.
      <div
        className='pointer-events-auto h-full w-full cursor-pointer rounded-xl border-2 shadow-sm transition-colors'
        style={{
          borderColor: neutral ? 'hsl(var(--border))' : `${color}80`,
          backgroundColor: neutral ? 'hsl(var(--muted))' : `${color}14`,
          borderStyle: neutral ? 'dashed' : 'solid',
        }}
      >
        {coverHandles(connectable, displayColor)}
        <button
          type='button'
          onClick={onToggleCollapse}
          data-track-category='flow_board'
          data-track-name='toggle_group_collapse'
          className='block h-full w-full rounded-[10px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        >
          <span
            className='flex items-center gap-2 border-b px-3 py-2'
            style={{ borderColor: neutral ? 'hsl(var(--border))' : `${color}33` }}
          >
            <Boxes size={13} className='shrink-0' style={{ color: displayColor }} />
            <Tooltip content={name || 'Group'} side='top' delayDuration={300}>
              <span
                className='min-w-0 flex-1 truncate text-[12px] font-semibold'
                style={{ color: displayColor }}
              >
                {name || 'Group'}
              </span>
            </Tooltip>
            {validationWarning && (
              <span
                className='flex shrink-0 items-center text-amber-500'
                title={validationWarning}
                aria-label={validationWarning}
              >
                <AlertTriangle size={12} />
              </span>
            )}
            {badge}
            {status}
            <ChevronRight size={13} className='shrink-0' style={{ color: displayColor }} />
          </span>
          <span className='flex flex-col px-3 py-1.5'>
            {(members ?? []).map(member => (
              <span key={member.id} className='flex h-[24px] items-center gap-2'>
                <Tooltip content={member.title || 'Untitled step'} side='top' delayDuration={300}>
                  <span className='min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/80'>
                    {member.title || 'Untitled step'}
                  </span>
                </Tooltip>
                {member.memberCount !== undefined && (
                  <span
                    className='flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium'
                    style={{ backgroundColor: `${displayColor}1a`, color: displayColor }}
                    title={`${member.memberCount} stages`}
                  >
                    {member.memberCount}
                  </span>
                )}
                {member.status}
              </span>
            ))}
          </span>
        </button>
      </div>
    );
  }

  return (
    // pointer-events-auto: same wrapper caveat as above — the run view's
    // cover is neither draggable nor selectable, so without it the collapse
    // chevron is dead.
    <div
      className='pointer-events-auto h-full w-full rounded-2xl border-2 transition-colors'
      style={{
        borderColor: neutral ? 'hsl(var(--border))' : selected ? color : `${color}66`,
        backgroundColor: neutral ? 'hsl(var(--muted))' : `${color}0d`,
        borderStyle: neutral ? 'dashed' : 'solid',
      }}
    >
      {coverHandles(connectable, displayColor)}
      {coverFlowHandles(displayColor)}
      <div
        className={`flex items-center gap-1.5 px-3 py-2 ${canToggleFromHeader ? 'cursor-pointer hover:bg-black/[0.025]' : ''}`}
        role={canToggleFromHeader ? 'button' : undefined}
        tabIndex={canToggleFromHeader ? 0 : undefined}
        aria-label={canToggleFromHeader ? `Collapse ${name || 'group'}` : undefined}
        onClick={canToggleFromHeader ? onToggleCollapse : undefined}
        onKeyDown={handleHeaderKeyDown}
        data-track-category='flow_board'
        data-track-name='toggle_group_collapse_header'
      >
        <Boxes size={13} className='shrink-0' style={{ color: displayColor }} />
        {onRename ? (
          <input
            type='text'
            value={name}
            onChange={e => onRename(e.target.value)}
            placeholder='Group name'
            data-track-category='flow_plan_editor'
            data-track-name='input_group_name'
            className='nodrag min-w-0 flex-1 bg-transparent text-[12px] font-semibold placeholder:opacity-50 focus:outline-none'
            style={{ color: displayColor }}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <Tooltip content={name || 'Group'} side='top' delayDuration={300}>
            <span
              className='min-w-0 flex-1 truncate text-[12px] font-semibold'
              style={{ color: displayColor }}
            >
              {name || 'Group'}
            </span>
          </Tooltip>
        )}
        {validationWarning && (
          <span
            className='flex shrink-0 items-center text-amber-500'
            title={validationWarning}
            aria-label={validationWarning}
          >
            <AlertTriangle size={12} />
          </span>
        )}
        {badge}
        {status}
        {groupMenu}
        {onToggleCollapse && (
          <button
            type='button'
            onClick={event => {
              event.stopPropagation();
              onToggleCollapse();
            }}
            title='Collapse group'
            data-track-category='flow_board'
            data-track-name='toggle_group_collapse'
            className='nodrag shrink-0 rounded p-0.5 transition-colors hover:bg-black/5'
            style={{ color: displayColor }}
            onPointerDown={e => e.stopPropagation()}
          >
            <ChevronDown size={13} />
          </button>
        )}
        {onUngroup && (
          <button
            type='button'
            onClick={onUngroup}
            title='Ungroup steps'
            data-track-category='flow_plan_editor'
            data-track-name='ungroup'
            className='nodrag shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100'
            style={{ color: displayColor }}
            onPointerDown={e => e.stopPropagation()}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
};
