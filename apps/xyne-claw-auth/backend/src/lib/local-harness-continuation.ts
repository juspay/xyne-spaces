import { isLocalHarnessProvider } from "xyne-claw-shared";
import { createLogger } from "../logger.js";
import { chatMessageRepository } from "../repositories/chatMessageRepository.js";
import { localHarnessSessionRepository } from "../repositories/localHarnessSessionRepository.js";

const log = createLogger("local-harness-continuation");

export const HARNESS_TRANSCRIPT_MAX_MESSAGES = 40;
export const HARNESS_TRANSCRIPT_MAX_CHARS = 24000;

const TRANSCRIPT_HEADER =
  "Earlier conversation in this thread (it ran on a different provider, so you have not seen it):";

export interface TranscriptMessage {
  role: string;
  content: string;
  status?: string | null;
  runProvider?: string | null;
  id?: string;
}

function isTranscriptable(message: TranscriptMessage): boolean {
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (message.status === "running") return false;
  return typeof message.content === "string" && message.content.trim().length > 0;
}

export function buildTranscript(messages: TranscriptMessage[]): string | null {
  const usable = messages.filter(isTranscriptable);
  if (usable.length === 0) return null;

  let kept = usable.slice(-HARNESS_TRANSCRIPT_MAX_MESSAGES);
  let truncated = kept.length < usable.length;

  const render = (list: TranscriptMessage[]): string =>
    list.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`).join("\n");

  while (kept.length > 1 && render(kept).length > HARNESS_TRANSCRIPT_MAX_CHARS) {
    kept = kept.slice(1);
    truncated = true;
  }

  const body = render(kept);
  if (!body.trim()) return null;

  return [TRANSCRIPT_HEADER, ...(truncated ? ["(earlier messages omitted)"] : []), body].join("\n");
}

async function loadMessages(args: {
  conversationId: string;
  agentSlug: string;
  excludeMessageIds?: string[];
}): Promise<TranscriptMessage[]> {
  const excluded = new Set(args.excludeMessageIds ?? []);
  const rows = await chatMessageRepository.findByConversationAndAgent(args.conversationId, args.agentSlug);
  return rows
    .filter((row) => !excluded.has(row.id) && row.status !== "running")
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      status: row.status,
      runProvider: row.runProvider,
    }));
}

export async function planHarnessContinuation(args: {
  conversationId: string;
  agentSlug: string;
  provider: string;
  excludeMessageIds?: string[];
}): Promise<{ resumeSessionId: string | null; context: string | null }> {
  try {
    const [session, messages] = await Promise.all([
      localHarnessSessionRepository.find(args.conversationId, args.provider),
      loadMessages(args),
    ]);

    if (!session) {
      return { resumeSessionId: null, context: buildTranscript(messages) };
    }

    let lastSameProviderIdx = -1;
    messages.forEach((message, index) => {
      if (message.role === "assistant" && message.runProvider === args.provider) lastSameProviderIdx = index;
    });

    return {
      resumeSessionId: session.cliSessionId,
      context: buildTranscript(messages.slice(lastSameProviderIdx + 1)),
    };
  } catch (err) {
    log.warn(
      `[local-harness] continuation planning failed conv=${args.conversationId} provider=${args.provider}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { resumeSessionId: null, context: null };
  }
}

export async function planServerContinuation(args: {
  conversationId: string;
  agentSlug: string;
  excludeMessageIds?: string[];
}): Promise<string | null> {
  try {
    const messages = await loadMessages(args);
    const hasHarnessTurn = messages.some(
      (message) => message.role === "assistant" && isLocalHarnessProvider(message.runProvider),
    );
    if (!hasHarnessTurn) return null;

    let lastServerIdx = -1;
    messages.forEach((message, index) => {
      if (
        message.role === "assistant" &&
        typeof message.runProvider === "string" &&
        message.runProvider &&
        !isLocalHarnessProvider(message.runProvider)
      ) {
        lastServerIdx = index;
      }
    });

    return buildTranscript(messages.slice(lastServerIdx + 1));
  } catch (err) {
    log.warn(
      `[local-harness] server continuation planning failed conv=${args.conversationId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
