import { callService } from '@/src/services/Call/callService';

/** Fix Hindi/Urdu/Arabic text corrupted by UTF-8 bytes read as Latin-1 (native atob). */
export function repairUtf8Mojibake(text: string): string {
  if (!/[\u00C2-\u00EF][\u0080-\u00BF]/.test(text)) return text;

  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

const transcriptCache = new Map<string, string>();
const inflightTranscriptRequests = new Map<string, Promise<string>>();

export function getCachedTranscript(callId: string): string | undefined {
  return transcriptCache.get(callId);
}

export function invalidateTranscriptCache(callId: string): void {
  transcriptCache.delete(callId);
  inflightTranscriptRequests.delete(callId);
}

export async function fetchTranscript(
  callId: string,
  options?: { force?: boolean },
): Promise<string> {
  if (!options?.force) {
    const cached = transcriptCache.get(callId);
    if (cached !== undefined) return cached;

    const inflight = inflightTranscriptRequests.get(callId);
    if (inflight) return inflight;
  } else {
    invalidateTranscriptCache(callId);
  }

  const request = callService
    .downloadTranscript(callId)
    .then(result => {
      const text = repairUtf8Mojibake(result.data);
      transcriptCache.set(callId, text);
      inflightTranscriptRequests.delete(callId);
      return text;
    })
    .catch(error => {
      inflightTranscriptRequests.delete(callId);
      throw error;
    });

  inflightTranscriptRequests.set(callId, request);
  return request;
}
