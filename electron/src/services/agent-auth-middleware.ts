import { IncomingMessage, ServerResponse } from 'http';
import { agentAuthService } from '../services/agent-auth';
import log from 'electron-log/main';

/**
 * Middleware to protect HTTP endpoints with agent authorization
 * 
 * Usage in your HTTP server:
 * ```typescript
 * if (requiresAuth && !await agentAuthMiddleware(req, res)) {
 *   return; // Response already sent by middleware
 * }
 * ```
 */
export async function agentAuthMiddleware(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    log.warn('[AgentAuth] Missing authorization header');
    sendJsonResponse(res, 401, {
      error: 'Unauthorized',
      message: 'Missing or invalid authorization header'
    });
    return false;
  }

  const token = authHeader.substring(7);

  if (!agentAuthService.validateToken(token)) {
    log.warn('[AgentAuth] Invalid or expired token');
    sendJsonResponse(res, 403, {
      error: 'Forbidden',
      message: 'Invalid or expired token'
    });
    return false;
  }

  return true;
}

/**
 * Helper to send JSON responses
 */
function sendJsonResponse(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Example protected endpoint handler
 * 
 * This shows how to use the middleware in your own HTTP server
 */
export async function handleProtectedRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Validate authorization
  if (!await agentAuthMiddleware(req, res)) {
    return; // Response already sent
  }

  // Handle the authorized request
  sendJsonResponse(res, 200, {
    message: 'Access granted',
    data: 'Your protected data here'
  });
}
