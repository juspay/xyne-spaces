/**
 * Spaces MCP sign-in from the desktop app.
 *
 * The Spaces MCP server keeps its session in `~/.xyne/agent/spaces.json`, a
 * file the web page cannot reach. These run in the main process on its behalf:
 *
 * - `signInSpacesMcp` runs the same Xyne SSO sign-in as `spaces_login`, but
 *   approves it with the app's own login (the button press is the consent), and
 *   writes the session to the file. Running MCP servers pick it up from there.
 * - `getSpacesMcpStatus` reads the file and asks Spaces (`GET /api/sdk/v1/me`)
 *   whether the session still works.
 * - `signOutSpacesMcp` ends the sign-in on Spaces and removes it from the file.
 *
 * Writes to the file take `spaces.json.lock`, the lock the MCP renews under, so
 * a renewal finishing late cannot overwrite what was just written.
 *
 * The page passes nothing in — no path, no address, no token — and gets back
 * only an outcome, never the session: the address is worked out here, so a page
 * cannot have a session sent somewhere else, and the token stays in this process.
 */

import { net } from 'electron';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../app/config';
import { getMainWindow } from '../window/manager';
import { errorLogger } from './logger/Logger';

/** A Spaces MCP session, as the MCP saves it. */
interface StoredSession {
  cookie: { name: string; value: string };
  expiresAt: number;
  userId: string;
  workspaceId: string;
  /** Issued by Spaces deployments that renew sessions; carried through as-is. */
  refreshToken?: string;
  refreshExpiresAt?: number;
}

export type SpacesMcpStatus =
  | { state: 'signed_in'; user?: { name: string; email: string }; until: number; renewsAutomatically: boolean }
  | { state: 'signed_out' }
  | { state: 'expired'; expiredAt: number }
  /** Spaces no longer accepts the saved session: signed out elsewhere, or the user was removed */
  | { state: 'invalid' }
  /** The saved session belongs to another Spaces deployment */
  | { state: 'other_deployment'; baseUrl: string }
  | { state: 'unreachable'; message: string };

export type SpacesMcpSignInResult =
  | { ok: true; status: SpacesMcpStatus }
  | { ok: false; message: string };

export type SpacesMcpSignOutResult =
  | { ok: true; status: SpacesMcpStatus; notice?: string }
  | { ok: false; message: string };

const REQUEST_TIMEOUT_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Longest a sign-in or sign-out waits for Spaces to end the sign-in it replaces. */
const SIGN_OUT_WAIT_MS = 5_000;

/** As the MCP's lock: how long to wait for it, and when a left-over one is stale. */
const LOCK_WAIT_MS = 10_000;
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 100;

/** Polls after approving, in case the decision is not visible to the first one. */
const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 1_000;

/** `~/.xyne/agent/spaces.json`, or under `XYNE_AGENT_DIR`, as the MCP resolves it. */
function configPath(): string {
  const envDir = process.env.XYNE_AGENT_DIR;
  if (envDir) {
    if (envDir === '~') return path.join(os.homedir(), 'spaces.json');
    if (envDir.startsWith('~/')) return path.join(os.homedir(), envDir.slice(2), 'spaces.json');
    return path.join(envDir, 'spaces.json');
  }
  return path.join(os.homedir(), '.xyne', 'agent', 'spaces.json');
}

/**
 * The address the MCP should use for this deployment: the backend's public
 * host, without the app's `app.` prefix, as the Developers tab shows it. Not
 * the mTLS host, which the MCP cannot reach.
 */
export function spacesMcpBaseUrl(): string {
  const url = new URL(config.BACKEND_URL);
  url.hostname = url.hostname.replace(/^app\./, '');
  return url.origin;
}

/** Where the app's own API calls go, so its login cookies apply. */
function appApiOrigin(): string {
  const page = getMainWindow()?.webContents.getURL();
  try {
    if (page && new URL(page).origin === new URL(config.MTLS_FRONTEND_URL).origin) {
      return new URL(config.MTLS_BACKEND_URL).origin;
    }
  } catch {
    // Not a URL (e.g. before the page loads): use the ordinary backend
  }
  return new URL(config.BACKEND_URL).origin;
}

interface HttpResult {
  status: number;
  body: unknown;
}

/**
 * One JSON request through Electron's network stack. `withAppLogin` sends the
 * app's own cookies; otherwise none are sent but an explicit `cookie`.
 */
function request(
  method: 'GET' | 'POST',
  url: string,
  options: { body?: unknown; withAppLogin?: boolean; cookie?: string } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method, url, useSessionCookies: options.withAppLogin === true });
    req.setHeader('Accept', 'application/json');
    if (options.body !== undefined) req.setHeader('Content-Type', 'application/json');
    if (options.cookie) req.setHeader('Cookie', options.cookie);

    const timer = setTimeout(() => {
      req.abort();
      reject(new Error('Spaces did not respond in time'));
    }, REQUEST_TIMEOUT_MS);

    req.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf-8');
        let body: unknown = undefined;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = text;
        }
        resolve({ status: response.statusCode, body });
      });
      response.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function field(body: unknown, key: string): unknown {
  return body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
}

function messageOf(body: unknown, fallback: string): string {
  const message = field(body, 'message');
  return typeof message === 'string' && message ? message : fallback;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredSession>;
  return (
    typeof v.cookie?.name === 'string' &&
    typeof v.cookie.value === 'string' &&
    typeof v.expiresAt === 'number' &&
    typeof v.userId === 'string' &&
    typeof v.workspaceId === 'string'
  );
}

async function readStoredConfig(): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(configPath(), 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Write the file. Owner-only, as the MCP writes it, and replaced in one step
 * (temporary file, then rename) so a running server never reads half a file.
 */
async function writeStoredConfig(stored: Record<string, unknown>): Promise<void> {
  const file = configPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, file);
}

/**
 * Run `fn` holding `spaces.json.lock`, the MCP's lock, taken the same way:
 * created exclusively, stale after 30s, and given up on after 10s.
 */
async function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = `${configPath()}.lock`;
  await fs.mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held) {
    try {
      await (await fs.open(lock, 'wx', 0o600)).close();
      held = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') break;
      const age = await fs.stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > STALE_LOCK_MS) {
        await fs.unlink(lock).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) break;
      await sleep(LOCK_RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    if (held) await fs.unlink(lock).catch(() => {});
  }
}

/**
 * End a sign-in on Spaces by its refresh token. Bounded and best effort: true
 * if Spaces confirmed it, false if it could not be reached in time.
 */
async function endSignIn(baseUrl: string, refreshToken: string): Promise<boolean> {
  const ended = request('POST', `${baseUrl}/api/sdk/auth/sso/logout`, { body: { refreshToken } }).then(
    (response) => response.status === 204,
    () => false,
  );
  return Promise.race([ended, sleep(SIGN_OUT_WAIT_MS).then(() => false)]);
}

/** Where a saved session's sign-in lives: the file's own address, else this deployment's. */
function savedBaseUrl(stored: Record<string, unknown>): string {
  return typeof stored.baseUrl === 'string' && /^https?:\/\//.test(stored.baseUrl)
    ? stored.baseUrl.replace(/\/+$/, '')
    : spacesMcpBaseUrl();
}

/** The session in an approved poll response, in the shape the MCP saves. */
function toStoredSession(body: unknown): StoredSession | undefined {
  const cookie = field(body, 'cookie') as { name?: unknown; value?: unknown } | undefined;
  const expiresAt = field(body, 'expires_at');
  const userId = field(body, 'user_id');
  const workspaceId = field(body, 'workspace_id');
  if (
    typeof cookie?.name !== 'string' ||
    typeof cookie.value !== 'string' ||
    typeof expiresAt !== 'number' ||
    typeof userId !== 'string' ||
    typeof workspaceId !== 'string'
  ) {
    return undefined;
  }
  const refreshToken = field(body, 'refresh_token');
  const refreshExpiresAt = field(body, 'refresh_expires_at');
  return {
    cookie: { name: cookie.name, value: cookie.value },
    expiresAt,
    userId,
    workspaceId,
    ...(typeof refreshToken === 'string' && typeof refreshExpiresAt === 'number'
      ? { refreshToken, refreshExpiresAt }
      : {}),
  };
}

/**
 * Sign the Spaces MCP in as the user signed in to the app: start a Xyne SSO
 * request, approve it with the app's login, collect the session and save it.
 */
export async function signInSpacesMcp(): Promise<SpacesMcpSignInResult> {
  const baseUrl = spacesMcpBaseUrl();
  try {
    // The MCP that reads the file renews sessions, so ask for a refresh token.
    const init = await request('POST', `${baseUrl}/api/sdk/auth/sso/init`, { body: { refresh: true } });
    const deviceCode = field(init.body, 'device_code');
    const userCode = field(init.body, 'user_code');
    if (init.status !== 200 || typeof deviceCode !== 'string' || typeof userCode !== 'string') {
      return { ok: false, message: messageOf(init.body, 'Spaces could not start the sign-in.') };
    }

    const approve = await request('POST', `${appApiOrigin()}/api/sdk/auth/sso/approve`, {
      body: { userCode, approved: true },
      withAppLogin: true,
    });
    if (approve.status === 401) {
      return { ok: false, message: 'The app is not signed in to Spaces. Sign in to the app, then try again.' };
    }
    if (approve.status !== 200) {
      return { ok: false, message: messageOf(approve.body, 'Spaces did not approve the sign-in.') };
    }

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const poll = await request('POST', `${baseUrl}/api/sdk/auth/sso/poll`, { body: { deviceCode } });
      if (poll.status === 200) {
        const session = toStoredSession(poll.body);
        if (!session) return { ok: false, message: 'Spaces returned an unexpected sign-in response.' };
        await withSessionLock(async () => {
          const { apiKey: _dropped, ...stored } = await readStoredConfig();
          const replaced = stored.session;
          await writeStoredConfig({ ...stored, baseUrl, session });
          // End the sign-in this one replaces, so it does not stay live unused
          if (isStoredSession(replaced) && replaced.refreshToken && replaced.refreshToken !== session.refreshToken) {
            await endSignIn(savedBaseUrl(stored), replaced.refreshToken);
          }
        });
        return { ok: true, status: await getSpacesMcpStatus() };
      }
      if (field(poll.body, 'error') !== 'authorization_pending') {
        return { ok: false, message: messageOf(poll.body, 'Spaces did not complete the sign-in.') };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { ok: false, message: 'Spaces did not complete the sign-in in time. Try again.' };
  } catch (error) {
    errorLogger.warn('[spaces-mcp] Sign-in failed', { error: error instanceof Error ? error.message : String(error) });
    return {
      ok: false,
      message: `Could not reach Spaces at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Whether the saved MCP session works for this deployment.
 *
 * A session that can be renewed (it has a refresh token that has not expired)
 * counts as signed in even after its cookie expires: the MCP renews it on its
 * next call. It is not renewed here, since renewing replaces the refresh token
 * and that is the MCP's to do.
 */
export async function getSpacesMcpStatus(): Promise<SpacesMcpStatus> {
  const baseUrl = spacesMcpBaseUrl();
  const stored = await readStoredConfig();
  const session = stored.session;
  if (!isStoredSession(session)) return { state: 'signed_out' };

  if (typeof stored.baseUrl === 'string' && stored.baseUrl.replace(/\/+$/, '') !== baseUrl) {
    return { state: 'other_deployment', baseUrl: stored.baseUrl };
  }

  const now = Date.now();
  const renewable =
    typeof session.refreshToken === 'string' &&
    typeof session.refreshExpiresAt === 'number' &&
    session.refreshExpiresAt > now;
  const until = renewable ? session.refreshExpiresAt! : session.expiresAt;

  if (session.expiresAt <= now) {
    return renewable
      ? { state: 'signed_in', until, renewsAutomatically: true }
      : { state: 'expired', expiredAt: session.expiresAt };
  }

  try {
    const me = await request('GET', `${baseUrl}/api/sdk/v1/me`, {
      cookie: `${session.cookie.name}=${session.cookie.value}; xyne_last_workspace=${session.workspaceId}`,
    });
    if (me.status === 200) {
      const name = field(me.body, 'displayName') || field(me.body, 'name');
      const email = field(me.body, 'email');
      return {
        state: 'signed_in',
        until,
        renewsAutomatically: renewable,
        ...(typeof email === 'string' ? { user: { name: typeof name === 'string' ? name : email, email } } : {}),
      };
    }
    if (me.status === 401) return { state: 'invalid' };
    return { state: 'unreachable', message: messageOf(me.body, `Spaces answered ${me.status}.`) };
  } catch (error) {
    return { state: 'unreachable', message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Sign the Spaces MCP out on this computer: end the sign-in on Spaces when it
 * can be (a session with a refresh token), and remove the session from the
 * file either way, keeping the rest of it. A cookie already issued stays valid
 * on Spaces until it expires; nothing here holds it any more.
 */
export async function signOutSpacesMcp(): Promise<SpacesMcpSignOutResult> {
  try {
    const notice = await withSessionLock(async () => {
      const { session, ...rest } = await readStoredConfig();
      if (!isStoredSession(session)) return undefined;
      const ended = session.refreshToken ? await endSignIn(savedBaseUrl(rest), session.refreshToken) : true;
      await writeStoredConfig(rest);
      return ended
        ? undefined
        : 'Signed out on this computer, but Spaces could not be reached to end the sign-in there.';
    });
    return { ok: true, status: { state: 'signed_out' }, ...(notice ? { notice } : {}) };
  } catch (error) {
    errorLogger.warn('[spaces-mcp] Sign-out failed', { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, message: `Could not update ${configPath()}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
