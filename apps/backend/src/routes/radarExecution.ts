import { Router, type Request, type Response } from 'express';
import { MAX_RULES, MAX_RULE_VALUES, MAX_RULE_VALUE_LENGTH } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { RadarActionError, radarManualActions } from '@/services/radar/radarManualActions';
import { radarFeedService, type PendingOthersPageQuery } from '@/services/radar/radarFeedService';
import { radarRuleStore } from '@/services/radar/radarRuleStore';

const router = Router();

function getAuthContext(
  req: Request
): { userId: string; workspaceId: string; role: string } | null {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  const role = req.user?.role;
  // Guests are limited to explicit grants, so a request with no role resolved
  // is refused rather than evaluated under the member rule.
  if (!userId || !workspaceId || !role) return null;
  return { userId, workspaceId, role };
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

function handleActionError(res: Response, err: RadarActionError): void {
  const status = err.code === 'not-found' ? 404 : err.code === 'forbidden' ? 403 : 400;
  res.status(status).json({ success: false, error: err.message });
}

router.post('/items/:itemId/resolve', async (req: Request<{ itemId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const result = await radarManualActions.resolveItem(auth, req.params.itemId);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof RadarActionError) {
      handleActionError(res, err);
      return;
    }
    logger.error('[radar-execution] resolve failed:', err);
    res.status(500).json({ success: false, error: 'Failed to resolve execution item' });
  }
});

router.post('/items/:itemId/dismiss', async (req: Request<{ itemId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const result = await radarManualActions.dismissItem(auth, req.params.itemId);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof RadarActionError) {
      handleActionError(res, err);
      return;
    }
    logger.error('[radar-execution] dismiss failed:', err);
    res.status(500).json({ success: false, error: 'Failed to dismiss execution item' });
  }
});

// The param is a SCOPE key, not always a conversation id: a DM card covers its
// whole channel, so "all" has to mean everything that card shows.
router.post(
  '/threads/:scopeKey/dismiss-all',
  async (req: Request<{ scopeKey: string }>, res: Response) => {
    try {
      const auth = getAuthContext(req);
      if (!auth) {
        sendUnauthorized(res);
        return;
      }
      const result = await radarManualActions.dismissAllInScope(auth, req.params.scopeKey);
      res.json({ success: true, data: result });
    } catch (err) {
      if (err instanceof RadarActionError) {
        handleActionError(res, err);
        return;
      }
      logger.error('[radar-execution] dismiss-all failed:', err);
      res.status(500).json({ success: false, error: 'Failed to dismiss thread items' });
    }
  }
);

// The param is a SCOPE key, not always a conversation id: a DM card covers its
// whole channel, so "all" has to mean everything that card shows.
router.post(
  '/threads/:scopeKey/resolve-all',
  async (req: Request<{ scopeKey: string }>, res: Response) => {
    try {
      const auth = getAuthContext(req);
      if (!auth) {
        sendUnauthorized(res);
        return;
      }
      const result = await radarManualActions.resolveAllInScope(auth, req.params.scopeKey);
      res.json({ success: true, data: result });
    } catch (err) {
      if (err instanceof RadarActionError) {
        handleActionError(res, err);
        return;
      }
      logger.error('[radar-execution] resolve-all failed:', err);
      res.status(500).json({ success: false, error: 'Failed to resolve thread items' });
    }
  }
);

router.get('/feed/pending-me', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const threads = await radarFeedService.pendingMe(auth);
    res.json({ success: true, data: { threads } });
  } catch (err) {
    logger.error('[radar-execution] pending-me feed failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load feed' });
  }
});

router.get('/debug/items/:itemId', async (req: Request<{ itemId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const trail = await radarFeedService.debugItemTrail(auth, req.params.itemId);
    if (!trail) {
      res.status(404).json({ success: false, error: 'Execution item not found' });
      return;
    }
    res.json({ success: true, data: trail });
  } catch (err) {
    logger.error('[radar-execution] debug item trail failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load item trail' });
  }
});

router.get('/debug/runs', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const conversationId =
      typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
    if (!conversationId) {
      // Debug is per-thread by design — there is no workspace-wide listing.
      res.status(400).json({ success: false, error: 'conversationId is required' });
      return;
    }
    const result = await radarFeedService.debugRuns(auth, conversationId);
    if (!result) {
      res.status(404).json({ success: false, error: 'Thread not found' });
      return;
    }
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('[radar-execution] debug runs failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load debug runs' });
  }
});

router.get('/feed/waiting-on', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const threads = await radarFeedService.waitingOn(auth);
    res.json({ success: true, data: { threads } });
  } catch (err) {
    logger.error('[radar-execution] waiting-on feed failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load feed' });
  }
});

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 5;

const intParam = (value: unknown, fallback: number): number => {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const listParam = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
const dateParam = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Query string -> a Pending Others page request. Anything malformed falls back
 *  to "no narrowing" rather than failing the feed. */
const parsePageQuery = (query: Request['query']): PendingOthersPageQuery => ({
  page: intParam(query.page, 0),
  mutedPage: intParam(query.mutedPage, 0),
  pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, intParam(query.pageSize, DEFAULT_PAGE_SIZE))),
  holderIds: listParam(query.holders),
  channelIds: listParam(query.channels),
  createdFrom: dateParam(query.createdFrom),
  createdTo: dateParam(query.createdTo),
});

router.get('/feed/pending-others', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    // Paged when the caller asks for a page; the whole feed otherwise, as before.
    if (typeof req.query.page === 'string') {
      const data = await radarFeedService.pendingOthersPage(auth, parsePageQuery(req.query));
      res.json({ success: true, data });
      return;
    }
    const threads = await radarFeedService.pendingOthers(auth);
    res.json({ success: true, data: { threads } });
  } catch (err) {
    logger.error('[radar-execution] pending-others feed failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load feed' });
  }
});

// ── Rules ───────────────────────────────────────────────────────────────────
// A reader's own rules. Always scoped to the caller — there is no route here
// that reads or writes somebody else's.

const RULE_SCOPES = new Set(['channel', 'keyword', 'mention', 'sender']);

interface CleanCondition {
  scope: string;
  values: string[];
}

/** Either the rebuilt conditions or the reason there are none, so the caller
 *  can say which refusal this was rather than always "needs a condition". */
type CleanResult = { conditions: CleanCondition[] } | { error: string };

/** Client input is untrusted and this JSON decides what a reader sees, so the
 *  shape is rebuilt rather than checked and passed along. */
function cleanConditions(raw: unknown): CleanResult {
  if (!Array.isArray(raw)) return { error: 'A rule needs at least one condition' };
  const byScope = new Map<string, string[]>();
  // Both bounds are refusals, never trims. A rule stored with one of its values
  // quietly missing matches something other than what was asked for, and the
  // caller is told neither that it happened nor which part went.
  let tooLong = false;
  let tooMany = false;
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as { scope?: unknown; values?: unknown };
    if (typeof c.scope !== 'string' || !RULE_SCOPES.has(c.scope)) continue;
    if (!Array.isArray(c.values)) continue;
    const trimmed = c.values
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v !== '');
    if (trimmed.some((v) => v.length > MAX_RULE_VALUE_LENGTH)) tooLong = true;
    // Counted after de-duplication: a repeated value is the caller being
    // redundant, not the caller exceeding a limit.
    const values = [...new Set(trimmed.filter((v) => v.length <= MAX_RULE_VALUE_LENGTH))];
    if (values.length > MAX_RULE_VALUES) tooMany = true;
    if (values.length === 0) continue;
    // One condition per scope, so the stored shape can only ever mean what the
    // evaluator reads it as.
    const existing = byScope.get(c.scope);
    if (existing) {
      for (const v of values) if (!existing.includes(v)) existing.push(v);
      // Two entries for one scope can cross the cap even when neither did.
      if (existing.length > MAX_RULE_VALUES) tooMany = true;
    } else {
      byScope.set(c.scope, values);
    }
  }
  if (tooLong) {
    return { error: `A rule value cannot be longer than ${MAX_RULE_VALUE_LENGTH} characters` };
  }
  if (tooMany) {
    return { error: `A condition holds at most ${MAX_RULE_VALUES} values` };
  }
  const conditions = [...byScope.entries()].map(([scope, values]) => ({ scope, values }));
  if (conditions.length > 0) return { conditions };
  return { error: 'A rule needs at least one condition' };
}

router.get('/rules', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const rules = await radarRuleStore.list(auth);
    res.json({ success: true, data: { rules } });
  } catch (err) {
    logger.error('[RADAR-RULES] list failed', { error: err });
    res.status(500).json({ success: false, error: 'Failed to load rules' });
  }
});

router.post('/rules', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const cleaned = cleanConditions(req.body?.conditions);
    if ('error' in cleaned) {
      res.status(400).json({ success: false, error: cleaned.error });
      return;
    }
    // Counted and written together, so two tabs cannot both pass a check that
    // was true when each of them read it.
    const rule = await radarRuleStore.createWithinLimit(auth, cleaned.conditions, MAX_RULES);
    if (!rule) {
      res.status(409).json({ success: false, error: `At most ${MAX_RULES} rules` });
      return;
    }
    res.status(201).json({ success: true, data: { rule } });
  } catch (err) {
    logger.error('[RADAR-RULES] create failed', { error: err });
    res.status(500).json({ success: false, error: 'Failed to save rule' });
  }
});

router.patch('/rules/:ruleId', async (req: Request<{ ruleId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const cleaned = cleanConditions(req.body?.conditions);
    if ('error' in cleaned) {
      res.status(400).json({ success: false, error: cleaned.error });
      return;
    }
    const rule = await radarRuleStore.update(auth, req.params.ruleId, cleaned.conditions);
    if (!rule) {
      res.status(404).json({ success: false, error: 'Rule not found' });
      return;
    }
    res.json({ success: true, data: { rule } });
  } catch (err) {
    logger.error('[RADAR-RULES] update failed', { error: err });
    res.status(500).json({ success: false, error: 'Failed to update rule' });
  }
});

router.delete('/rules/:ruleId', async (req: Request<{ ruleId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const removed = await radarRuleStore.remove(auth, req.params.ruleId);
    if (!removed) {
      res.status(404).json({ success: false, error: 'Rule not found' });
      return;
    }
    res.json({ success: true, data: { id: req.params.ruleId } });
  } catch (err) {
    logger.error('[RADAR-RULES] delete failed', { error: err });
    res.status(500).json({ success: false, error: 'Failed to delete rule' });
  }
});

export default router;
