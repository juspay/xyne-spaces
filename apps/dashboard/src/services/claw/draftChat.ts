import type { AgentCreateFormState } from '@/components/flowUI/nodes/agent/create/types';
import { CLAW_API_BASE, ClawApiError, clawErrorText } from './clawRequest';

export interface DraftChatSnapshot {
  name: string;
  description: string;
  systemPrompt: string;
  tools: AgentCreateFormState['tools'];
  skillIds: string[];
  kbScope: AgentCreateFormState['selectedKbScope'];
  knowledgeBase: AgentCreateFormState['selectedKbResources'];
}

export function snapshotFromForm(form: AgentCreateFormState): DraftChatSnapshot {
  return {
    name: form.name,
    description: form.description,
    systemPrompt: form.systemPrompt,
    tools: form.tools,
    skillIds: form.selectedSkillIds,
    kbScope: form.selectedKbScope,
    knowledgeBase: form.selectedKbResources,
  };
}

export interface DraftChatHandlers {
  onDelta: (text: string) => void;
  onDone: (finalText: string | null) => void;
  onError: (message: string) => void;
}

/** Streams a turn against the unsaved agent. Resolves when the SSE stream ends. */
export async function streamDraftChat(input: {
  message: string;
  draftConversationId: string;
  snapshot: DraftChatSnapshot;
  signal: AbortSignal;
  handlers: DraftChatHandlers;
}): Promise<void> {
  // Streaming body — clawRequest parses JSON and would consume the stream.
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  const res = await fetch(`${CLAW_API_BASE}/api/v1/agents/draft-chat`, {
    method: 'POST',
    credentials: 'include',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message: input.message,
      draftConversationId: input.draftConversationId,
      snapshot: input.snapshot,
    }),
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const raw = body.error ?? `Request failed: ${res.status}`;
    throw new ClawApiError(res.status, clawErrorText(new ClawApiError(res.status, raw), raw));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamed = '';

  const handleFrame = (event: string, data: Record<string, unknown>): void => {
    if (event === 'delta' && typeof data['textDelta'] === 'string') {
      streamed += data['textDelta'];
      input.handlers.onDelta(data['textDelta']);
      return;
    }
    if (event === 'done') {
      const result = data['result'];
      const content =
        result &&
        typeof result === 'object' &&
        typeof (result as { content?: unknown }).content === 'string'
          ? (result as { content: string }).content
          : null;
      const status =
        result && typeof result === 'object' ? (result as { status?: string }).status : undefined;
      const error =
        result &&
        typeof result === 'object' &&
        typeof (result as { error?: unknown }).error === 'string'
          ? (result as { error: string }).error
          : null;
      if (status === 'failed' || status === 'cancelled') {
        input.handlers.onError(error || 'The draft agent stopped.');
        return;
      }
      input.handlers.onDone(streamed.length > 0 ? null : content);
      return;
    }
    if (event === 'error') {
      const message = typeof data['error'] === 'string' ? data['error'] : 'The draft agent failed.';
      input.handlers.onError(message);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      if (!frame.trim() || frame.startsWith(':')) continue;
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      try {
        const parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        handleFrame(event, parsed);
      } catch {
        // Ignore keepalive and non-JSON frames.
      }
    }
  }
}

export async function clearDraftChat(draftConversationId: string): Promise<void> {
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  const res = await fetch(`${CLAW_API_BASE}/api/v1/agents/draft-chat/clear`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftConversationId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ClawApiError(res.status, body.error ?? 'Could not clear the draft chat.');
  }
}
