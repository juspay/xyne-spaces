import type { TicketArtifact } from "xyne-claw-shared";
import { spacesAppFetchGet } from "./spaces-api.js";

const TICKET_STATUSES = ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"] as const;
const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export function parseXyneIdFromToolResult(resultText: string): string | null {
  const match = /^\s*xyneId:\s*(\S+)\s*$/im.exec(resultText);
  return match?.[1] ?? null;
}

/**
 * The fields the email-sent card shows, read back from what the tool actually
 * sent rather than from the action's params — on a reply the subject comes
 * from the thread, so params would show a blank where the recipient saw a
 * real subject line.
 */
export function parseSentEmailFromToolResult(resultText: string): {
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  ticketXyneId?: string;
} | null {
  const sent =
    /^\s*Sent to\s+(.+?)\s*(?:\(cc\s+(.+?)\s*\))?\s*(?:\(bcc\s+(.+?)\s*\))?\.\s*$/im.exec(resultText);
  if (!sent) return null;
  const list = (raw: string | undefined): string[] =>
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const to = list(sent[1]);
  if (to.length === 0) return null;
  const subject = /^\s*Subject:\s*(.+?)\s*$/im.exec(resultText)?.[1];
  const ticketXyneId = /^\s*Ticket:\s*(\S+)\s*$/im.exec(resultText)?.[1];
  return {
    to,
    cc: list(sent[2]),
    bcc: list(sent[3]),
    ...(subject ? { subject } : {}),
    ...(ticketXyneId ? { ticketXyneId } : {}),
  };
}

export async function fetchTicketForCard(
  xyneId: string,
  appToken: string,
): Promise<TicketArtifact | null> {
  try {
    const data = (await spacesAppFetchGet(
      `/ticket/${encodeURIComponent(xyneId)}`,
      appToken,
    )) as {
      id?: string;
      xyneId?: string;
      title?: string;
      statusV2?: string;
      priority?: string;
      eta?: string | null;
      stageName?: string | null;
      assignedTo?: string | null;
      workspaceId?: string;
      channelId?: string;
      conversationId?: string;
    };
    if (!data?.id || !data.xyneId || !data.title) return null;
    if (!data.workspaceId || !data.channelId || !data.conversationId) return null;

    const status = TICKET_STATUSES.find((candidate) => candidate === data.statusV2);
    const priority = TICKET_PRIORITIES.find((candidate) => candidate === data.priority);
    if (!status || !priority) return null;

    return {
      xyneId: data.xyneId,
      ticketId: data.id,
      title: data.title,
      status,
      priority,
      ...(data.stageName ? { stageName: data.stageName } : {}),
      ...(data.eta ? { eta: data.eta } : {}),
      channelId: data.channelId,
      conversationId: data.conversationId,
      ...(data.assignedTo ? { assigneeId: data.assignedTo } : {}),
      url: `/${encodeURIComponent(data.workspaceId)}/chat/dir/${encodeURIComponent(data.channelId)}?${new URLSearchParams(
        { tab: "tickets", ticketId: data.id, conversationId: data.conversationId },
      ).toString()}`,
    };
  } catch {
    return null;
  }
}
