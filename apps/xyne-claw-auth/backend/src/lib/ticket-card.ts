import type { TicketArtifact } from "xyne-claw-shared";
import { spacesAppFetchGet } from "./spaces-api.js";

const TICKET_STATUSES = ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"] as const;
const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export function parseXyneIdFromToolResult(resultText: string): string | null {
  const match = /^\s*xyneId:\s*(\S+)\s*$/im.exec(resultText);
  return match?.[1] ?? null;
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
