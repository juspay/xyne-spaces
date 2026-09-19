import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiInstance } from './apiClient';

/** Desk onboarding exams. All data is served over REST from the desk's preference row. */

export const ONBOARDING_MAX_TICKETS_PER_TOPIC = 20;
export const ONBOARDING_MAX_REPLY_CHARS = 20000;

export interface OnboardingAttempt {
  id: string;
  topicId: string;
  userId: string;
  status: 'IN_PROGRESS' | 'GRADING' | 'GRADED' | 'FAILED';
  startedAt: string;
  submittedAt: string | null;
  durationSeconds: number | null;
  totalScore: number | null;
  maxScore: number | null;
  /** score, reasoning and error reach admins only. */
  answers: {
    replyText: string;
    score?: number | null;
    reasoning?: string | null;
    error?: string | null;
  }[];
}

/** ticketIds, graderAgentSlug and defaultGraderAgentSlug reach admins only. */
export interface OnboardingTopic {
  id: string;
  name: string;
  ticketCount: number;
  graderAgentSlug?: string | null;
  defaultGraderAgentSlug?: string;
  ticketIds?: string[];
}

export interface OnboardingTicket {
  id: string;
  xyneId: string;
  title: string;
}

export interface OnboardingState {
  isAdmin: boolean;
  topics: OnboardingTopic[];
  attempts: OnboardingAttempt[];
  users: { id: string; name: string; email: string }[];
  tickets: OnboardingTicket[];
}

/** An attempt plus its paper: `questions[i]` is the first email of answer `i`, or null if gone. */
export interface OnboardingExam extends OnboardingAttempt {
  questions: ({ subject: string; from: string; sentAt: string; text: string } | null)[];
}

export type OnboardingTopicPatch = {
  name?: string;
  graderAgentSlug?: string | null;
  ticketIds?: string[];
  deleted?: true;
};

/** Every onboarding response is `{ data }`; every path is relative to the desk. */
async function call<T>(
  method: 'get' | 'post' | 'patch',
  channelId: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<T> {
  const url = `/onboarding/${encodeURIComponent(channelId)}${path}`;
  const res =
    method === 'get'
      ? await apiInstance.get<{ data: T }>(url, { params })
      : method === 'post'
        ? await apiInstance.post<{ data: T }>(url, body)
        : await apiInstance.patch<{ data: T }>(url, body);
  return res.data.data;
}

const attempt = (id: string): string => `/attempts/${encodeURIComponent(id)}`;
const topic = (id: string): string => `/topics/${encodeURIComponent(id)}`;

export const fetchOnboardingState = (channelId: string) =>
  call<OnboardingState>('get', channelId, '');

export const createOnboardingTopic = (channelId: string, name: string) =>
  call<{ id: string }>('post', channelId, '/topics', { name });

export const updateOnboardingTopic = (channelId: string, id: string, patch: OnboardingTopicPatch) =>
  call<boolean>('patch', channelId, topic(id), patch);

export const startOnboardingAttempt = (channelId: string, topicId: string) =>
  call<OnboardingExam>('post', channelId, `${topic(topicId)}/attempts`);

export const submitOnboardingAttempt = (channelId: string, id: string, replies: string[]) =>
  call<OnboardingAttempt>('post', channelId, `${attempt(id)}/submit`, { replies });

export const retryOnboardingGrading = (channelId: string, id: string) =>
  call<{ retried: boolean }>('post', channelId, `${attempt(id)}/retry`);

/** The server's message for a failed request, or a fallback. */
export function onboardingErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof message === 'string' && message ? message : fallback;
}

const GRADING_POLL_MS = 10_000;

const onboardingStateQueryKey = (channelId: string) => ['desk-onboarding', channelId] as const;

/**
 * The Onboarding tab's state for one desk. Nothing syncs live, so while any visible attempt is
 * being graded the query re-fetches every 10 seconds until grading finishes.
 */
export function useDeskOnboardingState(channelId: string) {
  return useQuery({
    queryKey: onboardingStateQueryKey(channelId),
    queryFn: () => fetchOnboardingState(channelId),
    enabled: !!channelId,
    refetchInterval: query =>
      query.state.data?.attempts.some(a => a.status === 'GRADING') ? GRADING_POLL_MS : false,
  });
}

export function useInvalidateDeskOnboarding(channelId: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: onboardingStateQueryKey(channelId) }),
    [queryClient, channelId],
  );
}
