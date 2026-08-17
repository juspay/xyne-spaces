import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { dialog, BrowserWindow, session, net, app } from 'electron';
import log from 'electron-log/main';
import { config } from '../app/config';
import { Logger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_PORT = 49231;

interface AuthRequest {
  agentName: string;
  agentType?: string;
  description: string;
}

interface AuthSession {
  token: string;
  agentName: string;
  description: string;
  expiresAt: number;
  createdAt: number;
}

interface AuthResponse {
  status: 'approved' | 'denied' | 'pairing_required';
  accessToken?: string;
  expiresAt?: number;
  reason?: string;
  pairingCode?: string;
}

type DurationOption = '5min' | '1hour' | 'session';

class AgentAuthService {
  private server: ReturnType<typeof createServer> | null = null;
  private port: number = DEFAULT_PORT;
  private sessions: Map<string, AuthSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private consentDialogOpen = false;

  private getMcpBackendBaseUrl(): string {
    return config.BACKEND_URL.replace(/\/+$/, '');
  }

  /**
   * Start the agent authorization HTTP server
   */
  async startServer(port: number = DEFAULT_PORT): Promise<number> {
    if (this.server) {
      log.warn('[AgentAuth] Server already running');
      return this.port;
    }

    this.port = port;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          log.error(`[AgentAuth] Port ${this.port} is already in use`);
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          log.error('[AgentAuth] Server error:', error);
          reject(error);
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        log.info(`[AgentAuth] Server listening on http://127.0.0.1:${this.port}`);
        this.startCleanupInterval();
        resolve(this.port);
      });
    });
  }

  /**
   * Stop the server and cleanup
   */
  async stopServer(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        log.info('[AgentAuth] Server stopped');
        this.server = null;
        this.sessions.clear();
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Set CORS headers for localhost only
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Every legitimate caller connects to the loopback server directly, so Host must be
    // 127.0.0.1:<port> / localhost:<port>. A request arriving with any other Host is
    // rejected here before routing.
    const hostHeader = req.headers.host;
    const allowedHosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`]);
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      log.warn(`[AgentAuth] Rejected request with unexpected Host header: ${hostHeader ?? '(none)'}`);
      this.sendJson(res, 403, { error: 'Forbidden', message: 'Invalid Host' });
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    try {
      if (req.method === 'POST' && url.pathname === '/auth/request') {
        // Real local agents are non-browser clients and send no Origin / Sec-Fetch-Site
        // header; reject cross-site browser requests to the consent dialog.
        if (this.isCrossSiteBrowserRequest(req)) {
          log.warn('[AgentAuth] Rejected cross-site /auth/request (browser consent-dialog spam)');
          this.sendJson(res, 403, { error: 'Forbidden', message: 'Cross-site request rejected' });
          return;
        }
        await this.handleAuthRequest(req, res);
      } else if (req.method === 'POST' && url.pathname === '/auth/release') {
        await this.handleAuthRelease(req, res);
      } else if (req.method === 'POST' && url.pathname === '/interact') {
        await this.handleInteract(req, res);
      } else if (req.method === 'GET' && url.pathname === '/search') {
        await this.handleSearch(req, res, url);
      } else if (req.method === 'POST' && url.pathname === '/api/search') {
        await this.handleMcpSearch(req, res, url);
      } else if (req.method === 'POST' && url.pathname === '/api/ingest/turn') {
        await this.handleMcpIngestTurn(req, res, url);
      } else if (req.method === 'POST' && url.pathname === '/api/conversation-ingest/upload') {
        await this.handleMcpConversationIngestUpload(req, res);
      } else if (req.method === 'POST' && url.pathname === '/memory/search') {
        await this.handleMemorySearch(req, res);
      } else if (req.method === 'POST' && url.pathname === '/memory/upload') {
        await this.handleMemoryUpload(req, res);
      } else if (req.method === 'GET' && url.pathname === '/memory/sessionHistory') {
        await this.handleSessionHistory(req, res, url);
      } else if (req.method === 'PATCH' && url.pathname.startsWith('/memory/')) {
        await this.handleMemoryUpdate(req, res, url);
      } else if (req.method === 'POST' && url.pathname === '/memory/replaceSession') {
        await this.handleMemoryReplaceSession(req, res);
      } else if (req.method === 'POST' && url.pathname.startsWith('/chat/postMessage/')) {
        const conversationId = url.pathname.split('/chat/postMessage/')[1];
        await this.handleProxyPost(req, res, `/api/conversations/${conversationId}/messages`);
      } else if (
        req.method === 'POST' &&
        url.pathname.startsWith('/channels/') &&
        url.pathname.endsWith('/conversations')
      ) {
        const channelId = url.pathname.slice('/channels/'.length, -'/conversations'.length);
        if (!channelId || channelId.includes('/')) {
          this.sendJson(res, 400, { error: 'Invalid channelId' });
        } else {
          await this.handleProxyPost(
            req,
            res,
            `/api/channels/${encodeURIComponent(channelId)}/conversations`,
          );
        }
      } else if (req.method === 'GET' && url.pathname === '/auth/me') {
        // Identity for local agents. The Prisma AST behind /interact has no way to
        // reference "the caller", so this is the only route by which an agent can
        // learn its own user id — without it, every "assigned to me" query is a guess.
        await this.handleProxy(req, res, 'GET', '/api/v2/auth/me');
      } else if (req.method === 'PATCH' && url.pathname.startsWith('/ticket/')) {
        const ticketId = url.pathname.slice('/ticket/'.length);
        if (!ticketId || ticketId.includes('/')) {
          this.sendJson(res, 400, { error: 'Invalid ticketId' });
        } else {
          await this.handleProxy(req, res, 'PATCH', `/api/tickets/${encodeURIComponent(ticketId)}`);
        }
      } else if (
        req.method === 'POST' &&
        url.pathname.startsWith('/message/') &&
        url.pathname.endsWith('/reactions')
      ) {
        const messageId = url.pathname.slice('/message/'.length, -'/reactions'.length);
        if (!messageId || messageId.includes('/')) {
          this.sendJson(res, 400, { error: 'Invalid messageId' });
        } else {
          await this.handleProxy(
            req,
            res,
            'POST',
            `/api/messages/${encodeURIComponent(messageId)}/reactions`,
          );
        }
      } else if (
        req.method === 'DELETE' &&
        url.pathname.startsWith('/message/') &&
        url.pathname.includes('/reactions/')
      ) {
        const [messageId, emojiName] = url.pathname.slice('/message/'.length).split('/reactions/');
        if (!messageId || !emojiName || messageId.includes('/')) {
          this.sendJson(res, 400, { error: 'Invalid messageId or emojiName' });
        } else {
          await this.handleProxy(
            req,
            res,
            'DELETE',
            `/api/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emojiName)}`,
          );
        }
      } else if (req.method === 'POST' && url.pathname === '/ticket/create') {
        await this.handleProxyPost(req, res, '/api/tickets');
      } else if (req.method === 'POST' && url.pathname === '/calls/schedule') {
        await this.handleProxyPost(req, res, '/api/calls/schedule');
      } else if (req.method === 'GET' && url.pathname.startsWith('/message/') && url.pathname.endsWith('/attachments/info')) {
        const id = url.pathname.split('/message/')[1]?.split('/attachments/info')[0];
        if (id) {
          await this.handleMessageAttachmentsInfo(req, res, id, url);
        } else {
          this.sendJson(res, 400, { error: 'Invalid messageId or conversationId' });
        }
      } else if (req.method === 'GET' && url.pathname.startsWith('/message/') && url.pathname.endsWith('/attachments')) {
        const id = url.pathname.split('/message/')[1]?.split('/attachments')[0];
        if (id) {
          await this.handleMessageAttachments(req, res, id, url);
        } else {
          this.sendJson(res, 400, { error: 'Invalid messageId or conversationId' });
        }
      } else if (req.method === 'GET' && url.pathname === '/health') {
        this.sendJson(res, 200, { status: 'ok' });
      } else {
        this.sendJson(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      log.error('[AgentAuth] Request error:', error);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  /**
   * Handle authorization request
   *
   * ACCEPTED RISK (secops #367, MED): this loopback endpoint (127.0.0.1:49231) has no
   * requesting-process binding and no out-of-band pairing, so ANY local process can POST an auth
   * request and spawn a native consent dialog with attacker-controlled agentName/description text
   * (and, on user approval, proxy authenticated backend calls). The declared pairing-code flow was
   * never implemented; the team accepted this under a local-only (already-compromised-host) threat
   * model. Implement the pairing-code echo before relying on this endpoint for anything sensitive.
   */
  private async handleAuthRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.parseBody(req);
    
    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }

    const authRequest = body as AuthRequest;

    // Validate required fields
    if (!authRequest.agentName || !authRequest.description) {
      this.sendJson(res, 400, { 
        error: 'Missing required fields: agentName, description' 
      });
      return;
    }

    if (this.consentDialogOpen) {
      this.sendJson(res, 429, { error: 'A consent request is already pending' });
      return;
    }
    this.consentDialogOpen = true;
    try {
      Logger.info(ElectronEvent.AGENT_AUTH_REQUEST, { agentName: authRequest.agentName, agentType: authRequest.agentType }, 'AgentAuth');

      // Show consent dialog to user
      const approval = await this.showConsentDialog(authRequest);

      if (!approval.approved) {
        const response: AuthResponse = {
          status: 'denied',
          reason: 'User rejected the request'
        };
        Logger.info(ElectronEvent.AGENT_AUTH_DENIED, { agentName: authRequest.agentName }, 'AgentAuth');
        this.sendJson(res, 403, response);
        return;
      }

      // Generate access token
      const token = this.generateToken();
      const expiresAt = this.calculateExpiration(approval.duration);

      const session: AuthSession = {
        token,
        agentName: authRequest.agentName,
        description: authRequest.description,
        expiresAt,
        createdAt: Date.now()
      };

      this.sessions.set(token, session);

      const response: AuthResponse = {
        status: 'approved',
        accessToken: token,
        expiresAt
      };

      Logger.info(ElectronEvent.AGENT_AUTH_GRANTED, { agentName: authRequest.agentName, expiresAt, duration: approval.duration }, 'AgentAuth');
      this.sendJson(res, 200, response);
    } finally {
      this.consentDialogOpen = false;
    }
  }

  /**
   * Handle token release
   */
  private async handleAuthRelease(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = this.extractToken(req);

    if (!token) {
      this.sendJson(res, 401, { error: 'Missing authorization token' });
      return;
    }

    const session = this.sessions.get(token);
    if (session) {
      this.sessions.delete(token);
      log.info(`[AgentAuth] Session released for ${session.agentName}`);
      this.sendJson(res, 200, { status: 'released' });
    } else {
      this.sendJson(res, 404, { error: 'Session not found' });
    }
  }

  /**
   * Handle /interact endpoint - proxy requests to backend with user's access token
   */
  private async handleInteract(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Validate agent authorization token
    const agentToken = this.extractToken(req);
    if (!agentToken || !this.validateToken(agentToken)) {
      this.sendJson(res, 401, { 
        error: 'Unauthorized',
        message: 'Invalid or missing agent authorization token' 
      });
      return;
    }

    // Use hardcoded endpoint and method from config
    const endpoint = config.agentInteract.endpoint;
    const method = config.agentInteract.method.toUpperCase();

    // Parse request body (contains only the data to send to backend)
    let data: any = null;
    try {
      data = await this.parseBody(req);
    } catch (error) {
      this.sendJson(res, 400, { 
        error: 'Bad Request',
        message: 'Invalid JSON in request body' 
      });
      return;
    }

    try {
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, { 
          error: 'Unauthorized',
          message: 'No user access token found in session' 
        });
        return;
      }

      // Construct full backend URL
      const backendUrl = `${config.BACKEND_URL}${endpoint}`;
      log.info(`[AgentAuth] Proxying ${method} request to ${backendUrl}`);

      // Make request to backend with user's access token
      const backendResponse = await this.sendWithRefresh(accessToken, (token) =>
        this.makeBackendRequest({
          url: backendUrl,
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          data
        }),
      );
      if (!backendResponse) {
        this.reauthRequired(res);
        return;
      }

      // Forward backend response to agent
      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));

    } catch (error: any) {
      log.error('[AgentAuth] Backend request failed:', error);
      this.sendJson(res, 500, { 
        error: 'Backend Request Failed',
        message: error.message 
      });
    }
  }

  /**
   * Handle /search endpoint - proxy search requests to backend with user's access token
   * Supports query parameters: q, app, filterOnly, and any additional Vespa parameters
   * Payload structure:
    * {
    *   query?: string;
    *   scope: MemoryScope; // e.g., 'my' | 'all'
    *   limit: number;
    *   offset: number;
    *   includeQuery?: boolean;
    *   includeSummary?: boolean;
    *   docType?: VespaDocType; // e.g., 'fact' | 'sop'
    *   tags?: string[];
    *   repoUrl?: string;
    *   commitId?: string;
    *   sessionId?: string;
    *   filePointers?: string;
    *   ticketId?: string;
    *   parentRef?: string;
    *   reviewStatus?: string; // e.g., 'pending' | 'verified' | 'rejected'
    *   docId?: string;
    * }
   */
  private async handleSearch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    // Validate agent authorization token
    const agentToken = this.extractToken(req);
    if (!agentToken || !this.validateToken(agentToken)) {
      this.sendJson(res, 401, { 
        error: 'Unauthorized',
        message: 'Invalid or missing agent authorization token' 
      });
      return;
    }

    try {
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, { 
          error: 'Unauthorized',
          message: 'No user access token found in session' 
        });
        return;
      }

      // Build backend URL with all query parameters
      const searchParams = new URLSearchParams(url.searchParams);
      const backendUrl = `${config.BACKEND_URL}/api/vespaSearch?${searchParams.toString()}`;
      log.info(`[AgentAuth] Proxying GET vespaSearch request to ${backendUrl}`);

      // Make request to backend with user's access token
      const backendResponse = await this.sendWithRefresh(accessToken, (token) =>
        this.makeBackendRequest({
          url: backendUrl,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }),
      );
      if (!backendResponse) {
        this.reauthRequired(res);
        return;
      }

      // Forward backend response to agent
      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));

    } catch (error: any) {
      log.error('[AgentAuth] Backend search request failed:', error);
      this.sendJson(res, 500, { 
        error: 'Backend Request Failed',
        message: error.message 
      });
    }
  }

  /**
   * MCP compatibility route: POST /api/search
   * Proxies JSON payloads to backend /test/api/search using the logged-in Electron session token.
   */
  private async handleMcpSearch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const agentToken = this.extractToken(req);
    if (!agentToken || !this.validateToken(agentToken)) {
      this.sendJson(res, 401, {
        error: 'Unauthorized',
        message: 'Invalid or missing agent authorization token',
      });
      return;
    }

    let body: any;
    try {
      body = await this.parseBody(req);
    } catch {
      this.sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Invalid JSON in request body',
      });
      return;
    }

    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Request body must be a JSON object',
      });
      return;
    }

    try {
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, {
          error: 'Unauthorized',
          message: 'No user access token found in session',
        });
        return;
      }

      const searchParams = new URLSearchParams(url.searchParams);
      const qs = searchParams.toString();
      const backendUrl = `${this.getMcpBackendBaseUrl()}/test/api/search${qs ? `?${qs}` : ''}`;
      log.info(`[AgentAuth] Proxying MCP POST /api/search request to ${backendUrl}`);

      const bodyBuffer = Buffer.from(JSON.stringify(body));

      const backendResponse = await this.makeBackendRequestRaw({
        url: backendUrl,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        bodyBuffer,
      });

      this.forwardRawBackendResponse(res, backendResponse);
    } catch (error: any) {
      log.error('[AgentAuth] MCP search proxy request failed:', error);
      this.sendJson(res, 500, {
        error: 'Backend Request Failed',
        message: error.message,
      });
    }
  }

  /**
   * MCP compatibility route: POST /api/ingest/turn
   * Proxies JSON payloads to backend /test/api/ingest/turn using the logged-in Electron session token.
   */
  private async handleMcpIngestTurn(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const agentToken = this.extractToken(req);
    if (!agentToken || !this.validateToken(agentToken)) {
      this.sendJson(res, 401, {
        error: 'Unauthorized',
        message: 'Invalid or missing agent authorization token',
      });
      return;
    }

    let body: any;
    try {
      body = await this.parseBody(req);
    } catch {
      this.sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Invalid JSON in request body',
      });
      return;
    }

    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Request body must be a JSON object or array',
      });
      return;
    }

    try {
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, {
          error: 'Unauthorized',
          message: 'No user access token found in session',
        });
        return;
      }

      const searchParams = new URLSearchParams(url.searchParams);
      const qs = searchParams.toString();
      const backendUrl = `${this.getMcpBackendBaseUrl()}/test/api/ingest/turn${qs ? `?${qs}` : ''}`;
      log.info(`[AgentAuth] Proxying MCP POST /api/ingest/turn request to ${backendUrl}`);

      const bodyBuffer = Buffer.from(JSON.stringify(body));

      const backendResponse = await this.makeBackendRequestRaw({
        url: backendUrl,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        bodyBuffer,
      });

      this.forwardRawBackendResponse(res, backendResponse);
    } catch (error: any) {
      log.error('[AgentAuth] MCP ingest turn proxy request failed:', error);
      this.sendJson(res, 500, {
        error: 'Backend Request Failed',
        message: error.message,
      });
    }
  }

  /**
   * MCP compatibility route: POST /api/conversation-ingest/upload
   * Forwards multipart upload to backend /test/api/conversation-ingest/upload.
   */
  private async handleMcpConversationIngestUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const agentToken = this.extractToken(req);
    if (!agentToken || !this.validateToken(agentToken)) {
      this.sendJson(res, 401, {
        error: 'Unauthorized',
        message: 'Invalid or missing agent authorization token',
      });
      return;
    }

    const contentTypeHeader = req.headers['content-type'];
    if (!contentTypeHeader) {
      this.sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Missing Content-Type header',
      });
      return;
    }

    try {
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, {
          error: 'Unauthorized',
          message: 'No user access token found in session',
        });
        return;
      }

      const contentTypeRaw = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
      const contentType = contentTypeRaw.split(',')[0]?.trim() ?? '';
      if (!contentType) {
        this.sendJson(res, 400, {
          error: 'Bad Request',
          message: 'Invalid Content-Type header',
        });
        return;
      }

      const backendUrl = `${this.getMcpBackendBaseUrl()}/test/api/conversation-ingest/upload`;
      log.info(`[AgentAuth] Proxying MCP upload request to ${backendUrl}`);

      const bodyBuffer = await this.readRequestBody(req);
      log.info(
        `[AgentAuth] MCP upload payload details contentType="${contentType}" bytes=${bodyBuffer.length}`,
      );

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentType,
      };

      const backendResponse = await this.makeBackendRequestRaw({
        url: backendUrl,
        method: 'POST',
        headers,
        bodyBuffer,
      });

      this.forwardRawBackendResponse(res, backendResponse);
    } catch (error: any) {
      log.error('[AgentAuth] MCP conversation ingest upload proxy failed:', error);
      this.sendJson(res, 500, {
        error: 'Backend Request Failed',
        message: error.message,
      });
    }
  }

  // ==================== Memory Proxy Handlers ====================

  /**
   * Handle POST /memory/search - Search documents
   */
  private async handleMemorySearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.guardProxyRequest(req, res)) return;

    const body = await this.parseBody(req);
    log.info(`[AgentAuth] Memory search request: ${JSON.stringify(body)}`);
    
    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }

    try {
      const cookies = await session.defaultSession.cookies.get({});
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const backendUrl = `${config.BACKEND_URL}/api/memory/search`;
      log.info(`[AgentAuth] Proxying POST memory/search request to ${backendUrl}`);

      const backendResponse = await this.makeBackendRequest({
        url: backendUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString
        },
        data: body
      });

      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));
    } catch (error: any) {
      log.error('[AgentAuth] Memory search request failed:', error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }

  /**
   * Handle POST /memory/upload - Upload session turn
  * Payload structure:
    * {
    *   sessionId: string;
    *   repoUrl: string;
    *   ticketId: string;
    *   commitId: string;
    *   agentUsed: string[];
    *   modelUsed: string[];
    *   messages: any[]; // AnyFrontendMessage[]
    * }
   */
  private async handleMemoryUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.guardProxyRequest(req, res)) return;

    const body = await this.parseBody(req);
    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }

    log.info(`[AgentAuth] Buffering session ${body?.sessionId}`);

    try {
      const cookies = await session.defaultSession.cookies.get({});
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const backendUrl = `${config.BACKEND_URL}/api/memory/turn`;
      log.info(`[AgentAuth] Proxying POST memory/turn request to ${backendUrl}`);

      const backendResponse = await this.makeBackendRequest({
        url: backendUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString
        },
        data: body
      });

      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));
    } catch (error: any) {
      log.error('[AgentAuth] Memory upload request failed:', error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }



  /**
   * Handle GET /memory/sessionHistory - Fetch normalized session history
   * Query parameters:
   * {
   *   sessionId: string; // required
   * }
   */
  private async handleSessionHistory(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!this.guardProxyRequest(req, res)) return;

    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      this.sendJson(res, 400, { error: 'sessionId query parameter is required' });
      return;
    }

    log.info(`[AgentAuth] Session history request: sessionId=${sessionId}`);

    try {
      const cookies = await session.defaultSession.cookies.get({});
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const backendUrl = `${config.BACKEND_URL}/api/memory/sessionHistory?sessionId=${encodeURIComponent(sessionId)}`;
      log.info(`[AgentAuth] Proxying GET memory/sessionHistory request to ${backendUrl}`);

      const backendResponse = await this.makeBackendRequest({
        url: backendUrl,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString
        }
      });

      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));
    } catch (error: any) {
      log.error('[AgentAuth] Session history request failed:', error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }

  /**
   * Handle PATCH /memory/:docId - Partial update of a memory document
   * Payload structure (at least one field required):
   * {
   *   userQuery?: string;
   *   chatSummary?: string[];
   *   rawContent?: string;
   *   tags?: string[];
   *   filePointers?: string[];
   *   commitId?: string;
   *   reviewStatus?: 'pending' | 'verified' | 'rejected';
   * }
   */
  private async handleMemoryUpdate(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!this.guardProxyRequest(req, res)) return;

    const docId = url.pathname.replace('/memory/', '');
    if (!docId) {
      this.sendJson(res, 400, { error: 'docId is required' });
      return;
    }

    const body = await this.parseBody(req);
    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }

    log.info(`[AgentAuth] Memory update request: docId=${docId}`);

    try {
      const cookies = await session.defaultSession.cookies.get({});
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const backendUrl = `${config.BACKEND_URL}/api/memory/${encodeURIComponent(docId)}`;
      log.info(`[AgentAuth] Proxying PATCH memory/${docId} request to ${backendUrl}`);

      const backendResponse = await this.makeBackendRequest({
        url: backendUrl,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString
        },
        data: body
      });

      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));
    } catch (error: any) {
      log.error('[AgentAuth] Memory update request failed:', error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }

  /**
   * Handle POST /memory/replaceSession - Atomically replace all SOPs/Facts for a session
   * Payload structure:
   * {
   *   sessionId: string;
   *   docs: Array<{
   *     docType: 'fact' | 'sop';
   *     rawContent: string;
   *     userQuery?: string;
   *     tags: string[];
   *     filePointers: string[];
   *   }>;
   * }
   */
  private async handleMemoryReplaceSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.guardProxyRequest(req, res)) return;

    const body = await this.parseBody(req);
    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, { error: 'Invalid request body' });
      return;
    }

    if (!body.sessionId || !Array.isArray(body.docs) || body.docs.length === 0) {
      this.sendJson(res, 400, { error: 'sessionId and non-empty docs array are required' });
      return;
    }

    log.info(`[AgentAuth] replaceSession request: sessionId=${body.sessionId} docs=${body.docs.length}`);

    try {
      const cookies = await session.defaultSession.cookies.get({});
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const backendUrl = `${config.BACKEND_URL}/api/memory/replaceSession`;
      log.info(`[AgentAuth] Proxying POST memory/replaceSession to ${backendUrl}`);

      const backendResponse = await this.makeBackendRequest({
        url: backendUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString,
        },
        data: body,
      });

      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));
    } catch (error: any) {
      log.error('[AgentAuth] replaceSession request failed:', error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }

  /**
   * Generic write proxy — validates the agent token, parses the JSON body,
   * retrieves the user's active workspace access token from Electron session cookies,
   * and forwards the POST request to the backend.
   */
  private async handleProxyPost(
    req: IncomingMessage,
    res: ServerResponse,
    backendPath: string
  ): Promise<void> {
    return this.handleProxy(req, res, 'POST', backendPath);
  }

  /**
   * Method-aware variant of the write proxy.
   *
   * GET and DELETE carry no body, so body parsing is skipped for them — parseBody
   * rejects on an empty stream, which would turn every such request into a 400.
   *
   * `backendPath` is always built from a literal in the route table above, never
   * taken from the request, so this stays an explicit vocabulary rather than an
   * open passthrough to arbitrary backend paths.
   */
  private async handleProxy(
    req: IncomingMessage,
    res: ServerResponse,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    backendPath: string
  ): Promise<void> {
    // 1. Validate agent token
    const token = this.extractToken(req);
    if (!token || !this.validateToken(token)) {
      this.sendJson(res, 401, { error: 'Unauthorized: invalid or missing agent token' });
      return;
    }

    // 2. Parse request body (only for methods that carry one)
    const expectsBody = method === 'POST' || method === 'PATCH' || method === 'PUT';
    let body: any;
    if (expectsBody) {
      try {
        body = await this.parseBody(req);
      } catch {
        this.sendJson(res, 400, { error: 'Bad request: invalid JSON body' });
        return;
      }

      if (!body || typeof body !== 'object') {
        this.sendJson(res, 400, { error: 'Bad request: body must be a JSON object' });
        return;
      }
    }

    try {
      // 3. Retrieve the user's active access token from workspace-scoped cookies
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, { error: 'Unauthorized: no active user session' });
        return;
      }

      // 4. Forward to backend
      const backendUrl = `${config.BACKEND_URL}${backendPath}`;
      log.info(`[AgentAuth] Proxying ${method} to ${backendUrl}`);

      const send = (token: string) =>
        this.makeBackendRequest({
          url: backendUrl,
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          ...(expectsBody ? { data: body } : {})
        });

      // The forwarded workspace token is short-lived, so refresh once on a 401 and
      // replay — a long agent run would otherwise die mid-job.
      const backendResponse = await this.sendWithRefresh(accessToken, send);
      if (!backendResponse) {
        this.reauthRequired(res);
        return;
      }

      // 5. Return backend response
      res.writeHead(backendResponse.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backendResponse.data));
    } catch (error: any) {
      log.error(`[AgentAuth] Proxy ${method} to ${backendPath} failed:`, error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }

  /**
   * Fetch attachments for a message or conversation (common logic)
   * Returns { messageId, conversationId, attachments } or null if not found
   */
  private async fetchMessageAttachments(
    id: string,
    accessToken: string
  ): Promise<{ messageId: string; conversationId: string; attachments: any[] } | null> {
    let actualMessageId = id;
    let conversationId: string | null = null;

    // 1. First, try to get conversation by messageId to find conversationId
    log.info(`[AgentAuth] Getting conversation for messageId: ${id}`);
    const conversationByMessageUrl = `${config.BACKEND_URL}/api/conversations/by-message/${id}`;
    const conversationByMessageResponse = await this.makeBackendRequest({
      url: conversationByMessageUrl,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (conversationByMessageResponse.statusCode === 200 && conversationByMessageResponse.data?.conversationId) {
      // Got conversation from messageId
      conversationId = conversationByMessageResponse.data.conversationId;
      actualMessageId = id;
      log.info(`[AgentAuth] Found conversation ${conversationId} for messageId ${id}`);
    } else {
      // 2. If not found, assume id is conversationId and get conversation to find initialMessageId
      log.info(`[AgentAuth] Trying id as conversationId: ${id}`);
      const conversationUrl = `${config.BACKEND_URL}/api/conversations/${id}`;
      const conversationResponse = await this.makeBackendRequest({
        url: conversationUrl,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (conversationResponse.statusCode === 200 && conversationResponse.data?.initialMessageId) {
        conversationId = id;
        actualMessageId = conversationResponse.data.initialMessageId;
        log.info(`[AgentAuth] Using conversationId ${conversationId} with initialMessageId ${actualMessageId}`);
      } else {
        return null;
      }
    }

    // 3. Get message with attachments using existing endpoint
    const messageUrl = `${config.BACKEND_URL}/api/conversations/${conversationId}/message/${actualMessageId}`;
    log.info(`[AgentAuth] Getting message from ${messageUrl}`);

    const messageResponse = await this.makeBackendRequest({
      url: messageUrl,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (messageResponse.statusCode !== 200) {
      return null;
    }

    const messageData = messageResponse.data;
    const attachments = messageData?.attachments || [];

    return {
      messageId: actualMessageId,
      conversationId: conversationId!,
      attachments
    };
  }

  /**
   * Handle GET /message/:id/attachments with fallback to conversationId
   * Downloads all attachments to a unique directory and returns the download path
   */
  private async handleMessageAttachments(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    _url: URL
  ): Promise<void> {
    // 1. Validate agent token
    const token = this.extractToken(req);
    if (!token || !this.validateToken(token)) {
      this.sendJson(res, 401, { error: 'Unauthorized: invalid or missing agent token' });
      return;
    }

    try {
      // 2. Retrieve the user's active access token from workspace-scoped cookies
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, { error: 'Unauthorized: no active user session' });
        return;
      }

      // 3. Fetch attachments using common logic
      const result = await this.fetchMessageAttachments(id, accessToken);

      if (!result) {
        this.sendJson(res, 404, {
          error: 'Message or conversation not found',
          providedId: id
        });
        return;
      }

      const { messageId: actualMessageId, attachments } = result;

      if (attachments.length === 0) {
        this.sendJson(res, 200, {
          downloadPath: null,
          message: 'No attachments found',
          attachmentCount: 0,
          messageId: actualMessageId
        });
        return;
      }

      // 4. Create download directory on desktop
      const downloadDir = path.join(app.getPath('desktop'), 'xyne-attachments', actualMessageId);
      await fs.promises.mkdir(downloadDir, { recursive: true });
      log.info(`[AgentAuth] Created download directory: ${downloadDir}`);

      // 5. Download each attachment
      const downloadedFiles: Array<{ filename: string; path: string; size: number }> = [];
      for (const attachment of attachments) {
        try {
          const filename = attachment.originalFilename || `attachment_${attachment.id}`;
          const filePath = path.join(downloadDir, filename);

          // Download attachment using the attachment download endpoint
          const downloadUrl = `${config.BACKEND_URL}/api/attachments/${attachment.id}/download`;
          log.info(`[AgentAuth] Downloading attachment: ${filename} from ${downloadUrl}`);

          await this.downloadAttachmentToFile(downloadUrl, filePath, accessToken);

          const stats = await fs.promises.stat(filePath);
          downloadedFiles.push({
            filename,
            path: filePath,
            size: stats.size
          });

          log.info(`[AgentAuth] Downloaded: ${filename} (${stats.size} bytes)`);
        } catch (error: any) {
          log.error(`[AgentAuth] Failed to download attachment ${attachment.id}:`, error);
          // Continue with other attachments
        }
      }

      // 6. Return success response with download path
      this.sendJson(res, 200, {
        downloadPath: downloadDir,
        messageId: actualMessageId,
        attachmentCount: attachments.length,
        downloadedCount: downloadedFiles.length,
        files: downloadedFiles
      });

    } catch (error: any) {
      log.error(`[AgentAuth] Get message attachments failed:`, error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }

  /**
   * Handle GET /message/:id/attachments/info
   * Returns attachment metadata without downloading files
   */
  private async handleMessageAttachmentsInfo(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    _url: URL
  ): Promise<void> {
    // 1. Validate agent token
    const token = this.extractToken(req);
    if (!token || !this.validateToken(token)) {
      this.sendJson(res, 401, { error: 'Unauthorized: invalid or missing agent token' });
      return;
    }

    try {
      // 2. Retrieve the user's active access token from workspace-scoped cookies
      const accessToken = await this.getUserAccessTokenFromSession();
      if (!accessToken) {
        this.sendJson(res, 401, { error: 'Unauthorized: no active user session' });
        return;
      }

      // 3. Fetch attachments using common logic
      const result = await this.fetchMessageAttachments(id, accessToken);

      if (!result) {
        this.sendJson(res, 404, {
          error: 'Message or conversation not found',
          providedId: id
        });
        return;
      }

      const { messageId, conversationId, attachments } = result;

      // 4. Return attachment metadata without downloading
      this.sendJson(res, 200, {
        messageId,
        conversationId,
        attachmentCount: attachments.length,
        attachments: attachments.map((attachment: any) => ({
          id: attachment.id,
          filename: attachment.originalFilename,
          mimetype: attachment.mimetype,
          size: attachment.size,
          width: attachment.width,
          height: attachment.height,
          url: attachment.url,
          thumbnailUrl: attachment.thumbnailUrl,
          createdAt: attachment.createdAt,
          metadata: attachment.metadata
        }))
      });

    } catch (error: any) {
      log.error(`[AgentAuth] Get message attachments info failed:`, error);
      this.sendJson(res, 500, { error: 'Backend request failed', message: error.message });
    }
  }

  /**
   * Download an attachment file using Electron's net module
   */
  private async downloadAttachmentToFile(
    url: string,
    filePath: string,
    accessToken: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        url,
        method: 'GET',
        useSessionCookies: false
      });

      request.setHeader('Authorization', `Bearer ${accessToken}`);

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const writeStream = fs.createWriteStream(filePath);

        response.on('data', (chunk) => {
          writeStream.write(chunk);
        });

        response.on('end', () => {
          writeStream.end();
          writeStream.on('finish', () => resolve());
          writeStream.on('error', reject);
        });

        response.on('error', (error) => {
          writeStream.destroy();
          reject(error);
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.end();
    });
  }

  // ==================== End Memory Proxy Handlers ====================

  /**
   * Make HTTP/HTTPS request to backend using Electron's net module
   * This properly handles mTLS client certificates
   */
  private async makeBackendRequest(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    data?: any;
  }): Promise<{ statusCode: number; data: any }> {
    return new Promise((resolve, reject) => {
      // Use Electron's net module which handles client certificates automatically
      const request = net.request({
        url: options.url,
        method: options.method,
        useSessionCookies: false
      });

      // Set headers
      Object.entries(options.headers).forEach(([key, value]) => {
        request.setHeader(key, value);
      });

      let responseData = '';

      request.on('response', (response) => {
        response.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        response.on('end', () => {
          try {
            const data = responseData ? JSON.parse(responseData) : {};
            resolve({
              statusCode: response.statusCode,
              data
            });
          } catch (error) {
            reject(new Error('Failed to parse backend response'));
          }
        });

        response.on('error', (error) => {
          log.error('[AgentAuth] Response error:', error);
          reject(error);
        });
      });

      request.on('error', (error) => {
        log.error('[AgentAuth] Request error:', error);
        reject(error);
      });

      // Write body if present
      if (options.data && (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH')) {
        request.write(JSON.stringify(options.data));
      }

      request.end();
    });
  }

  /**
   * Make backend request and return raw response bytes/headers unchanged.
   * Used for passthrough proxy endpoints (e.g., multipart upload).
   */
  private async makeBackendRequestRaw(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyBuffer?: Buffer;
  }): Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        url: options.url,
        method: options.method,
        useSessionCookies: false,
      });

      Object.entries(options.headers).forEach(([key, value]) => {
        request.setHeader(key, value);
      });

      request.on('response', (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 500,
            headers: response.headers as Record<string, string | string[]>,
            body: Buffer.concat(chunks),
          });
        });

        response.on('error', (error) => {
          log.error('[AgentAuth] Raw response error:', error);
          reject(error);
        });
      });

      request.on('error', (error) => {
        log.error('[AgentAuth] Raw request error:', error);
        reject(error);
      });

      if (options.bodyBuffer) {
        request.write(options.bodyBuffer);
      }

      request.end();
    });
  }

  private async readRequestBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      req.on('error', (error) => {
        reject(error);
      });
    });
  }

  private forwardRawBackendResponse(
    res: ServerResponse,
    backendResponse: { statusCode: number; headers: Record<string, string | string[]>; body: Buffer },
  ): void {
    const responseHeaders: Record<string, string | string[]> = {};
    const contentType = backendResponse.headers['content-type'];
    const contentLength = backendResponse.headers['content-length'];

    if (contentType) {
      responseHeaders['Content-Type'] = contentType;
    }

    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength;
    }

    res.writeHead(backendResponse.statusCode, responseHeaders);
    res.end(backendResponse.body);
  }

  private async getUserAccessTokenFromSession(): Promise<string | null> {
    const cookies = await session.defaultSession.cookies.get({});
    const readCookie = (name: string): string | undefined =>
      cookies.find((cookie) => cookie.name === name)?.value;

    // Prefer authV2 workspace cookies:
    // 1) pointer cookie `xyne_last_workspace`
    // 2) token cookie `xyne_ws_<workspaceId>_token`
    const lastWorkspace = readCookie('xyne_last_workspace');
    if (lastWorkspace) {
      const workspaceToken = readCookie(`xyne_ws_${lastWorkspace}_token`);
      if (workspaceToken) {
        return workspaceToken;
      }
    }

    // Backward compatibility fallback: old `google_access_token` cookie.
    // Accept only JWT-shaped values to avoid using pending-auth JSON blobs.
    const legacy = readCookie('google_access_token');
    if (legacy && legacy.split('.').length === 3) {
      return legacy;
    }

    return null;
  }

  /**
   * Ask the backend to mint a fresh workspace token from the browser session.
   *
   * The workspace cookie this proxy forwards is short-lived, and nothing here used
   * to notice it expiring: a long-running local agent would simply start getting
   * 401s ("Token expired and no session provided for refresh") partway through a
   * job and have to be reconnected by hand.
   *
   * `/api/v2/auth/refresh-session` is driven by the `user_session_id` cookie, so
   * that has to be forwarded — the access token we are replacing is exactly the
   * thing that is no longer valid.
   *
   * Returns the new token, or null when the session itself is gone and the user
   * genuinely has to sign in again.
   */
  /**
   * Run a backend call, refreshing the workspace token once on a 401 and replaying.
   *
   * Returns null when the session could not be refreshed, meaning the caller should
   * answer 401 with `reauthRequired` rather than pass the failure through opaquely.
   */
  private async sendWithRefresh(
    firstToken: string,
    send: (token: string) => Promise<{ statusCode: number; data: any }>,
  ): Promise<{ statusCode: number; data: any } | null> {
    const response = await send(firstToken);
    if (response.statusCode !== 401) return response;

    log.info('[AgentAuth] Backend returned 401; attempting session refresh');
    const refreshed = await this.refreshUserAccessToken();
    if (!refreshed) return null;
    return send(refreshed);
  }

  private reauthRequired(res: ServerResponse): void {
    this.sendJson(res, 401, {
      error: 'Unauthorized',
      message:
        'Your Spaces session expired and could not be refreshed. Sign in again in the Spaces app.',
      reauthRequired: true,
    });
  }

  private async refreshUserAccessToken(): Promise<string | null> {
    try {
      const cookies = await session.defaultSession.cookies.get({});
      const sessionCookie = cookies.find((cookie) => cookie.name === 'user_session_id');
      if (!sessionCookie) {
        log.warn('[AgentAuth] Cannot refresh: no user_session_id cookie');
        return null;
      }

      const response = await this.makeBackendRequest({
        url: `${config.BACKEND_URL}/api/v2/auth/refresh-session`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `user_session_id=${sessionCookie.value}`,
        },
      });

      if (response.statusCode !== 200) {
        log.warn(`[AgentAuth] Session refresh returned ${response.statusCode}`);
        return null;
      }

      // The backend sets the refreshed workspace cookie as a side effect of the
      // call, but Electron's net module is run with useSessionCookies:false, so
      // re-read from the session rather than trusting a Set-Cookie round trip.
      const refreshed = await this.getUserAccessTokenFromSession();
      if (refreshed) {
        log.info('[AgentAuth] Refreshed the workspace access token');
        return refreshed;
      }

      // Fall back to a token in the response body if the cookie did not land.
      const data = response.data as { accessToken?: string; token?: string } | undefined;
      return data?.accessToken ?? data?.token ?? null;
    } catch (error: any) {
      log.error('[AgentAuth] Session refresh failed:', error);
      return null;
    }
  }

  /**
   * Validate an access token (for use by other services)
   */
  validateToken(token: string): boolean {
    const session = this.sessions.get(token);

    if (!session) {
      return false;
    }

    // Check expiration
    if (Date.now() >= session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }

    return true;
  }

  private sanitizeDialogText(value: string | undefined, maxLen: number): string {
    if (typeof value !== 'string') return '';
    const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
  }

  /**
   * Show consent dialog to user
   */
  private async showConsentDialog(authRequest: AuthRequest): Promise<{ approved: boolean; duration: DurationOption }> {
    const mainWindow = BrowserWindow.getAllWindows()[0];

    if (!mainWindow) {
      log.error('[AgentAuth] No window available for consent dialog');
      return { approved: false, duration: '5min' };
    }

    const name = this.sanitizeDialogText(authRequest.agentName, 64);
    const type = this.sanitizeDialogText(authRequest.agentType, 32);
    const description = this.sanitizeDialogText(authRequest.description, 256);

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Deny', 'Allow (5 min)', 'Allow (1 hour)', 'Allow (Session)'],
      defaultId: 0,
      cancelId: 0,
      title: 'Agent Authorization Request',
      message: `A local agent wants to connect`,
      detail: `Name: ${name}\n` +
              `${type ? `Type: ${type}\n` : ''}` +
              `Description: ${description}\n\n` +
              `Do you want to allow this agent to access your application?`,
      normalizeAccessKeys: true
    });

    if (result.response === 0) {
      return { approved: false, duration: '5min' };
    }

    const duration: DurationOption = result.response === 1 ? '5min' : 
                                      result.response === 2 ? '1hour' : 'session';

    return { approved: true, duration };
  }

  /**
   * Generate a secure random token
   */
  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Calculate expiration timestamp
   */
  private calculateExpiration(duration: DurationOption): number {
    const now = Date.now();
    switch (duration) {
      case '5min':
        return now + 5 * 60 * 1000;
      case '1hour':
        return now + 60 * 60 * 1000;
      case 'session':
        // Set to 24 hours as a practical limit
        return now + 24 * 60 * 60 * 1000;
      default:
        return now + 5 * 60 * 1000;
    }
  }

  /**
   * Extract bearer token from request
   */
  private extractToken(req: IncomingMessage): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }

  // XYNE-17386 Issues 123/157: the loopback server is reachable by any web page
  // the user visits. Reject cross-site browser fetch-metadata (Origin /
  // Sec-Fetch-Site) — real local agents are non-browser and send neither.
  private isCrossSiteBrowserRequest(req: IncomingMessage): boolean {
    const loopbackHosts = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`]);
    const origin = req.headers['origin'];
    if (typeof origin === 'string' && origin.length > 0) {
      try {
        if (!loopbackHosts.has(new URL(origin).host)) return true;
      } catch {
        return true; // malformed Origin → treat as hostile
      }
    }
    const secFetchSite = req.headers['sec-fetch-site'];
    if (typeof secFetchSite === 'string' && secFetchSite !== 'none' && secFetchSite !== 'same-origin') {
      return true;
    }
    return false;
  }

  private guardProxyRequest(req: IncomingMessage, res: ServerResponse): boolean {
    if (this.isCrossSiteBrowserRequest(req)) {
      log.warn('[AgentAuth] Rejected cross-site request to credential-forwarding endpoint');
      this.sendJson(res, 403, { error: 'Forbidden', message: 'Cross-site request rejected' });
      return false;
    }
    const agentToken = this.extractToken(req);
    if (!agentToken || !this.validateToken(agentToken)) {
      this.sendJson(res, 401, {
        error: 'Unauthorized',
        message: 'Invalid or missing agent authorization token',
      });
      return false;
    }
    return true;
  }

  /**
   * Parse request body as JSON
   */
  private async parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Send JSON response
   */
  private sendJson(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Clean up expired sessions periodically
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [token, session] of this.sessions.entries()) {
        if (now >= session.expiresAt) {
          this.sessions.delete(token);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        log.info(`[AgentAuth] Cleaned up ${cleaned} expired session(s)`);
      }
    }, 60 * 1000); // Check every minute
  }

  /**
   * Get all active sessions (for debugging/monitoring)
   */
  getActiveSessions(): Array<Omit<AuthSession, 'token'>> {
    return Array.from(this.sessions.values()).map(({ token, ...session }) => session);
  }
}

export const agentAuthService = new AgentAuthService();
