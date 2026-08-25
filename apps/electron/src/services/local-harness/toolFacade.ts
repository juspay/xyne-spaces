import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { AddressInfo } from 'net';
import log from 'electron-log/main';
import type { LocalHarnessToolSpec } from './contract';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface ToolFacadeHandlers {
  listTools: () => Promise<LocalHarnessToolSpec[]>;
  callTool: (spec: LocalHarnessToolSpec, args: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>;
  onToolStarted?: (toolName: string) => void;
}

export class ToolFacadeServer {
  private server: Server | null = null;
  private port = 0;
  private readonly token = randomBytes(32).toString('base64url');
  private toolsByName = new Map<string, LocalHarnessToolSpec>();

  constructor(private readonly handlers: ToolFacadeHandlers) {}

  async start(): Promise<{ url: string; token: string }> {
    if (this.server) return { url: this.url(), token: this.token };

    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });

    this.port = (this.server.address() as AddressInfo).port;
    log.info(`[LocalHarness] tool facade listening on ${this.url()}`);
    return { url: this.url(), token: this.token };
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.toolsByName.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private url(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  mcpConfig(serverName: string): Record<string, unknown> {
    return {
      mcpServers: {
        [serverName]: {
          type: 'http',
          url: this.url(),
          headers: { Authorization: `Bearer ${this.token}` },
        },
      },
    };
  }

  private isCrossSiteBrowserRequest(req: IncomingMessage): boolean {
    const origin = req.headers['origin'];
    if (typeof origin === 'string' && origin.length > 0) return true;
    const secFetchSite = req.headers['sec-fetch-site'];
    return typeof secFetchSite === 'string' && secFetchSite !== 'none' && secFetchSite !== 'same-origin';
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    return typeof header === 'string' && header === `Bearer ${this.token}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.isCrossSiteBrowserRequest(req) || !this.authorized(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body: JsonRpcRequest;
    try {
      body = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    if (body.id === undefined || body.id === null) {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end('');
      return;
    }

    try {
      const result = await this.dispatch(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`[LocalHarness] facade method ${body.method} failed: ${message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32603, message: 'Internal error' },
        }),
      );
    }
  }

  private async dispatch(req: JsonRpcRequest): Promise<unknown> {
    switch (req.method) {
      case 'initialize':
        return {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'xyne-spaces', version: '1.0.0' },
        };

      case 'ping':
        return {};

      case 'tools/list': {
        const tools = await this.handlers.listTools();
        this.toolsByName = new Map(tools.map((t) => [t.name, t]));
        return {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
      }

      case 'tools/call': {
        const name = req.params?.['name'];
        const args = req.params?.['arguments'];
        if (typeof name !== 'string') throw new Error('tools/call requires a string name');

        const spec = this.toolsByName.get(name);
        if (!spec) {
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }

        this.handlers.onToolStarted?.(spec.toolName);
        const result = await this.handlers.callTool(
          spec,
          args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
        );
        return {
          content: [{ type: 'text', text: result.content }],
          ...(result.ok ? {} : { isError: true }),
        };
      }

      default:
        throw new Error(`Unsupported method: ${req.method}`);
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
