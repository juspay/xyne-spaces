/**
 * JIRA-compatibility facade: makes Bitbucket Server treat Xyne Spaces as a linked
 * JIRA so ticket keys (e.g. XYNE-16662) in commits/PRs linkify and open in Spaces
 * instead of Atlassian JIRA.
 *
 * Mounted at /api/webhooks/bitbucket/:workspaceId — the per-workspace path the
 * ingress already forwards. Bitbucket appends /rest/* and /browse/* to the
 * Application Link base URL, so that base URL must be
 * `<host>/api/webhooks/bitbucket/<workspaceId>`.
 *
 * Read-only and unauthenticated (Bitbucket is external, no client cert — same as
 * the webhook, which uses HMAC not mTLS). Lookups are workspace-scoped and expose
 * only project codes + ticket title/status. Restrict to Bitbucket egress IPs at
 * the ingress if that exposure matters.
 */
import { Router, Request, Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

// mergeParams so the :workspaceId from the mount path is visible in handlers.
const router = Router({ mergeParams: true });
const prisma = DatabaseClient.getInstance();

// Mount path; shared with app.ts (exported) and used to build self URLs below.
const MOUNT_BASE = '/api/webhooks/bitbucket';
export const JIRA_COMPAT_MOUNT = `${MOUNT_BASE}/:workspaceId`;

// Workspace id shape (Spaces cuid ~25 chars / UUID 36 chars).
const WORKSPACE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
// Issue key shape: PROJECT-1234.
const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*-\d+$/;

// Stable Application Link identity persisted by Bitbucket — must never change.
const APPLINK_ID = 'b6e9f4a0-5c3d-4d2e-9a1b-0c7e2f8d4a11';
// Impersonate a recent JIRA Server so Bitbucket enables full integration.
const JIRA_VERSION = '9.12.0';
const JIRA_VERSION_NUMBERS = [9, 12, 0];
const JIRA_BUILD_NUMBER = 912000;
const SERVER_TITLE = 'Xyne Spaces';

// Trusted backend origin from config — NEVER request headers (Host/X-Forwarded-*
// are attacker-controllable -> manifest/self-URL poisoning, applink hijack).
const HOST_BASE = (config.backendUrl || '').trim().replace(/\/$/, '');
const URL_RE = /^https?:\/\/[^\s]+$/;

const XML_ESCAPE: Record<string, string> = {
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
};
function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => XML_ESCAPE[c]);
}

/** Validated workspace id from the mount path; '' if malformed. */
function workspaceId(req: Request): string {
  const ws = (req.params as { workspaceId?: string }).workspaceId || '';
  return WORKSPACE_ID_RE.test(ws) ? ws : '';
}

/** Self/base URL Bitbucket uses: trusted config host + validated path workspace. */
function selfBase(req: Request): string {
  return `${HOST_BASE}${MOUNT_BASE}/${workspaceId(req)}`;
}

/**
 * Frontend origin for rendered ticket links — config only, never request-derived
 * (open-redirect vector). Falls back to the backend host; rejects malformed URLs.
 */
function frontendBase(): string {
  const base = (config.frontendUrl || '').trim().replace(/\/$/, '') || HOST_BASE;
  if (!URL_RE.test(base)) {
    logger.error('[Jira-Compat] invalid FRONTEND_URL/BACKEND_URL config:', base);
    return HOST_BASE;
  }
  return base;
}

/**
 * Application Links manifest. typeId `jira` is the trigger that makes Bitbucket
 * apply JIRA issue-key linkification to this link.
 */
router.get('/rest/applinks/1.0/manifest', (req: Request, res: Response) => {
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <id>${escapeXml(APPLINK_ID)}</id>
  <name>${escapeXml(SERVER_TITLE)}</name>
  <typeId>jira</typeId>
  <version>${escapeXml(JIRA_VERSION)}</version>
  <buildNumber>${JIRA_BUILD_NUMBER}</buildNumber>
  <url>${escapeXml(selfBase(req))}</url>
  <publicSignup>false</publicSignup>
</manifest>`
  );
});

/** Version/capability probe used during application-link setup. */
router.get('/rest/api/2/serverInfo', (req: Request, res: Response) => {
  res.json({
    baseUrl: selfBase(req),
    version: JIRA_VERSION,
    versionNumbers: JIRA_VERSION_NUMBERS,
    deploymentType: 'Server',
    buildNumber: JIRA_BUILD_NUMBER,
    serverTitle: SERVER_TITLE,
  });
});

/**
 * Project list. Bitbucket caches these keys to decide which `<KEY>-<N>` tokens
 * to linkify. We return every distinct Spaces project code.
 */
router.get('/rest/api/2/project', async (req: Request, res: Response) => {
  const ws = workspaceId(req);
  if (!ws) {
    res.status(400).json({ errorMessages: ['Invalid workspaceId'], errors: {} });
    return;
  }
  try {
    const projects = await prisma.project.findMany({
      where: { workspaceId: ws },
      select: { id: true, code: true, name: true },
      distinct: ['code'],
      orderBy: { code: 'asc' },
    });
    res.json(
      projects.map((p) => ({
        id: p.id,
        key: p.code,
        name: p.name,
        projectTypeKey: 'software',
      }))
    );
  } catch (error) {
    // 503 (not an empty list) so Bitbucket retries instead of caching "no projects".
    logger.error('[Jira-Compat] project list error:', error);
    res.status(503).json({ errorMessages: ['Service temporarily unavailable'], errors: {} });
  }
});

/**
 * Minimal issue payload for the given key (e.g. XYNE-16662). Enough for
 * Bitbucket's hover card and the development panel.
 */
router.get('/rest/api/2/issue/:key', async (req: Request, res: Response) => {
  const key = req.params.key;
  const ws = workspaceId(req);
  if (!ws || !ISSUE_KEY_RE.test(key)) {
    res.status(404).json({ errorMessages: ['Issue does not exist'], errors: {} });
    return;
  }
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { xyneId: key, workspaceId: ws },
      select: { id: true, xyneId: true, title: true, statusV2: true },
    });
    if (!ticket) {
      res.status(404).json({ errorMessages: ['Issue does not exist'], errors: {} });
      return;
    }
    res.json({
      id: ticket.id,
      key: ticket.xyneId,
      self: `${selfBase(req)}/rest/api/2/issue/${ticket.xyneId}`,
      fields: {
        summary: ticket.title,
        status: { name: ticket.statusV2 },
        issuetype: { name: 'Task', subtask: false },
      },
    });
  } catch (error) {
    logger.error(`[Jira-Compat] issue lookup error for ${key}:`, error);
    res.status(404).json({ errorMessages: ['Issue does not exist'], errors: {} });
  }
});

/** Build the Spaces frontend deep-link for a ticket. */
function ticketDeepLink(
  origin: string,
  t: {
    workspaceId: string;
    projectId: string | null;
    boardId: string | null;
    channelId: string | null;
    id: string;
    xyneId: string | null;
  }
): string {
  // Prefer the kanban board view (works for any ticket with a project + board).
  if (t.projectId && t.boardId) {
    return `${origin}/${t.workspaceId}/projects/${t.projectId}/${t.boardId}/${t.id}`;
  }
  // Desk/support tickets fall back to the support view keyed by xyneId.
  if (t.channelId && t.xyneId) {
    return `${origin}/${t.workspaceId}/support/${t.channelId}/${t.xyneId}`;
  }
  return `${origin}/${t.workspaceId}`;
}

/**
 * The destination the linkified key points at. Resolve the ticket and 302 to
 * its Spaces deep-link; this is what actually "routes to Spaces".
 */
router.get('/browse/:key', async (req: Request, res: Response) => {
  const key = req.params.key;
  const ws = workspaceId(req);
  const home = frontendBase();
  if (!ws || !ISSUE_KEY_RE.test(key)) {
    res.redirect(302, home);
    return;
  }
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { xyneId: key, workspaceId: ws },
      select: {
        id: true,
        xyneId: true,
        workspaceId: true,
        projectId: true,
        boardId: true,
        channelId: true,
      },
    });
    if (!ticket) {
      logger.warn(`[Jira-Compat] /browse/${key}: no ticket found`);
      res.redirect(302, home);
      return;
    }
    res.redirect(302, ticketDeepLink(home, ticket));
  } catch (error) {
    logger.error(`[Jira-Compat] /browse/${key} error:`, error);
    res.redirect(302, home);
  }
});

export default router;
