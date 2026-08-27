import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { Plus, AlertCircle, Trash2, ChevronDown, Check } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import type { User } from '../../../machines/stateMachine';

interface OnCallRotationModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupName: string;
  users: User[];
  userGroupMembers: Array<{ userId: string; onCallSetNumbers?: number[] }>;
  activeSet: number;
  onSetsChange?: (sets: Map<string, number[]>) => void;
}

interface SetData {
  setNumber: number;
  users: User[];
  isActive: boolean;
}

interface MultiSelectDropdownProps {
  userId: string;
  currentSets: number[];
  maxSetNumber: number;
  onChange: (userId: string, newSets: number[]) => void;
}

const MultiSelectDropdown = ({
  userId,
  currentSets,
  maxSetNumber,
  onChange,
}: MultiSelectDropdownProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleSet = (setNumber: number) => {
    const newSets = currentSets.includes(setNumber)
      ? currentSets.filter(s => s !== setNumber)
      : [...currentSets, setNumber].sort((a, b) => a - b);
    onChange(userId, newSets);
  };

  const displayText =
    currentSets.length === 0
      ? 'Not assigned'
      : currentSets.length === 1
        ? `Set ${currentSets[0]}`
        : `${currentSets.length} sets`;

  return (
    <div ref={dropdownRef} className='relative'>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className='text-[11px] border border-border rounded-md p-1.5 bg-muted/20 flex items-center gap-1 min-w-[100px]'
        data-track-category='UserGroups'
        data-track-name='ToggleUserSets'
        data-track-metadata={JSON.stringify({ userId })}
      >
        <span className='flex-1 text-left'>{displayText}</span>
        <ChevronDown className='w-3 h-3' />
      </button>

      {isOpen && (
        <div className='absolute right-0 top-full mt-1 w-32 bg-background border border-border rounded-md shadow-lg z-10 py-1'>
          {Array.from({ length: maxSetNumber }, (_, i) => i + 1).map(setNumber => {
            const isSelected = currentSets.includes(setNumber);
            return (
              <button
                key={setNumber}
                onClick={() => toggleSet(setNumber)}
                className='w-full px-3 py-2 text-[11px] text-left hover:bg-muted/50 flex items-center gap-2'
                data-track-category='UserGroups'
                data-track-name='ToggleUserSet'
                data-track-metadata={JSON.stringify({ setNumber, userId })}
              >
                <div
                  className={`w-4 h-4 border rounded flex items-center justify-center ${
                    isSelected ? 'bg-[#6276BE] border-[#6276BE]' : 'border-border'
                  }`}
                >
                  {isSelected && <Check className='w-3 h-3 text-white' />}
                </div>
                Set {setNumber}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const OnCallRotationModal = ({
  isOpen,
  onClose,
  groupName,
  users,
  userGroupMembers,
  activeSet,
  onSetsChange,
}: OnCallRotationModalProps): ReactElement | null => {
  const [userSets, setUserSets] = useState<Map<string, number[]>>(new Map());
  const [maxSetNumber, setMaxSetNumber] = useState<number>(1);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from props when modal opens
  useEffect(() => {
    if (isOpen) {
      const setsMap = new Map<string, number[]>();
      let maxSet = 1;
      for (const member of userGroupMembers) {
        const setNumbers = member.onCallSetNumbers?.length ? member.onCallSetNumbers : [1];
        setsMap.set(member.userId, setNumbers);
        const memberMax = Math.max(...setNumbers);
        if (memberMax > maxSet) maxSet = memberMax;
      }
      setUserSets(setsMap);
      setMaxSetNumber(maxSet);
      setHasChanges(false);
    }
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  // Derived: sets array - a user appears in ALL sets they belong to
  const sets = useMemo<SetData[]>(() => {
    return Array.from({ length: maxSetNumber }, (_, i) => {
      const setNumber = i + 1;
      const setUsers = Array.from(userSets.entries())
        .filter(([, sets]) => sets.includes(setNumber))
        .map(([uid]) => usersById.get(uid))
        .filter((u): u is User => Boolean(u));
      return { setNumber, users: setUsers, isActive: setNumber === activeSet };
    });
  }, [userSets, maxSetNumber, usersById, activeSet]);

  // Validation: true if any set has 0 users
  const hasEmptySet = useMemo(() => sets.some(s => s.users.length === 0), [sets]);

  const handleUserSetsChange = (userId: string, newSets: number[]): void => {
    setUserSets(prev => {
      const newMap = new Map(prev);
      if (newSets.length === 0) {
        // Ensure user is always in at least Set 1 (or we could remove them entirely)
        // For now, keep them in Set 1 as default
        newMap.set(userId, [1]);
      } else {
        newMap.set(userId, newSets);
      }
      return newMap;
    });
    setHasChanges(true);
  };

  const handleCreateSet = (): void => {
    setMaxSetNumber(prev => prev + 1);
    setHasChanges(true);
  };

  /**
   * Delete an empty set and remove it from all users' assignments.
   * When deleting Set N, renumber all sets N+1, N+2, etc. by decrementing by 1.
   *
   * Example:
   * - Before: Set 1 [A,B], Set 2 [], Set 3 [C,D], Set 4 [E]
   * - Delete Set 2 (must be empty first)
   * - After: Set 1 [A,B], Set 2 [C,D], Set 3 [E]
   * - User C goes from [3] to [2], User E goes from [4] to [3]
   */
  const handleDeleteSet = (setNumberToDelete: number): void => {
    // Only allow deleting empty sets
    const setToDelete = sets.find(s => s.setNumber === setNumberToDelete);
    if (!setToDelete || setToDelete.users.length > 0) {
      return; // Can only delete empty sets
    }

    setUserSets(prev => {
      const newMap = new Map<string, number[]>();
      for (const [userId, userSetsArr] of prev.entries()) {
        const adjustedSets = userSetsArr
          .filter(s => s !== setNumberToDelete) // Remove the deleted set
          .map(s => (s > setNumberToDelete ? s - 1 : s)); // Decrement higher sets
        // Ensure at least Set 1
        newMap.set(userId, adjustedSets.length > 0 ? adjustedSets : [1]);
      }
      return newMap;
    });

    setMaxSetNumber(prev => prev - 1);
    setHasChanges(true);
  };

  const handleDone = (): void => {
    // Pass the set changes to the parent component
    if (hasChanges && onSetsChange) {
      onSetsChange(userSets);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='flex flex-col w-[90vw] h-[85vh] bg-background rounded-lg shadow-xl overflow-hidden border border-border'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-border'>
          <div>
            <h2 className='text-[16px] font-semibold leading-[24px] text-foreground'>
              Configure On-Call Sets
            </h2>
            <p className='text-xs text-muted-foreground mt-0.5'>{groupName}</p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='secondary'
              size='sm'
              onClick={onClose}
              data-track-category='UserGroups'
              data-track-name='CANCEL_ON_CALL_ROTATION'
            >
              Cancel
            </Button>
            <Button
              variant='default'
              size='sm'
              onClick={handleDone}
              data-track-category='UserGroups'
              data-track-name='SAVE_ON_CALL_ROTATION'
              disabled={hasEmptySet}
              className='bg-[#6276BE] hover:bg-[#5060A0]'
            >
              Done
            </Button>
          </div>
        </div>

        {/* Action Bar */}
        <div className='px-6 py-4 bg-muted/30 border-b border-border flex items-end justify-end'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleCreateSet}
            data-track-category='UserGroups'
            data-track-name='CREATE_ON_CALL_SET'
          >
            <Plus className='w-4 h-4' />
            Create New Set
          </Button>
        </div>

        {/* Main Content - Horizontal Scroll */}
        <div className='flex-1 overflow-x-auto overflow-y-hidden flex flex-row p-6 gap-6 bg-[#F9FAFB] dark:bg-transparent'>
          {sets.map(set => (
            <div
              key={set.setNumber}
              className={`flex-shrink-0 w-[350px] flex flex-col rounded-xl shadow-sm bg-background transition-all ${
                set.isActive ? 'ring-2 ring-[#6276BE] border-transparent' : 'border border-border'
              }`}
            >
              {/* Card Header */}
              <div className='p-4 border-b rounded-t-xl flex items-center justify-between'>
                <div>
                  <span className='text-xs font-bold text-muted-foreground tracking-widest uppercase'>
                    Set {set.setNumber}
                  </span>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    {set.users.length} participant{set.users.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  {set.users.length === 0 && maxSetNumber > 1 && (
                    <button
                      onClick={() => handleDeleteSet(set.setNumber)}
                      className='p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded transition-colors'
                      title='Delete empty set'
                      data-track-category='UserGroups'
                      data-track-name='DeleteEmptySet'
                      data-track-metadata={JSON.stringify({ setNumber: set.setNumber })}
                    >
                      <Trash2 className='w-4 h-4' />
                    </button>
                  )}
                  {set.isActive && (
                    <div className='flex items-center gap-1.5 px-2 py-1 bg-[#6276BE] text-white rounded text-[10px] font-bold'>
                      <span className='relative flex h-2 w-2'>
                        <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75' />
                        <span className='relative inline-flex rounded-full h-2 w-2 bg-white' />
                      </span>
                      ACTIVE
                    </div>
                  )}
                </div>
              </div>

              {/* Card Body */}
              <div className='flex-1 overflow-y-auto p-3 space-y-3'>
                {set.users.length === 0 ? (
                  <div className='text-xs text-muted-foreground text-center py-6'>
                    No users in this set
                  </div>
                ) : (
                  set.users.map(user => (
                    <div
                      key={user.id}
                      className='group p-3 border border-border rounded-lg bg-background flex items-center justify-between'
                    >
                      <div className='flex items-center gap-2 min-w-0'>
                        <Avatar userId={user.id} size='sm' showActiveStatus={false} />
                        <span className='text-sm text-foreground truncate max-w-[150px]'>
                          {user.name}
                        </span>
                      </div>
                      <MultiSelectDropdown
                        userId={user.id}
                        currentSets={userSets.get(user.id) ?? [1]}
                        maxSetNumber={maxSetNumber}
                        onChange={handleUserSetsChange}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Error Toast */}
        {hasEmptySet && (
          <div className='mx-6 mb-4 p-3 bg-red-600 text-white rounded-lg flex items-center justify-center gap-2 text-sm font-medium shadow-lg'>
            <AlertCircle className='w-4 h-4 flex-shrink-0' />
            Every set must have at least one user assigned.
          </div>
        )}
      </div>
    </div>
  );
};
