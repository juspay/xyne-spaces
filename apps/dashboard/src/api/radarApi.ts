import { apiInstance } from '../services/clients/apiClient';

interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface RadarFeedItem {
  id: string;
  conversationId: string;
  channelId: string;
  sourceMessageId: string;
  title: string;
  contextSummary: string | null;
  requestedBy: string[];
  pendingOn: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RadarThreadCard {
  conversationId: string;
  channelId: string;
  threadPreview: string | null;
  lastActivityAt: string | null;
  items: RadarFeedItem[];
}

export interface RadarApplyResult {
  created: number;
  resolved: number;
  reassigned: number;
}

export interface RadarRunLog {
  id: string;
  conversationId: string;
  gatePassed: boolean;
  gateReason: string;
  windowSize: number;
  parserRan: boolean;
  proposedOps: unknown[] | null;
  validOps: unknown[] | null;
  droppedOps: unknown[] | null;
  applied: { created: number; resolved: number; reassigned: number } | null;
  /** Model's one-sentence read of the window — why these ops, or why none. */
  assessment: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

async function unwrap<T>(promise: Promise<{ data: SuccessEnvelope<T> }>): Promise<T> {
  const res = await promise;
  return res.data.data;
}

export function fetchRadarPendingMe(): Promise<RadarThreadCard[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<{ threads: RadarThreadCard[] }>>('/radar/feed/pending-me'),
  ).then(d => d.threads);
}

export function fetchRadarWaitingOn(): Promise<RadarThreadCard[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<{ threads: RadarThreadCard[] }>>('/radar/feed/waiting-on'),
  ).then(d => d.threads);
}

export interface RadarItemMutation {
  id: string;
  itemId: string;
  op: string;
  actorType: 'llm' | 'manual';
  actorId: string | null;
  sourceMessageId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface RadarTrailMessage {
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

export interface RadarItemTrail {
  item: RadarFeedItem & { status: string; resolvedAt: string | null };
  mutations: RadarItemMutation[];
  sourceMessages: Record<string, RadarTrailMessage>;
  threadState: { watermarkCreatedAt: string; watermarkMsgId: string; updatedAt: string } | null;
  latestMessage: { messageId: string; createdAt: string } | null;
}

export function fetchRadarItemTrail(itemId: string): Promise<RadarItemTrail> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<RadarItemTrail>>(
      `/radar/debug/items/${encodeURIComponent(itemId)}`,
    ),
  );
}

export interface RadarTeam {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
}

export interface RadarTeamFeedItem extends RadarFeedItem {
  channelVisibility: string;
}

export function fetchRadarTeams(): Promise<RadarTeam[]> {
  return unwrap(apiInstance.get<SuccessEnvelope<{ teams: RadarTeam[] }>>('/radar/teams')).then(
    d => d.teams,
  );
}

export function createRadarTeam(name: string, memberIds: string[]): Promise<RadarTeam> {
  return unwrap(apiInstance.post<SuccessEnvelope<RadarTeam>>('/radar/teams', { name, memberIds }));
}

export function updateRadarTeam(
  teamId: string,
  name: string,
  memberIds: string[],
): Promise<RadarTeam> {
  return unwrap(
    apiInstance.patch<SuccessEnvelope<RadarTeam>>(`/radar/teams/${encodeURIComponent(teamId)}`, {
      name,
      memberIds,
    }),
  );
}

export function deleteRadarTeam(teamId: string): Promise<void> {
  return apiInstance.delete(`/radar/teams/${encodeURIComponent(teamId)}`).then(() => undefined);
}

export function fetchRadarTeamFeed(teamId: string): Promise<RadarTeamFeedItem[]> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<{ items: RadarTeamFeedItem[] }>>(
      `/radar/feed/team/${encodeURIComponent(teamId)}`,
    ),
  ).then(d => d.items);
}

export interface RadarRunsResult {
  runs: RadarRunLog[];
  threadState: { watermarkCreatedAt: string; watermarkMsgId: string; updatedAt: string } | null;
  latestMessage: { messageId: string; createdAt: string } | null;
  /** Every item the thread produced (resolved included) when scoped to one thread. */
  items: Array<{ id: string; title: string; status: string }>;
}

/** Debug is per-thread: the endpoint has no workspace-wide listing. */
export function fetchRadarDebugRuns(conversationId: string): Promise<RadarRunsResult> {
  const query = `?conversationId=${encodeURIComponent(conversationId)}`;
  return unwrap(apiInstance.get<SuccessEnvelope<RadarRunsResult>>(`/radar/debug/runs${query}`));
}

export function resolveRadarItem(itemId: string): Promise<RadarApplyResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<RadarApplyResult>>(
      `/radar/items/${encodeURIComponent(itemId)}/resolve`,
    ),
  );
}

export function resolveAllRadarItems(conversationId: string): Promise<RadarApplyResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<RadarApplyResult>>(
      `/radar/threads/${encodeURIComponent(conversationId)}/resolve-all`,
    ),
  );
}
