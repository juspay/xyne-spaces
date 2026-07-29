import { ReactElement, useState, useEffect, useMemo } from 'react';
import { useZero } from '../../../hooks/useZero';
import { useNavigate } from 'react-router-dom';
import { PauseCircle, Settings } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { Switch } from '../../ui/Switch';
import Input from '../../ui/Input/Input';
import { Tooltip } from '../../ui/Tooltip';
import { Dialog } from '../../ui/Dialog/Dialog';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useActiveUsers } from '../../../hooks/useUsers';
import type { Board, UserAssignmentState } from '@xyne/shared';
import { RotationInterval } from '@xyne/shared';
import type { User } from '../../../machines/stateMachine';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { formatExpiryTime } from '../../../utils/statusUtils';
import { OnCallRotationModal } from '../OnCallRotationModal/OnCallRotationModal';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface AssignmentConfigScreenProps {
  userGroupId: string;
}

const ROTATION_INTERVAL_OPTIONS: { value: RotationInterval; label: string }[] = [
  { value: 'WEEKLY' as RotationInterval, label: 'Weekly' },
  { value: 'BIWEEKLY' as RotationInterval, label: 'Bi-Weekly' },
  { value: 'MONTHLY' as RotationInterval, label: 'Monthly' },
];

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
  const [isRotationModalOpen, setIsRotationModalOpen] = useState(false);
  const [showDisableRotationWarning, setShowDisableRotationWarning] = useState(false);

  // Current time for active set calculation (updates every 5 minutes)
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Local state for pending changes
  const [localUserStates, setLocalUserStates] = useState<
    Map<string, { onCall: boolean; isActive: boolean }>
  >(new Map());
  const [localExpertise, setLocalExpertise] = useState<Map<string, boolean>>(new Map());
  const [localPercentage, setLocalPercentage] = useState<Map<string, number>>(new Map());
  const [localMaxTickets, setLocalMaxTickets] = useState<Map<string, number>>(new Map());
  const [localBoardWeight, setLocalBoardWeight] = useState<number>(1);
  const [localUsePercentage, setLocalUsePercentage] = useState<boolean>(false);

  // Group-level rotation state
  const [localAutoRotationEnabled, setLocalAutoRotationEnabled] = useState<boolean>(false);
  const [localRotationInterval, setLocalRotationInterval] = useState<RotationInterval>(
    RotationInterval.WEEKLY,
  );
  // Pending set mappings from modal (applied on main save)
  // Each user can be in multiple sets
  const [pendingSetMappings, setPendingSetMappings] = useState<Map<string, number[]> | null>(null);

  const [userGroup] = useCachedQuery(queries.getUserGroupById({ userGroupId }));

  const [userGroupMembers] = useCachedQuery(queries.getUserGroupMembers({ userGroupId }));

  const [allBoards] = useCachedQuery(queries.getAllBoardsList());

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

  const allUsers = useActiveUsers();

  // Create usersById map
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  // Extract users from mappings using userId and XState user store
  const users = useMemo(() => {
    return (
      userGroupMembers
        ?.map(mapping => usersById.get(mapping.userId))
        .filter((user): user is User => Boolean(user)) || []
    );
  }, [userGroupMembers, usersById]);

  // Effective mappings: use pending changes if available (for instant UI feedback before save)
  const effectiveUserGroupMembers = useMemo(() => {
    return (
      userGroupMembers?.map(mapping => {
        const onCallSets = mapping.onCallSetNumbers as number[] | undefined;
        const setNumbers: number[] = onCallSets && onCallSets.length > 0 ? onCallSets : [1];
        return {
          ...mapping,
          onCallSetNumbers: pendingSetMappings
            ? (pendingSetMappings.get(mapping.userId) ?? [1])
            : setNumbers,
        };
      }) ?? []
    );
  }, [userGroupMembers, pendingSetMappings]);

  // Get max set number for grouping (include pending changes)
  const currentMaxSet = useMemo(() => {
    const allSetNumbers = effectiveUserGroupMembers.flatMap(m => m.onCallSetNumbers ?? [1]);
    const maxSet = allSetNumbers.length > 0 ? Math.max(...allSetNumbers, 1) : 1;
    return maxSet;
  }, [effectiveUserGroupMembers]);

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Update current time every 5 minutes to keep active set calculation fresh
  useEffect(() => {
    if (!userGroup?.autoRotationEnabled) return;

    const timer = setInterval(
      () => {
        setCurrentTime(Date.now());
      },
      5 * 60 * 1000,
    ); // 5 minutes

    return () => clearInterval(timer);
  }, [userGroup?.autoRotationEnabled]);

  // Calculate active set based on rotation settings
  const activeSet = useMemo(() => {
    const isAutoRotationEnabled = localAutoRotationEnabled;
    const rotationStartDate = userGroup?.rotationStartDate;
    const rotationInterval = localRotationInterval;

    if (!isAutoRotationEnabled || !rotationStartDate || !rotationInterval) {
      return 1;
    }

    const startDate = rotationStartDate;
    const interval = rotationInterval;
    const now = currentTime;

    let intervalDelay: number;
    switch (interval) {
      case RotationInterval.WEEKLY:
        intervalDelay = 7 * MS_PER_DAY;
        break;
      case RotationInterval.BIWEEKLY:
        intervalDelay = 14 * MS_PER_DAY;
        break;
      case RotationInterval.MONTHLY:
        intervalDelay = 30 * MS_PER_DAY;
        break;
      default:
        intervalDelay = 7 * MS_PER_DAY;
    }

    const elapsedMs = now - startDate;
    const periodsElapsed = Math.max(0, Math.floor(elapsedMs / intervalDelay));

    return (periodsElapsed % currentMaxSet) + 1;
  }, [
    localAutoRotationEnabled,
    userGroup?.rotationStartDate,
    localRotationInterval,
    currentMaxSet,
    currentTime,
  ]);

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

  // Initialize rotation settings from user group
  useEffect(() => {
    if (userGroup) {
      setLocalAutoRotationEnabled(userGroup.autoRotationEnabled ?? false);
      setLocalRotationInterval(userGroup.rotationInterval ?? RotationInterval.WEEKLY);
    }
  }, [userGroup?.autoRotationEnabled, userGroup?.rotationInterval]);

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

  // Calculate total percentage for all users
  const totalPercentage = useMemo(() => {
    let total = 0;
    for (const user of users) {
      total += localPercentage.get(user.id) ?? 100;
    }
    return total;
  }, [users, localPercentage]);

  // Calculate total percentage for each set
  const setPercentages = useMemo(() => {
    const percentages = new Map<number, number>();

    for (let setNum = 1; setNum <= currentMaxSet; setNum++) {
      const setUserIds = effectiveUserGroupMembers
        .filter(m => m.onCallSetNumbers?.includes(setNum) ?? setNum === 1)
        .map(m => m.userId);

      let total = 0;
      for (const userId of setUserIds) {
        total += localPercentage.get(userId) ?? 100;
      }
      percentages.set(setNum, total);
    }
    return percentages;
  }, [effectiveUserGroupMembers, localPercentage, currentMaxSet]);

  const getSetTotalPercentage = (setNumber: number): number => {
    return setPercentages.get(setNumber) ?? 0;
  };

  // Check if percentage is valid (sum = 100 per set) when usePercentage is enabled and rotation is enabled
  const isPercentageValid = useMemo(() => {
    if (!localUsePercentage) return true;

    if (!localAutoRotationEnabled) {
      return totalPercentage === 100;
    }

    // When rotation is enabled, validate each set independently
    for (let setNum = 1; setNum <= currentMaxSet; setNum++) {
      if ((setPercentages.get(setNum) ?? 0) !== 100) {
        return false;
      }
    }
    return true;
  }, [
    localUsePercentage,
    localAutoRotationEnabled,
    totalPercentage,
    setPercentages,
    currentMaxSet,
  ]);

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
    // Check if user is disabling auto-rotation - show warning if so
    const isDisablingRotation =
      (userGroup?.autoRotationEnabled ?? false) && !localAutoRotationEnabled;

    if (isDisablingRotation) {
      setShowDisableRotationWarning(true);
      return;
    }

    performSave();
  };

  const performSave = (): void => {
    // Validate percentage sum equals 100 when usePercentage is enabled
    if (localUsePercentage) {
      if (localAutoRotationEnabled) {
        // Validate per-set percentages when rotation is enabled
        for (let setNum = 1; setNum <= currentMaxSet; setNum++) {
          const setTotal = getSetTotalPercentage(setNum);
          if (setTotal !== 100) {
            setPercentageError(
              `Set ${setNum} percentage share must sum to 100% (current: ${setTotal}%)`,
            );
            return;
          }
        }
      } else {
        if (totalPercentage !== 100) {
          setPercentageError(`Percentage share must sum to 100% (current: ${totalPercentage}%)`);
          return;
        }
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

      // Prepare set mappings from pending changes or existing mappings
      // Only include onCallSetNumbers if rotation is enabled
      const userMappings = pendingSetMappings
        ? Array.from(pendingSetMappings.entries()).map(([userId, onCallSetNumbers]) => ({
            userId,
            onCallSetNumbers: localAutoRotationEnabled ? onCallSetNumbers : [],
          }))
        : (userGroupMembers ?? []).map(m => ({
            userId: m.userId,
            onCallSetNumbers: localAutoRotationEnabled
              ? ((m.onCallSetNumbers as number[] | undefined) ?? [1])
              : [],
          }));

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
          userMappings,
          stateIds,
          complexityScoreId: uuidv4(),
          mappingIds,
          timestamp: Date.now(),
        }),
      );

      // Also update rotation settings (enable/disable, interval)
      const rotationChanged =
        localAutoRotationEnabled !== (userGroup?.autoRotationEnabled ?? false) ||
        (localAutoRotationEnabled &&
          localRotationInterval !== (userGroup?.rotationInterval ?? 'WEEKLY'));

      if (rotationChanged) {
        void zero.mutate(
          mutators.assignmentConfig.toggleGroupAutoRotation({
            userGroupId,
            autoRotationEnabled: localAutoRotationEnabled,
            rotationInterval: localAutoRotationEnabled ? localRotationInterval : undefined,
            rotationStartDate: localAutoRotationEnabled ? Date.now() : undefined,
            timestamp: Date.now(),
          }),
        );
      }

      setHasChanges(false);
      setPendingSetMappings(null);
      setJustSaved(true);
    } catch {
      alert('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetsChange = (sets: Map<string, number[]>): void => {
    setPendingSetMappings(sets);
    setHasChanges(true);
  };

  const getUserLocalState = (userId: string): { onCall: boolean; isActive: boolean } => {
    return localUserStates.get(userId) || { onCall: false, isActive: false };
  };

  const hasLocalExpertise = (userId: string): boolean => {
    return localExpertise.get(userId) ?? false;
  };

  // Group users by set number (use effective mappings for instant feedback)
  const getUsersBySet = (setNumber: number): User[] => {
    const setUserIds = effectiveUserGroupMembers
      .filter(m => m.onCallSetNumbers?.includes(setNumber) ?? setNumber === 1)
      .map(m => m.userId);
    return users.filter(u => setUserIds.includes(u.id));
  };

  const renderUserRow = (user: User): ReactElement => {
    const localState = getUserLocalState(user.id);
    const assignmentUnavailableUntil = user.assignmentUnavailableUntil as number | undefined;
    const isUnavailable = assignmentUnavailableUntil
      ? assignmentUnavailableUntil > Date.now()
      : false;
    const unavailableTooltip = assignmentUnavailableUntil
      ? `Unavailable until ${formatExpiryTime(assignmentUnavailableUntil, false)}`
      : 'Unavailable for ticket assignment';

    return (
      <tr key={user.id} className='hover:bg-muted'>
        <td className='px-6 py-4 whitespace-nowrap'>
          <div className='flex items-center'>
            <Avatar userId={user.id} size='sm' showActiveStatus={false} />
            <div className='ml-4 flex-1'>
              <div className='flex items-center gap-2'>
                <div className='text-sm font-medium text-foreground'>
                  {getUserDisplayName(user)}
                </div>
                {isUnavailable && (
                  <Tooltip content={unavailableTooltip}>
                    <PauseCircle className='size-3.5 text-muted-foreground flex-shrink-0' />
                  </Tooltip>
                )}
              </div>
              <div className='text-sm text-muted-foreground'>{user.email}</div>
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
                className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-input rounded cursor-pointer'
                data-track-category='UserGroup'
                data-track-name='ToggleExpertise'
                data-track-metadata={JSON.stringify({ userId: user.id })}
              />
            </td>
            {localUsePercentage && (
              <>
                <td className='px-6 py-4 whitespace-nowrap text-center'>
                  <Input
                    type='text'
                    inputMode='numeric'
                    value={getLocalPercentage(user.id)}
                    onChange={e => handlePercentageChange(user.id, e.target.value)}
                    className='w-16 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                  />
                </td>
                <td className='px-6 py-4 whitespace-nowrap text-center'>
                  <Input
                    type='text'
                    inputMode='numeric'
                    value={getLocalMaxTickets(user.id) === -1 ? '' : getLocalMaxTickets(user.id)}
                    onChange={e => handleMaxTicketsChange(user.id, e.target.value)}
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
  };

  const renderSetSection = (setNumber: number): ReactElement => {
    const setUsers = getUsersBySet(setNumber);
    const isActive = userGroup?.autoRotationEnabled && activeSet === setNumber;
    const setPercentageTotal = getSetTotalPercentage(setNumber);

    return (
      <div key={setNumber} className='mb-6'>
        <div className='flex items-center gap-3 mb-3'>
          <h3 className='text-lg font-semibold text-foreground'>
            Set {setNumber}
            {isActive && (
              <span className='ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800'>
                ACTIVE
              </span>
            )}
          </h3>
          {localUsePercentage && selectedBoardId && (
            <span
              className={`text-sm font-medium ${
                setPercentageTotal === 100 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              (Total: {setPercentageTotal}%)
            </span>
          )}
        </div>
        <div className='bg-background border border-border rounded-lg overflow-hidden'>
          <table className='min-w-full divide-y divide-border table-fixed'>
            <thead className='bg-muted'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[40%]'>
                  User
                </th>
                <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-[12%]'>
                  On-Call
                </th>
                <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-[12%]'>
                  Active
                </th>
                {selectedBoardId && (
                  <>
                    <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-[12%]'>
                      Expertise
                    </th>
                    {localUsePercentage && (
                      <>
                        <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-[12%]'>
                          % Share
                        </th>
                        <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-[12%]'>
                          Max Tickets
                        </th>
                      </>
                    )}
                  </>
                )}
              </tr>
            </thead>
            <tbody className='bg-background divide-y divide-border'>
              {setUsers.length > 0 ? (
                setUsers.map(renderUserRow)
              ) : (
                <tr>
                  <td
                    colSpan={selectedBoardId ? (localUsePercentage ? 6 : 4) : 3}
                    className='px-6 py-4 text-center text-sm text-muted-foreground'
                  >
                    No users in this set
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className='h-full w-full overflow-hidden bg-muted'>
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          {/* Header */}
          <div className='flex items-center justify-between p-6 border-b border-border bg-background'>
            <div>
              <div className='flex items-center gap-3 mb-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => void navigate('/user-groups')}
                  data-track-category='UserGroups'
                  data-track-name='BackToUserGroups'
                >
                  ← Back
                </Button>
                <h1 className='text-2xl font-bold text-foreground'>Assignment Configuration</h1>
              </div>
              <p className='text-sm text-muted-foreground'>
                {userGroup?.name || 'User Group'}
                {userGroup?.description ? ` • ${userGroup.description}` : ''}
              </p>
            </div>
            <Button
              variant='default'
              size='default'
              onClick={() => void handleSave()}
              disabled={!hasChanges || isSaving || !isPercentageValid}
              data-track-category='UserGroups'
              data-track-name='SaveAssignmentConfig'
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          {/* Main Content */}
          <div className='flex-1 overflow-auto p-6'>
            <div className='max-w-7xl mx-auto space-y-6'>
              {/* Group-Level Rotation Configuration */}
              <div className='bg-background border border-border rounded-lg p-4'>
                <div className='flex items-center justify-between mb-4'>
                  <div>
                    <h2 className='text-lg font-semibold text-foreground'>On-Call Rotation</h2>
                    <p className='text-sm text-muted-foreground'>
                      Automatically rotate on-call status across team sets
                    </p>
                  </div>
                </div>

                <div className='flex items-center justify-between mb-4'>
                  <div>
                    <span className='block text-sm font-medium text-foreground'>
                      Enable Auto-Rotation
                    </span>
                    <p className='text-xs text-muted-foreground mt-1'>
                      When enabled, on-call status rotates automatically based on the configured
                      interval
                    </p>
                  </div>
                  <Switch
                    checked={localAutoRotationEnabled}
                    onCheckedChange={checked => {
                      setLocalAutoRotationEnabled(checked);
                      setHasChanges(true);
                    }}
                  />
                </div>

                {localAutoRotationEnabled && (
                  <>
                    <div className='mb-4'>
                      <label
                        htmlFor='rotation-interval'
                        className='block text-sm font-medium text-foreground mb-2'
                      >
                        Rotation Interval
                      </label>
                      <select
                        id='rotation-interval'
                        value={localRotationInterval}
                        onChange={e => {
                          setLocalRotationInterval(e.target.value as RotationInterval);
                          setHasChanges(true);
                        }}
                        className='block w-full max-w-md px-3 py-2 border border-input rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
                        data-track-category='UserGroups'
                        data-track-name='ChangeRotationInterval'
                      >
                        {ROTATION_INTERVAL_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setIsRotationModalOpen(true)}
                    >
                      <Settings className='w-4 h-4 mr-2' />
                      Configure On-Call Sets
                    </Button>
                  </>
                )}
              </div>

              {/* Board Filter */}
              <div className='bg-background border border-border rounded-lg p-4'>
                <label
                  htmlFor='board-filter'
                  className='block text-sm font-medium text-foreground mb-2'
                >
                  Filter by Board
                </label>
                <select
                  id='board-filter'
                  value={selectedBoardId ?? ''}
                  onChange={e => setSelectedBoardId(e.target.value || null)}
                  className='block w-full max-w-md px-3 py-2 border border-input rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'
                  data-track-event='change'
                  data-track-category='UserGroups'
                  data-track-name='SelectBoardFilter'
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
                <div className='bg-background border border-border rounded-lg p-4'>
                  <label
                    htmlFor='board-weight'
                    className='block text-sm font-medium text-foreground mb-2'
                  >
                    Board Weight
                  </label>
                  <p className='text-xs text-muted-foreground mb-3'>
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
                    className='block w-32 px-3 py-2 border border-input rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
                    data-track-event='change'
                    data-track-category='UserGroups'
                    data-track-name='SetBoardWeight'
                  />

                  <div className='mt-4 pt-4 border-t border-border'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <span className='block text-sm font-medium text-foreground'>
                          Use Percentage Assignment
                        </span>
                        <p className='text-xs text-muted-foreground mt-1'>
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

              {/* User Assignment Table - Grouped by Set when rotation is enabled */}
              {localAutoRotationEnabled ? (
                // Render users grouped by set
                Array.from({ length: currentMaxSet }, (_, i) => i + 1).map(renderSetSection)
              ) : (
                // Render flat user list when rotation is disabled
                <div className='bg-background border border-border rounded-lg overflow-hidden'>
                  <table className='min-w-full divide-y divide-border'>
                    <thead className='bg-muted'>
                      <tr>
                        <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                          User
                        </th>
                        <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                          On-Call
                        </th>
                        <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                          Active
                        </th>
                        {selectedBoardId && (
                          <>
                            <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                              Expertise ({boards.find(b => b.id === selectedBoardId)?.name})
                            </th>
                            {localUsePercentage && (
                              <>
                                <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                                  % Share
                                  <span
                                    className={`block text-xs font-normal mt-1 ${
                                      totalPercentage === 100 ? 'text-green-600' : 'text-red-600'
                                    }`}
                                  >
                                    (Total: {totalPercentage}%)
                                  </span>
                                </th>
                                <th className='px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                                  Max Tickets
                                </th>
                              </>
                            )}
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className='bg-background divide-y divide-border'>
                      {users.map(renderUserRow)}
                      {users.length === 0 && (
                        <tr>
                          <td
                            colSpan={selectedBoardId ? (localUsePercentage ? 6 : 4) : 3}
                            className='px-6 py-4 text-center text-sm text-muted-foreground'
                          >
                            No users in this group
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Percentage Error Message */}
              {percentageError && (
                <div className='bg-red-50 border border-red-200 rounded-lg p-4'>
                  <p className='text-sm text-red-600'>{percentageError}</p>
                </div>
              )}

              {/* Info Section */}
              <div className='bg-muted border border-border rounded-lg p-4'>
                <h3 className='font-medium text-foreground mb-2'>How Auto-Assignment Works</h3>
                <ul className='text-sm text-muted-foreground space-y-1 list-disc list-inside'>
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
                  <li>
                    <strong>On-Call Rotation</strong>: Only the active set receives tickets.
                    Rotation happens automatically based on the configured interval.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* On-Call Rotation Modal */}
      {isRotationModalOpen && (
        <OnCallRotationModal
          isOpen={isRotationModalOpen}
          groupName={userGroup?.name ?? 'User Group'}
          users={users}
          userGroupMembers={effectiveUserGroupMembers.map(m => ({
            userId: m.userId,
            onCallSetNumbers: m.onCallSetNumbers,
          }))}
          activeSet={activeSet}
          onClose={() => setIsRotationModalOpen(false)}
          onSetsChange={handleSetsChange}
        />
      )}

      {/* Disable Auto-Rotation Warning Dialog */}
      <Dialog
        open={showDisableRotationWarning}
        onOpenChange={setShowDisableRotationWarning}
        title='Disable Auto-Rotation?'
      >
        <div className='p-6'>
          <p className='text-sm text-muted-foreground mb-4'>
            Disabling auto-rotation will clear all set configurations. When you re-enable rotation
            in the future, you will need to reconfigure the on-call sets from scratch.
          </p>
          <p className='text-sm text-muted-foreground mb-6'>Are you sure you want to continue?</p>

          <div className='flex justify-end gap-3'>
            <Button
              variant='secondary'
              onClick={() => setShowDisableRotationWarning(false)}
              data-track-category='UserGroups'
              data-track-name='CancelDisableRotation'
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowDisableRotationWarning(false);
                performSave();
              }}
              className='bg-red-600 hover:bg-red-700 text-white'
              data-track-category='UserGroups'
              data-track-name='ConfirmDisableRotation'
              data-track-metadata={JSON.stringify({ userGroupId })}
            >
              Disable Rotation
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
