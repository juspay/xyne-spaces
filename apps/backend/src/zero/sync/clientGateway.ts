import { randomUUID } from 'crypto';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { WebSocketServer, type WebSocket } from 'ws';
import { logger } from '@/utils/logger';
import { authMiddleware } from '@/middleware/auth';
import { syncEngine } from './syncEngine';
import { fanout } from './fanout';
import { hashOfNameAndArgs } from './protocol';
import { deriveAclGate } from './aclGate';
import { queryMetaFor } from './queryMeta';
import { grantQueryName, grantArgs } from './grantQueries';

const SYNC_WS_PATH = '/api/sync/ws';

interface AuthedUser {
  id: string;
  workspaceId: string;
}

/** Authenticate a WS upgrade as the existing user (cookie/JWT), reusing authMiddleware. */
async function authenticateUpgrade(req: IncomingMessage): Promise<AuthedUser | null> {
  const cookies: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeReq = {
    headers: req.headers,
    cookies,
    method: 'GET',
    path: SYNC_WS_PATH,
    body: {},
    get: (h: string) => (req.headers as Record<string, string | undefined>)[h.toLowerCase()],
  } as any;
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeRes = { status: () => ({ json: () => resolve(null) }), cookie: () => {}, setHeader: () => {} } as any;
    void authMiddleware.authenticate(fakeReq, fakeRes, (err?: unknown) => {
      resolve(
        !err && fakeReq.user ? { id: fakeReq.user.id, workspaceId: fakeReq.user.workspaceId } : null,
      );
    });
  });
}

export function attachSyncClientGateway(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!(req.url ?? '').startsWith(SYNC_WS_PATH)) return;
    void (async () => {
      const user = await authenticateUpgrade(req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, user));
    })();
  });
  logger.info('[SyncGateway] WS handler registered', { path: SYNC_WS_PATH });
}

interface Subscription {
  grantInstanceKeys: string[];
}

function handleConnection(ws: WebSocket, user: AuthedUser): void {
  const connId = `client-${randomUUID()}`;
  const subs = new Map<string, Subscription>(); // dataInstanceKey → grant instances

  ws.on('message', (raw) => void onMessage(raw.toString()));
  ws.on('close', () => {
    for (const [dataInstanceKey, sub] of subs) {
      syncEngine.unsubscribe(dataInstanceKey, connId);
      for (const g of sub.grantInstanceKeys) syncEngine.unsubscribe(g, connId);
      fanout.removeClient(connId, dataInstanceKey);
    }
    subs.clear();
  });

  async function onMessage(raw: string): Promise<void> {
    let msg: { action?: string; queryName?: string; args?: unknown[] };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg.queryName || !Array.isArray(msg.args)) return;
    if (msg.action === 'subscribe') await subscribe(msg.queryName, msg.args);
    else if (msg.action === 'unsubscribe') unsubscribe(msg.queryName, msg.args);
  }

  async function subscribe(queryName: string, args: unknown[]): Promise<void> {
    const dataInstanceKey = syncEngine.subscribe(queryName, args, connId);
    if (!dataInstanceKey) {
      ws.send(JSON.stringify({ type: 'error', queryName, message: 'not a shareable query' }));
      return;
    }
    const meta = queryMetaFor(queryName, args[0]);
    if (!meta) return;
    const partitionValue = String((args[0] as Record<string, unknown>)[meta.partitionColumn]);

    // Materialize the ACL grant instances (own client groups) and gate the client.
    const gate = deriveAclGate(meta.rootTable);
    const grantByTable = new Map<string, string>();
    const grantInstanceKeys: string[] = [];
    for (const gs of gate.grantSources) {
      const gk = syncEngine.subscribe(grantQueryName(gs.table), grantArgs(gs.scopeColumn, partitionValue), connId);
      if (gk) {
        grantByTable.set(gs.table, gk);
        grantInstanceKeys.push(gk);
      }
    }
    subs.set(dataInstanceKey, { grantInstanceKeys });
    await fanout.addClient({
      id: connId,
      socket: ws,
      userId: user.id,
      workspaceId: user.workspaceId,
      scope: { [meta.partitionColumn]: partitionValue },
      gate,
      dataInstanceKey,
      grantByTable,
    });
  }

  function unsubscribe(queryName: string, args: unknown[]): void {
    const dataInstanceKey = hashOfNameAndArgs(queryName, args);
    const sub = subs.get(dataInstanceKey);
    if (!sub) return;
    syncEngine.unsubscribe(dataInstanceKey, connId);
    for (const g of sub.grantInstanceKeys) syncEngine.unsubscribe(g, connId);
    fanout.removeClient(connId, dataInstanceKey);
    subs.delete(dataInstanceKey);
  }
}
