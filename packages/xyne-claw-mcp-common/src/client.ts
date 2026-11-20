/**
 * Client of the MCP service. The caller supplies signing and sending. A request
 * goes out without `launch`; on 409 launch-required the launch spec is built
 * and the request is sent once more with it.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  bodyHash,
  LaunchRequiredError,
  MCP_SERVICE_PATHS,
  MCP_SESSION_KEY_HEADER,
  type EvictRequest,
  type LaunchSpec,
  type ServiceResponse,
  type SessionTarget,
  type ToolDescriptor,
} from "./protocol.js";

export const SERVICE_ASSERTION_HEADER = "x-service-assertion";

/** MCP `tools/call` result as the server returned it. */
export type McpCallResult = Awaited<ReturnType<Client["callTool"]>>;

export interface McpSessionRef {
  key: string;
  serverType: string;
  fingerprint: string;
  /** Builds the launch spec; called only when a session must be started. */
  launch: () => Promise<LaunchSpec>;
}

export interface McpServiceClient {
  listTools(ref: McpSessionRef): Promise<ToolDescriptor[]>;
  callTool(ref: McpSessionRef, tool: string, args: Record<string, unknown>, meta?: Record<string, unknown>): Promise<McpCallResult>;
  /** Best-effort; errors go to `onEvictError`. */
  evict(req: EvictRequest): Promise<void>;
  restart(serverType?: string): Promise<number>;
}

export interface McpServiceClientOptions {
  baseUrl: string;
  /** Service assertion for this request; `bh` must be the body hash given. */
  sign: (method: "POST", path: string, claims: { bh: string }) => string;
  /** Sends the request; the caller adds timeouts, redirect and size limits. */
  send: (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;
  onEvictError?: (err: unknown) => void;
}

/** A response the MCP service sent back as an error (not a transport failure). */
export class McpServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "McpServiceError";
  }
}

function target(ref: McpSessionRef, launch?: LaunchSpec): SessionTarget {
  return { key: ref.key, serverType: ref.serverType, fingerprint: ref.fingerprint, ...(launch ? { launch } : {}) };
}

/** Try without a launch spec; on launch-required, build it and retry once. */
async function withLazyLaunch<T>(ref: McpSessionRef, run: (t: SessionTarget) => Promise<T>): Promise<T> {
  try {
    return await run(target(ref));
  } catch (err) {
    if (!(err instanceof LaunchRequiredError)) throw err;
  }
  return run(target(ref, await ref.launch()));
}

export function createMcpServiceClient(opts: McpServiceClientOptions): McpServiceClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");

  async function post<T>(path: string, payload: unknown, sessionKey?: string): Promise<T> {
    const body = JSON.stringify(payload);
    const res = await opts.send(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SERVICE_ASSERTION_HEADER]: opts.sign("POST", path, { bh: bodyHash(body) }),
        ...(sessionKey ? { [MCP_SESSION_KEY_HEADER]: sessionKey } : {}),
      },
      body,
    });
    let parsed: ServiceResponse<T>;
    try {
      parsed = (await res.json()) as ServiceResponse<T>;
    } catch {
      throw new McpServiceError(`xyne-claw-mcp returned HTTP ${res.status} without a JSON body`, "bad-response", res.status);
    }
    if (parsed.ok) return parsed.result;
    if (parsed.code === "launch-required") throw new LaunchRequiredError(sessionKey ?? "");
    throw new McpServiceError(parsed.error, parsed.code, res.status);
  }

  return {
    listTools: (ref) => withLazyLaunch(ref, (t) => post<ToolDescriptor[]>(MCP_SERVICE_PATHS.listTools, { session: t }, ref.key)),
    callTool: (ref, tool, args, meta) =>
      withLazyLaunch(ref, (t) =>
        post<McpCallResult>(MCP_SERVICE_PATHS.callTool, { session: t, tool, arguments: args, ...(meta ? { meta } : {}) }, ref.key),
      ),
    evict: async (req) => {
      // Errors go to onEvictError.
      await post(MCP_SERVICE_PATHS.evict, req).catch((err: unknown) => opts.onEvictError?.(err));
    },
    restart: async (serverType) => (await post<{ closed: number }>(MCP_SERVICE_PATHS.restart, serverType ? { serverType } : {})).closed,
  };
}
