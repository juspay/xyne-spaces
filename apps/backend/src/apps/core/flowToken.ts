
import crypto from 'node:crypto';

/**
 * Distinguishes a flow token from the SDK keys and session tokens that share
 * `JWT_SECRET` (see API_KEY_AUDIENCE in api/sdk/auth.ts). Without it, one key
 * serving three purposes invites cross-protocol confusion.
 */
const AUDIENCE = 'xyne-flow';

/** Matches the window Slack allows an interactive ephemeral's response_url. */
const TTL_MS = 30 * 60 * 1000;

const VERSION = 1;

/** Read at call time, never at module load: a boot-generated secret would
 *  invalidate every open card on deploy and break outright across pods. */
function secret(): string {
  const value = process.env['JWT_SECRET'];
  if (!value) throw new Error('JWT_SECRET environment variable is required');
  return value;
}

function sign(encoded: string): string {
  return crypto.createHmac('sha256', secret()).update(encoded).digest('hex');
}

export interface FlowTokenClaims {
  appId: string;
  /** The one user permitted to act on the card. */
  userId: string;
  /** Binds the token to a single card, so it cannot be replayed onto another. */
  messageId: string;
}

export function mintFlowToken(claims: FlowTokenClaims): string {
  const payload = { v: VERSION, aud: AUDIENCE, ...claims, exp: Date.now() + TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

/** Mints a per-fetch flow-action token for a Xyne AI artifact card. Cards
 *  without `spacesAppId` + `chatMessageId` are returned untouched. */
export function attachXyneAiFlowToken<T>(flow: T, userId: string): T {
  if (!flow || typeof flow !== 'object') return flow;
  const data = (flow as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return flow;
  const record = data as Record<string, unknown>;
  const appId = record['spacesAppId'];
  const messageId = record['chatMessageId'];
  if (typeof appId !== 'string' || !appId) return flow;
  if (typeof messageId !== 'string' || !messageId) return flow;
  if (!userId) return flow;
  return {
    ...flow,
    data: { ...record, __xyneFlowToken: mintFlowToken({ appId, userId, messageId }) },
  };
}

/**
 * Returns the appId the token was minted for, or null if it fails any check.
 * One return value on purpose — there is no partially-trusted token.
 */
export function verifyFlowToken(
  token: string,
  userId: string,
  messageId: string,
): string | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  // Compare raw bytes, not hex strings: a `===` on a signature leaks how many
  // leading bytes a guess got right. Malformed hex decodes short, so the length
  // check also rejects it before timingSafeEqual (which throws on a mismatch).
  const provided = Buffer.from(signature, 'hex');
  const expected = Buffer.from(sign(encoded), 'hex');
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }

  if (payload['v'] !== VERSION || payload['aud'] !== AUDIENCE) return null;
  // The signature proves the server minted it; these prove it was minted for
  // THIS user and THIS card, so a token cannot be lifted between either.
  if (payload['userId'] !== userId || payload['messageId'] !== messageId) return null;
  const exp = payload['exp'];
  if (typeof exp !== 'number' || exp < Date.now()) return null;

  const appId = payload['appId'];
  return typeof appId === 'string' && appId ? appId : null;
}
