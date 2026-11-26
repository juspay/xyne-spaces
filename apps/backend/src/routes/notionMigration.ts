/**
 * Notion migration — token import with an access review, member OAuth import, ingest (first cut).
 *
 * Two ways in, one pipeline (collect → [review] → ingest):
 *
 * 1. Admin, token — the merchant's Notion owner creates an internal integration, adds the pages to
 *    it (on Enterprise incl. members' private pages granted via Content search), shares the token:
 *      POST /token-import { token }                 → collect → awaiting_review
 *      POST /jobs/:id/approve { channel?, sections } → ingest (public / private-to-owner / skip)
 *
 * 2. Member, OAuth — on any plan, a member brings their own private pages through Notion's page
 *    picker. Uses Xyne's Notion OAuth app (NOTION_CLIENT_ID / _SECRET / _REDIRECT_URI, set once):
 *      GET /connect                → Notion consent + page picker (signed, 10-min state)
 *      GET /oauth/callback         → token → email must match → collect → ingest private to them
 *    A member import never takes over an existing canvas (e.g. the admin's public import).
 *
 *   GET /mine, GET /jobs/:id      → the signed-in user's imports
 *
 * Tokens are used only while collecting and never stored. Jobs live in Redis (History survives
 * restarts; any pod answers /mine and Approve). Pages waiting for review are staged in the migration
 * bucket. Collect and ingest still run inside the API process that started them.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import express, { Router, type Request, type Response } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { escapeHtml as esc } from '@/utils/htmlEscape';
import { runWithContext } from '@/database/tenant/context';
import { NOTION_VERSION, NotionApiCollector, NotionAuthError, type NotionTokenSource } from '@/services/notion/notionApiCollector';
import { NOTION_JOB_HEARTBEAT_MS, notionJobStore, type NotionImportJob } from '@/services/notion/notionJobStore';
import { deleteStaging, downloadStaging, remoteStagingEnabled, uploadStaging } from '@/services/notion/notionStaging';
import {
  importNotionTree,
  listNotionSections,
  resolveNotionImportTarget,
  type NotionImportPlan,
  type SectionAccess,
} from '@/services/notion/notionCanvasImporter';

/** A job while this process runs one of its phases; the local folder never leaves this process. */
type ImportJob = NotionImportJob & { stagingDir?: string };

/** What Redis keeps: everything but this process's local folder. */
const stored = (job: ImportJob): NotionImportJob => {
  const { stagingDir: _dir, ...view } = job;
  return view;
};

/** What the dashboard sees: no storage locations. */
const publicView = (job: NotionImportJob) => {
  const { stagingDir: _dir, stagingPrefix: _prefix, ...view } = job as ImportJob;
  return view;
};

const pendingSaves = new Map<string, NodeJS.Timeout>();
/** Pages awaiting review on this pod's disk — only when the migration bucket isn't configured. */
const localStaging = new Map<string, string>();

/** Save to Redis — right away for state changes, otherwise at most once a second (progress lines). */
async function persist(job: ImportJob, now = false): Promise<void> {
  job.updatedAt = Date.now();
  if (!now) {
    if (!pendingSaves.has(job.id)) pendingSaves.set(job.id, setTimeout(() => void persist(job, true), 1000));
    return;
  }
  clearTimeout(pendingSaves.get(job.id));
  pendingSaves.delete(job.id);
  await notionJobStore.save(stored(job)).catch(err =>
    logger.error('[NotionMigration] Could not save job', err, { jobId: job.id }));
}

function addLog(job: ImportJob, line: string): void {
  job.log.push(line);
  void persist(job);
}

/** Keep `updatedAt` fresh during long steps, so a live job is never mistaken for an interrupted one. */
async function withHeartbeat(job: ImportJob, run: () => Promise<void>): Promise<void> {
  const timer = setInterval(() => void persist(job, true), NOTION_JOB_HEARTBEAT_MS);
  try {
    await run();
  } finally {
    clearInterval(timer);
  }
}

/** Record a new import and start reading Notion in the background (the request doesn't wait). */
async function startJob(
  init: Pick<ImportJob, 'kind' | 'userId' | 'userEmail' | 'workspaceId'> & { notionWorkspace: string | undefined; firstLog: string },
  accessToken: string | NotionTokenSource,
): Promise<ImportJob> {
  const { firstLog, notionWorkspace, ...rest } = init;
  const now = Date.now();
  const job: ImportJob = {
    id: crypto.randomUUID(),
    ...rest,
    ...(notionWorkspace ? { notionWorkspace } : {}),
    status: 'collecting',
    log: [firstLog],
    startedAt: now,
    updatedAt: now,
  };
  await persist(job, true);
  void collect(job, accessToken);
  return job;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const NOTION_AUTHORIZE = 'https://api.notion.com/v1/oauth/authorize';
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

interface OAuthState {
  u: string; // Spaces user id
  w: string; // workspace id
  e: string; // Spaces email
  x: number; // expiry (ms)
  n: string; // nonce
}

function oauthConfig() {
  // From config, not process.env: in deployed environments the secret is KMS-encrypted in env.
  const { clientId, clientSecret, redirectUri } = config.notion;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

interface NotionTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // not documented by Notion; used only if it's sent
  workspace_name?: string;
  owner?: { user?: { person?: { email?: string } } };
  error?: string;
}

/** POST /v1/oauth/token with the app's credentials (code exchange and refresh). */
async function notionTokenRequest(oauth: NonNullable<ReturnType<typeof oauthConfig>>, body: Record<string, unknown>) {
  const res = await fetch(NOTION_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, token: (await res.json().catch(() => ({}))) as NotionTokenResponse };
}

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const expiryOf = (t: NotionTokenResponse) => (typeof t.expires_in === 'number' ? Date.now() + t.expires_in * 1000 : undefined);

/**
 * A member's OAuth tokens for one import, held in memory only (never stored). Refreshes ahead of
 * time if Notion told us the expiry, and on a 401 otherwise. A refresh rotates both tokens, so the
 * new pair replaces the old one before any request continues.
 */
function oauthTokenSource(oauth: NonNullable<ReturnType<typeof oauthConfig>>, initial: NotionTokenResponse & { access_token: string }): NotionTokenSource {
  let accessToken = initial.access_token;
  let refreshToken = initial.refresh_token;
  let expiresAt = expiryOf(initial);
  let inFlight: Promise<string> | null = null;

  const refresh = (): Promise<string> => {
    // One refresh at a time: a second caller waits for the same new token.
    inFlight ??= (async () => {
      if (!refreshToken) throw new NotionAuthError('Notion gave no refresh token');
      const { ok, status, token } = await notionTokenRequest(oauth, { grant_type: 'refresh_token', refresh_token: refreshToken });
      if (!ok || !token.access_token) throw new NotionAuthError(`token refresh failed (${token.error ?? status})`);
      accessToken = token.access_token;
      refreshToken = token.refresh_token ?? refreshToken;
      expiresAt = expiryOf(token);
      return accessToken;
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    get: async () => (expiresAt && expiresAt - REFRESH_EARLY_MS <= Date.now() ? refresh() : accessToken),
    refresh,
  };
}

const signingKey = () => config.jwt.secret || config.encryptionKey;

function signState(state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', signingKey()).update(body).digest('base64url')}`;
}

/** Anything malformed is just "invalid" — this runs without sign-in, so it must never throw. */
function verifyState(raw: string): OAuthState | null {
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const given = Buffer.from(mac);
  const expected = Buffer.from(crypto.createHmac('sha256', signingKey()).update(body).digest('base64url'));
  // Compare byte lengths: timingSafeEqual throws on unequal buffers (a non-ASCII mac has more bytes than characters).
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString()) as OAuthState;
    return typeof state.x === 'number' && state.x > Date.now() ? state : null;
  } catch {
    return null;
  }
}

/** The page the Notion consent tab/browser ends on — the user returns to the Spaces app themselves. */
function finishPage(title: string, message: string, ok: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Spaces</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px}
main{max-width:440px;text-align:center}.icon{font-size:40px}h1{font-size:20px;margin:8px 0}p{opacity:.8}</style></head>
<body><main><div class="icon">${ok ? '✅' : '⚠️'}</div><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}

const router = Router();

/** Member: Notion's consent + page picker for the signed-in user (any role). */
router.get('/connect', authMiddleware.authenticate, (req: Request, res: Response) => {
  const oauth = oauthConfig();
  if (!oauth) {
    res.status(503).json({ error: 'NOTION_OAUTH_NOT_CONFIGURED', message: 'Notion sign-in is not set up on this server (NOTION_CLIENT_ID / NOTION_CLIENT_SECRET / NOTION_REDIRECT_URI).' });
    return;
  }
  const user = req.user!;
  const state = signState({ u: user.id, w: user.workspaceId!, e: user.email, x: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') });
  const url = `${NOTION_AUTHORIZE}?${new URLSearchParams({ client_id: oauth.clientId, response_type: 'code', owner: 'user', redirect_uri: oauth.redirectUri, state })}`;
  if (req.query.format === 'json') res.json({ url });
  else res.redirect(url);
});

/** Notion → here. Trusts only the signed state (no cookies arrive on this cross-site redirect). */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const oauth = oauthConfig();
  const state = typeof req.query.state === 'string' ? verifyState(req.query.state) : null;
  if (!oauth || !state) {
    res.status(400).send(finishPage('Link expired', 'This Notion link is invalid or expired. Go back to Spaces → Migrations → Notion and click Connect Notion again.', false));
    return;
  }
  if (typeof req.query.error === 'string') {
    res.send(finishPage('Cancelled', 'Nothing was imported. You can close this tab and go back to Spaces.', false));
    return;
  }
  try {
    const { ok, status, token } = await notionTokenRequest(oauth, { grant_type: 'authorization_code', code: req.query.code, redirect_uri: oauth.redirectUri });
    if (!ok || !token.access_token) throw new Error(`Notion token exchange failed (${token.error ?? status})`);
    const { access_token: accessToken } = token;
    logger.info('[NotionMigration] OAuth token received', { hasRefreshToken: Boolean(token.refresh_token), expiresIn: token.expires_in ?? null });

    // Like Slack DM migration: you can only bring in the Notion account that is yours.
    const notionEmail = token.owner?.user?.person?.email?.toLowerCase();
    if (notionEmail !== state.e.toLowerCase()) {
      res.status(403).send(finishPage('Wrong Notion account', `That Notion account (${notionEmail ?? 'email unavailable'}) isn't yours in Spaces (${state.e}). Sign in to Notion as yourself and click Connect Notion again.`, false));
      return;
    }

    await startJob({
      kind: 'member', userId: state.u, userEmail: state.e, workspaceId: state.w, notionWorkspace: token.workspace_name,
      firstLog: `Connected to Notion workspace "${token.workspace_name ?? '?'}" as ${notionEmail}`,
    }, oauthTokenSource(oauth, { ...token, access_token: accessToken }));
    // The consent ran in a separate tab (web) or the system browser (desktop app), so don't send
    // that window to the dashboard — the app is still open and picks the new import up by itself.
    res.send(finishPage('Notion connected', `Importing from “${token.workspace_name ?? 'Notion'}”. Go back to Spaces to follow the progress — you can close this tab.`, true));
  } catch (error) {
    logger.error('[NotionMigration] OAuth callback failed', error);
    res.status(502).send(finishPage('Could not connect', 'Notion didn’t accept the connection. Go back to Spaces and click Connect Notion again.', false));
  }
});

// The router is mounted before the app-wide JSON parser, so POST routes parse their own body.

router.post('/token-import', express.json({ limit: '16kb' }), authMiddleware.authenticate, async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!/^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(token)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Paste a Notion integration token (starts with ntn_ or secret_).' });
    return;
  }
  let me: { name: string; workspace?: string };
  try {
    me = await new NotionApiCollector(token).whoAmI();
  } catch {
    res.status(400).json({ error: 'TOKEN_REJECTED', message: 'Notion rejected this token — check it was copied in full and the integration still exists.' });
    return;
  }
  const user = req.user!;
  const job = await startJob({
    kind: 'token', userId: user.id, userEmail: user.email, workspaceId: user.workspaceId!, notionWorkspace: me.workspace,
    firstLog: `Using integration "${me.name}" in Notion workspace "${me.workspace ?? '?'}" (token pasted by ${user.email})`,
  }, token);
  res.status(202).json(publicView(job));
});

router.get('/mine', authMiddleware.authenticate, async (req: Request, res: Response) => {
  res.json({ jobs: (await notionJobStore.listForUser(req.user!.workspaceId!, req.user!.id)).map(publicView) });
});

router.get('/jobs/:id', authMiddleware.authenticate, async (req: Request, res: Response) => {
  const job = await notionJobStore.get(req.params.id);
  if (!job || job.userId !== req.user!.id) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  res.json(publicView(job));
});

/**
 * Body: { channel?: string, sections: { [sectionKey]: 'public' | 'private-owner' | 'private-me' | 'skip' } }
 * 'private-owner' needs the section's Notion owner to have a Spaces account.
 */
router.post('/jobs/:id/approve', express.json({ limit: '1mb' }), authMiddleware.authenticate, async (req: Request, res: Response) => {
  const job: ImportJob | null = await notionJobStore.get(req.params.id);
  if (!job || job.userId !== req.user!.id) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  if (job.status !== 'awaiting_review' || !job.sections) {
    res.status(409).json({ error: 'INVALID_STATE', message: `Only an import awaiting review can be approved (current: ${job.status})` });
    return;
  }
  const decisions = (req.body?.sections ?? {}) as Record<string, string>;
  const sections: Record<string, SectionAccess> = {};
  for (const section of job.sections) {
    const choice = decisions[section.key] ?? 'private-owner';
    if (choice === 'public') sections[section.key] = { mode: 'public' };
    else if (choice === 'skip') sections[section.key] = { mode: 'skip' };
    else if (choice === 'private-me') {
      if (section.spacesOwner && section.spacesOwner.id !== job.userId) {
        res.status(400).json({ error: 'NOT_YOUR_PAGE', message: `"${section.title}" belongs to ${section.spacesOwner.email} — choose private to its owner, public, or skip.` });
        return;
      }
      sections[section.key] = { mode: 'private', ownerUserId: job.userId };
    }
    else if (section.spacesOwner) sections[section.key] = { mode: 'private', ownerUserId: section.spacesOwner.id };
    else {
      res.status(400).json({ error: 'OWNER_UNRESOLVED', message: `"${section.title}" has no matching Spaces user — choose public, private to you, or skip.` });
      return;
    }
  }
  if (!(await notionJobStore.claim(job.id))) {
    res.status(409).json({ error: 'INVALID_STATE', message: 'This import was already approved.' });
    return;
  }
  if (typeof req.body?.channel === 'string' && req.body.channel.trim()) job.channel = req.body.channel.trim().replace(/^#/, '');
  const count = (mode: SectionAccess['mode']) => Object.values(sections).filter(s => s.mode === mode).length;
  job.log.push(`Approved by ${job.userEmail}: ${count('public')} public, ${count('private')} private, ${count('skip')} skipped`);
  job.status = 'ingesting';
  await persist(job, true);
  void ingest(job, { sections });
  res.json(publicView(job));
});

async function collect(job: ImportJob, accessToken: string | NotionTokenSource): Promise<void> {
  const log = (m: string) => addLog(job, m);
  try {
    await withHeartbeat(job, () => collectAndStage(job, accessToken, log));
  } catch (error) {
    await fail(job, error);
  }
}

async function collectAndStage(job: ImportJob, accessToken: string | NotionTokenSource, log: (m: string) => void): Promise<void> {
  const collected = await new NotionApiCollector(accessToken).collect(log);
  job.stagingDir = collected.dir; // removed when the import ends, whatever the outcome
  log(`Collected ${collected.pages} pages, ${collected.databases} databases, ${collected.files} files, ${collected.manifest.users.length} Notion users`);
  collected.warnings.forEach(w => log(`! ${w}`));
  collected.failures.forEach(f => log(`✗ ${f.what} "${f.title}": ${f.reason}`));
  if (collected.pages + collected.databases === 0) {
    throw new Error(job.kind === 'member'
      ? 'No pages were selected in Notion’s page picker — connect again and tick your pages.'
      : 'The integration can see no pages. In Notion, add the pages to it (integration settings → Content access), then start again.');
  }
  if (job.kind === 'member') {
    await ingest(job, { sections: {}, member: { userId: job.userId } });
    return;
  }
  job.sections = await runWithContext({ userId: job.userId, workspaceId: job.workspaceId }, () =>
    listNotionSections(collected.dir, job.workspaceId));
  // The review can take days and Approve may reach another pod: keep the pages in the bucket.
  if (remoteStagingEnabled()) {
    job.stagingPrefix = await uploadStaging(collected.dir, job.id);
    await removeLocalStaging(job);
  } else {
    localStaging.set(job.id, collected.dir); // without the bucket, Approve must reach this pod
  }
  job.status = 'awaiting_review';
  log(`Waiting for review: ${job.sections.length} top-level pages`);
  await persist(job, true);
}

async function ingest(job: ImportJob, plan: NotionImportPlan): Promise<void> {
  try {
    job.status = 'ingesting';
    await persist(job, true);
    await withHeartbeat(job, async () => {
      job.stagingDir ??= localStaging.get(job.id);
      if (!job.stagingDir && job.stagingPrefix) job.stagingDir = await downloadStaging(job.stagingPrefix);
      if (!job.stagingDir) throw new Error('The collected pages are no longer available — start the import again.');
      const dir = job.stagingDir;
      await runWithContext({ userId: job.userId, workspaceId: job.workspaceId }, async () => {
        const needsChannel = !plan.member && Object.values(plan.sections).some(s => s.mode === 'public');
        const target = await resolveNotionImportTarget({ userId: job.userId, workspaceId: job.workspaceId, needsChannel, ...(job.channel ? { channelName: job.channel } : {}) });
        job.summary = await importNotionTree(dir, target, plan);
      });
    });
    job.status = 'completed';
    job.finishedAt = Date.now();
    await removeStaging(job);
    await persist(job, true);
  } catch (error) {
    await fail(job, error);
  }
}

async function fail(job: ImportJob, error: unknown): Promise<void> {
  job.status = 'failed';
  job.error = error instanceof Error ? error.message : String(error);
  job.finishedAt = Date.now();
  logger.error('[NotionMigration] Import failed', error, { jobId: job.id });
  await removeStaging(job);
  await persist(job, true);
}

/** The pages and files read from Notion are only needed until the import ends. */
async function removeStaging(job: ImportJob): Promise<void> {
  await removeLocalStaging(job);
  if (!job.stagingPrefix) return;
  const prefix = job.stagingPrefix;
  delete job.stagingPrefix;
  await deleteStaging(prefix).catch(err => logger.warn('[NotionMigration] Could not remove staged pages from the bucket', { jobId: job.id, err: String(err) }));
}

async function removeLocalStaging(job: ImportJob): Promise<void> {
  localStaging.delete(job.id);
  if (!job.stagingDir) return;
  const dir = job.stagingDir;
  delete job.stagingDir;
  await fs.rm(dir, { recursive: true, force: true }).catch(err => logger.warn('[NotionMigration] Could not remove staged pages', { jobId: job.id, err: String(err) }));
}

export default router;
