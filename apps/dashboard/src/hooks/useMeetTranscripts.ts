import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMeetTranscriptsSetting,
  setMeetTranscriptsEnabled,
  type MeetTranscriptsSetting,
} from '../services/clients/calendarApi';

const QUERY_KEY = ['meet-transcripts-setting'];
export const SYNC_CALENDAR_FIRST = 'Please sync your calendar first';

/** The server's message for a refused save, else a generic one. */
function saveErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  if (data?.error === 'calendar_not_connected') return SYNC_CALENDAR_FIRST;
  return data?.message || 'Failed to save the setting. Please try again.';
}

/**
 * Whether Xyne turns on and fetches Google Meet's own transcript for the Google
 * Calendar meetings I organise. Opt-in: Meet tells everyone in the meeting that it is
 * being transcribed. Stored in `user_preferences.meetTranscripts`; the backend worker
 * reads it every minute (backend: meetTranscriptService). It can only be turned on
 * with a Google Calendar connection, which is what the worker reads with.
 */
export const useMeetTranscripts = (): {
  /** The feature is switched on for this deployment. */
  available: boolean;
  meetTranscripts: boolean;
  setMeetTranscripts: (value: boolean) => void;
  /** Why the last attempt to change it did not go through, if it did not. */
  error: string | null;
} => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getMeetTranscriptsSetting,
    staleTime: 5 * 60_000,
  });
  const { mutate } = useMutation({
    mutationFn: setMeetTranscriptsEnabled,
    // Show the switch flipped straight away; put it back if saving fails.
    onMutate: async (enabled: boolean) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<MeetTranscriptsSetting>(QUERY_KEY);
      if (previous)
        queryClient.setQueryData<MeetTranscriptsSetting>(QUERY_KEY, { ...previous, enabled });
      return { previous };
    },
    onError: (mutationError, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      setError(saveErrorMessage(mutationError));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const setMeetTranscripts = (value: boolean): void => {
    // No calendar connection: refuse here rather than flip the switch and flip it back.
    if (value && data && !data.calendarConnected) {
      setError(SYNC_CALENDAR_FIRST);
      return;
    }
    mutate(value);
  };

  return {
    available: data?.available ?? false,
    meetTranscripts: data?.enabled ?? false,
    setMeetTranscripts,
    error,
  };
};
