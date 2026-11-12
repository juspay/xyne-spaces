/**
 * /api/claw-agents/bot/* — the bot API for Claw agents acting as themselves
 * (posting messages, cards, files, DMs).
 *
 * The same handlers as the app API (/api/apps/*), mounted on a separate path:
 *   - only agent tokens (claw/tokens.ts authenticateClawAgent), never app
 *     tokens, and never on-behalf-of tokens;
 *   - only the endpoints in BOT_ENDPOINTS (everything else is 404);
 *   - each handler's own requirePermission check enforces the agent's scopes.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import chatRoutes from '@/apps/routes/chat';
import channelRoutes from '@/apps/routes/channel';
import fileRoutes from '@/apps/routes/files';
import ticketRoutes from '@/apps/routes/ticket';
import { uploadMultiple } from '@/middleware/upload';
import { authenticateClawAgent } from './tokens';

/**
 * Endpoints Claw agents may call, relative to /api/claw-agents/bot. `:param`
 * matches one path segment, except the names in RESERVED_SEGMENTS (other
 * routes on the same router, e.g. GET /ticket/boards).
 */
export const BOT_ENDPOINTS: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'POST', path: '/chat/postMessage' },
  { method: 'POST', path: '/chat/updateMessage' },
  { method: 'POST', path: '/chat/agentProgress' },
  { method: 'GET', path: '/chat/conversationReplies' },
  { method: 'POST', path: '/channel/openDm' },
  { method: 'POST', path: '/channel/info' },
  { method: 'GET', path: '/channel/list' },
  { method: 'POST', path: '/files/filesUpload' },
  { method: 'GET', path: '/files/download/:attachmentId' },
  { method: 'GET', path: '/ticket/:xyneId' },
];

const RESERVED_SEGMENTS = ['boards', 'listBySender', 'list', 'info', 'download'];
const PARAM = `(?!(?:${RESERVED_SEGMENTS.join('|')})(?:/|$))[^/]+`;

const compiled = BOT_ENDPOINTS.map((e) => ({
  method: e.method,
  re: new RegExp(`^${e.path.replace(/:[A-Za-z]+/g, PARAM)}/?$`),
}));

export function isBotEndpoint(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return compiled.some((e) => e.method === m && e.re.test(path));
}

function onlyBotEndpoints(req: Request, res: Response, next: NextFunction): void {
  if (!isBotEndpoint(req.method, req.path)) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  next();
}

const router = Router();
router.use(onlyBotEndpoints, authenticateClawAgent);
router.use('/chat', chatRoutes);
router.use('/channel', channelRoutes);
router.use('/files', uploadMultiple, fileRoutes);
router.use('/ticket', ticketRoutes);

export { router as clawBotRoutes };
