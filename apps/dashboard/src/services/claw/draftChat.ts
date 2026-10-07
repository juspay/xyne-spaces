import type { AgentCreateFormState } from '@/components/flowUI/nodes/agent/create/types';
import {
  capabilityGapFromInvocation,
  type CapabilityGap,
} from '@/components/flowUI/nodes/agent/create/draftChatGaps';
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

/** A file sent with one test message, base64 without the data-URL prefix. */
export interface DraftChatAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
}

/** What the composer adds to a test message besides its text. */
export interface DraftChatExtras {
  attachments: DraftChatAttachment[];
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
}

export const EMPTY_DRAFT_CHAT_EXTRAS: DraftChatExtras = {
  attachments: [],
  webSearchEnabled: false,
  deepResearchEnabled: false,
};

export interface DraftChatHandlers {
  onDelta: (text: string) => void;
  onDone: (finalText: string | null) => void;
  onError: (message: string) => void;
  /** The agent reported something the test can't use (missing, after save, or a write). */
  onCapabilityGap?: (gap: CapabilityGap) => void;
}

/**
 * What goes in front of text that resumes after a tool call: a paragraph break,
 * so "Let me read the file." and the "# Digest" that follows the read don't fuse
 * into one line where the heading never renders.
 */
export function afterToolBreak(streamed: string): string {
  if (!streamed.trim() || streamed.endsWith('\n\n')) return '';
  return streamed.endsWith('\n') ? '\n' : '\n\n';
}

/** Streams a turn against the unsaved agent. Resolves when the SSE stream ends. */
export async function streamDraftChat(input: {
  message: string;
  draftConversationId: string;
  snapshot: DraftChatSnapshot;
  extras?: DraftChatExtras;
  signal: AbortSignal;
  handlers: DraftChatHandlers;
}): Promise<void> {
  const extras = input.extras ?? EMPTY_DRAFT_CHAT_EXTRAS;
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
      // claw doesn't tell the model the date; claw-auth adds it in this zone.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(extras.attachments.length > 0
        ? {
            attachments: extras.attachments.map(({ fileName, mimeType, data }) => ({
              fileName,
              mimeType,
              data,
            })),
          }
        : {}),
      ...(extras.webSearchEnabled ? { webSearchEnabled: true } : {}),
      ...(extras.deepResearchEnabled ? { deepResearchEnabled: true } : {}),
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
  let toolSinceText = false;

  const handleFrame = (event: string, data: Record<string, unknown>): void => {
    if (event === 'invocation') {
      toolSinceText = true;
      const gap = capabilityGapFromInvocation(data['toolInvocation']);
      if (gap) input.handlers.onCapabilityGap?.(gap);
      return;
    }
    if (event === 'delta' && typeof data['textDelta'] === 'string') {
      const text = (toolSinceText ? afterToolBreak(streamed) : '') + data['textDelta'];
      toolSinceText = false;
      streamed += text;
      input.handlers.onDelta(text);
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
