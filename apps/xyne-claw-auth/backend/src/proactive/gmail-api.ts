const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const REQUEST_TIMEOUT_MS = 20_000;

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailHistoryPage {
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }> }>;
  historyId?: string;
  nextPageToken?: string;
}

export const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "List-Unsubscribe",
  "List-Id",
  "Precedence",
  "Auto-Submitted",
] as const;

export class GmailClient {
  constructor(private readonly accessToken: string) {}

  private async call<T>(path: string, init: { method?: string; query?: Record<string, string | string[]>; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${GMAIL_BASE}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GmailApiError(res.status, `gmail ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  profile(): Promise<{ emailAddress: string; historyId: string }> {
    return this.call("/profile");
  }

  watch(topicName: string): Promise<{ historyId: string; expiration: string }> {
    return this.call("/watch", {
      method: "POST",
      body: { topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "INCLUDE" },
    });
  }

  stop(): Promise<void> {
    return this.call("/stop", { method: "POST", body: {} });
  }

  history(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage> {
    return this.call("/history", {
      query: {
        startHistoryId,
        historyTypes: "messageAdded",
        maxResults: "500",
        ...(pageToken ? { pageToken } : {}),
      },
    });
  }

  recentMessageIds(query: string, maxResults: number): Promise<{ messages?: Array<{ id: string; threadId: string }> }> {
    return this.call("/messages", { query: { q: query, maxResults: String(maxResults) } });
  }

  messageMetadata(id: string): Promise<GmailMessage> {
    return this.call(`/messages/${encodeURIComponent(id)}`, {
      query: { format: "metadata", metadataHeaders: [...METADATA_HEADERS] },
    });
  }

  thread(id: string): Promise<{ id: string; messages?: GmailMessage[] }> {
    return this.call(`/threads/${encodeURIComponent(id)}`, { query: { format: "full" } });
  }
}
