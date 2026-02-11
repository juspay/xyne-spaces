import { ReactElement, useState, useEffect } from 'react';
import { useZero } from '../../../hooks/useZero';
import { useNavigate } from 'react-router-dom';
import { PauseCircle } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { Switch } from '../../ui/Switch';
import Input from '../../ui/Input/Input';
import { Tooltip } from '../../ui/Tooltip';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useUsers } from '../../../hooks/useUsers';
import type { Board, UserAssignmentState } from '@xyne/shared';
import type { User } from '../../../machines/stateMachine';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { formatExpiryTime } from '../../../utils/statusUtils';

interface AssignmentConfigScreenProps {
  userGroupId: string;
}

export const AssignmentConfigScreen = ({
  userGroupId,
}: AssignmentConfigScreenProps): ReactElement => {
  const navigate = useNavigate();
  const zero = useZero();
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [boardWeight, setBoardWeight] = useState<string>('1');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [percentageError, setPercentageError] = useState<string | null>(null);

  // Local state for pending changes
  const [localUserStates, setLocalUserStates] = useState<
    Map<string, { onCall: boolean; isActive: boolean }>
  >(new Map());
  const [localExpertise, setLocalExpertise] = useState<Map<string, boolean>>(new Map());
  const [localPercentage, setLocalPercentage] = useState<Map<string, number>>(new Map());
  const [localMaxTickets, setLocalMaxTickets] = useState<Map<string, number>>(new Map());
  const [localBoardWeight, setLocalBoardWeight] = useState<number>(1);
  const [localUsePercentage, setLocalUsePercentage] = useState<boolean>(false);

  const [userGroup] = useCachedQuery(queries.getUserGroupById({ userGroupId }));

  const [userGroupMembers] = useCachedQuery(queries.getUserGroupMembers({ userGroupId }));

  const [allBoards] = useCachedQuery(queries.getAllBoards());

  const [userAssignmentStates] = useCachedQuery(queries.getUserAssignmentStates({ userGroupId }));

  const [boardComplexityScores] = useCachedQuery(queries.getBoardComplexityScores({ userGroupId }));

  const [expertiseMappings] = useCachedQuery(
    selectedBoardId
      ? queries.getUserExpertiseMappings({
          userGroupId,
          boardId: selectedBoardId,
        })
      : queries.getUserExpertiseMappings({
          userGroupId,
          boardId: 'nonexistent',
        }),
  );

  const allUsers = useUsers();

  // Create usersById map
  const usersById = new Map<string, User>();
  for (const u of allUsers) {
    usersById.set(u.id, u);
  }

  // Extract users from mappings using userId and XState user store
  const users =
    userGroupMembers
      ?.map(mapping => usersById.get(mapping.userId))
      .filter((user): user is User => Boolean(user)) || [];

  // Initialize local state from server data
  useEffect(() => {
    if (justSaved) {
      setJustSaved(false);
      return;
    }
    if (userAssignmentStates && userGroupMembers && userGroupMembers.length > 0) {
      const statesMap = new Map<string, { onCall: boolean; isActive: boolean }>();
      for (const mapping of userGroupMembers) {
        const state = userAssignmentStates.find(
          (s: UserAssignmentState) => s.userId === mapping.userId,
        );
        statesMap.set(mapping.userId, {
          onCall: state?.onCall || false,
          isActive: state?.isActiveForAssignment === true,
        });
      }
      setLocalUserStates(statesMap);
    }
  }, [userAssignmentStates, userGroupMembers, justSaved]);

  // Initialize local expertise/percentage/maxTickets from server data
  useEffect(() => {
    if (justSaved) {
      return;
    }
    if (expertiseMappings && selectedBoardId) {
      const expertiseMap = new Map<string, boolean>();
      const percentageMap = new Map<string, number>();
      const maxTicketsMap = new Map<string, number>();
      for (const e of expertiseMappings) {
        expertiseMap.set(e.userId, e.hasExpertise);
        percentageMap.set(e.userId, e.percentage);
        maxTicketsMap.set(e.userId, e.maxTickets);
      }
      setLocalExpertise(expertiseMap);
      setLocalPercentage(percentageMap);
      setLocalMaxTickets(maxTicketsMap);
    } else {
      setLocalExpertise(new Map());
      setLocalPercentage(new Map());
      setLocalMaxTickets(new Map());
    }
  }, [expertiseMappings, selectedBoardId, justSaved]);

  // Initialize local board weight and usePercentage from server data
  useEffect(() => {
    if (selectedBoardId && boardComplexityScores) {
      const score = boardComplexityScores.find(s => s.boardId === selectedBoardId);
      const weight = score?.weight || 1;
      setBoardWeight(String(weight));
      setLocalBoardWeight(weight);
      setLocalUsePercentage(score?.usePercentage ?? false);
    } else {
      setBoardWeight('1');
      setLocalBoardWeight(1);
      setLocalUsePercentage(false);
    }
    setHasChanges(false);
  }, [selectedBoardId, boardComplexityScores]);

  const boards = allBoards || [];

  const handleToggleOnCall = (userId: string): void => {
    const currentState = localUserStates.get(userId);
    if (currentState) {
      const newStates = new Map(localUserStates);
      // If turning onCall ON, automatically set isActive to true
      if (!currentState.onCall) {
        newStates.set(userId, { onCall: true, isActive: true });
      } else {
        newStates.set(userId, { ...currentState, onCall: false });
      }
      setLocalUserStates(newStates);
      setHasChanges(true);
    }
  };

  const handleToggleActiveForAssignment = (userId: string): void => {
    const currentState = localUserStates.get(userId);
    if (currentState) {
      const newStates = new Map(localUserStates);
      // If turning isActive OFF, automatically set onCall to false as well
      if (currentState.isActive) {
        newStates.set(userId, { onCall: false, isActive: false });
      } else {
        newStates.set(userId, { ...currentState, isActive: true });
      }
      setLocalUserStates(newStates);
      setHasChanges(true);
    }
  };

  const handleToggleExpertise = (userId: string): void => {
    const newExpertise = new Map(localExpertise);
    const currentValue = newExpertise.get(userId) ?? false;
    newExpertise.set(userId, !currentValue);
    setLocalExpertise(newExpertise);
    setHasChanges(true);
  };

  const handlePercentageChange = (userId: string, value: string): void => {
    // Only allow digits
    const sanitizedValue = value.replace(/[^0-9]/g, '');

    // If empty, reset to 0 (will show as 0 in input, user can continue typing)
    if (sanitizedValue === '') {
      const newPercentage = new Map(localPercentage);
      newPercentage.set(userId, 0);
      setLocalPercentage(newPercentage);
      setHasChanges(true);
      setPercentageError(null);
      return;
    }

    const numValue = parseInt(sanitizedValue);

    // Clamp between 0 and 100
    if (numValue > 100) {
      const newPercentage = new Map(localPercentage);
      newPercentage.set(userId, 100);
      setLocalPercentage(newPercentage);
      setHasChanges(true);
      setPercentageError(null);
      return;
    }

    const newPercentage = new Map(localPercentage);
    newPercentage.set(userId, numValue);
    setLocalPercentage(newPercentage);
    setHasChanges(true);
    setPercentageError(null);
  };

  const handleMaxTicketsChange = (userId: string, value: string): void => {
    // Only allow digits
    const sanitizedValue = value.replace(/[^0-9]/g, '');

    // If empty, set to -1 (unlimited)
    if (sanitizedValue === '') {
      const newMaxTickets = new Map(localMaxTickets);
      newMaxTickets.set(userId, -1);
      setLocalMaxTickets(newMaxTickets);
      setHasChanges(true);
      return;
    }

    const numValue = parseInt(sanitizedValue);

    const newMaxTickets = new Map(localMaxTickets);
    newMaxTickets.set(userId, numValue);
    setLocalMaxTickets(newMaxTickets);
    setHasChanges(true);
  };

  const getLocalPercentage = (userId: string): number => {
    return localPercentage.get(userId) ?? 100;
  };

  const getLocalMaxTickets = (userId: string): number => {
    return localMaxTickets.get(userId) ?? -1;
  };

  const getTotalPercentage = (): number => {
    let total = 0;
    for (const user of users) {
      total += localPercentage.get(user.id) ?? 100;
    }
    return total;
  };

  // Check if percentage is valid (sum = 100) when usePercentage is enabled
  const isPercentageValid = !localUsePercentage || getTotalPercentage() === 100;

  const handleBoardWeightChange = (value: string): void => {
    // Only allow digits, no negative sign or leading zeros except single '0'
    const sanitizedValue = value.replace(/[^0-9]/g, '');

    // Prevent empty string
    if (sanitizedValue === '') {
      setBoardWeight('');
      return;
    }

    // Remove leading zeros (e.g., "0001" becomes "1", "01" becomes "1")
    const withoutLeadingZeros = sanitizedValue.replace(/^0+/, '');

    // If all zeros were removed, treat as empty
    if (withoutLeadingZeros === '') {
      setBoardWeight('');
      return;
    }

    const numValue = parseInt(withoutLeadingZeros);

    // Clamp between 1 and 100
    if (numValue > 100) {
      setBoardWeight('100');
      setLocalBoardWeight(100);
      setHasChanges(true);
      return;
    }

    if (numValue >= 1 && numValue <= 100) {
      setBoardWeight(withoutLeadingZeros);
      setLocalBoardWeight(numValue);
      setHasChanges(true);
    }
  };

  const handleSave = (): void => {
    // Validate percentage sum equals 100 when usePercentage is enabled
    if (localUsePercentage) {
      const totalPercentage = getTotalPercentage();
      if (totalPercentage !== 100) {
        setPercentageError(`Percentage share must sum to 100% (current: ${totalPercentage}%)`);
        return;
      }
    }
    setPercentageError(null);

    setIsSaving(true);
    try {
      const userStates = Array.from(localUserStates.entries()).map(([userId, state]) => ({
        userId,
        onCall: state.onCall,
        isActive: state.isActive,
      }));

      // Prepare board weight if a board is selected
      const boardWeightData = selectedBoardId
        ? {
            boardId: selectedBoardId,
            weight: localBoardWeight,
            usePercentage: localUsePercentage,
          }
        : undefined;

      // Prepare expertise mappings with all three fields if a board is selected
      const expertiseMappingsData = selectedBoardId
        ? {
            boardId: selectedBoardId,
            userConfigs: users.map(user => ({
              userId: user.id,
              hasExpertise: localExpertise.get(user.id) ?? false,
              percentage: localPercentage.get(user.id) ?? 100,
              maxTickets: localMaxTickets.get(user.id) ?? -1,
            })),
          }
        : undefined;

      const stateIds = userStates.reduce(
        (acc, userState) => {
          acc[userState.userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      const mappingIds = expertiseMappingsData?.userConfigs.reduce(
        (acc, userConfig) => {
          acc[userConfig.userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      void zero.mutate(
        mutators.assignmentConfig.batchUpdate({
          userGroupId,
          userStates,
          boardWeight: boardWeightData,
          expertiseMappings: expertiseMappingsData,
          stateIds,
          complexityScoreId: uuidv4(),
          mappingIds,
          timestamp: Date.now(),
        }),
      );

      setHasChanges(false);
      setJustSaved(true);
    } catch {
      alert('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getUserLocalState = (userId: string): { onCall: boolean; isActive: boolean } => {
    return localUserStates.get(userId) || { onCall: false, isActive: false };
  };

  const hasLocalExpertise = (userId: string): boolean => {
    return localExpertise.get(userId) ?? false;
  };

  return (
    <div className='h-full w-full overflow-hidden bg-gray-50'>
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          {/* Header */}
          <div className='flex items-center justify-between p-6 border-b border-gray-200 bg-white'>
            <div>
              <div className='flex items-center gap-3 mb-2'>
                <Button variant='outline' size='sm' onClick={() => void navigate('/user-groups')}>
                  ← Back
                </Button>
                <h1 className='text-2xl font-bold text-gray-900'>Assignment Configuration</h1>
              </div>
              <p className='text-sm text-gray-600'>
                {userGroup?.name || 'User Group'}
                {userGroup?.description ? ` • ${userGroup.description}` : ''}
              </p>
            </div>
            <Button
              variant='default'
              size='default'
              onClick={() => void handleSave()}
              disabled={!hasChanges || isSaving || !isPercentageValid}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          {/* Main Content */}
          <div className='flex-1 overflow-auto p-6'>
            <div className='max-w-7xl mx-auto space-y-6'>
              {/* Board Filter */}
              <div className='bg-white border border-gray-200 rounded-lg p-4'>
                <label
                  htmlFor='board-filter'
                  className='block text-sm font-medium text-gray-700 mb-2'
                >
                  Filter by Board
                </label>
                <select
                  id='board-filter'
                  value={selectedBoardId ?? ''}
                  onChange={e => setSelectedBoardId(e.target.value || null)}
                  className='block w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
                >
                  <option value=''>All Boards</option>
                  {boards.map((board: Board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Board Weight Configuration - Only shown when a specific board is selected */}
              {selectedBoardId && (
                <div className='bg-white border border-gray-200 rounded-lg p-4'>
                  <label
                    htmlFor='board-weight'
                    className='block text-sm font-medium text-gray-700 mb-2'
                  >
                    Board Weight
                  </label>
                  <p className='text-xs text-gray-500 mb-3'>
                    Higher weights increase the workload impact for this board during assignment.
                    Range: 1 to 100.
                  </p>
                  <input
                    type='text'
                    inputMode='numeric'
                    id='board-weight'
                    value={boardWeight}
                    onChange={e => handleBoardWeightChange(e.target.value)}
                    onBlur={() => {
                      // Reset to 1 if empty or invalid on blur
                      const numValue = parseInt(boardWeight);
                      if (isNaN(numValue) || numValue < 1) {
                        setBoardWeight('1');
                        setLocalBoardWeight(1);
                        setHasChanges(true);
                      }
                    }}
                    placeholder='1'
                    className='block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                  />

                  <div className='mt-4 pt-4 border-t border-gray-100'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <span className='block text-sm font-medium text-gray-700'>
                          Use Percentage Assignment
                        </span>
                        <p className='text-xs text-gray-500 mt-1'>
                          When enabled, tickets are distributed based on % Share. When disabled,
                          uses standard workload-based assignment.
                        </p>
                      </div>
                      <Switch
                        checked={localUsePercentage}
                        onCheckedChange={checked => {
                          setLocalUsePercentage(checked);
                          setHasChanges(true);
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* User Assignment Table */}
              <div className='bg-white border border-gray-200 rounded-lg overflow-hidden'>
                <table className='min-w-full divide-y divide-gray-200'>
                  <thead className='bg-gray-50'>
                    <tr>
                      <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
                        User
                      </th>
                      <th className='px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider'>
                        On-Call
                      </th>
                      <th className='px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider'>
                        Active
                      </th>
                      {selectedBoardId && (
                        <>
                          <th className='px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider'>
                            Expertise ({boards.find(b => b.id === selectedBoardId)?.name})
                          </th>
                          {localUsePercentage && (
                            <>
                              <th className='px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider'>
                                % Share
                                <span
                                  className={`block text-xs font-normal mt-1 ${
                                    getTotalPercentage() === 100 ? 'text-green-600' : 'text-red-600'
                                  }`}
                                >
                                  (Total: {getTotalPercentage()}%)
                                </span>
                              </th>
                              <th className='px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider'>
                                Max Tickets
                              </th>
                            </>
                          )}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className='bg-white divide-y divide-gray-200'>
                    {users.map((user: User) => {
                      const localState = getUserLocalState(user.id);
                      const assignmentUnavailableUntil = (
                        user?.presenceStatus as { assignmentUnavailableUntil?: number } | undefined
                      )?.assignmentUnavailableUntil;
                      const isUnavailable = assignmentUnavailableUntil
                        ? assignmentUnavailableUntil > Date.now()
                        : false;
                      const unavailableTooltip = assignmentUnavailableUntil
                        ? `Unavailable until ${formatExpiryTime(assignmentUnavailableUntil, false)}`
                        : 'Unavailable for ticket assignment';
                      return (
                        <tr key={user.id} className='hover:bg-gray-50'>
                          <td className='px-6 py-4 whitespace-nowrap'>
                            <div className='flex items-center'>
                              <Avatar userId={user.id} size='sm' showActiveStatus={false} />
                              <div className='ml-4 flex-1'>
                                <div className='flex items-center gap-2'>
                                  <div className='text-sm font-medium text-gray-900'>
                                    {user.name}
                                  </div>
                                  {isUnavailable && (
                                    <Tooltip content={unavailableTooltip}>
                                      <PauseCircle className='size-3.5 text-gray-500 flex-shrink-0' />
                                    </Tooltip>
                                  )}
                                </div>
                                <div className='text-sm text-gray-500'>{user.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap text-center align-middle'>
                            <div className='flex items-center justify-center h-full'>
                              <Switch
                                checked={localState.onCall}
                                onCheckedChange={() => handleToggleOnCall(user.id)}
                              />
                            </div>
                          </td>
                          <td className='px-6 py-4 whitespace-nowrap text-center align-middle'>
                            <div className='flex items-center justify-center h-full'>
                              <Switch
                                checked={localState.isActive}
                                onCheckedChange={() => handleToggleActiveForAssignment(user.id)}
                              />
                            </div>
                          </td>
                          {selectedBoardId && (
                            <>
                              <td className='px-6 py-4 whitespace-nowrap text-center'>
                                <input
                                  type='checkbox'
                                  checked={hasLocalExpertise(user.id)}
                                  onChange={() => handleToggleExpertise(user.id)}
                                  className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer'
                                />
                              </td>
                              {localUsePercentage && (
                                <>
                                  <td className='px-6 py-4 whitespace-nowrap text-center'>
                                    <Input
                                      type='text'
                                      inputMode='numeric'
                                      value={getLocalPercentage(user.id)}
                                      onChange={e =>
                                        handlePercentageChange(user.id, e.target.value)
                                      }
                                      className='w-16 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                                    />
                                  </td>
                                  <td className='px-6 py-4 whitespace-nowrap text-center'>
                                    <Input
                                      type='text'
                                      inputMode='numeric'
                                      value={
                                        getLocalMaxTickets(user.id) === -1
                                          ? ''
                                          : getLocalMaxTickets(user.id)
                                      }
                                      onChange={e =>
                                        handleMaxTicketsChange(user.id, e.target.value)
                                      }
                                      placeholder='∞'
                                      className='w-16 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                                    />
                                  </td>
                                </>
                              )}
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {users.length === 0 && (
                      <tr>
                        <td
                          colSpan={selectedBoardId ? (localUsePercentage ? 6 : 4) : 3}
                          className='px-6 py-4 text-center text-sm text-gray-500'
                        >
                          No users in this group
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Percentage Error Message */}
              {percentageError && (
                <div className='bg-red-50 border border-red-200 rounded-lg p-4'>
                  <p className='text-sm text-red-600'>{percentageError}</p>
                </div>
              )}

              {/* Info Section */}
              <div className='bg-blue-50 border border-blue-200 rounded-lg p-4'>
                <h3 className='font-medium text-blue-900 mb-2'>How Auto-Assignment Works</h3>
                <ul className='text-sm text-blue-800 space-y-1 list-disc list-inside'>
                  <li>
                    <strong>Eligibility</strong>: Users must be Active. On-Call is preferred but not
                    required. If expertise mappings exist, experts get priority.
                  </li>
                  <li>
                    <strong>Score-based</strong>: Users with lower scores get priority. Score
                    formula: <code>weightedActiveTasks - expertiseBonus - percentDiff</code>
                  </li>
                  <li>
                    <strong>Expertise Bonus</strong>: Users with expertise get -10 points (higher
                    priority)
                  </li>
                  <li>
                    <strong>% Share</strong>: Users below their target percentage get priority.
                    Helps balance ticket distribution.
                  </li>
                  <li>
                    <strong>Max Tickets</strong>: Users at their limit are skipped. Set to -1 for
                    unlimited.
                  </li>
                  <li>
                    <strong>Board Weight</strong>: Multiplies task impact. Weight of 2 means 1 task
                    counts as 2 towards workload.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
