/**
 * Xyne Claw client — remote agent dispatch.
 *
 * Deliberately separate from ./auth.ts. Spaces tools authenticate through the
 * desktop app's consent dialog on loopback; Claw uses a device-flow bearer token
 * stored at ~/.xyne/agent/claw.json — the same file the Xyne CLI and
 * xyne-claw-mcp use, so logging in through any one of them works in all three.
 *
 * The two auth systems share nothing, which is why a Spaces tool can work while
 * a Claw tool reports "not logged in", and vice versa.
 */

import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"

const DEFAULT_CLAW_BASE_URL = "https://spaces.xyne.juspay.net"
const API_PATH = "/claw/api/v1"

/** Statuses that mean a run has stopped moving — polling ends here. */
const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled", "canceled", "error"]

export interface ClawConfig {
  baseUrl: string
  token: string
  tokenPrefix?: string
  userId?: string
  email?: string
  createdAt?: string
}

export interface ClawAgent {
  slug: string
  name?: string
  description?: string
}

export interface ClawSession {
  sessionId: string
  agentSlug?: string
  status?: string
  title?: string
  createdAt?: string
}

export interface ClawRun {
  sessionId: string
  status: string
  result?: string
  error?: string
}

interface DeviceAuthStart {
  deviceCode: string
  userCode: string
  verifyUrl: string
  expiresIn: number
  interval: number
}

interface DeviceAuthToken {
  token: string
  userId?: string
  email?: string
}

export class ClawApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message)
    this.name = "ClawApiError"
  }
}

// ── Credential file (shared with the Xyne CLI) ───────────────────────

function getAgentDir(): string {
  const envDir = process.env.XYNE_AGENT_DIR
  if (envDir) {
    if (envDir === "~") return homedir()
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1)
    return envDir
  }
  return join(homedir(), ".xyne", "agent")
}

export function getClawConfigPath(): string {
  return join(getAgentDir(), "claw.json")
}

export function loadClawConfig(): ClawConfig | undefined {
  const path = getClawConfigPath()
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"))
    if (parsed && typeof parsed === "object" && typeof parsed.token === "string") {
      return parsed as ClawConfig
    }
    return undefined
  } catch {
    return undefined
  }
}

function saveClawConfig(config: ClawConfig): void {
  const dir = getAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getClawConfigPath(), JSON.stringify(config, null, 2) + "\n")
}

export function clearClawConfig(): boolean {
  const path = getClawConfigPath()
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

/**
 * A candidate base URL counts only if it is a real http(s) URL. This rejects an
 * unexpanded `${XYNE_CLAW_BASE_URL}` placeholder, which an MCP config can pass
 * through verbatim when the shell variable is not set.
 */
function isUsableBaseUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim())
}

export function resolveClawBaseUrl(): string {
  const candidates = [process.env.XYNE_CLAW_BASE_URL, loadClawConfig()?.baseUrl]
  const chosen = candidates.find(isUsableBaseUrl) ?? DEFAULT_CLAW_BASE_URL
  return chosen.replace(/\/+$/, "")
}

export function requireClawConfig(): ClawConfig {
  const config = loadClawConfig()
  if (!config) throw new ClawApiError("Not logged in to Claw. Run claw-login first.", 401)
  return config
}

// ── Response coercion ────────────────────────────────────────────────

function str(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function num(obj: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return fallback
}

/**
 * claw-auth wraps responses as `{ success, data: … }`. Unwrap the envelope
 * before looking for the list — without this, list calls silently return [].
 */
function coerceList(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === "object") {
    const data = (raw as Record<string, unknown>)["data"]
    if (Array.isArray(data)) return data
    if (data && typeof data === "object") {
      for (const key of keys) {
        const value = (data as Record<string, unknown>)[key]
        if (Array.isArray(value)) return value
      }
    }
    for (const key of keys) {
      const value = (raw as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value
    }
  }
  return []
}

// ── HTTP client ──────────────────────────────────────────────────────

export class ClawClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string
  ) {}

  private async request(
    method: string,
    path: string,
    opts: { auth?: boolean; body?: unknown } = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "xyne-spaces-mcp",
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json"
    if (opts.auth) {
      if (!this.token) throw new ClawApiError("Not logged in to Claw. Run claw-login first.", 401)
      headers["Authorization"] = `Bearer ${this.token}`
    }

    const url = `${this.baseUrl}${API_PATH}${path.startsWith("/") ? path : `/${path}`}`

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch (err) {
      throw new ClawApiError(
        `Could not reach Claw at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        0
      )
    }

    const text = await response.text()
    let parsed: unknown
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (!response.ok) {
      let message = `${method} ${path} failed with ${response.status}`
      if (parsed && typeof parsed === "object") {
        const fromBody = str(parsed as Record<string, unknown>, "error", "message")
        if (fromBody) message = fromBody
      }
      throw new ClawApiError(message, response.status, parsed)
    }
    return parsed
  }

  async startDeviceAuth(): Promise<DeviceAuthStart> {
    const raw = (await this.request("POST", "/cli/auth/start", {
      body: { clientId: "xyne-cli" },
    })) as Record<string, unknown>

    const deviceCode = str(raw, "deviceCode", "device_code")
    const userCode = str(raw, "userCode", "user_code")
    const verifyUrl = str(raw, "verifyUrl", "verification_uri", "verificationUri", "verify_url")
    if (!deviceCode || !userCode || !verifyUrl) {
      throw new ClawApiError("Malformed /cli/auth/start response.", 502, raw)
    }
    return {
      deviceCode,
      userCode,
      verifyUrl,
      expiresIn: num(raw, 600, "expiresIn", "expires_in"),
      interval: num(raw, 3, "interval"),
    }
  }

  /** Returns null while the user has not yet authorized. */
  async pollDeviceToken(deviceCode: string): Promise<DeviceAuthToken | null> {
    try {
      const raw = (await this.request("POST", "/cli/auth/token", {
        body: { deviceCode, clientId: "xyne-cli" },
      })) as Record<string, unknown>
      const token = str(raw, "token", "access_token")
      if (!token) return null
      return {
        token,
        userId: str(raw, "userId", "user_id"),
        email: str(raw, "email"),
      }
    } catch (err) {
      if (err instanceof ClawApiError) {
        const code = errorCode(err)
        if (err.status === 202 || code === "authorization_pending" || code === "slow_down") return null
      }
      throw err
    }
  }

  async listAgents(): Promise<ClawAgent[]> {
    const raw = await this.request("GET", "/agents", { auth: true })
    return coerceList(raw, "agents").map((item) => {
      const o = item as Record<string, unknown>
      return {
        slug: str(o, "slug", "agentSlug") ?? "",
        name: str(o, "name", "displayName"),
        description: str(o, "description"),
      }
    })
  }

  async listSessions(limit = 20): Promise<ClawSession[]> {
    const raw = await this.request("GET", `/runs/light?limit=${limit}`, { auth: true })
    return coerceList(raw, "runs", "sessions").map((item) => {
      const o = item as Record<string, unknown>
      return {
        sessionId: str(o, "sessionId", "session_id", "id") ?? "",
        agentSlug: str(o, "agentSlug", "agent_slug", "agent"),
        status: str(o, "status"),
        title: str(o, "title", "summary", "name"),
        createdAt: str(o, "createdAt", "created_at"),
      }
    })
  }

  /**
   * A conversationId is REQUIRED for the run to be persisted and pollable:
   * claw-auth only writes the AgentRun row that GET /runs/:id reads when one is
   * present. Generate it when the caller has none.
   */
  async createRun(input: {
    agentSlug: string
    task: string
    conversationId?: string
    channelId?: string
    deliverTo?: "dm"
  }): Promise<{ sessionId: string; conversationId: string }> {
    const conversationId = input.conversationId ?? `mcp-${randomUUID()}`
    const raw = (await this.request("POST", "/run", {
      auth: true,
      body: {
        agentSlug: input.agentSlug,
        task: input.task,
        triggerSource: "api",
        conversationId,
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.deliverTo ? { deliverTo: input.deliverTo } : {}),
      },
    })) as Record<string, unknown>

    const sessionId =
      str(raw, "sessionId", "session_id", "id") ??
      str((raw["data"] as Record<string, unknown>) ?? {}, "sessionId", "id")
    if (!sessionId) throw new ClawApiError("Malformed /run response (missing sessionId).", 502, raw)
    return { sessionId, conversationId }
  }

  async getRun(sessionId: string): Promise<ClawRun> {
    return (await this.getRunWithDetail(sessionId)).run
  }

  /** Full run row (tool calls, tokens, timing) alongside the summary. */
  async getRunWithDetail(
    sessionId: string
  ): Promise<{ run: ClawRun; detail: Record<string, unknown> }> {
    const envelope = (await this.request("GET", `/runs/${encodeURIComponent(sessionId)}`, {
      auth: true,
    })) as Record<string, unknown>

    // claw-auth wraps the run as { success, data: run } — unwrap it.
    const raw =
      (envelope?.["data"] && typeof envelope["data"] === "object"
        ? (envelope["data"] as Record<string, unknown>)
        : envelope) ?? {}

    return {
      run: {
        sessionId,
        status: str(raw, "status") ?? "unknown",
        result: str(raw, "result", "response", "output", "lastAssistantText"),
        error: str(raw, "error", "errorMessage"),
      },
      detail: raw,
    }
  }
}

function errorCode(err: ClawApiError): string {
  if (err.body && typeof err.body === "object") {
    return str(err.body as Record<string, unknown>, "error") ?? ""
  }
  return ""
}

// ── Flows ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Best-effort browser open. The server is a local subprocess, so this lands on the user's machine. */
function openBrowser(url: string): boolean {
  try {
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
    execFileSync(cmd, args, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export async function performClawLogin(
  baseUrl: string,
  timeoutSeconds: number | undefined,
  onProgress: (message: string) => Promise<void>
): Promise<{ config: ClawConfig; verifyUrl: string; userCode: string }> {
  const client = new ClawClient(baseUrl)
  const start = await client.startDeviceAuth()
  const opened = openBrowser(start.verifyUrl)

  await onProgress(
    `${opened ? "Opened your browser to authorize Xyne Claw." : "Open this URL to authorize Xyne Claw:"} ${start.verifyUrl}\n` +
      `Confirm this code and click Authorize: ${start.userCode}`
  )

  const maxSeconds =
    timeoutSeconds && timeoutSeconds > 0 ? Math.min(timeoutSeconds, start.expiresIn) : start.expiresIn
  const deadline = Date.now() + maxSeconds * 1000
  let intervalMs = Math.max(1, start.interval) * 1000
  let token: DeviceAuthToken | null = null

  while (Date.now() < deadline) {
    await sleep(intervalMs)
    try {
      token = await client.pollDeviceToken(start.deviceCode)
    } catch (err) {
      if (err instanceof ClawApiError && errorCode(err) === "slow_down") {
        intervalMs += 5000
        continue
      }
      throw err
    }
    if (token) break
  }
  if (!token) throw new ClawApiError("Login timed out. Run claw-login to try again.", 408)

  const config: ClawConfig = {
    baseUrl,
    token: token.token,
    tokenPrefix: token.token.slice(0, 12),
    userId: token.userId,
    email: token.email,
    createdAt: new Date().toISOString(),
  }
  saveClawConfig(config)
  return { config, verifyUrl: start.verifyUrl, userCode: start.userCode }
}

/**
 * Dispatch a run and poll to completion with backoff.
 *
 * A 404 before the first successful read is expected — the run row is written
 * shortly after /run returns — so it is retried rather than surfaced.
 */
export async function runAndWait(
  client: ClawClient,
  agentSlug: string,
  task: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onTick: (sessionId: string) => Promise<void>,
  channelId?: string,
  deliverTo?: "dm"
): Promise<ClawRun> {
  const { sessionId } = await client.createRun({ agentSlug, task, channelId, deliverTo })
  const deadline = Date.now() + timeoutMs
  let pollMs = 2000
  let sawRun = false

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ClawApiError("Cancelled.", 0)
    await sleep(pollMs)
    await onTick(sessionId)
    try {
      const run = await client.getRun(sessionId)
      sawRun = true
      if (TERMINAL_RUN_STATUSES.includes(run.status.toLowerCase())) return run
    } catch (err) {
      if (err instanceof ClawApiError && err.status === 404 && !sawRun) {
        pollMs = Math.min(Math.floor(pollMs * 1.5), 10_000)
        continue
      }
      throw err
    }
    pollMs = Math.min(Math.floor(pollMs * 1.5), 10_000)
  }

  throw new ClawApiError(
    `Timed out waiting for run ${sessionId}. It may still be running — check with claw-get-run.`,
    408
  )
}

// ── Formatting ───────────────────────────────────────────────────────

export function formatAgents(agents: ClawAgent[]): string {
  if (agents.length === 0) return "No Claw agents available to this account."
  const lines = agents.map(
    (a) => `- ${a.slug}${a.name ? ` (${a.name})` : ""}${a.description ? `: ${a.description}` : ""}`
  )
  return (
    `Claw agents (${agents.length}):\n${lines.join("\n")}\n\n` +
    `Dispatch one with claw-run-agent using the slug (the value before the parenthesis).`
  )
}

export function formatSessions(sessions: ClawSession[]): string {
  if (sessions.length === 0) return "No Claw sessions found."
  const lines = sessions.map(
    (s) =>
      `- ${s.sessionId}${s.agentSlug ? ` [${s.agentSlug}]` : ""}${s.status ? ` ${s.status}` : ""}` +
      `${s.title ? ` - ${s.title}` : ""}`
  )
  return `Claw sessions (${sessions.length}):\n${lines.join("\n")}`
}

export function clawErrorMessage(err: unknown): string {
  if (err instanceof ClawApiError && err.status === 401) {
    return "Not authorized for Claw. Run claw-login first (your session may have expired)."
  }
  return err instanceof Error ? err.message : String(err)
}
