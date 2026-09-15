import { ReactElement, useMemo } from 'react';
import Avatar from '../../ui/Avatar/Avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { AssignmentStrategy, type Board } from '@xyne/shared';
import type { User } from '../../../machines/stateMachine';
import {
  computeAssignmentScores,
  computeUsePercentageForBoard,
  type AssignmentStateLike,
  type ComplexityScoreLike,
  type ExpertiseMappingLike,
  type UserGroupMappingLike,
  type WorkloadMappingLike,
} from './AssignmentConfigScreen.utils';

const formatLastAssigned = (timestamp: number | null): string =>
  timestamp ? new Date(timestamp).toLocaleString() : 'Never';

/** Radix Select rejects an empty-string item value, so "no board filter" needs a sentinel. */
const ALL_BOARDS_VALUE = '__all_boards__';

const TABLE_HEAD_CELL =
  'px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground';

interface VisibilityTabProps {
  users: User[];
  boards: Board[];
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string | null) => void;
  workloadMappings: readonly WorkloadMappingLike[] | null | undefined;
  boardComplexityScores: readonly ComplexityScoreLike[] | null | undefined;
  expertiseMappings: readonly ExpertiseMappingLike[] | null | undefined;
  assignmentStates: readonly AssignmentStateLike[] | null | undefined;
  assignmentStrategy: AssignmentStrategy;
  isCurrentUserGroupMember: boolean;
  userGroupMappings: readonly UserGroupMappingLike[] | null | undefined;
  /** user_groups.maxWorkload — shown only when set (non-null). */
  maxWorkload: number | null | undefined;
}

/**
 * "Visibility" tab of the Assignment Configuration screen: per-user open tickets
 * ranked by the assignment method (first = next). Read-only; shares the selected
 * board with the Availability tab via `selectedBoardId` / `onSelectBoard`.
 */
export function VisibilityTab({
  users,
  boards,
  selectedBoardId,
  onSelectBoard,
  workloadMappings,
  boardComplexityScores,
  expertiseMappings,
  assignmentStates,
  assignmentStrategy,
  isCurrentUserGroupMember,
  userGroupMappings,
  maxWorkload,
}: VisibilityTabProps): ReactElement {
  const hasMaxWorkload = maxWorkload !== null && maxWorkload !== undefined;
  const isRoundRobin = assignmentStrategy === AssignmentStrategy.ROUND_ROBIN;

  const scoreRows = useMemo(
    () =>
      computeAssignmentScores({
        users,
        workloadMappings,
        boardComplexityScores,
        expertiseMappings,
        userGroupMappings,
        assignmentStates,
        boards,
        selectedBoardId,
        maxWorkload: maxWorkload ?? null,
        strategy: assignmentStrategy,
      }),
    [
      users,
      workloadMappings,
      boardComplexityScores,
      expertiseMappings,
      userGroupMappings,
      assignmentStates,
      boards,
      selectedBoardId,
      maxWorkload,
      assignmentStrategy,
    ],
  );

  const showScoreColumn = !isRoundRobin && Boolean(selectedBoardId);

  const selectedBoardName = boards.find(b => b.id === selectedBoardId)?.name;
  const hasAnyStartOffset = scoreRows.some(row => row.startOffset > 0);
  const usePercentage = computeUsePercentageForBoard(boardComplexityScores, selectedBoardId);

  if (!isCurrentUserGroupMember) {
    return (
      <div className='rounded-2xl border border-border bg-card p-8 text-center'>
        <p className='text-[13px] text-muted-foreground'>
          You need to be part of this user group to see member workloads.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Board filter (shared selection with Availability) */}
      <div className='rounded-2xl border border-border bg-card p-4'>
        <div className='flex flex-col gap-2'>
          <span className='text-[13px] font-medium text-foreground'>Filter by board</span>
          <Select
            value={selectedBoardId ?? ALL_BOARDS_VALUE}
            onValueChange={value => onSelectBoard(value === ALL_BOARDS_VALUE ? null : value)}
          >
            <SelectTrigger className='w-full max-w-[320px]' aria-label='Filter by board'>
              <SelectValue placeholder='All boards' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BOARDS_VALUE}>All boards</SelectItem>
              {boards.map(board => (
                <SelectItem key={board.id} value={board.id}>
                  {board.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-xs leading-[1.4] text-muted-foreground'>
            {isRoundRobin
              ? 'Round robin: among eligible members, whoever was assigned least recently goes next. Members never assigned come first.'
              : selectedBoardId
                ? usePercentage
                  ? 'Score = (weightedActiveTasks + coldStartOffset) − expertiseBonus − percentDiff. Lowest score is assigned next.'
                  : 'Score = (weightedActiveTasks + coldStartOffset) − expertiseBonus. Lowest score is assigned next. percentDiff is excluded because “Use percentage assignment” is off for this board.'
                : 'Pick a board to see the exact score. With “All boards”, only total open tickets and weighted load are shown.'}
          </p>
        </div>
      </div>

      {hasMaxWorkload && (
        <div className='rounded-2xl border border-border bg-card p-4'>
          <p className='text-[13px] leading-[1.5] text-foreground'>
            Max workload: <span className='font-medium'>{maxWorkload}</span>. Members at or above
            this weighted load won&apos;t receive new tickets. If everyone is at capacity, no one is
            assigned.
          </p>
        </div>
      )}

      {/* Per-user tickets + score */}
      <div className='overflow-hidden rounded-2xl border border-border bg-card'>
        <div className='overflow-x-auto'>
          <table className='min-w-full divide-y divide-border'>
            <thead className='bg-muted/50'>
              <tr>
                <th className={cn(TABLE_HEAD_CELL, 'text-left')}>User</th>
                <th className={cn(TABLE_HEAD_CELL, 'text-center')}>
                  Open Tickets
                  {selectedBoardId ? ` (${selectedBoardName})` : ' (all boards)'}
                </th>
                <th className={cn(TABLE_HEAD_CELL, 'text-center')}>Weighted Load</th>
                {hasAnyStartOffset && (
                  <th className={cn(TABLE_HEAD_CELL, 'text-center')}>Cold-Start Offset</th>
                )}
                {hasMaxWorkload && <th className={cn(TABLE_HEAD_CELL, 'text-center')}>Capacity</th>}
                {isRoundRobin && (
                  <th className={cn(TABLE_HEAD_CELL, 'text-center')}>Last Assigned</th>
                )}
                {showScoreColumn && <th className={cn(TABLE_HEAD_CELL, 'text-center')}>Score</th>}
              </tr>
            </thead>
            <tbody className='divide-y divide-border'>
              {scoreRows.map(row => (
                <tr
                  key={row.user.id}
                  className={cn(
                    'transition-colors hover:bg-muted/50',
                    row.isAtCapacity && 'bg-destructive/5',
                  )}
                >
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center'>
                      <Avatar userId={row.user.id} size='sm' showActiveStatus={false} />
                      <div className='ml-4 flex-1'>
                        <div className='text-sm font-medium text-foreground'>
                          {getUserDisplayName(row.user)}
                        </div>
                        <div className='text-sm text-muted-foreground'>{row.user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-center text-sm text-foreground'>
                    {row.userTickets}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-center text-sm text-foreground'>
                    {row.weightedActiveTasks}
                  </td>
                  {hasAnyStartOffset && (
                    <td className='px-6 py-4 whitespace-nowrap text-center text-sm text-foreground'>
                      {row.startOffset > 0 ? `+${row.startOffset}` : '—'}
                    </td>
                  )}
                  {hasMaxWorkload && (
                    <td className='px-6 py-4 whitespace-nowrap text-center text-sm'>
                      {row.isAtCapacity ? (
                        <span className='font-medium text-destructive'>At capacity</span>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </td>
                  )}
                  {isRoundRobin && (
                    <td className='px-6 py-4 whitespace-nowrap text-center text-sm text-foreground'>
                      {formatLastAssigned(row.lastAssignedAt)}
                    </td>
                  )}
                  {showScoreColumn && (
                    <td className='px-6 py-4 whitespace-nowrap text-center text-sm font-medium text-foreground'>
                      {row.displayScore !== null ? row.displayScore.toFixed(2) : '—'}
                    </td>
                  )}
                </tr>
              ))}
              {scoreRows.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      3 +
                      (hasAnyStartOffset ? 1 : 0) +
                      (hasMaxWorkload ? 1 : 0) +
                      (isRoundRobin ? 1 : 0) +
                      (showScoreColumn ? 1 : 0)
                    }
                    className='px-6 py-8 text-center text-[13px] text-muted-foreground'
                  >
                    No members to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className='rounded-2xl border border-border bg-muted/40 p-4'>
        <p className='text-[13px] leading-[1.5] text-muted-foreground'>
          {isRoundRobin
            ? 'Rows are ordered least-recently-assigned first. Ticket counts are shown for reference only — round robin ignores them, though per-user max-ticket limits and the group max workload still apply. This list does not apply the eligibility tiers, so the actual pick is the first row here that is currently eligible.'
            : 'Lower score is assigned first. Numbers reflect the last synced workload the engine scores on. Scores shown here are shifted so the lowest reads as 0 — this is display-only and doesn’t change the actual assignment math or ordering.'}{' '}
          A Cold-Start Offset appears once for brand-new members so they start at parity with the
          group instead of being flooded with tickets — it&apos;s fixed the moment it&apos;s set and
          never decays. Eligibility (on-call / active / expertise) and the assignment method are
          configured in the Availability tab.
        </p>
      </div>
    </>
  );
}
