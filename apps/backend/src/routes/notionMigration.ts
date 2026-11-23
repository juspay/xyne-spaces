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
 * Tokens are used only while collecting and never stored. Jobs are in-memory for now; the durable
 * queued job (like Slack migration) replaces this.
 */
import crypto from 'crypto';
import express, { Router, type Request, type Response } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { runWithContext } from '@/database/tenant/context';
import { NotionApiCollector } from '@/services/notion/notionApiCollector';
import {
  importNotionTree,
  listNotionSections,
  resolveNotionImportTarget,
  type NotionImportPlan,
  type NotionImportSummary,
  type NotionSection,
  type SectionAccess,
} from '@/services/notion/notionCanvasImporter';

type JobStatus = 'collecting' | 'awaiting_review' | 'ingesting' | 'completed' | 'failed';

interface ImportJob {
  id: string;
  kind: 'token' | 'member';
  userId: string;
  userEmail: string;
  workspaceId: string;
  status: JobStatus;
  channel?: string;
  notionWorkspace?: string;
  log: string[];
  sections?: NotionSection[]; // set when awaiting review
  summary?: NotionImportSummary;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  stagingDir?: string; // collected pages, kept until ingest
}

const jobs = new Map<string, ImportJob>();

const publicView = (job: ImportJob) => {
  const { stagingDir: _dir, ...view } = job;
  return view;
};

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

const signingKey = () => config.jwt.secret || config.encryptionKey;

function signState(state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', signingKey()).update(body).digest('base64url')}`;
}

function verifyState(raw: string): OAuthState | null {
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const state = JSON.parse(Buffer.from(body, 'base64url').toString()) as OAuthState;
  return state.x > Date.now() ? state : null;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

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
    const tokenRes = await fetch(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: oauth.redirectUri }),
    });
    const token = await tokenRes.json() as { access_token?: string; workspace_name?: string; owner?: { user?: { person?: { email?: string } } }; error?: string };
    if (!tokenRes.ok || !token.access_token) throw new Error(`Notion token exchange failed (${token.error ?? tokenRes.status})`);

    // Like Slack DM migration: you can only bring in the Notion account that is yours.
    const notionEmail = token.owner?.user?.person?.email?.toLowerCase();
    if (notionEmail !== state.e.toLowerCase()) {
      res.status(403).send(finishPage('Wrong Notion account', `That Notion account (${notionEmail ?? 'email unavailable'}) isn't yours in Spaces (${state.e}). Sign in to Notion as yourself and click Connect Notion again.`, false));
      return;
    }

    const job: ImportJob = {
      id: crypto.randomUUID(),
      kind: 'member',
      userId: state.u,
      userEmail: state.e,
      workspaceId: state.w,
      status: 'collecting',
      notionWorkspace: token.workspace_name,
      log: [`Connected to Notion workspace "${token.workspace_name ?? '?'}" as ${notionEmail}`],
      startedAt: Date.now(),
    };
    jobs.set(job.id, job);
    void collect(job, token.access_token);
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
  const job: ImportJob = {
    id: crypto.randomUUID(),
    kind: 'token',
    userId: user.id,
    userEmail: user.email,
    workspaceId: user.workspaceId!,
    status: 'collecting',
    notionWorkspace: me.workspace,
    log: [`Using integration "${me.name}" in Notion workspace "${me.workspace ?? '?'}" (token pasted by ${user.email})`],
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  void collect(job, token);
  res.status(202).json(publicView(job));
});

router.get('/mine', authMiddleware.authenticate, (req: Request, res: Response) => {
  const mine = [...jobs.values()]
    .filter(j => j.userId === req.user!.id)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(publicView);
  res.json({ jobs: mine });
});

router.get('/jobs/:id', authMiddleware.authenticate, (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
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
  const job = jobs.get(req.params.id);
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
  if (typeof req.body?.channel === 'string' && req.body.channel.trim()) job.channel = req.body.channel.trim().replace(/^#/, '');
  const count = (mode: SectionAccess['mode']) => Object.values(sections).filter(s => s.mode === mode).length;
  job.log.push(`Approved by ${job.userEmail}: ${count('public')} public, ${count('private')} private, ${count('skip')} skipped`);
  job.status = 'ingesting';
  void ingest(job, { sections });
  res.json(publicView(job));
});

async function collect(job: ImportJob, accessToken: string): Promise<void> {
  const log = (m: string) => { job.log.push(m); };
  try {
    const collected = await new NotionApiCollector(accessToken).collect(log);
    log(`Collected ${collected.pages} pages, ${collected.databases} databases, ${collected.files} files, ${collected.manifest.users.length} Notion users`);
    collected.warnings.forEach(w => log(`! ${w}`));
    if (collected.pages + collected.databases === 0) {
      throw new Error(job.kind === 'member'
        ? 'No pages were selected in Notion’s page picker — connect again and tick your pages.'
        : 'The integration can see no pages. In Notion, add the pages to it (integration settings → Content access), then start again.');
    }
    job.stagingDir = collected.dir;
    if (job.kind === 'member') {
      await ingest(job, { sections: {}, member: { userId: job.userId } });
      return;
    }
    job.sections = await runWithContext({ userId: job.userId, workspaceId: job.workspaceId }, () =>
      listNotionSections(collected.dir, job.workspaceId));
    job.status = 'awaiting_review';
    log(`Waiting for review: ${job.sections.length} top-level pages`);
  } catch (error) {
    fail(job, error);
  }
}

async function ingest(job: ImportJob, plan: NotionImportPlan): Promise<void> {
  try {
    job.status = 'ingesting';
    await runWithContext({ userId: job.userId, workspaceId: job.workspaceId }, async () => {
      const target = await resolveNotionImportTarget({ email: job.userEmail, channelName: job.channel });
      job.summary = await importNotionTree(job.stagingDir!, target, plan);
    });
    job.status = 'completed';
    job.finishedAt = Date.now();
  } catch (error) {
    fail(job, error);
  }
}

function fail(job: ImportJob, error: unknown): void {
  job.status = 'failed';
  job.error = error instanceof Error ? error.message : String(error);
  job.finishedAt = Date.now();
  logger.error('[NotionMigration] Import failed', error, { jobId: job.id });
}

export default router;
