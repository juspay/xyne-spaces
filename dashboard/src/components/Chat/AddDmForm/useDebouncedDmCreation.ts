import { useEffect, useRef, useState, useCallback } from 'react';
import { User, Channel } from '@xyne/shared';
import {
  channelService,
  CreateDmRequest,
  CreateDmResponse,
} from '../../../services/Chat/channelService';

interface UseDebouncedDmCreationOptions {
  selectedUsers: User[];
  existingDmChannel: Channel | undefined;
  onChannelCreated: (channelId: string) => void;
  delay?: number;
}

interface UseDebouncedDmCreationReturn {
  isAutoCreating: boolean;
  cancelAutoCreate: () => void;
  createDm: (request: CreateDmRequest) => Promise<CreateDmResponse>;
}

interface InFlightRequest {
  promise: Promise<CreateDmResponse>;
  participantIds: string[];
}

const sortIds = (ids: string[]): string[] => [...ids].sort();

const sameParticipants = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedA = sortIds(a);
  const sortedB = sortIds(b);
  return sortedA.every((id, index) => id === sortedB[index]);
};

export const useDebouncedDmCreation = ({
  selectedUsers,
  existingDmChannel,
  onChannelCreated,
  delay = 1000,
}: UseDebouncedDmCreationOptions): UseDebouncedDmCreationReturn => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAutoCreating, setIsAutoCreating] = useState(false);
  const hasAttemptedRef = useRef(false);
  const inFlightRef = useRef<InFlightRequest | null>(null);
  const selectedUsersRef = useRef(selectedUsers);

  useEffect(() => {
    selectedUsersRef.current = selectedUsers;
  }, [selectedUsers]);

  const cancelAutoCreate = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const createDm = useCallback(
    async (request: CreateDmRequest): Promise<CreateDmResponse> => {
      // Cancel any pending timeout - the user pressed send, so create immediately.
      cancelAutoCreate();

      const participantIds = request.participantIds;

      // If a matching request is already in flight, latch onto it instead of
      // firing a duplicate channel creation request.
      if (
        inFlightRef.current &&
        sameParticipants(inFlightRef.current.participantIds, participantIds)
      ) {
        return inFlightRef.current.promise;
      }

      hasAttemptedRef.current = true;
      setIsAutoCreating(true);

      const promise = channelService
        .createDm(request)
        .then(response => {
          // Only notify the consumer if the participant selection hasn't
          // changed since the request started. Otherwise a stale auto-create
          // for the previous selection would overwrite the current channel.
          if (
            sameParticipants(
              participantIds,
              selectedUsersRef.current.map(user => user.id),
            )
          ) {
            onChannelCreated(response.id);
          }
          return response;
        })
        .catch(error => {
          // Only clear the attempt flag if this request still matches the
          // current selection, so a stale failure doesn't unblock retries.
          if (
            sameParticipants(
              participantIds,
              selectedUsersRef.current.map(user => user.id),
            )
          ) {
            hasAttemptedRef.current = false;
          }
          throw error;
        })
        .finally(() => {
          if (inFlightRef.current?.promise === promise) {
            inFlightRef.current = null;
          }
          setIsAutoCreating(false);
        });

      inFlightRef.current = {
        promise,
        participantIds: [...participantIds],
      };

      return promise;
    },
    [cancelAutoCreate, onChannelCreated],
  );

  useEffect(() => {
    // Clear any existing timeout when dependencies change.
    cancelAutoCreate();

    // Reset attempt flag and auto-creating state if users are cleared.
    if (selectedUsers.length === 0) {
      hasAttemptedRef.current = false;
      setIsAutoCreating(false);
      return;
    }

    // Reset the attempt flag whenever the selection changes, so adding or
    // swapping participants triggers a fresh auto-create.
    hasAttemptedRef.current = false;

    // Don't auto-create if:
    // 1. Already have an existing DM channel
    // 2. No temp channel ID available
    if (existingDmChannel) {
      if (!inFlightRef.current) {
        setIsAutoCreating(false);
      }
      return;
    }

    setIsAutoCreating(true);

    // Start debounce timer
    timeoutRef.current = setTimeout(() => {
      // Double-check conditions before creating
      if (selectedUsers.length > 0 && !existingDmChannel && !hasAttemptedRef.current) {
        const dmRequest: CreateDmRequest = {
          participantIds: selectedUsers.map(user => user.id),
          silent: true,
        };

        void createDm(dmRequest);
      }
    }, delay);

    return () => {
      cancelAutoCreate();
      if (!inFlightRef.current) {
        setIsAutoCreating(false);
      }
    };
  }, [selectedUsers, existingDmChannel, delay, createDm, cancelAutoCreate]);

  return {
    isAutoCreating,
    cancelAutoCreate,
    createDm,
  };
};
