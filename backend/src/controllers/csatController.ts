import { Request, Response } from 'express';
import { recordCsatRating, getExistingCsatRating, CSAT_MAX_SCORE } from '@/services/csatFields';
import { db } from '@/database/client';
import { csatTokenService } from '@/services/csatTokenService';
import { logger } from '@/utils/logger';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CHECK_ICON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="12" fill="#16a34a"/><path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const INFO_ICON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="12" fill="#94a3b8"/><path d="M12 8v.01M12 11v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
const WARN_ICON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="12" fill="#dc2626"/><path d="M12 8v4.5M12 15.5v.01" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

const PAGE_HTML = (bodyHtml: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Share your feedback</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: linear-gradient(180deg, #f8fafc 0%, #eef1f6 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%; max-width: 440px; background: #ffffff; border-radius: 20px;
    border: 1px solid #eef1f6;
    box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 16px 40px -8px rgba(16,24,40,.12);
    overflow: hidden;
  }
  .card-accent { height: 4px; background: #6366f1; }
  .card-body { padding: 40px 36px; text-align: center; }
  .icon { display: inline-flex; align-items: center; justify-content: center; margin-bottom: 18px; }
  .title { margin: 0 0 8px 0; font-size: 20px; font-weight: 650; color: #101828; letter-spacing: -0.01em; line-height: 1.3; }
  .subtitle { margin: 0 0 28px 0; font-size: 14px; line-height: 21px; color: #667085; }
  form { text-align: left; margin-top: 4px; }
  fieldset.stars {
    display: flex; flex-direction: row-reverse; justify-content: center; gap: 2px;
    border: none; padding: 0; margin: 0 0 24px 0;
  }
  fieldset.stars input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  fieldset.stars label {
    display: inline-flex; align-items: center; justify-content: center;
    width: 48px; height: 48px; font-size: 32px; line-height: 1;
    color: #e4e7ec; cursor: pointer; border-radius: 10px;
    transition: color .12s ease, transform .12s ease;
  }
  fieldset.stars label:active { transform: scale(0.92); }
  fieldset.stars input:checked ~ label,
  fieldset.stars label:hover,
  fieldset.stars label:hover ~ label { color: #f5b400; }
  fieldset.stars input:focus-visible + label { outline: 2px solid #6366f1; outline-offset: 2px; }
  .field-label { display: block; margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #344054; }
  textarea {
    width: 100%; padding: 12px 14px; border: 1px solid #d0d5dd; border-radius: 10px;
    font-size: 14px; font-family: inherit; line-height: 20px; resize: vertical; color: #101828;
    transition: border-color .15s ease, box-shadow .15s ease; outline: none;
  }
  textarea::placeholder { color: #98a2b3; }
  textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.14); }
  button {
    margin-top: 16px; width: 100%; padding: 12px; background: #101828; color: #ffffff;
    border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer;
    transition: background .15s ease, transform .05s ease;
  }
  button:hover { background: #1d2939; }
  button:active { transform: scale(0.99); }
  button:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
  .footer { margin: 24px 0 0 0; font-size: 12px; color: #98a2b3; }
</style>
</head>
<body>
  <div class="card">
    <div class="card-accent"></div>
    <div class="card-body">${bodyHtml}</div>
  </div>
</body>
</html>`;

const CONFIRM_HTML = (message: string, kind: 'success' | 'info' | 'warn' = 'success'): string => {
  const icon = kind === 'success' ? CHECK_ICON : kind === 'warn' ? WARN_ICON : INFO_ICON;
  return PAGE_HTML(`
    <div class="icon">${icon}</div>
    <p class="title">${message}</p>
    <p class="footer">You can close this page now.</p>
  `);
};

/**
 * The actual data-collection form — shown after a Good/Bad email link click,
 * but nothing is recorded yet at this point (GET only ever renders this).
 * Submitting it is what records the rating.
 */
const RATING_FORM_HTML = (ticketId: string, token: string, presetScore: number): string => {
  const stars = Array.from({ length: CSAT_MAX_SCORE }, (_, i) => CSAT_MAX_SCORE - i)
    .map(
      n => `
      <input type="radio" id="star${n}" name="score" value="${n}" ${n === presetScore ? 'checked' : ''} />
      <label for="star${n}" title="${n} star${n === 1 ? '' : 's'}">★</label>`,
    )
    .join('');
  return PAGE_HTML(`
    <p class="title">How did we do?</p>
    <p class="subtitle">Your feedback helps our team improve.</p>
    <form method="POST" action="/api/csat/${escapeHtml(ticketId)}">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <span class="field-label">Rating</span>
      <fieldset class="stars">${stars}</fieldset>
      <label class="field-label" for="comment">Comment <span style="font-weight:400;color:#98a2b3;">(optional)</span></label>
      <textarea id="comment" name="comment" rows="3" placeholder="Tell us more about your experience..."></textarea>
      <button type="submit">Submit feedback</button>
    </form>
  `);
};

function parseSubmission(source: Record<string, unknown>): { comment?: string; score?: number } {
  const comment = typeof source.comment === 'string' ? source.comment : undefined;
  const scoreRaw = source.score;
  const score =
    typeof scoreRaw === 'number'
      ? scoreRaw
      : typeof scoreRaw === 'string' && scoreRaw.trim()
        ? Number(scoreRaw)
        : undefined;
  return { comment, score };
}

class CsatController {
  /**
   * GET /api/csat/:ticketId?rating=GOOD|BAD&token=
   * Public, no auth — but `token` must be a valid signature issued for this
   * exact ticketId (28-day expiry). Never records anything by itself (so an
   * email link-scanner prefetching this URL can't silently submit a rating) —
   * it only renders the star-rating + comment form, pre-selected from which
   * Good/Bad button was clicked in the email. Recording happens on submit.
   */
  async showForm(req: Request, res: Response): Promise<void> {
    try {
      const { ticketId } = req.params;
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token || !csatTokenService.verify(ticketId, token)) {
        res.status(403).send(CONFIRM_HTML('This link is invalid or has expired.', 'warn'));
        return;
      }

      const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { boardId: true } });
      if (!ticket) {
        res.status(404).send(CONFIRM_HTML('This ticket could not be found.', 'warn'));
        return;
      }
      const alreadyResponded = await getExistingCsatRating(ticketId, ticket.boardId);
      if (alreadyResponded) {
        res.status(200).send(CONFIRM_HTML("You've already submitted feedback for this ticket. Thanks again!", 'info'));
        return;
      }

      const ratingRaw = typeof req.query.rating === 'string' ? req.query.rating.trim().toUpperCase() : '';
      const presetScore = ratingRaw === 'BAD' ? 1 : CSAT_MAX_SCORE;

      res.status(200).send(RATING_FORM_HTML(ticketId, token, presetScore));
    } catch (err) {
      logger.error(`[csat] showForm failed | error=${err}`);
      res.status(500).send(CONFIRM_HTML('Something went wrong. Please try again later.', 'warn'));
    }
  }

  /**
   * POST /api/csat/:ticketId
   * Body: { token, score, comment? }. Requires the same signed token as the
   * email link. This is the only place a rating actually gets recorded —
   * derives GOOD/BAD from the submitted star score.
   */
  async record(req: Request, res: Response): Promise<void> {
    try {
      const { ticketId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = typeof body.token === 'string' ? body.token : '';
      if (!token || !csatTokenService.verify(ticketId, token)) {
        res.status(403).send(CONFIRM_HTML('This link is invalid or has expired.', 'warn'));
        return;
      }

      const { comment, score } = parseSubmission(body);
      if (score === undefined || !Number.isFinite(score) || score < 1 || score > CSAT_MAX_SCORE) {
        res.status(400).send(CONFIRM_HTML('Please pick a star rating.', 'warn'));
        return;
      }
      const rating: 'GOOD' | 'BAD' = score >= 3 ? 'GOOD' : 'BAD';

      const result = await recordCsatRating(ticketId, rating, comment, score);
      if (result.success) {
        res.status(200).send(CONFIRM_HTML('Thanks for your feedback!'));
        return;
      }
      if (result.alreadyResponded) {
        res.status(200).send(CONFIRM_HTML("You've already submitted feedback for this ticket.", 'info'));
        return;
      }
      res.status(404).send(CONFIRM_HTML('This ticket could not be found.', 'warn'));
    } catch (err) {
      logger.error(`[csat] record failed | error=${err}`);
      res.status(500).send(CONFIRM_HTML('Something went wrong. Please try again later.', 'warn'));
    }
  }

  async recordExternal(req: Request, res: Response): Promise<void> {
    try {
      const { ticketId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const ratingRaw = typeof body.rating === 'string' ? body.rating.trim().toUpperCase() : '';
      if (ratingRaw !== 'GOOD' && ratingRaw !== 'BAD') {
        res.status(400).json({ error: 'rating must be GOOD or BAD' });
        return;
      }
      const rating: 'GOOD' | 'BAD' = ratingRaw;
      const { comment, score } = parseSubmission(body);
      if (score !== undefined && (!Number.isFinite(score) || score < 1 || score > CSAT_MAX_SCORE)) {
        res.status(400).json({ error: `score must be between 1 and ${CSAT_MAX_SCORE}` });
        return;
      }

      const result = await recordCsatRating(ticketId, rating, comment, score, true);
      if (!result.success && result.notFound) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }
      if (!result.success && !result.alreadyResponded) {
        res.status(500).json({ error: 'Failed to record rating' });
        return;
      }

      res.status(200).json({ success: true });
    } catch (err) {
      logger.error(`[csat] recordExternal failed | error=${err}`);
      res.status(500).json({ error: 'Internal error' });
    }
  }
}

export const csatController = new CsatController();
