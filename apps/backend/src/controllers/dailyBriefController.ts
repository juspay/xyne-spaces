import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  getDailyBriefConfig,
  saveDailyBriefConfig,
  getDailyBriefSettings,
  saveDailyBriefSettings,
  getLatestDailyBrief,
  getDailyBriefHistory,
  getDailyBriefDates,
  getDailyBriefByDate,
  postDailyBriefSwitched,
  regenerateDailyBriefStream,
} from '../services/clawAgentService';

/** Unwrap claw-auth's { success, data } envelope for the dashboard. */
function unwrap(result: unknown): unknown {
  if (result && typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
    return (result as { data: unknown }).data;
  }
  return result;
}

/** GET /api/daily-brief/config — enable flag + custom instructions. */
export async function getConfig(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await getDailyBriefConfig(req, userId);
    return res.json(unwrap(result));
  } catch (error) {
    logger.error('[DailyBrief] Error fetching config:', error);
    return res.status(500).json({ error: 'Failed to load daily brief config' });
  }
}

/** PUT /api/daily-brief/config — { enabled?, instructions?, instructionsEnabled? }. */
export async function saveConfig(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { enabled, instructions, instructionsEnabled } = req.body ?? {};
    const result = await saveDailyBriefConfig(req, userId, {
      enabled,
      instructions,
      instructionsEnabled,
    });
    return res.json(unwrap(result));
  } catch (error) {
    logger.error('[DailyBrief] Error saving config:', error);
    return res.status(500).json({ error: 'Failed to save daily brief config' });
  }
}

/** GET /api/daily-brief/settings — which agent runs the brief + pickable agents. */
export async function getSettings(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await getDailyBriefSettings(req, userId);
    return res.json(unwrap(result));
  } catch (error) {
    logger.error('[DailyBrief] Error fetching settings:', error);
    return res.status(500).json({ error: 'Failed to load daily brief settings' });
  }
}

/** PUT /api/daily-brief/settings — set the org's brief agent ({ agentSlug }). Admin-only. */
export async function saveSettings(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { agentSlug } = req.body ?? {};
    const { status, json } = await saveDailyBriefSettings(req, userId, { agentSlug });
    // Pass through the claw-auth status (403 not-admin / 400 bad agent / 200 ok).
    const payload = json && typeof json === 'object' && 'data' in (json as Record<string, unknown>)
      ? (json as { data: unknown }).data
      : json;
    return res.status(status).json(payload);
  } catch (error) {
    logger.error('[DailyBrief] Error saving settings:', error);
    return res.status(500).json({ error: 'Failed to save daily brief settings' });
  }
}

/** GET /api/daily-brief/latest — today's stored brief (or the most recent one). */
export async function getLatest(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await getLatestDailyBrief(req, userId);
    return res.json(unwrap(result));
  } catch (error) {
    logger.error('[DailyBrief] Error fetching latest brief:', error);
    return res.status(500).json({ error: 'Failed to load daily brief' });
  }
}

/** GET /api/daily-brief/history — the user's recent briefs (newest first). */
export async function getHistory(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
    const result = await getDailyBriefHistory(req, userId, limit);
    return res.json(unwrap(result));
  } catch (error) {
    logger.error('[DailyBrief] Error fetching history:', error);
    return res.status(500).json({ error: 'Failed to load daily brief history' });
  }
}

/** GET /api/daily-brief/dates — days the user has briefs for (date + status only). */
export async function getDates(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
    const result = await getDailyBriefDates(req, userId, limit);
    return res.json(unwrap(result));
  } catch (error) {
    logger.error('[DailyBrief] Error fetching dates:', error);
    return res.status(500).json({ error: 'Failed to load daily brief dates' });
  }
}

/** GET /api/daily-brief/by-date/:date — the stored brief for one YYYY-MM-DD bucket. */
export async function getByDate(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { status, json } = await getDailyBriefByDate(req, userId, String(req.params.date ?? ''));
    return res.status(status).json(unwrap(json));
  } catch (error) {
    logger.error('[DailyBrief] Error fetching brief by date:', error);
    return res.status(500).json({ error: 'Failed to load daily brief' });
  }
}

/** POST /api/daily-brief/switched — beacon: the user switched to another brief. */
export async function postSwitched(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const source = typeof req.body?.source === 'string' ? req.body.source : 'history_menu';
    const status = await postDailyBriefSwitched(req, userId, source);
    return res.status(status === 204 ? 204 : 500).end();
  } catch (error) {
    logger.error('[DailyBrief] Error recording brief switch:', error);
    return res.status(500).end();
  }
}

/** POST /api/daily-brief/regenerate — SSE: re-run + overwrite today's brief. */
export async function regenerate(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const abort = new AbortController();
  req.on('close', () => abort.abort());
  try {
    await regenerateDailyBriefStream(req, res, userId, { signal: abort.signal });
  } catch (error) {
    logger.error('[DailyBrief] Error regenerating brief:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to regenerate daily brief' });
    } else if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Failed to regenerate daily brief' })}\n\n`);
      res.end();
    }
  }
}
