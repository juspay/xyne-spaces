/**
 * Claw Connectors Service
 *
 * The Spaces half of `sdk.connectors`: relays an artifact app's connector calls
 * to claw-auth's `/internal/app-connectors/*`, which resolves the VIEWER's own
 * MCP connection and runs the tool server-side. The connector credential stays
 * in claw-auth; only the tool's text output comes back.
 *
 * Authenticated with INTERNAL_S2S_KEY (claw-auth's `requireInternalS2S`) and an
 * explicit `userId` in every body — Spaces user ids are claw's `User.id`. With
 * no key configured nothing is sent: an unauthenticated request would only be
 * refused upstream, and failing here names the actual cause.
 *
 * claw-auth reports failures as `{ success: false, code, error }`. The three
 * codes an app can act on become typed errors that the SDK router maps onto its
 * envelope; everything else is a plain Error and surfaces as `internal`.
 */
import { config } from '@/config/env';

export interface Connector {
  type: string;
  name: string;
  description: string | null;
  auth: 'oauth' | 'credentials';
  /** The viewer has a usable connection, personal or org. */
  connected: boolean;
  source: 'personal' | 'org' | null;
}

export interface ConnectorTool {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  write: boolean;
}

export type ConnectResult =
  | { kind: 'oauth'; authUrl: string }
  | { kind: 'manual'; settingsUrl: string | null };

/** The viewer has no connection (personal or org) for this connector. */
export class ConnectorNotConnectedError extends Error {
  constructor(public readonly connector: string) {
    super(`Connector "${connector}" is not connected for this user.`);
    this.name = 'ConnectorNotConnectedError';
  }
}

/** The tool writes; apps may only call read tools. */
export class ConnectorWriteToolError extends Error {
  constructor(
    public readonly connector: string,
    public readonly tool: string,
  ) {
    super(`"${tool}" on connector "${connector}" is a write tool; apps can only call read tools.`);
    this.name = 'ConnectorWriteToolError';
  }
}

/** Unknown, disabled, not visible to the viewer, or platform-internal. */
export class ConnectorNotFoundError extends Error {
  constructor(public readonly connector: string) {
    super(`Connector "${connector}" not found.`);
    this.name = 'ConnectorNotFoundError';
  }
}

/** The tool is not one the connector advertises, or the input was refused. */
export class ConnectorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorValidationError';
  }
}

const SHORT_TIMEOUT_MS = 15_000;
/** A tool call runs a real upstream query; give it room. */
const CALL_TIMEOUT_MS = 60_000;

type Op = 'list' | 'tools' | 'call' | 'connect';

interface ClawEnvelope<T> {
  success?: boolean;
  data?: T;
  code?: string;
  error?: string;
}

async function post<T>(
  op: Op,
  body: Record<string, unknown>,
  timeoutMs: number,
  connector?: string,
  tool?: string,
): Promise<T> {
  const key = config.internalS2sKey;
  if (!key) {
    throw new Error('[ClawConnectorsService] INTERNAL_S2S_KEY is not configured');
  }

  const base = config.xyneClaw.authUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/claw/api/v1/internal/app-connectors/${op}`, {
    method: 'POST',
    headers: { 'x-s2s-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text().catch(() => '');
  let json: ClawEnvelope<T> | undefined;
  try {
    json = text ? (JSON.parse(text) as ClawEnvelope<T>) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok || json?.success !== true) {
    // Branch on claw-auth's `code`, not the bare status: a 404 from a claw-auth
    // that predates this route must not read as "connector not found".
    const code = json?.code;
    if (connector && res.status === 409 && code === 'not_connected') {
      throw new ConnectorNotConnectedError(connector);
    }
    if (connector && tool && res.status === 403 && code === 'write_tool') {
      throw new ConnectorWriteToolError(connector, tool);
    }
    if (connector && res.status === 404 && code === 'not_found') {
      throw new ConnectorNotFoundError(connector);
    }
    if (res.status === 400 && code === 'validation_failed' && json?.error) {
      throw new ConnectorValidationError(json.error);
    }
    throw new Error(
      `[ClawConnectorsService] ${op}: HTTP ${res.status} — ${(json?.error ?? text).slice(0, 300)}`,
    );
  }
  if (json.data === undefined) {
    throw new Error(`[ClawConnectorsService] ${op}: response carried no data`);
  }
  return json.data;
}

/** Every connector the viewer can see, with whether they can use it yet. */
export async function listConnectors(userId: string): Promise<Connector[]> {
  const data = await post<{ connectors: Connector[] }>('list', { userId }, SHORT_TIMEOUT_MS);
  return data.connectors;
}

/** The tools a connector exposes, as the viewer's connection sees them. */
export async function listConnectorTools(userId: string, type: string): Promise<ConnectorTool[]> {
  const data = await post<{ tools: ConnectorTool[] }>(
    'tools',
    { userId, serverType: type },
    SHORT_TIMEOUT_MS,
    type,
  );
  return data.tools;
}

/** Run one read tool as the viewer; returns the tool's raw text output. */
export async function callConnectorTool(
  userId: string,
  type: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ content: string }> {
  const data = await post<{ content: string }>(
    'call',
    { userId, serverType: type, tool, params: args },
    CALL_TIMEOUT_MS,
    type,
    tool,
  );
  return { content: data.content };
}

/**
 * Start connecting a connector: an OAuth consent URL, or — for connectors set
 * up with a credential form — the settings page to do it on. claw-auth does not
 * know the dashboard's workspace-scoped URL, so `settingsUrl` is supplied by
 * the caller and used whenever claw-auth returns none.
 */
export async function startConnectorConnect(
  userId: string,
  type: string,
  opts: { returnTo?: string; settingsUrl?: string | null } = {},
): Promise<ConnectResult> {
  const result = await post<ConnectResult>(
    'connect',
    { userId, serverType: type, ...(opts.returnTo ? { returnTo: opts.returnTo } : {}) },
    SHORT_TIMEOUT_MS,
    type,
  );
  if (result.kind === 'manual') {
    return { kind: 'manual', settingsUrl: result.settingsUrl ?? opts.settingsUrl ?? null };
  }
  return result;
}
