import { ReactElement, ReactNode, useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, X, Ticket, UserCheck, GitPullRequest, GitBranch, GitMerge } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge/Badge';
import { Switch } from '../../../components/ui/Switch';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { BoardType } from '@xyne/shared';

interface BoardStageInfo {
  id: string;
  name: string;
  eta: number | null;
  sequenceNumber: number;
}

interface BoardRolesConfigScreenProps {
  boardId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  onBack?: () => void;
}

// ─── Role color derivation ─────────────────────────────────────────────────
// Roles are workspace-defined, so we hash the name to a stable hue and pick
// from a curated palette matching the design.
const ROLE_PALETTE = [
  '#185FA5',
  '#0F6E56',
  '#534AB7',
  '#BA7517',
  '#993556',
  '#993C1D',
  '#1F7A8C',
  '#6B4E9E',
];

const roleColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return ROLE_PALETTE[Math.abs(hash) % ROLE_PALETTE.length] ?? '#185FA5';
};

const RoleDot = ({ name, size = 8 }: { name: string; size?: number }) => (
  <span
    className='rounded-full shrink-0 inline-block'
    style={{ width: size, height: size, background: roleColor(name) }}
  />
);

// ─── Section column header ───────────────────────────────────────────────────
interface ColumnProps {
  icon: ReactElement;
  iconClass: string;
  title: string;
  description: string;
  children: ReactNode;
}

const Column = ({ icon, iconClass, title, description, children }: ColumnProps) => (
  <div className='flex flex-col'>
    <div className='px-4 py-3 border-b border-border flex items-start gap-2.5'>
      <div
        className={cn('w-8 h-8 rounded-md flex items-center justify-center shrink-0', iconClass)}
      >
        {icon}
      </div>
      <div className='min-w-0'>
        <h3 className='text-sm font-medium text-foreground mb-0.5'>{title}</h3>
        <p className='text-xs text-muted-foreground leading-[1.5]'>{description}</p>
      </div>
    </div>
    <div className='p-3 flex flex-col gap-2 flex-1'>{children}</div>
  </div>
);

// ─── Role tag row (multi-select chip) ──────────────────────────────────────
interface RoleTagProps {
  name: string;
  onRemove: () => void;
}

const RoleTag = ({ name, onRemove }: RoleTagProps) => (
  <div className='flex items-center gap-2 px-2.5 py-2 border border-border rounded-md hover:bg-muted/40 transition-colors'>
    <RoleDot name={name} />
    <span className='text-sm font-medium flex-1 text-foreground truncate'>{name}</span>
    <button
      type='button'
      onClick={onRemove}
      aria-label={`Remove ${name}`}
      data-track-category='BOARD_ROLE_CONFIG'
      data-track-name='REMOVE_TICKET_CONTROL_ROLE'
      className='w-5 h-5 flex items-center justify-center text-muted-foreground hover:bg-red-50 hover:text-red-500 rounded transition-colors'
    >
      <X size={14} />
    </button>
  </div>
);

// ─── Primary row (auto-assign with radio) ───────────────────────────────────
interface PrimaryRowProps {
  name: string;
  isPrimary: boolean;
  onSetPrimary: () => void;
  onRemove: () => void;
}

const PrimaryRow = ({ name, isPrimary, onSetPrimary, onRemove }: PrimaryRowProps) => (
  <div className='flex items-center gap-2 px-2.5 py-2 border border-border rounded-md hover:bg-muted/40 transition-colors'>
    <RoleDot name={name} />
    <span className='text-sm font-medium flex-1 text-foreground truncate'>{name}</span>
    <label
      className={cn(
        'flex items-center gap-1 text-xs cursor-pointer select-none',
        isPrimary ? 'text-[#185FA5] font-medium' : 'text-muted-foreground',
      )}
    >
      <input
        type='radio'
        name='auto-assign-primary'
        checked={isPrimary}
        onChange={onSetPrimary}
        data-track-category='BOARD_ROLE_CONFIG'
        data-track-name='SET_AUTO_ASSIGN_PRIMARY'
        className='accent-[#185FA5] cursor-pointer'
      />
      Primary
    </label>
    <button
      type='button'
      onClick={onRemove}
      aria-label={`Remove ${name}`}
      data-track-category='BOARD_ROLE_CONFIG'
      data-track-name='REMOVE_AUTO_ASSIGN_ROLE'
      className='w-5 h-5 flex items-center justify-center text-muted-foreground hover:bg-red-50 hover:text-red-500 rounded transition-colors'
    >
      <X size={14} />
    </button>
  </div>
);

// ─── Root component ───────────────────────────────────────────────────────────
const BoardRolesConfigScreen = ({
  boardId,
  isOpen,
  onClose,
  onSave,
  onBack,
}: BoardRolesConfigScreenProps): ReactElement | null => {
  const zero = useZero();

  const [boardFromQuery] = useCachedQuery(queries.boardFullDetailById({ boardId: boardId || '' }), {
    enabled: !!boardId,
  });
  const board = boardFromQuery;

  const [roles] = useCachedQuery(queries.roles({}));

  const [ticketControlRoleIds, setTicketControlRoleIds] = useState<string[]>([]);
  const [assignmentRoles, setAssignmentRoles] = useState<
    Array<{ roleId: string; isPrimary: boolean }>
  >([]);
  const [prOpenedRoleId, setPrOpenedRoleId] = useState<string | null>(null);
  const [prMergedRoleId, setPrMergedRoleId] = useState<string | null>(null);
  const [autoRecomputeEnabled, setAutoRecomputeEnabled] = useState(false);
  const [savingAutoRecompute, setSavingAutoRecompute] = useState(false);
  const [standardPathStageIds, setStandardPathStageIds] = useState<string[]>([]);
  const [savingStandardPath, setSavingStandardPath] = useState(false);

  useEffect(() => {
    if (board && typeof board === 'object' && 'metadata' in board) {
      const metadata = board.metadata as Record<string, unknown>;
      const etaManagement = metadata?.['etaManagement'];
      setAutoRecomputeEnabled(
        Boolean(
          etaManagement &&
          typeof etaManagement === 'object' &&
          (etaManagement as Record<string, unknown>)['autoRecomputeEnabled'] === true,
        ),
      );
      if (
        etaManagement &&
        typeof etaManagement === 'object' &&
        Array.isArray((etaManagement as Record<string, unknown>)['standardPathStageIds'])
      ) {
        setStandardPathStageIds(
          ((etaManagement as Record<string, unknown>)['standardPathStageIds'] as unknown[]).filter(
            (id): id is string => typeof id === 'string',
          ),
        );
      }
      if (Array.isArray(metadata?.['ticketControlRoleIds'])) {
        setTicketControlRoleIds(
          (metadata['ticketControlRoleIds'] as unknown[]).filter(
            (id): id is string => typeof id === 'string',
          ),
        );
      }
      if (Array.isArray(metadata?.['assignmentRoles'])) {
        const slots = (
          metadata['assignmentRoles'] as Array<{ roleId: string; isPrimary: boolean }>
        ).filter(s => s && typeof s.roleId === 'string');
        setAssignmentRoles(slots);
      }
      if (
        metadata?.['bitbucketEventRoles'] &&
        typeof metadata['bitbucketEventRoles'] === 'object'
      ) {
        const raw = metadata['bitbucketEventRoles'] as Record<string, unknown>;
        setPrOpenedRoleId(typeof raw['prOpenedRoleId'] === 'string' ? raw['prOpenedRoleId'] : null);
        setPrMergedRoleId(typeof raw['prMergedRoleId'] === 'string' ? raw['prMergedRoleId'] : null);
      }
    }
  }, [board]);

  const rolesById = useMemo(() => new Map((roles ?? []).map(r => [r.id, r])), [roles]);

  const roleOptions: SelectorOption[] = useMemo(
    () =>
      (roles ?? []).map(r => ({
        value: r.id,
        label: r.name,
        subtitle: r.description ?? null,
        icon: <RoleDot name={r.name} />,
      })),
    [roles],
  );

  const tcrAvailable = useMemo(
    () => roleOptions.filter(opt => !ticketControlRoleIds.includes(opt.value)),
    [roleOptions, ticketControlRoleIds],
  );
  const aarAvailable = useMemo(
    () => roleOptions.filter(opt => !assignmentRoles.some(s => s.roleId === opt.value)),
    [roleOptions, assignmentRoles],
  );

  const aarSetPrimary = (roleId: string) =>
    setAssignmentRoles(prev => prev.map(s => ({ ...s, isPrimary: s.roleId === roleId })));

  const aarRemove = (roleId: string) => {
    setAssignmentRoles(prev => {
      const next = prev.filter(s => s.roleId !== roleId);
      const removed = prev.find(s => s.roleId === roleId);
      if (removed?.isPrimary && next.length > 0 && next[0]) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  };

  const aarAdd = (roleId: string) =>
    setAssignmentRoles(prev => [...prev, { roleId, isPrimary: prev.length === 0 }]);

  const boardName =
    board && typeof board === 'object' && 'name' in board
      ? (board as { name?: string }).name
      : null;

  const boardType =
    board && typeof board === 'object' && 'boardType' in board
      ? (board as { boardType?: string }).boardType
      : null;

  // Offered for every board type whose forecast can actually act on the flag. RELEASE is
  // included because routeResolution forecasts it identically to DEFAULT, so automation is
  // live there and needs a way to be turned off. FLOW is excluded: its route always resolves
  // NOT_APPLICABLE, so the toggle would control nothing.
  const showAutoRecomputeToggle =
    boardType === BoardType.DEFAULT ||
    boardType === BoardType.NON_LINEAR ||
    boardType === BoardType.RELEASE;

  const handleToggleAutoRecompute = useCallback(
    async (next: boolean) => {
      if (!boardId) return;
      setSavingAutoRecompute(true);
      // Optimistic - revert on error.
      setAutoRecomputeEnabled(next);
      try {
        const result = zero.mutate(
          mutators.board.update({
            boardId,
            autoRecomputeEnabled: next,
            timestamp: Date.now(),
          }),
        );
        const res = await result.server;
        if (res.type === 'error') {
          setAutoRecomputeEnabled(!next);
          toast.error('Failed to update automatic ETA management', {
            description: res.error.message || 'You do not have permission to modify this board.',
            duration: 5000,
          });
        }
      } catch (error) {
        setAutoRecomputeEnabled(!next);
        toast.error('Failed to update automatic ETA management', {
          description: error instanceof Error ? error.message : 'An unexpected error occurred.',
          duration: 5000,
        });
      } finally {
        setSavingAutoRecompute(false);
      }
    },
    [boardId, zero],
  );

  // ─── Standard Path (NON_LINEAR forecasting overlay, PRD §6.2) ─────────────
  const boardStages: BoardStageInfo[] = useMemo(() => {
    if (!board || typeof board !== 'object' || !('stages' in board)) return [];
    const rawStages = (board as { stages?: ReadonlyArray<Record<string, unknown>> }).stages ?? [];
    return rawStages.map(s => ({
      id: s['id'] as string,
      name: s['name'] as string,
      eta: (s['eta'] as number | null) ?? null,
      sequenceNumber: s['sequenceNumber'] as number,
    }));
  }, [board]);
  const stagesById = useMemo(() => new Map(boardStages.map(s => [s.id, s])), [boardStages]);

  const standardPathAvailable: SelectorOption[] = useMemo(
    () =>
      boardStages
        .filter(s => !standardPathStageIds.includes(s.id))
        .map(s => ({
          value: s.id,
          label: s.name,
          subtitle: s.eta ? `${s.eta}h default` : 'No default estimate',
          icon: <Ticket size={14} />,
        })),
    [boardStages, standardPathStageIds],
  );

  // Approximate preview only (stage defaults, ignoring transition-specific fixed-hours
  // overrides which this modal doesn't load) - the mutator re-validates authoritatively
  // against the real transition config on save.
  const standardPathPreview = useMemo(() => {
    let totalHours = 0;
    const missingEstimateStages: string[] = [];
    for (const id of standardPathStageIds) {
      const stage = stagesById.get(id);
      if (!stage || !stage.eta || stage.eta <= 0) {
        missingEstimateStages.push(stage?.name ?? id);
      } else {
        totalHours += stage.eta;
      }
    }
    return { totalHours, missingEstimateStages };
  }, [standardPathStageIds, stagesById]);

  const spMove = (index: number, direction: -1 | 1) => {
    setStandardPathStageIds(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const spRemove = (id: string) => setStandardPathStageIds(prev => prev.filter(s => s !== id));
  const spAdd = (id: string) => setStandardPathStageIds(prev => [...prev, id]);

  const handleSaveStandardPath = useCallback(async () => {
    if (!boardId) return;
    setSavingStandardPath(true);
    try {
      const result = zero.mutate(
        mutators.board.update({
          boardId,
          autoRecomputeEnabled,
          standardPathStageIds,
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Failed to save Standard Path', {
          description: res.error.message || 'Check that the path is valid and try again.',
          duration: 6000,
        });
      } else {
        toast.success('Standard Path saved');
      }
    } catch (error) {
      toast.error('Failed to save Standard Path', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        duration: 6000,
      });
    } finally {
      setSavingStandardPath(false);
    }
  }, [boardId, autoRecomputeEnabled, standardPathStageIds, zero]);

  const handleSave = useCallback(async () => {
    if (!boardId) return;
    try {
      const existingMetadata =
        board && typeof board === 'object' && 'metadata' in board
          ? (board.metadata as Record<string, unknown>)
          : {};

      const mutatorArgs = {
        boardId,
        name:
          board && typeof board === 'object' && 'name' in board
            ? (board as { name?: string }).name || ''
            : '',
        metadata: {
          ...existingMetadata,
          ticketControlRoleIds,
          assignmentRoles,
          bitbucketEventRoles: {
            ...(prOpenedRoleId ? { prOpenedRoleId } : {}),
            ...(prMergedRoleId ? { prMergedRoleId } : {}),
          },
        },
        timestamp: Date.now(),
      };

      const result = zero.mutate(mutators.board.update(mutatorArgs));
      const res = await result.server;

      if (res.type === 'error') {
        toast.error('Failed to update role config', {
          description: res.error.message || 'You do not have permission to modify this board.',
          duration: 5000,
        });
      } else {
        toast.success('Board roles updated successfully');
        onSave?.();
        onClose();
      }
    } catch (error) {
      toast.error('Failed to update role config', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        duration: 5000,
      });
    }
  }, [
    boardId,
    board,
    ticketControlRoleIds,
    assignmentRoles,
    prOpenedRoleId,
    prMergedRoleId,
    zero,
    onSave,
    onClose,
  ]);

  if (!isOpen) return null;

  const loading = board === undefined;

  if (loading) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-background rounded-lg p-8 flex flex-col items-center gap-3'>
          <div className='w-8 h-8 rounded-full border-2 border-[#185FA5]/30 border-t-[#185FA5] animate-spin' />
          <p className='text-sm text-muted-foreground'>Loading board...</p>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-background rounded-lg p-8 text-center'>
          <p className='text-muted-foreground mb-4'>Board not found</p>
          <Button
            onClick={onClose}
            data-track-category='BOARD_ROLE_CONFIG'
            data-track-name='CLOSE_BOARD_ROLES'
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-background flex flex-col w-[90vw] h-[85vh] rounded-lg shadow-xl overflow-hidden border border-border'>
        {/* ── Top bar ── */}
        <header className='flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0'>
          <div className='flex items-center gap-2 min-w-0'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => (onBack ? onBack() : onClose())}
              data-track-category='BOARD_ROLE_CONFIG'
              data-track-name='BOARD_ROLES_BACK'
            >
              <ArrowLeft size={15} /> Back
            </Button>
            <span className='text-sm font-medium text-foreground truncate'>Configure roles</span>
            {boardName && <Badge variant='secondary'>{boardName}</Badge>}
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='secondary'
              onClick={onClose}
              data-track-category='BOARD_ROLE_CONFIG'
              data-track-name='CANCEL_BOARD_ROLES'
            >
              Cancel
            </Button>
            <Button
              className='bg-[#185FA5] hover:bg-[#0C447C] text-white'
              onClick={() => void handleSave()}
              data-track-category='BOARD_ROLE_CONFIG'
              data-track-name='SAVE_BOARD_ROLES'
            >
              Finish
            </Button>
          </div>
        </header>

        {showAutoRecomputeToggle && (
          <div className='flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0'>
            <div className='min-w-0'>
              <h3 className='text-sm font-medium text-foreground mb-0.5'>
                Automatic ETA management
              </h3>
              <p className='text-xs text-muted-foreground leading-[1.5]'>
                Extend the ticket due date automatically when a stage forecast runs later than the
                current commitment. Never shortens an existing due date. Changes apply to tickets on
                their next stage move or estimate change, not retroactively.
              </p>
            </div>
            <Switch
              checked={autoRecomputeEnabled}
              onCheckedChange={value => void handleToggleAutoRecompute(value)}
              disabled={savingAutoRecompute}
              aria-label='Automatic ETA management'
              id='auto-eta-management-toggle'
            />
          </div>
        )}

        {boardType === BoardType.NON_LINEAR && (
          <div className='px-4 py-3 border-b border-border flex-shrink-0'>
            <div className='flex items-start justify-between gap-4 mb-3'>
              <div className='min-w-0'>
                <h3 className='text-sm font-medium text-foreground mb-0.5'>Standard Path</h3>
                <p className='text-xs text-muted-foreground leading-[1.5]'>
                  An expected route through this board, used only to forecast ticket due dates - it
                  never restricts which stage moves are actually allowed. Must start with a
                  non-terminal stage, include a To Do/Started/Completed stage, and end Completed.
                </p>
              </div>
              <Button
                variant='secondary'
                onClick={() => void handleSaveStandardPath()}
                disabled={savingStandardPath || standardPathStageIds.length === 0}
              >
                {savingStandardPath ? 'Saving...' : 'Save Standard Path'}
              </Button>
            </div>

            <div className='flex flex-col gap-1.5 mb-2'>
              {standardPathStageIds.map((id, index) => {
                const stage = stagesById.get(id);
                return (
                  <div
                    key={`${id}-${index}`}
                    className='flex items-center gap-2 px-2.5 py-2 border border-border rounded-md'
                  >
                    <span className='text-xs text-muted-foreground w-5 text-right'>
                      {index + 1}
                    </span>
                    <span className='text-sm font-medium flex-1 text-foreground truncate'>
                      {stage?.name ?? id}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {stage?.eta ? `${stage.eta}h` : 'no estimate'}
                    </span>
                    <button
                      type='button'
                      onClick={() => spMove(index, -1)}
                      disabled={index === 0}
                      aria-label='Move up'
                      className='w-5 h-5 flex items-center justify-center text-muted-foreground hover:bg-muted rounded disabled:opacity-30'
                      data-track-category='BOARD_ROLE_CONFIG'
                      data-track-name='MOVE_STANDARD_PATH_STAGE_UP'
                    >
                      ↑
                    </button>
                    <button
                      type='button'
                      onClick={() => spMove(index, 1)}
                      disabled={index === standardPathStageIds.length - 1}
                      aria-label='Move down'
                      className='w-5 h-5 flex items-center justify-center text-muted-foreground hover:bg-muted rounded disabled:opacity-30'
                      data-track-category='BOARD_ROLE_CONFIG'
                      data-track-name='MOVE_STANDARD_PATH_STAGE_DOWN'
                    >
                      ↓
                    </button>
                    <button
                      type='button'
                      onClick={() => spRemove(id)}
                      aria-label={`Remove ${stage?.name ?? id}`}
                      className='w-5 h-5 flex items-center justify-center text-muted-foreground hover:bg-red-50 hover:text-red-500 rounded'
                      data-track-category='BOARD_ROLE_CONFIG'
                      data-track-name='REMOVE_STANDARD_PATH_STAGE'
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            <EntitySelector
              options={standardPathAvailable}
              selectedValue={null}
              onSelect={value => {
                if (value) spAdd(value);
              }}
              placeholder='Add stage to Standard Path'
              searchPlaceholder='Search stages...'
              showSearch={true}
              width='100%'
              testId='standard-path-stage-picker'
            />

            {standardPathStageIds.length > 0 && (
              <div className='mt-2 text-xs text-muted-foreground'>
                Approximate total: {standardPathPreview.totalHours}h across{' '}
                {standardPathStageIds.length} stage
                {standardPathStageIds.length === 1 ? '' : 's'} (stage defaults only - fixed-hour
                transition overrides are resolved when you save).
                {standardPathPreview.missingEstimateStages.length > 0 && (
                  <span className='block mt-1 text-amber-600'>
                    Missing estimate: {standardPathPreview.missingEstimateStages.join(', ')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 3-column layout ── */}
        <div className='flex-1 overflow-y-auto'>
          <div className='grid min-h-full' style={{ gridTemplateColumns: '1fr 1px 1fr 1px 1fr' }}>
            {/* Col 1: Ticket Control Roles */}
            <Column
              icon={<Ticket size={16} />}
              iconClass='bg-[#E6F1FB] text-[#185FA5]'
              title='Ticket control roles'
              description='Roles allowed to change assignee, ETA, stage, or board. Empty = unrestricted.'
            >
              {ticketControlRoleIds.map(roleId => {
                const role = rolesById.get(roleId);
                return (
                  <RoleTag
                    key={roleId}
                    name={role?.name ?? roleId}
                    onRemove={() => setTicketControlRoleIds(prev => prev.filter(r => r !== roleId))}
                  />
                );
              })}
              <EntitySelector
                options={tcrAvailable}
                selectedValue={null}
                onSelect={value => {
                  if (value) setTicketControlRoleIds(prev => [...prev, value]);
                }}
                placeholder='Add ticket control role'
                searchPlaceholder='Search roles...'
                showSearch={true}
                width='100%'
                testId='ticket-control-roles-picker'
              />
            </Column>

            <div className='bg-border' />

            {/* Col 2: Auto-Assign Roles */}
            <Column
              icon={<UserCheck size={16} />}
              iconClass='bg-[#E1F5EE] text-[#0F6E56]'
              title='Auto-assign roles'
              description='One user per role is picked per ticket. Mark one as primary to set the ticket assignee.'
            >
              {assignmentRoles.map(slot => {
                const role = rolesById.get(slot.roleId);
                return (
                  <PrimaryRow
                    key={slot.roleId}
                    name={role?.name ?? slot.roleId}
                    isPrimary={slot.isPrimary}
                    onSetPrimary={() => aarSetPrimary(slot.roleId)}
                    onRemove={() => aarRemove(slot.roleId)}
                  />
                );
              })}
              <EntitySelector
                options={aarAvailable}
                selectedValue={null}
                onSelect={value => {
                  if (value) aarAdd(value);
                }}
                placeholder='Add role to auto-assign'
                searchPlaceholder='Search roles...'
                showSearch={true}
                width='100%'
                testId='auto-assign-roles-picker'
              />
            </Column>

            <div className='bg-border' />

            {/* Col 3: PR Event Roles */}
            <Column
              icon={<GitPullRequest size={16} />}
              iconClass='bg-[#EEEDFE] text-[#534AB7]'
              title='PR event roles'
              description='Role to auto-assign when Bitbucket PR events fire on this board.'
            >
              <div className='border border-border rounded-md overflow-hidden'>
                <div className='px-3 py-2 bg-muted/40 border-b border-border flex items-center gap-1.5'>
                  <GitBranch size={14} className='text-muted-foreground' />
                  <span className='text-xs font-medium text-muted-foreground'>
                    PR opened / updated
                  </span>
                </div>
                <div className='p-2.5'>
                  <EntitySelector
                    options={roleOptions}
                    selectedValue={prOpenedRoleId}
                    onSelect={setPrOpenedRoleId}
                    placeholder='Select role'
                    searchPlaceholder='Search roles...'
                    showSearch={true}
                    width='100%'
                    showClearButton
                    testId='pr-opened-role-picker'
                  />
                </div>
              </div>

              <div className='border border-border rounded-md overflow-hidden'>
                <div className='px-3 py-2 bg-muted/40 border-b border-border flex items-center gap-1.5'>
                  <GitMerge size={14} className='text-muted-foreground' />
                  <span className='text-xs font-medium text-muted-foreground'>PR merged</span>
                </div>
                <div className='p-2.5'>
                  <EntitySelector
                    options={roleOptions}
                    selectedValue={prMergedRoleId}
                    onSelect={setPrMergedRoleId}
                    placeholder='Select role'
                    searchPlaceholder='Search roles...'
                    showSearch={true}
                    width='100%'
                    showClearButton
                    testId='pr-merged-role-picker'
                  />
                </div>
              </div>
            </Column>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BoardRolesConfigScreen;
