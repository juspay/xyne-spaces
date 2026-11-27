export const IDENTITY_FIELDS = [
  "userId",
  "userName",
  "userEmail",
  "orgId",
  "workspaceId",
  "spacesUserId",
  "senderId",
] as const;

export const TRUST_BEARING_FIELDS = [
  "providerConfigs",
  "agentConfig",
  "callbackUrl",
  "progressUrl",
  "eventType",
  "triggerSource",
  "sessionToken",
] as const;

export interface SpacesRunDispatch {
  sessionId: string;
  agentSlug: string;
  conversationId: string;
  task: string;
  body: Record<string, unknown>;
}

export type SpacesSchemaResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string; offending: string[] };

export function rejectIdentityFields(body: Record<string, unknown>): SpacesSchemaResult {
  const offending = IDENTITY_FIELDS.filter((key) => body[key] !== undefined);
  if (offending.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `identity fields are not accepted on the dispatch body: ${offending.join(", ")}`,
      offending: [...offending],
    };
  }
  return { ok: true, body };
}

export function stripIdentityFields(body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if ((IDENTITY_FIELDS as readonly string[]).includes(key)) continue;
    next[key] = value;
  }
  return next;
}
