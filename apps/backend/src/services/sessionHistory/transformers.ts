export type AgentType = 'xyne-cli' | 'workflow';

export type MessageKind = 'llm-text' | 'tool-call' | 'user-text';

export interface NormalizedMessage {
  id: string;
  ts: string;
  kind: MessageKind;
  text?: string;
  tool?: string;
  status?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  duration?: number;
}

interface WorkflowStep {
  stepId: string;
  stepName: string;
  data: string | null;
  status: string | null;
  createdAt: string;
}

export interface NormalizedContext {
  messages: NormalizedMessage[];
}

interface XyneCliPayload {
  messages: Array<Record<string, unknown>>;
}

function isXyneCliPayload(raw: unknown): raw is XyneCliPayload {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'messages' in raw &&
    Array.isArray(raw.messages)
  );
}

export function transformXyneCli(rawPayload: unknown): NormalizedContext {
  if (!isXyneCliPayload(rawPayload)) {
    throw new Error('[SessionHistory:transformXyneCli] payload must have a messages array');
  }

  const messages: NormalizedMessage[] = rawPayload.messages
    .filter((msg) => msg.kind !== 'user-message')
    .map((msg) => {
      const normalized: NormalizedMessage = {
        id:   typeof msg.id   === 'string' ? msg.id   : '',
        ts:   typeof msg.ts   === 'string' ? msg.ts   : '',
        kind: (typeof msg.kind === 'string' ? msg.kind : '') as MessageKind,
      };
      if (typeof msg.text   === 'string') normalized.text   = msg.text;
      if (typeof msg.tool   === 'string') normalized.tool   = msg.tool;
      if (typeof msg.status === 'string') normalized.status = msg.status;
      if (typeof msg.input  === 'object' && msg.input !== null) {
        normalized.input = msg.input as Record<string, unknown>;
      }
      return normalized;
    });

  return { messages };
}

function normalizeInputKeys(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const camelKey = key.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function buildMessageFromStep(step: WorkflowStep): NormalizedMessage | null {
  let parsed: Record<string, unknown> | null = null;
  try { parsed = step.data ? (JSON.parse(step.data) as Record<string, unknown>) : null; } catch { return null; }
  if (!parsed) return null;

  if (step.stepName.startsWith('llm_call_')) {
    const text = (parsed.response as string) || (parsed.content as string) || '';
    if (!text.trim()) return null;
    return { id: step.stepId, ts: step.createdAt, kind: 'llm-text', text };
  }

  if (step.stepName.startsWith('tool_')) {
    return {
      id:       step.stepId,
      ts:       step.createdAt,
      kind:     'tool-call',
      tool:     step.stepName.slice('tool_'.length),
      status:   step.status ?? 'completed',
      input:    normalizeInputKeys((parsed.input as Record<string, unknown>) ?? {}),
      output:   parsed.output ?? null,
      duration: (parsed.duration as number) ?? 0,
    };
  }

  if (step.stepName === 'user_message') {
    const text = (parsed.content as string) || '';
    if (!text.trim()) return null;
    return { id: step.stepId, ts: step.createdAt, kind: 'user-text', text };
  }

  return null;
}

export function transformWorkflow(rawPayload: unknown): NormalizedContext {
  if (!Array.isArray(rawPayload)) {
    throw new Error('[SessionHistory:transformWorkflow] payload must be an array of step records');
  }

  const steps = (rawPayload as WorkflowStep[])
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const messages: NormalizedMessage[] = steps
    .map(buildMessageFromStep)
    .filter((msg): msg is NormalizedMessage => msg !== null);

  return { messages };
}
