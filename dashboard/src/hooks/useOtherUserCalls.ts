import { useState, useEffect, useCallback } from 'react';
import { callService } from '../services/Call/callService';
import type { User } from '../machines/authMachine';

export interface OtherUserBusySlot {
  startsAt: number;
  endsAt: number | null;
  id?: string;
  title?: string;
}

export interface OtherUserCalls {
  user: User;
  color: string;
  calls: OtherUserBusySlot[];
  calendarVisibility: 'PUBLIC' | 'PRIVATE';
}

const MEET_WITH_COLORS = [
  '#d50000',
  '#33b679',
  '#8e24aa',
  '#f4511e',
  '#039be5',
  '#c0ca33',
  '#7986cb',
  '#616161',
  '#e67c73',
  '#0b8043',
  '#d81b60',
  '#009688',
  '#f6bf26',
  '#3f51b5',
  '#795548',
];

export function useOtherUserCalls(from: Date, to: Date) {
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [otherUsersCalls, setOtherUsersCalls] = useState<Map<string, OtherUserCalls>>(new Map());

  const fetchCallsForUser = useCallback(
    async (user: User, color: string) => {
      try {
        const result = await callService.getOtherUserScheduledCalls(user.id, from, to);
        setOtherUsersCalls(prev => {
          const next = new Map(prev);
          next.set(user.id, {
            user,
            color,
            calls: result.calls,
            calendarVisibility: result.calendarVisibility,
          });
          return next;
        });
      } catch {
        // silently ignore — user stays in selectedUsers but with empty calls
      }
    },
    [from, to],
  );

  // Re-fetch all selected users when date range changes
  useEffect(() => {
    selectedUsers.forEach((user, i) => {
      const color = MEET_WITH_COLORS[i % MEET_WITH_COLORS.length]!;
      void fetchCallsForUser(user, color);
    });
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const addUser = useCallback(
    (user: User) => {
      setSelectedUsers(prev => {
        if (prev.find(u => u.id === user.id)) return prev;
        const updated = [...prev, user];
        const color = MEET_WITH_COLORS[(updated.length - 1) % MEET_WITH_COLORS.length]!;
        void fetchCallsForUser(user, color);
        return updated;
      });
    },
    [fetchCallsForUser],
  );

  const removeUser = useCallback((userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
    setOtherUsersCalls(prev => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  return { selectedUsers, otherUsersCalls, addUser, removeUser };
}
