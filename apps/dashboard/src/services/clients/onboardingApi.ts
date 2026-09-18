import { apiInstance } from './apiClient';

/** Desk onboarding exams. All data is served over REST from the desk's preference row. */

export type OnboardingAttemptStatus = 'IN_PROGRESS' | 'GRADING' | 'GRADED' | 'FAILED';
export type OnboardingReviewStatus = 'PENDING' | 'GRADED' | 'FAILED' | 'SKIPPED';

export const ONBOARDING_MAX_TICKETS_PER_TOPIC = 20;
export const ONBOARDING_MAX_REPLY_CHARS = 20000;
export const ONBOARDING_MAX_SCORE_PER_ANSWER = 10;

export interface OnboardingReview {
  status: OnboardingReviewStatus;
  reasoning: string | null;
  missedPoints: string[];
  agentSlug: string;
  sessionId: string | null;
  dispatchedAt: string | null;
  retryCount: number;
  gradedAt: string | null;
  error: string | null;
}

export interface OnboardingAnswer {
  paperTicketId: string;
  replyText: string;
  /** Admin view only. */
  ticketId?: string;
  score?: number | null;
  review?: OnboardingReview | null;
}

export interface OnboardingAttempt {
  id: string;
  topicId: string;
  userId: string;
  status: OnboardingAttemptStatus;
  startedAt: string;
  draftSavedAt: string | null;
  submittedAt: string | null;
  durationSeconds: number | null;
  gradedAt: string | null;
  totalScore: number | null;
  maxScore: number | null;
  answers: OnboardingAnswer[];
}

export interface OnboardingTopicSummary {
  id: string;
  name: string;
  ticketCount: number;
  /** Admin view only. */
  graderAgentSlug?: string | null;
  defaultGraderAgentSlug?: string;
  tickets?: { id: string; ticketId: string }[];
  createdAt?: string;
}

export interface OnboardingState {
  isAdmin: boolean;
  topics: OnboardingTopicSummary[];
  deletedTopics: { id: string; name: string }[];
  attempts: OnboardingAttempt[];
  /** "topicId:userId" → attempts submitted. */
  counts: Record<string, number>;
  users: { id: string; name: string; email: string }[];
  tickets: { id: string; xyneId: string; title: string }[];
}

export interface OnboardingAttachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
}

export interface OnboardingFirstEmail {
  subject: string;
  from: string;
  sentAt: string;
  text: string;
  attachments: OnboardingAttachment[];
}

export type OnboardingTicketEmailResponse =
  | { available: true; firstEmail: OnboardingFirstEmail }
  | { available: false };

export interface OnboardingThreadEmail {
  id: string;
  subject: string;
  from: string;
  sentAt: string;
  inbound: boolean;
  text: string;
}

export interface OnboardingAttemptReview extends Omit<OnboardingAttempt, 'answers'> {
  answers: (OnboardingAnswer & {
    content: {
      firstEmail: OnboardingThreadEmail & { attachments: OnboardingAttachment[] };
      thread: OnboardingThreadEmail[];
    } | null;
  })[];
}

export interface OnboardingReplyInput {
  paperTicketId: string;
  replyText: string;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

const base = (channelId: string): string => `/onboarding/${encodeURIComponent(channelId)}`;

export async function fetchOnboardingState(channelId: string): Promise<OnboardingState> {
  const res = await apiInstance.get<Envelope<OnboardingState>>(base(channelId));
  return res.data.data;
}

export async function searchOnboardingTickets(
  channelId: string,
  q: string,
): Promise<{ id: string; title: string; xyneId: string }[]> {
  const res = await apiInstance.get<Envelope<{ id: string; title: string; xyneId: string }[]>>(
    `${base(channelId)}/search-tickets`,
    { params: { q } },
  );
  return res.data.data;
}

export async function createOnboardingTopic(
  channelId: string,
  body: { name: string; graderAgentSlug?: string | null },
): Promise<{ id: string }> {
  const res = await apiInstance.post<Envelope<{ id: string }>>(`${base(channelId)}/topics`, body);
  return res.data.data;
}

export async function updateOnboardingTopic(
  channelId: string,
  topicId: string,
  body: { name?: string; graderAgentSlug?: string | null; deleted?: true },
): Promise<void> {
  await apiInstance.patch(`${base(channelId)}/topics/${encodeURIComponent(topicId)}`, body);
}

export async function setOnboardingTopicTickets(
  channelId: string,
  topicId: string,
  ticketIds: string[],
): Promise<void> {
  await apiInstance.put(`${base(channelId)}/topics/${encodeURIComponent(topicId)}/tickets`, {
    ticketIds,
  });
}

export async function startOnboardingAttempt(
  channelId: string,
  topicId: string,
): Promise<OnboardingAttempt> {
  const res = await apiInstance.post<Envelope<OnboardingAttempt>>(
    `${base(channelId)}/topics/${encodeURIComponent(topicId)}/attempts`,
  );
  return res.data.data;
}

export async function fetchOnboardingTicketEmail(
  channelId: string,
  attemptId: string,
  paperTicketId: string,
): Promise<OnboardingTicketEmailResponse> {
  const res = await apiInstance.get<Envelope<OnboardingTicketEmailResponse>>(
    `${base(channelId)}/attempts/${encodeURIComponent(attemptId)}/tickets/${encodeURIComponent(paperTicketId)}/email`,
  );
  return res.data.data;
}

export async function saveOnboardingDraft(
  channelId: string,
  attemptId: string,
  replies: OnboardingReplyInput[],
): Promise<{ draftSavedAt: string | null }> {
  const res = await apiInstance.put<Envelope<{ draftSavedAt: string | null }>>(
    `${base(channelId)}/attempts/${encodeURIComponent(attemptId)}/draft`,
    { replies },
  );
  return res.data.data;
}

export async function submitOnboardingAttempt(
  channelId: string,
  attemptId: string,
  replies: OnboardingReplyInput[],
): Promise<OnboardingAttempt> {
  const res = await apiInstance.post<Envelope<OnboardingAttempt>>(
    `${base(channelId)}/attempts/${encodeURIComponent(attemptId)}/submit`,
    { replies },
  );
  return res.data.data;
}

export async function fetchOnboardingAttemptReview(
  channelId: string,
  attemptId: string,
): Promise<OnboardingAttemptReview> {
  const res = await apiInstance.get<Envelope<OnboardingAttemptReview>>(
    `${base(channelId)}/attempts/${encodeURIComponent(attemptId)}/review`,
  );
  return res.data.data;
}

/** The server's message for a failed request, or a fallback. */
export function onboardingErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof message === 'string' && message ? message : fallback;
}
