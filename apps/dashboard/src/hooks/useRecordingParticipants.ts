import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { User } from '@xyne/shared/machines';
import { useActiveUsers, useUsersById, useSelf, searchUsers } from './useUsers';
import { recordingService } from '../services/Recording/recordingService';
import type { RecordingParticipantShare } from '../services/Recording/recordingService';
import { getRecordingParticipantIds, logRecordingError } from '../utils/recordingUtils';
import { getApiErrorMessage } from '../utils/apiError';

interface UseRecordingParticipantsArgs {
  recordingExternalId: string;
  createdByUserId: string | undefined;
  recordingParticipants: string | null | undefined;
  shares: readonly RecordingParticipantShare[] | null | undefined;
}

export interface UseRecordingParticipantsReturn {
  self: User | undefined;
  searchRef: React.RefObject<HTMLInputElement | null>;
  canManage: boolean;
  total: number;
  participants: (User | undefined)[];
  participantIds: string[];
  busyIds: ReadonlySet<string>;
  withAccess: ReadonlySet<string>;
  accessKnown: boolean;
  sharesLoaded: boolean;
  withoutAccess: number;
  changeParticipant: (action: 'add' | 'remove', userId: string) => void;
  shareWith: (userId: string) => void;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  trimmedQuery: string;
  results: User[];
  activeIndex: number;
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  pickResult: (userId: string) => void;
  highlightResult: (index: number) => void;
}

export function useRecordingParticipants({
  recordingExternalId,
  createdByUserId,
  recordingParticipants,
  shares,
}: UseRecordingParticipantsArgs): UseRecordingParticipantsReturn {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlyMap<string, 'add' | 'remove'>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);

  const users = useActiveUsers();
  const usersById = useUsersById();
  const self = useSelf();

  const canManage = Boolean(self?.id && createdByUserId && self.id === createdByUserId);

  const serverIds = useMemo(
    () => getRecordingParticipantIds(createdByUserId, recordingParticipants),
    [recordingParticipants, createdByUserId],
  );

  const participantIds = useMemo(() => {
    if (pending.size === 0) return serverIds;
    const ids = serverIds.filter(id => pending.get(id) !== 'remove');
    for (const [id, change] of pending) {
      if (change === 'add' && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [serverIds, pending]);

  useEffect(() => {
    setPending(current => {
      const next = new Map(current);
      for (const [id, change] of current) {
        if (serverIds.includes(id) === (change === 'add')) next.delete(id);
      }
      return next.size === current.size ? current : next;
    });
  }, [serverIds]);

  const withAccess = useMemo(() => {
    const shared = new Set<string>();
    for (const share of shares ?? []) {
      if (share.userId) shared.add(share.userId);
    }
    if (createdByUserId) shared.add(createdByUserId);
    return shared;
  }, [shares, createdByUserId]);

  const accessKnown = !(shares ?? []).some(
    share => Boolean(share.userGroupId) || Boolean(share.channelId),
  );
  const sharesLoaded = shares !== undefined;

  const participants = useMemo(
    () => participantIds.map(id => usersById.get(id)).filter(Boolean),
    [participantIds, usersById],
  );

  const trimmedQuery = query.trim();
  const results = useMemo(() => {
    if (!trimmedQuery) return [];
    const already = new Set(participantIds);
    return searchUsers(
      users.filter(user => !already.has(user.id)),
      trimmedQuery,
      6,
    );
  }, [trimmedQuery, users, participantIds]);

  useEffect(() => setHighlighted(0), [trimmedQuery]);
  const activeIndex = highlighted < results.length ? highlighted : 0;

  const withBusy = async (userId: string, work: () => Promise<void>): Promise<void> => {
    setBusyIds(current => new Set(current).add(userId));
    try {
      await work();
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }
  };

  const changeParticipant = (action: 'add' | 'remove', userId: string): void => {
    setPending(current => new Map(current).set(userId, action));
    void withBusy(userId, async () => {
      try {
        await recordingService.manageRecordingParticipant(recordingExternalId, action, userId);
      } catch (error) {
        setPending(current => {
          const next = new Map(current);
          next.delete(userId);
          return next;
        });
        logRecordingError('RecordingParticipants.change', error);
        toast.error(
          action === 'add' ? 'Could not add participant' : 'Could not remove participant',
          {
            description: getApiErrorMessage(error, 'Unable to update participants'),
          },
        );
      }
    });
  };

  const shareWith = (userId: string): void => {
    void withBusy(userId, async () => {
      try {
        await recordingService.grantRecordingAccess(recordingExternalId, [
          { type: 'user', id: userId },
        ]);
        toast.success('Recording shared');
      } catch (error) {
        logRecordingError('RecordingParticipants.share', error);
        toast.error('Could not share recording', {
          description: getApiErrorMessage(error, 'Unable to share this recording'),
        });
      }
    });
  };

  const total = participantIds.length;
  const withoutAccess = participantIds.filter(id => !withAccess.has(id)).length;

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((activeIndex + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((activeIndex - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = results[activeIndex];
      if (picked) {
        setQuery('');
        changeParticipant('add', picked.id);
      }
    }
  };

  const pickResult = (userId: string): void => {
    setQuery('');
    changeParticipant('add', userId);
  };

  const highlightResult = (index: number): void => setHighlighted(index);

  return {
    self,
    searchRef,
    canManage,
    total,
    participants,
    participantIds,
    busyIds,
    withAccess,
    accessKnown,
    sharesLoaded,
    withoutAccess,
    changeParticipant,
    shareWith,
    query,
    setQuery,
    trimmedQuery,
    results,
    activeIndex,
    onSearchKeyDown,
    pickResult,
    highlightResult,
  };
}
