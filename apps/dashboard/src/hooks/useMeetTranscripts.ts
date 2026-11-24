import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMeetTranscriptsSetting,
  setMeetTranscriptsEnabled,
  type MeetTranscriptsSetting,
} from '../services/clients/calendarApi';

const QUERY_KEY = ['meet-transcripts-setting'];

/**
 * Whether Xyne turns on and fetches Google Meet's own transcript for the Google
 * Calendar meetings I organise. Opt-in: Meet tells everyone in the meeting that it is
 * being transcribed. Stored in `user_preferences.meetTranscripts`; the backend worker
 * reads it every minute (backend: meetTranscriptService).
 */
export const useMeetTranscripts = (): {
  /** The feature is switched on for this deployment. */
  available: boolean;
  meetTranscripts: boolean;
  setMeetTranscripts: (value: boolean) => void;
} => {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getMeetTranscriptsSetting,
    staleTime: 5 * 60_000,
  });
  const { mutate } = useMutation({
    mutationFn: setMeetTranscriptsEnabled,
    // Show the switch flipped straight away; put it back if saving fails.
    onMutate: async (enabled: boolean) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<MeetTranscriptsSetting>(QUERY_KEY);
      if (previous)
        queryClient.setQueryData<MeetTranscriptsSetting>(QUERY_KEY, { ...previous, enabled });
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    available: data?.available ?? false,
    meetTranscripts: data?.enabled ?? false,
    setMeetTranscripts: mutate,
  };
};
