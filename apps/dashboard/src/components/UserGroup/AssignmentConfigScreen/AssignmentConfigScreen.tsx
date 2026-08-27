import { ReactElement, useState, useEffect, useMemo } from 'react';
import { useZero } from '../../../hooks/useZero';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, PauseCircle, Settings02 } from '@xyne/icons';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { Switch } from '../../ui/Switch';
import Input from '../../ui/Input/Input';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { MultiSelect } from '../../ui/MultiSelect';
import { Tooltip } from '../../ui/Tooltip';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
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
import { VisibilityTab } from './VisibilityTab';

interface AssignmentConfigScreenProps {
  userGroupId: string;
}

const ROTATION_INTERVAL_OPTIONS: { value: RotationInterval; label: string }[] = [
  { value: 'WEEKLY' as RotationInterval, label: 'Weekly' },
  { value: 'BIWEEKLY' as RotationInterval, label: 'Bi-Weekly' },
  { value: 'MONTHLY' as RotationInterval, label: 'Monthly' },
];

/** Radix Select rejects an empty-string item value, so "no board filter" needs a sentinel. */
const ALL_BOARDS_VALUE = '__all_boards__';

const TABLE_HEAD_CELL =
  'px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground';

const isPausedFromAssignment = (user: User | undefined): boolean => {
  const until = user?.assignmentUnavailableUntil as number | undefined;
  return until ? until > Date.now() : false;
};

export const AssignmentConfigScreen = ({
  userGroupId,
}: AssignmentConfigScreenProps): ReactElement => {
  const navigate = useNavigate();
  const zero = useZero();
  const { userID } = useAuthContextValues();
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [boardWeight, setBoardWeight] = useState<string>('1');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [percentageError, setPercentageError] = useState<string | null>(null);
  const [maxWorkloadError, setMaxWorkloadError] = useState<string | null>(null);
  const [isRotationModalOpen, setIsRotationModalOpen] = useState(false);
  const [showDisableRotationWarning, setShowDisableRotationWarning] = useState(false);
  const [activeTab, setActiveTab] = useState<'availability' | 'visibility'>('availability');
  // Members switched off in this session who were opted in to a ticket handoff on save
  const [pendingReassignUserIds, setPendingReassignUserIds] = useState<Set<string>>(new Set());
  // Handoff prompt raised by switching a member off. `previous` and `previousHasChanges`
  // are the state Cancel restores.
  const [reassignPrompt, setReassignPrompt] = useState<{
    userId: string;
    previous: { onCall: boolean; isActive: boolean };
    previousHasChanges: boolean;
  } | null>(null);
  const [reassignPromptChecked, setReassignPromptChecked] = useState(false);

  // Current time for active set calculation (updates every 5 minutes)
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Local state for pending changes
  const [localUserStates, setLocalUserStates] = useState<
    Map<string, { onCall: boolean; isActive: boolean }>
  >(new Map());
  const [localExpertise, setLocalExpertise] = useState<Map<string, boolean>>(new Map());
  const [localIsNotified, setLocalIsNotified] = useState<Map<string, boolean>>(new Map());
  const [selectedNotifyRoleIds, setSelectedNotifyRoleIds] = useState<string[]>([]);
  const [localPercentage, setLocalPercentage] = useState<Map<string, number>>(new Map());
  const [localMaxTickets, setLocalMaxTickets] = useState<Map<string, number>>(new Map());
  const [localBoardWeight, setLocalBoardWeight] = useState<number>(1);
  const [localUsePercentage, setLocalUsePercentage] = useState<boolean>(false);

  // Group-level rotation state
  const [localAutoRotationEnabled, setLocalAutoRotationEnabled] = useState<boolean>(false);
  const [localReassignOnUnavailable, setLocalReassignOnUnavailable] = useState<boolean>(false);
  const [localMaxWorkloadEnabled, setLocalMaxWorkloadEnabled] = useState<boolean>(false);
  const [maxWorkloadInput, setMaxWorkloadInput] = useState<string>('');
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

  const [userWorkloadMappings] = useCachedQuery(queries.getUserWorkloadMappings({ userGroupId }));

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

  // Workload/complexity data is ACL-scoped to group members: if the viewer isn't
  // in the group, those queries silently sync empty rather than erroring.
  const isCurrentUserGroupMember = useMemo(
    () => (userGroupMembers ?? []).some(mapping => mapping.userId === userID),
    [userGroupMembers, userID],
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

  const availableNotifyRoles = useMemo(() => {
    const byId = new Map<string, string>();
    for (const mapping of userGroupMembers ?? []) {
      const role = (mapping as { role?: { id?: string; name?: string } | null }).role;
      if (role?.id && role.name) {
        byId.set(role.id, role.name);
      }
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [userGroupMembers]);

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
      const notifiedMap = new Map<string, boolean>();
      for (const mapping of userGroupMembers) {
        const state = userAssignmentStates.find(
          (s: UserAssignmentState) => s.userId === mapping.userId,
        );
        statesMap.set(mapping.userId, {
          onCall: state?.onCall || false,
          isActive: state?.isActiveForAssignment === true,
        });
        notifiedMap.set(mapping.userId, mapping.isNotified === true);
      }
      setLocalUserStates(statesMap);
      setLocalIsNotified(notifiedMap);
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
      setLocalReassignOnUnavailable(userGroup.reassignOnUnavailable ?? false);
      const savedMaxWorkload = userGroup.maxWorkload ?? null;
      setLocalMaxWorkloadEnabled(savedMaxWorkload !== null);
      setMaxWorkloadInput(savedMaxWorkload !== null ? String(savedMaxWorkload) : '');
    }
  }, [
    userGroup?.autoRotationEnabled,
    userGroup?.rotationInterval,
    userGroup?.reassignOnUnavailable,
    userGroup?.maxWorkload,
  ]);

  const boards = useMemo(() => allBoards || [], [allBoards]);

  const setPendingReassign = (userId: string, shouldReassign: boolean): void => {
    setPendingReassignUserIds(prev => {
      if (prev.has(userId) === shouldReassign) return prev;
      const next = new Set(prev);
      if (shouldReassign) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  // Zero data, so it includes un-flushed optimistic edits: read before mutating, never
  // after, or post-save it just reports the value we wrote.
  const isActiveOnServer = (userId: string): boolean => {
    const serverState = userAssignmentStates?.find((s: UserAssignmentState) => s.userId === userId);
    return serverState?.isActiveForAssignment === true;
  };

  // True only while a member who is still active on the server has been switched off
  // locally and not saved yet — the window in which the handoff opt-in is offered.
  const isDeactivatedInSession = (userId: string): boolean => {
    if (!isActiveOnServer(userId)) return false;
    return localUserStates.get(userId)?.isActive === false;
  };

  // Single source of truth for the handoff promise, so the row badge can never advertise
  // a handoff that save would skip — e.g. after the group setting is switched off, or
  // after a concurrent edit syncs in and re-seeds the local switches.
  const willReassignOnSave = (userId: string): boolean => {
    return (
      localReassignOnUnavailable &&
      pendingReassignUserIds.has(userId) &&
      isDeactivatedInSession(userId)
    );
  };

  const handleToggleOnCall = (userId: string): void => {
    if (isPausedFromAssignment(users.find(u => u.id === userId))) return;
    const currentState = localUserStates.get(userId);
    if (currentState) {
      const newStates = new Map(localUserStates);
      // If turning onCall ON, automatically set isActive to true
      if (!currentState.onCall) {
        newStates.set(userId, { onCall: true, isActive: true });
        setPendingReassign(userId, false);
      } else {
        newStates.set(userId, { ...currentState, onCall: false });
      }
      setLocalUserStates(newStates);
      setHasChanges(true);
    }
  };

  const handleToggleActiveForAssignment = (userId: string): void => {
    if (isPausedFromAssignment(users.find(u => u.id === userId))) return;
    const currentState = localUserStates.get(userId);
    if (currentState) {
      const newStates = new Map(localUserStates);
      // If turning isActive OFF, automatically set onCall to false as well
      if (currentState.isActive) {
        newStates.set(userId, { onCall: false, isActive: false });
        // Deactivating strands their open tickets, so ask about the handoff the group
        // has opted into. Starts unchecked: tickets stay with them unless asked otherwise.
        // Switching off someone already inactive on the server strands nothing, so they
        // get no prompt — the same condition the handoff is filtered on at save.
        if (localReassignOnUnavailable && isActiveOnServer(userId)) {
          setReassignPromptChecked(false);
          setReassignPrompt({ userId, previous: currentState, previousHasChanges: hasChanges });
        }
      } else {
        newStates.set(userId, { ...currentState, isActive: true });
      }
      // Re-toggling always retires the previous answer; Continue records the new one.
      setPendingReassign(userId, false);
      setLocalUserStates(newStates);
      setHasChanges(true);
    }
  };

  const handleToggleIsNotified = (userId: string): void => {
    const newNotified = new Map(localIsNotified);
    const currentValue = newNotified.get(userId) ?? false;
    newNotified.set(userId, !currentValue);
    setLocalIsNotified(newNotified);
    setHasChanges(true);
  };

  // Bulk-enable Notify for every current member whose role is in
  // selectedNotifyRoleIds. Additive only — never turns anyone off, so it can't
  // silently undo a manual opt-in from someone outside the selected roles.
  const handleApplyNotifyRoles = (): void => {
    if (selectedNotifyRoleIds.length === 0) return;
    const newNotified = new Map(localIsNotified);
    let enabledCount = 0;
    for (const mapping of userGroupMembers ?? []) {
      const roleId = (mapping as { role?: { id?: string } | null }).role?.id;
      if (roleId && selectedNotifyRoleIds.includes(roleId) && !newNotified.get(mapping.userId)) {
        newNotified.set(mapping.userId, true);
        enabledCount++;
      }
    }
    setLocalIsNotified(newNotified);
    if (enabledCount > 0) {
      setHasChanges(true);
      toast.success(
        `Enabled Notify for ${enabledCount} member${enabledCount === 1 ? '' : 's'}. Click Save changes to apply.`,
      );
    } else {
      toast.info('Everyone in the selected roles is already enabled.');
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

  const handleMaxWorkloadChange = (value: string): void => {
    const sanitizedValue = value.replace(/[^0-9]/g, '');
    if (sanitizedValue === '') {
      setMaxWorkloadInput('');
      setHasChanges(true);
      return;
    }
    const withoutLeadingZeros = sanitizedValue.replace(/^0+/, '');
    if (withoutLeadingZeros === '') {
      setMaxWorkloadInput('');
      setHasChanges(true);
      return;
    }
    setMaxWorkloadInput(withoutLeadingZeros);
    setHasChanges(true);
  };

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

    void performSave();
  };

  const performSave = async (): Promise<void> => {
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

    // A max-workload cap that is switched on must carry a positive integer.
    const parsedMaxWorkload = parseInt(maxWorkloadInput, 10);
    if (localMaxWorkloadEnabled && (isNaN(parsedMaxWorkload) || parsedMaxWorkload < 1)) {
      setMaxWorkloadError('Enter a max workload of 1 or more, or turn the limit off.');
      return;
    }
    setMaxWorkloadError(null);

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
            isNotified: localIsNotified.get(userId) ?? false,
          }))
        : (userGroupMembers ?? []).map(m => ({
            userId: m.userId,
            onCallSetNumbers: localAutoRotationEnabled
              ? ((m.onCallSetNumbers as number[] | undefined) ?? [1])
              : [],
            isNotified: localIsNotified.get(m.userId) ?? false,
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

      // Rides along with the states so the handoff commits or rolls back with them.
      // The server re-derives who actually transitioned active -> inactive.
      const reassignUserIds = [...pendingReassignUserIds].filter(willReassignOnSave);

      const reassignOnUnavailableChanged =
        localReassignOnUnavailable !== (userGroup?.reassignOnUnavailable ?? false);

      // null clears the cap; the mutator skips the field entirely when undefined.
      const nextMaxWorkload = localMaxWorkloadEnabled ? parsedMaxWorkload : null;
      const maxWorkloadChanged = nextMaxWorkload !== (userGroup?.maxWorkload ?? null);

      const pendingServerResults = [
        // Ordered before batchUpdate on purpose: its post-commit handoff reads both settings
        // from committed rows — reassignOnUnavailable gates it, maxWorkload caps candidates.
        ...(reassignOnUnavailableChanged || maxWorkloadChanged
          ? [
              zero.mutate(
                mutators.userGroup.update({
                  userGroupId,
                  ...(reassignOnUnavailableChanged && {
                    reassignOnUnavailable: localReassignOnUnavailable,
                  }),
                  ...(maxWorkloadChanged && { maxWorkload: nextMaxWorkload }),
                  timestamp: Date.now(),
                }),
              ).server,
            ]
          : []),
        zero.mutate(
          mutators.assignmentConfig.batchUpdate({
            userGroupId,
            userStates,
            boardWeight: boardWeightData,
            expertiseMappings: expertiseMappingsData,
            userMappings,
            stateIds,
            reassignUserIds,
            complexityScoreId: uuidv4(),
            mappingIds,
            timestamp: Date.now(),
          }),
        ).server,
      ];

      // Also update rotation settings (enable/disable, interval)
      const rotationChanged =
        localAutoRotationEnabled !== (userGroup?.autoRotationEnabled ?? false) ||
        (localAutoRotationEnabled &&
          localRotationInterval !== (userGroup?.rotationInterval ?? 'WEEKLY'));

      if (rotationChanged) {
        pendingServerResults.push(
          zero.mutate(
            mutators.assignmentConfig.toggleGroupAutoRotation({
              userGroupId,
              autoRotationEnabled: localAutoRotationEnabled,
              rotationInterval: localAutoRotationEnabled ? localRotationInterval : undefined,
              rotationStartDate: localAutoRotationEnabled ? Date.now() : undefined,
              timestamp: Date.now(),
            }),
          ).server,
        );
      }

      const serverResults = await Promise.all(pendingServerResults);
      const failedResult = serverResults.find(result => result.type === 'error');
      if (failedResult?.type === 'error') {
        throw new Error(failedResult.error.message || 'Failed to save assignment configuration');
      }

      if (reassignUserIds.length > 0) {
        toast.success('Availability saved', {
          description: `Ticket handoff queued for ${reassignUserIds.length} member(s).`,
        });
      }
      setPendingReassignUserIds(new Set());

      setHasChanges(false);
      setPendingSetMappings(null);
      setJustSaved(true);
    } catch (error) {
      toast.error('Changes not saved', {
        description:
          error instanceof Error ? error.message : 'Something went wrong on save. Try again.',
        duration: 5000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetsChange = (sets: Map<string, number[]>): void => {
    setPendingSetMappings(sets);
    setHasChanges(true);
  };

  const reassignPromptUser = reassignPrompt
    ? users.find(u => u.id === reassignPrompt.userId)
    : undefined;

  // Cancel undoes the switch that raised the prompt, leaving the member active.
  const cancelReassignPrompt = (): void => {
    if (reassignPrompt) {
      const { userId, previous, previousHasChanges } = reassignPrompt;
      setLocalUserStates(prev => new Map(prev).set(userId, previous));
      setPendingReassign(userId, false);
      // Undoing the only edit of the session leaves nothing to save; edits made before
      // the switch keep the flag set.
      setHasChanges(previousHasChanges);
    }
    setReassignPrompt(null);
  };

  // Continue keeps the member switched off and records whatever the checkbox says; the
  // screen's "Save changes" button is what actually persists it.
  const confirmReassignPrompt = (): void => {
    if (reassignPrompt) {
      setPendingReassign(reassignPrompt.userId, reassignPromptChecked);
    }
    setReassignPrompt(null);
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
    const isUnavailable = isPausedFromAssignment(user);
    const unavailableTooltip = assignmentUnavailableUntil
      ? `Unavailable until ${formatExpiryTime(assignmentUnavailableUntil, false)}`
      : 'Unavailable for ticket assignment';
    const pausedSwitchTooltip = assignmentUnavailableUntil
      ? `Paused from ticket assignment until ${formatExpiryTime(assignmentUnavailableUntil, false)}. They can resume from Preferences > Availability.`
      : 'Paused from ticket assignment. They can resume from Preferences > Availability.';

    const renderAvailabilitySwitch = (checked: boolean, onToggle: () => void): ReactElement =>
      isUnavailable ? (
        <Tooltip content={pausedSwitchTooltip}>
          <span className='inline-flex'>
            <Switch checked={checked} onCheckedChange={onToggle} disabled />
          </span>
        </Tooltip>
      ) : (
        <Switch checked={checked} onCheckedChange={onToggle} />
      );

    return (
      <tr key={user.id} className='transition-colors hover:bg-muted/50'>
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
                {willReassignOnSave(user.id) && (
                  <span className='flex-shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
                    Tickets will be reassigned
                  </span>
                )}
              </div>
              <div className='text-sm text-muted-foreground'>{user.email}</div>
            </div>
          </div>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-center align-middle'>
          <div className='flex items-center justify-center h-full'>
            {renderAvailabilitySwitch(localState.onCall, () => handleToggleOnCall(user.id))}
          </div>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-center align-middle'>
          <div className='flex items-center justify-center h-full'>
            {renderAvailabilitySwitch(localState.isActive, () =>
              handleToggleActiveForAssignment(user.id),
            )}
          </div>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-center align-middle'>
          <div className='flex items-center justify-center h-full'>
            <Switch
              checked={localIsNotified.get(user.id) ?? false}
              onCheckedChange={() => handleToggleIsNotified(user.id)}
              data-track-event='change'
              data-track-category='UserGroup'
              data-track-name='ToggleIsNotified'
              data-track-metadata={JSON.stringify({ userId: user.id })}
            />
          </div>
        </td>
        {selectedBoardId && (
          <>
            <td className='px-6 py-4 whitespace-nowrap text-center'>
              <div
                className='flex items-center justify-center'
                data-track-category='UserGroup'
                data-track-name='ToggleExpertise'
                data-track-metadata={JSON.stringify({ userId: user.id })}
              >
                <Checkbox
                  checked={hasLocalExpertise(user.id)}
                  onChange={() => handleToggleExpertise(user.id)}
                  label=''
                />
              </div>
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
      <div key={setNumber}>
        <div className='mb-3 flex items-center gap-3'>
          <h3 className='flex items-center gap-2 text-sm font-semibold text-foreground'>
            Set {setNumber}
            {isActive && (
              <span className='inline-flex items-center rounded-full bg-stage-completed px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-success'>
                Active
              </span>
            )}
          </h3>
          {localUsePercentage && selectedBoardId && (
            <span
              className={cn(
                'text-xs font-medium',
                setPercentageTotal === 100 ? 'text-status-success' : 'text-status-failure',
              )}
            >
              Total: {setPercentageTotal}%
            </span>
          )}
        </div>
        <div className='overflow-hidden rounded-2xl border border-border bg-card'>
          <div className='overflow-x-auto'>
            <table className='min-w-full table-fixed divide-y divide-border'>
              <thead className='bg-muted/50'>
                <tr>
                  <th className={cn(TABLE_HEAD_CELL, 'w-[32%] text-left')}>User</th>
                  <th className={cn(TABLE_HEAD_CELL, 'w-[12%] text-center')}>On-Call</th>
                  <th className={cn(TABLE_HEAD_CELL, 'w-[12%] text-center')}>Active</th>
                  <th className={cn(TABLE_HEAD_CELL, 'w-[12%] text-center')}>Notify</th>
                  {selectedBoardId && (
                    <>
                      <th className={cn(TABLE_HEAD_CELL, 'w-[12%] text-center')}>Expertise</th>
                      {localUsePercentage && (
                        <>
                          <th className={cn(TABLE_HEAD_CELL, 'w-[12%] text-center')}>% Share</th>
                          <th className={cn(TABLE_HEAD_CELL, 'w-[12%] text-center')}>
                            Max Tickets
                          </th>
                        </>
                      )}
                    </>
                  )}
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {setUsers.length > 0 ? (
                  setUsers.map(renderUserRow)
                ) : (
                  <tr>
                    <td
                      colSpan={selectedBoardId ? (localUsePercentage ? 7 : 5) : 4}
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
      </div>
    );
  };

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'>
      {/* Header */}
      <div className='shrink-0'>
        <div className='flex w-full items-center gap-5 px-6 pt-5'>
          <Button
            variant='ghost'
            size='iconSm'
            className='shrink-0 text-muted-foreground hover:text-foreground'
            onClick={() => void navigate('/user-groups')}
            aria-label='Back to user groups'
            data-track-category='UserGroups'
            data-track-name='BackToUserGroups'
          >
            <ArrowLeft size={16} />
          </Button>
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <h1 className='text-base font-semibold leading-7 tracking-[-0.32px] text-foreground'>
              Assignment Configuration
            </h1>
            <p className='truncate text-[15px] leading-[1.2] text-muted-foreground'>
              {userGroup?.name || 'User Group'}
              {userGroup?.description ? ` • ${userGroup.description}` : ''}
            </p>
          </div>
          <Button
            className='h-auto shrink-0 rounded-lg p-2 text-sm'
            onClick={() => void handleSave()}
            disabled={!hasChanges || isSaving || !isPercentageValid}
            data-track-category='UserGroups'
            data-track-name='SaveAssignmentConfig'
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className='flex-1 overflow-y-auto'>
        <div className='w-full space-y-4 px-6 pb-8 pt-8'>
          {/* Tabs */}
          <div className='flex gap-1 rounded-xl border border-border bg-muted/40 p-1'>
            <button
              type='button'
              onClick={() => setActiveTab('availability')}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                activeTab === 'availability'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-track-category='UserGroups'
              data-track-name='AssignmentTabAvailability'
            >
              Availability
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('visibility')}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                activeTab === 'visibility'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-track-category='UserGroups'
              data-track-name='AssignmentTabVisibility'
            >
              Visibility
            </button>
          </div>

          {activeTab === 'availability' && (
            <>
              {/* Group-Level Rotation Configuration */}
              <div className='rounded-2xl border border-border bg-card p-4'>
                <div className='mb-4'>
                  <h2 className='text-sm font-semibold text-foreground'>On-call rotation</h2>
                  <p className='mt-1 text-[13px] leading-[1.4] text-muted-foreground'>
                    Rotate on-call status across team sets automatically.
                  </p>
                </div>

                <div className='flex items-center justify-between gap-4 border-t border-border pt-4'>
                  <div className='min-w-0'>
                    <span className='block text-[13px] font-medium text-foreground'>
                      Enable auto-rotation
                    </span>
                    <p className='mt-1 text-xs leading-[1.4] text-muted-foreground'>
                      On-call status moves to the next set on the interval you choose.
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
                  <div className='mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4'>
                    <div className='flex flex-col gap-2'>
                      <span className='text-[13px] font-medium text-foreground'>
                        Rotation interval
                      </span>
                      <Select
                        value={localRotationInterval}
                        onValueChange={value => {
                          setLocalRotationInterval(value as RotationInterval);
                          setHasChanges(true);
                        }}
                      >
                        <SelectTrigger
                          className='w-[200px]'
                          aria-label='Rotation interval'
                          data-track-category='UserGroups'
                          data-track-name='ChangeRotationInterval'
                        >
                          <SelectValue placeholder='Select an interval' />
                        </SelectTrigger>
                        <SelectContent>
                          {ROTATION_INTERVAL_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      variant='outline'
                      onClick={() => setIsRotationModalOpen(true)}
                      data-track-category='UserGroups'
                      data-track-name='OPEN_ON_CALL_ROTATION_MODAL'
                    >
                      <Settings02 size={16} />
                      Configure on-call sets
                    </Button>
                  </div>
                )}
              </div>

              {/* Allow reassignment on unavailability */}
              <div className='rounded-2xl border border-border bg-card p-4'>
                <div className='mb-4'>
                  <h2 className='text-sm font-semibold text-foreground'>
                    Allow reassignment on unavailability
                  </h2>
                  <p className='mt-1 text-[13px] leading-[1.4] text-muted-foreground'>
                    Let members of this group choose whether to hand off their existing open tickets
                    when they pause ticket assignment.
                  </p>
                </div>

                <div className='flex items-center justify-between gap-4 border-t border-border pt-4'>
                  <div className='min-w-0'>
                    <span className='block text-[13px] font-medium text-foreground'>
                      Allow existing-ticket reassignment
                    </span>
                    <p className='mt-1 text-xs leading-[1.4] text-muted-foreground'>
                      Members can opt in from the pause dialog. If no eligible replacement exists,
                      their tickets stay assigned to them.
                    </p>
                  </div>
                  <Switch
                    checked={localReassignOnUnavailable}
                    onCheckedChange={checked => {
                      setLocalReassignOnUnavailable(checked);
                      setHasChanges(true);
                    }}
                  />
                </div>
              </div>

              {/* Max workload cap */}
              <div className='rounded-2xl border border-border bg-card p-4'>
                <div className='mb-4'>
                  <h2 className='text-sm font-semibold text-foreground'>Max workload</h2>
                  <p className='mt-1 text-[13px] leading-[1.4] text-muted-foreground'>
                    Cap how much work one member can hold at once, counted as the sum of their open
                    tickets multiplied by each board&apos;s weight.
                  </p>
                </div>

                <div className='flex items-center justify-between gap-4 border-t border-border pt-4'>
                  <div className='min-w-0'>
                    <span className='block text-[13px] font-medium text-foreground'>
                      Limit workload per member
                    </span>
                    <p className='mt-1 text-xs leading-[1.4] text-muted-foreground'>
                      When a member reaches this limit they stop receiving new tickets. If everyone
                      is at the limit, no one is assigned. Off means no limit.
                    </p>
                  </div>
                  <Switch
                    checked={localMaxWorkloadEnabled}
                    onCheckedChange={checked => {
                      setLocalMaxWorkloadEnabled(checked);
                      if (!checked) {
                        setMaxWorkloadInput('');
                        setMaxWorkloadError(null);
                      }
                      setHasChanges(true);
                    }}
                  />
                </div>

                {localMaxWorkloadEnabled && (
                  <div className='mt-4 flex flex-col gap-2 border-t border-border pt-4'>
                    <label
                      htmlFor='max-workload'
                      className='text-[13px] font-medium text-foreground'
                    >
                      Workload limit
                    </label>
                    <p className='text-xs leading-[1.4] text-muted-foreground'>
                      Weighted total, not a ticket count. On a board with weight 3, one ticket uses
                      3 of this limit.
                    </p>
                    <Input
                      type='text'
                      inputMode='numeric'
                      id='max-workload'
                      value={maxWorkloadInput}
                      onChange={e => handleMaxWorkloadChange(e.target.value)}
                      placeholder='e.g. 20'
                      className='mt-1 w-24 text-sm'
                      data-track-event='change'
                      data-track-category='UserGroups'
                      data-track-name='SetMaxWorkload'
                    />
                    {maxWorkloadError && (
                      <p className='text-[13px] text-destructive'>{maxWorkloadError}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Board Filter */}
              <div className='rounded-2xl border border-border bg-card p-4'>
                <div className='flex flex-col gap-2'>
                  <span className='text-[13px] font-medium text-foreground'>Filter by board</span>
                  <Select
                    value={selectedBoardId ?? ALL_BOARDS_VALUE}
                    onValueChange={value =>
                      setSelectedBoardId(value === ALL_BOARDS_VALUE ? null : value)
                    }
                  >
                    <SelectTrigger
                      className='w-full max-w-[320px]'
                      aria-label='Filter by board'
                      data-track-category='UserGroups'
                      data-track-name='SelectBoardFilter'
                    >
                      <SelectValue placeholder='All boards' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_BOARDS_VALUE}>All boards</SelectItem>
                      {boards.map((board: Board) => (
                        <SelectItem key={board.id} value={board.id}>
                          {board.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-xs leading-[1.4] text-muted-foreground'>
                    Pick a board to set per-board weight, expertise and share.
                  </p>
                </div>
              </div>

              {/* Board Weight Configuration - Only shown when a specific board is selected */}
              {selectedBoardId && (
                <div className='rounded-2xl border border-border bg-card p-4'>
                  <div className='flex flex-col gap-2'>
                    <label
                      htmlFor='board-weight'
                      className='text-[13px] font-medium text-foreground'
                    >
                      Board weight
                    </label>
                    <p className='text-xs leading-[1.4] text-muted-foreground'>
                      Higher weights increase how much this board&apos;s tickets count towards a
                      person&apos;s workload. Range: 1 to 100.
                    </p>
                    <Input
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
                      className='mt-1 w-24 text-sm'
                      data-track-event='change'
                      data-track-category='UserGroups'
                      data-track-name='SetBoardWeight'
                    />
                  </div>

                  <div className='mt-4 flex items-center justify-between gap-4 border-t border-border pt-4'>
                    <div className='min-w-0'>
                      <span className='block text-[13px] font-medium text-foreground'>
                        Use percentage assignment
                      </span>
                      <p className='mt-1 text-xs leading-[1.4] text-muted-foreground'>
                        Distribute tickets by % share instead of standard workload balancing.
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
              )}

              {/* Bulk-enable Notify by role */}
              {availableNotifyRoles.length > 0 && (
                <div className='rounded-2xl border border-border bg-card p-4'>
                  <div className='mb-3'>
                    <h2 className='text-sm font-semibold text-foreground'>Enable Notify by role</h2>
                    <p className='mt-1 text-[13px] leading-[1.4] text-muted-foreground'>
                      Pick one or more roles to turn on Notify for everyone currently in that role.
                      This only turns Notify on — it never turns it off, and you can still adjust
                      individual members below before saving.
                    </p>
                  </div>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
                    <div className='flex-1'>
                      <MultiSelect
                        options={availableNotifyRoles.map(role => ({
                          value: role.id,
                          label: role.name,
                        }))}
                        selectedValues={selectedNotifyRoleIds}
                        onChange={setSelectedNotifyRoleIds}
                        placeholder='Select roles...'
                      />
                    </div>
                    <Button
                      variant='outline'
                      onClick={handleApplyNotifyRoles}
                      disabled={selectedNotifyRoleIds.length === 0}
                      data-track-event='click'
                      data-track-category='UserGroup'
                      data-track-name='ApplyNotifyByRole'
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              )}

              {/* User Assignment Table - Grouped by Set when rotation is enabled */}
              {localAutoRotationEnabled ? (
                // Render users grouped by set
                <div className='space-y-6'>
                  {Array.from({ length: currentMaxSet }, (_, i) => i + 1).map(renderSetSection)}
                </div>
              ) : (
                // Render flat user list when rotation is disabled
                <div className='overflow-hidden rounded-2xl border border-border bg-card'>
                  <div className='overflow-x-auto'>
                    <table className='min-w-full divide-y divide-border'>
                      <thead className='bg-muted/50'>
                        <tr>
                          <th className={cn(TABLE_HEAD_CELL, 'text-left')}>User</th>
                          <th className={cn(TABLE_HEAD_CELL, 'text-center')}>On-Call</th>
                          <th className={cn(TABLE_HEAD_CELL, 'text-center')}>Active</th>
                          <th className={cn(TABLE_HEAD_CELL, 'text-center')}>Notify</th>
                          {selectedBoardId && (
                            <>
                              <th className={cn(TABLE_HEAD_CELL, 'text-center')}>
                                Expertise ({boards.find(b => b.id === selectedBoardId)?.name})
                              </th>
                              {localUsePercentage && (
                                <>
                                  <th className={cn(TABLE_HEAD_CELL, 'text-center')}>
                                    % Share
                                    <span
                                      className={cn(
                                        'mt-1 block text-xs font-normal normal-case tracking-normal',
                                        totalPercentage === 100
                                          ? 'text-status-success'
                                          : 'text-status-failure',
                                      )}
                                    >
                                      Total: {totalPercentage}%
                                    </span>
                                  </th>
                                  <th className={cn(TABLE_HEAD_CELL, 'text-center')}>
                                    Max Tickets
                                  </th>
                                </>
                              )}
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className='divide-y divide-border'>
                        {users.map(renderUserRow)}
                        {users.length === 0 && (
                          <tr>
                            <td
                              colSpan={selectedBoardId ? (localUsePercentage ? 7 : 5) : 4}
                              className='px-6 py-8 text-center text-[13px] text-muted-foreground'
                            >
                              This group has no members yet. Add people to the group to configure
                              assignment.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Percentage Error Message */}
              {percentageError && (
                <div
                  role='alert'
                  className='rounded-2xl border border-destructive/30 bg-destructive/10 p-4'
                >
                  <p className='text-[13px] text-destructive'>{percentageError}</p>
                </div>
              )}

              {/* Info Section */}
              <div className='rounded-2xl border border-border bg-muted/40 p-4'>
                <h3 className='mb-2 text-sm font-semibold text-foreground'>
                  How auto-assignment works
                </h3>
                <ul className='list-inside list-disc space-y-1 text-[13px] leading-[1.5] text-muted-foreground'>
                  <li>
                    <strong className='font-medium text-foreground'>Eligibility</strong>: people
                    must be Active. On-Call is preferred but not required. Where expertise is set,
                    experts go first.
                  </li>
                  <li>
                    <strong className='font-medium text-foreground'>Score</strong>: the lowest score
                    gets the ticket —{' '}
                    <code className='font-mono text-xs'>
                      weightedActiveTasks − expertiseBonus − percentDiff
                    </code>
                  </li>
                  <li>
                    <strong className='font-medium text-foreground'>Expertise bonus</strong>:
                    experts get −10 points, which moves them up the queue.
                  </li>
                  <li>
                    <strong className='font-medium text-foreground'>% Share</strong>: anyone below
                    their target share gets priority, which evens out distribution.
                  </li>
                  <li>
                    <strong className='font-medium text-foreground'>Max tickets</strong>: people at
                    their limit are skipped. Leave it empty for no limit.
                  </li>
                  <li>
                    <strong className='font-medium text-foreground'>Board weight</strong>:
                    multiplies ticket impact. A weight of 2 makes one ticket count as two.
                  </li>
                  <li>
                    <strong className='font-medium text-foreground'>On-call rotation</strong>: only
                    the active set receives tickets, and it advances on the interval you set.
                  </li>
                </ul>
              </div>
            </>
          )}

          {activeTab === 'visibility' && (
            <VisibilityTab
              users={users}
              boards={boards}
              selectedBoardId={selectedBoardId}
              onSelectBoard={setSelectedBoardId}
              workloadMappings={userWorkloadMappings}
              boardComplexityScores={boardComplexityScores}
              expertiseMappings={expertiseMappings}
              isCurrentUserGroupMember={isCurrentUserGroupMember}
              userGroupMappings={userGroupMembers}
              maxWorkload={userGroup?.maxWorkload ?? null}
            />
          )}
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

      {/* Reassign-On-Deactivate Dialog */}
      <Dialog
        open={reassignPrompt !== null}
        onOpenChange={open => {
          if (!open) cancelReassignPrompt();
        }}
        title='Reassign their open tickets?'
      >
        <div className='p-6'>
          <p className='text-[13px] leading-[1.5] text-muted-foreground'>
            {reassignPromptUser ? getUserDisplayName(reassignPromptUser) : 'This member'} will stop
            receiving new tickets in this group once you save. Their open tickets can be handed to
            another eligible member — if none is available, the tickets stay with them.
          </p>

          <div className='mt-4 space-y-1 rounded-lg border border-border bg-muted/30 p-3'>
            <Checkbox
              checked={reassignPromptChecked}
              onChange={setReassignPromptChecked}
              label='Reassign their existing open tickets'
            />
            <p className='pl-[26px] text-xs leading-[1.4] text-muted-foreground'>
              If unchecked, they will still be excluded from new auto-assignment once you save.
              Existing tickets will stay with them.
            </p>
          </div>

          <div className='mt-6 flex justify-end gap-3'>
            <Button
              variant='secondary'
              onClick={cancelReassignPrompt}
              data-track-category='UserGroups'
              data-track-name='CancelReassignOnDeactivate'
            >
              Cancel
            </Button>
            <Button
              onClick={confirmReassignPrompt}
              data-track-category='UserGroups'
              data-track-name='ConfirmReassignOnDeactivate'
              data-track-metadata={JSON.stringify({ userGroupId, reassignPromptChecked })}
            >
              Continue
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Disable Auto-Rotation Warning Dialog */}
      <Dialog
        open={showDisableRotationWarning}
        onOpenChange={setShowDisableRotationWarning}
        title='Disable auto-rotation?'
      >
        <div className='p-6'>
          <p className='mb-6 text-[13px] leading-[1.5] text-muted-foreground'>
            Disabling auto-rotation clears every set configuration for this group. Re-enabling it
            later means building the on-call sets again from scratch.
          </p>

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
              variant='destructive'
              onClick={() => {
                setShowDisableRotationWarning(false);
                void performSave();
              }}
              data-track-category='UserGroups'
              data-track-name='ConfirmDisableRotation'
              data-track-metadata={JSON.stringify({ userGroupId })}
            >
              Disable rotation
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
