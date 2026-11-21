/** A call an embedded softphone reports, in provider-neutral form. */
export interface SoftphoneCall {
  /** The id the provider's webhook keys the call by. */
  callId: string;
  /** Another id the webhook may fall back to. */
  altCallId?: string;
  dialledNumber: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

// Ozonetel's toolbar posts { action, token: { monitorUcid, ucid, callerId } }; busyAgent can repeat per call.
function parseOzonetelMessage(data: unknown): SoftphoneCall | null {
  const message = data as { action?: unknown; token?: unknown } | null;
  if (message?.action !== 'busyAgent' && message?.action !== 'newCall') return null;
  const token = (message.token ?? {}) as {
    monitorUcid?: unknown;
    ucid?: unknown;
    callerId?: unknown;
  };
  const callId = asText(token.monitorUcid);
  if (!callId) return null;
  const altCallId = asText(token.ucid);
  return { callId, ...(altCallId ? { altCallId } : {}), dialledNumber: asText(token.callerId) };
}

const PARSERS: Record<string, (data: unknown) => SoftphoneCall | null> = {
  ozonetel: parseOzonetelMessage,
};

/** The call a softphone iframe message reports, or null for any other message. */
export function parseSoftphoneMessage(provider: string, data: unknown): SoftphoneCall | null {
  return PARSERS[provider]?.(data) ?? null;
}
