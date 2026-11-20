/**
 * HTTP routes of the MCP service. Every route checks the caller's signed
 * assertion (auth.ts) and responds with a JSON `ServiceResponse`.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { errMsg } from "xyne-claw-mcp-common/errors";
import { createLogger } from "xyne-claw-shared";
import { AssertionVerifier, SERVICE_ASSERTION_HEADER } from "./auth.js";
import { checkLaunch, checkLaunchAddresses, policyFromEnv, type LaunchPolicy } from "xyne-claw-mcp-common/launch-policy";
import {
  poolCallTool,
  poolEvict,
  poolListTools,
  poolRestart,
  poolStats,
} from "./pool.js";
import {
  LaunchRequiredError,
  MCP_SERVICE_PATHS,
  type CallToolRequest,
  type EvictRequest,
  type ListToolsRequest,
  type RestartRequest,
  type ServiceResponse,
  type SessionTarget,
} from "xyne-claw-mcp-common/protocol";

const log = createLogger("mcp-service");

type RawRequest = Request & { rawBody?: Buffer; caller?: string };

function send<T>(res: Response, status: number, body: ServiceResponse<T>): void {
  res.status(status).json(body);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseTarget(v: unknown): SessionTarget | null {
  if (!isRecord(v)) return null;
  const { key, serverType, fingerprint, launch } = v;
  if (typeof key !== "string" || !key || typeof serverType !== "string" || !serverType) return null;
  if (typeof fingerprint !== "string") return null;
  if (launch === undefined) return { key, serverType, fingerprint };
  if (!isRecord(launch)) return null;
  if (launch["transport"] === "http" && typeof launch["url"] === "string" && isRecord(launch["headers"])) {
    return { key, serverType, fingerprint, launch: { transport: "http", url: launch["url"], headers: launch["headers"] as Record<string, string> } };
  }
  if (
    launch["transport"] === "stdio" &&
    typeof launch["cmd"] === "string" &&
    Array.isArray(launch["args"]) &&
    isRecord(launch["env"]) &&
    (launch["files"] === undefined || isRecord(launch["files"]))
  ) {
    const files = launch["files"] as Record<string, unknown> | undefined;
    if (files && Object.values(files).some((v) => typeof v !== "string")) return null;
    return {
      key,
      serverType,
      fingerprint,
      launch: {
        transport: "stdio",
        cmd: launch["cmd"],
        args: (launch["args"] as unknown[]).map(String),
        env: launch["env"] as Record<string, string>,
        ...(files ? { files: files as Record<string, string> } : {}),
      },
    };
  }
  return null;
}

function handleError(res: Response, err: unknown, label: string): void {
  if (err instanceof LaunchRequiredError) {
    send(res, 409, { ok: false, code: "launch-required", error: err.message });
    return;
  }
  log.warn(`[mcp-service] ${label} failed: ${errMsg(err)}`);
  send(res, 502, { ok: false, code: "tool-error", error: errMsg(err) });
}

/** Responds 403 when the launch spec fails the launch policy. */
async function launchRefused(res: Response, req: Request, target: SessionTarget, policy: LaunchPolicy): Promise<boolean> {
  if (!target.launch) return false;
  const reason = checkLaunch(target.launch, policy) ?? (await checkLaunchAddresses(target.launch, policy));
  if (!reason) return false;
  log.warn(`[mcp-service] refused launch for ${target.serverType} from ${(req as RawRequest).caller ?? "?"}: ${reason}`);
  send(res, 403, { ok: false, code: "launch-not-allowed", error: `launch not allowed: ${reason}` });
  return true;
}

export function createMcpServiceApp(verifier: AssertionVerifier, policy: LaunchPolicy = policyFromEnv()): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, ...poolStats() });
  });

  // Keeps the raw body for the body-hash check.
  app.use(
    express.json({
      limit: process.env["MCP_SERVICE_BODY_LIMIT"] ?? "25mb",
      verify: (req, _res, buf) => {
        (req as RawRequest).rawBody = Buffer.from(buf);
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const result = verifier.verify(req.headers[SERVICE_ASSERTION_HEADER], {
      method: req.method,
      path: req.path,
      body: (req as RawRequest).rawBody ?? Buffer.alloc(0),
    });
    if (typeof result === "string") {
      log.warn(`[mcp-service] rejected ${req.method} ${req.path} (${result})`);
      send(res, 401, { ok: false, code: "unauthorized", error: "Unauthorized" });
      return;
    }
    (req as RawRequest).caller = result.caller;
    next();
  });

  app.post(MCP_SERVICE_PATHS.listTools, async (req, res) => {
    const body = req.body as Partial<ListToolsRequest>;
    const target = parseTarget(body.session);
    if (!target) return send(res, 400, { ok: false, code: "bad-request", error: "invalid session" });
    if (await launchRefused(res, req, target, policy)) return;
    try {
      send(res, 200, { ok: true, result: await poolListTools(target) });
    } catch (err) {
      handleError(res, err, `list ${target.serverType}`);
    }
  });

  app.post(MCP_SERVICE_PATHS.callTool, async (req, res) => {
    const body = req.body as Partial<CallToolRequest>;
    const target = parseTarget(body.session);
    if (!target || typeof body.tool !== "string" || !body.tool || (body.arguments !== undefined && !isRecord(body.arguments))) {
      return send(res, 400, { ok: false, code: "bad-request", error: "invalid call" });
    }
    if (await launchRefused(res, req, target, policy)) return;
    try {
      const result = await poolCallTool(target, body.tool, body.arguments ?? {}, isRecord(body.meta) ? body.meta : undefined);
      send(res, 200, { ok: true, result });
    } catch (err) {
      handleError(res, err, `call ${target.serverType}/${body.tool}`);
    }
  });

  app.post(MCP_SERVICE_PATHS.evict, async (req, res) => {
    const body = req.body as EvictRequest;
    const scopedKeys = Array.isArray(body.scopedKeys) ? body.scopedKeys.filter((k): k is string => typeof k === "string" && !!k) : [];
    const prefixes = Array.isArray(body.prefixes) ? body.prefixes.filter((k): k is string => typeof k === "string" && !!k) : [];
    send(res, 200, { ok: true, result: { closed: await poolEvict({ scopedKeys, prefixes }) } });
  });

  app.post(MCP_SERVICE_PATHS.restart, async (req, res) => {
    const body = req.body as RestartRequest;
    const serverType = typeof body.serverType === "string" && body.serverType ? body.serverType : undefined;
    send(res, 200, { ok: true, result: { closed: await poolRestart(serverType) } });
  });

  return app;
}
