import { apiInstance } from '../services/clients/apiClient';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The server's own reason when it gave one. */
const errorMessage = (error: unknown, fallback: string): string => {
  if (!isRecord(error) || !isRecord(error['response'])) return fallback;
  const { data } = error['response'];
  return isRecord(data) && typeof data['error'] === 'string' && data['error'].trim()
    ? data['error']
    : fallback;
};

const call = async <T>(request: Promise<{ data: T }>, fallback: string): Promise<T> => {
  try {
    return (await request).data;
  } catch (error) {
    throw new Error(errorMessage(error, fallback));
  }
};

/** What the policy decided about one burst: ids, outcomes and numbers, no text. */
export interface ProactivityDecisionView {
  id: string;
  kind: 'EPISODE' | 'REPLY' | 'FOLLOW_UP';
  mode: string;
  /** open | quiet | bump */
  gate: string;
  messageIds: string[];
  conversationId: string | null;
  outcome: string | null;
  reason: string | null;
  /** XOR's probability for the question `reason` names. */
  score: number | null;
  agentSlug: string | null;
  createdAt: string;
}

/** One agent's run for a question, from claw-auth. */
export interface ProactiveDraftView {
  agentSlug: string;
  status: string;
  /** The task it was given: the prompt, with the conversation. */
  task: string;
  result: string | null;
  error: string | null;
  model: string | null;
  totalMs: number | null;
  toolCalls: Array<{
    toolName: string;
    args: string;
    result: string;
    isError: boolean;
    durationMs: number | null;
  }>;
  startedAt: string;
  completedAt: string | null;
}

/** One request to XOR: what it read, and each question with its probability of yes. */
export interface XorCallView {
  id: string;
  /** gate | bump_gate | route | before_posting | follow_up */
  step: string;
  agentSlug: string | null;
  input: string;
  durationMs: number;
  failed: boolean;
  createdAt: string;
  questions: Array<{
    key: string;
    instructions: string;
    criteriaTrue: string | null;
    criteriaFalse: string | null;
    probability: number | null;
  }>;
}

/** A message's whole journey: every decision about it, with XOR's calls and the agents' runs. */
export interface MessageTraceResponse {
  success: boolean;
  message: {
    messageId: string;
    text: string;
    senderName: string | null;
    channelId: string | null;
    channelName: string | null;
    createdAt: string;
  } | null;
  decisions: Array<
    ProactivityDecisionView & {
      parentEpisodeId: string | null;
      /** Every message the decision covered: a burst, in order. */
      messages: Array<{ messageId: string; text: string; createdAt: string }>;
      xorCalls: XorCallView[];
      runs: ProactiveDraftView[];
    }
  >;
  /** The XOR model the requests went to. */
  xorModel: string;
  /** Today's thresholds: a probability at or over one is a yes. */
  thresholds: {
    gate: Record<string, number>;
    route: { relevant: number; secondAgent: number; maxAgents: number; closeChoice: number };
    beforePosting: Record<string, number>;
    followUp: Record<string, number>;
  } | null;
}

/** A decision as Administration → Agent activity lists it. */
export interface WorkspaceDecisionView extends ProactivityDecisionView {
  channelId: string;
  channelName: string | null;
  /** The question's opening text. */
  question: string | null;
}

export interface WorkspaceDecisionsResponse {
  success: boolean;
  decisions: WorkspaceDecisionView[];
  /** Channels where agents may reply on their own, for the filter. */
  channels: Array<{ id: string; name: string; agentProactivityMode: string }>;
  /** Pass as `before` for the next page; null on the last one. */
  nextBefore: string | null;
}

export const proactivityApi = {
  /** Workspace admins only. */
  workspaceDecisions: (params: {
    channelId?: string;
    outcome?: string;
    before?: string;
    limit?: number;
  }): Promise<WorkspaceDecisionsResponse> =>
    call<WorkspaceDecisionsResponse>(
      apiInstance.get('/proactivity/workspace/decisions', { params }),
      'Could not load agent activity',
    ),

  /** What each agent wrote for a question: for a held or test-only one. */
  drafts: (decisionId: string): Promise<{ success: boolean; drafts: ProactiveDraftView[] }> =>
    call<{ success: boolean; drafts: ProactiveDraftView[] }>(
      apiInstance.get(`/proactivity/decisions/${decisionId}/drafts`),
      'Could not load the drafts',
    ),

  /** Workspace admins only. */
  trace: (messageId: string): Promise<MessageTraceResponse> =>
    call<MessageTraceResponse>(
      apiInstance.get(`/proactivity/trace/${encodeURIComponent(messageId)}`),
      'Could not trace the message',
    ),

  /** Workspace admins only: send an XOR request again, edited, and get each probability. */
  tryXor: (request: {
    state: string;
    questions: Record<
      string,
      { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
    >;
  }): Promise<{ success: boolean; probabilities: Record<string, number | null> }> =>
    call<{ success: boolean; probabilities: Record<string, number | null> }>(
      apiInstance.post('/proactivity/xor/try', request),
      'Could not ask XOR',
    ),

  /** Why it did or didn't answer a message. */
  why: (messageId: string): Promise<{ success: boolean; decisions: ProactivityDecisionView[] }> =>
    call<{ success: boolean; decisions: ProactivityDecisionView[] }>(
      apiInstance.get(`/proactivity/why/${messageId}`),
      'Could not load why',
    ),
};
