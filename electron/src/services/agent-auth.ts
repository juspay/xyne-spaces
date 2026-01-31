import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { dialog, BrowserWindow, session, net } from 'electron';
import log from 'electron-log/main';
import https from 'https';
import http from 'http';
import { config } from '../app/config';

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    try {
      if (req.method === 'POST' && url.pathname === '/auth/request') {
        await this.handleAuthRequest(req, res);
      } else if (req.method === 'POST' && url.pathname === '/auth/release') {
        await this.handleAuthRelease(req, res);
      } else if (req.method === 'POST' && url.pathname === '/interact') {
        await this.handleInteract(req, res);
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

    log.info('[AgentAuth] Authorization request from:', authRequest.agentName);

    // Show consent dialog to user
    const approval = await this.showConsentDialog(authRequest);

    if (!approval.approved) {
      const response: AuthResponse = {
        status: 'denied',
        reason: 'User rejected the request'
      };
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

    log.info(`[AgentAuth] Access granted to ${authRequest.agentName} until ${new Date(expiresAt).toISOString()}`);
    this.sendJson(res, 200, response);
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
      // Get access token from cookies
      const cookies = await session.defaultSession.cookies.get({});
      const accessTokenCookie = cookies.find(c => c.name === 'google_access_token');
      
      if (!accessTokenCookie) {
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
      const backendResponse = await this.makeBackendRequest({
        url: backendUrl,
        method,
        headers: {
          'Authorization': `Bearer ${accessTokenCookie.value}`,
          'Content-Type': 'application/json'
        },
        data
      });

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

  /**
   * Show consent dialog to user
   */
  private async showConsentDialog(authRequest: AuthRequest): Promise<{ approved: boolean; duration: DurationOption }> {
    const mainWindow = BrowserWindow.getAllWindows()[0];

    if (!mainWindow) {
      log.error('[AgentAuth] No window available for consent dialog');
      return { approved: false, duration: '5min' };
    }

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Deny', 'Allow (5 min)', 'Allow (1 hour)', 'Allow (Session)'],
      defaultId: 0,
      cancelId: 0,
      title: 'Agent Authorization Request',
      message: `A local agent wants to connect`,
      detail: `Name: ${authRequest.agentName}\n` +
              `${authRequest.agentType ? `Type: ${authRequest.agentType}\n` : ''}` +
              `Description: ${authRequest.description}\n\n` +
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
