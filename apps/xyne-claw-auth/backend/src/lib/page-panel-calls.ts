import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { redisService } from "../redis.js";
import { errMsg } from "./errors.js";

const log = createLogger("page-panel-calls");

const PRESENCE_TTL_SECONDS = 5;
const QUEUE_TTL_SECONDS = 60;
const RESULT_TTL_SECONDS = 60;
const RESULT_POLL_MS = 250;
const MAX_ARG_CHARS = 4000;
const MAX_RUNS_PER_POLL = 5;
const OWNER_CACHE_MS = 60_000;
const PAGE_PANEL_TRIGGER_SOURCES = new Set(["chat"]);
const OPEN_URL_TOOL = "open-url";
const PANEL_OPEN_WAIT_MS = 8_000;

export const PAGE_PANEL_TOOLS = new Set([
  "page-read",
  "page-snapshot",
  "page-navigate",
  "page-click",
  "page-type",
  "page-press",
  "page-screenshot",
]);

const DEADLINES_MS: Record<string, number> = {
  "page-navigate": 18_000,
  "page-click": 12_000,
  "page-type": 12_000,
  "page-press": 12_000,
  "page-screenshot": 10_000,
};
const READ_DEADLINE_MS = 8_000;

export interface PagePanelResult {
  ok: boolean;
  content: string;
  image?: { data: string; mimeType: string };
  unavailable?: boolean;
}

export interface PagePanelCall {
  id: string;
  runId: string;
  toolName: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

const presenceKey = (runId: string) => `claw:page-panel:presence:${runId}`;
const queueKey = (runId: string) => `claw:page-panel:queue:${runId}`;
const callKey = (callId: string) => `claw:page-panel:call:${callId}`;
const resultKey = (callId: string) => `claw:page-panel:result:${callId}`;

export function isPagePanelTool(toolName: string): boolean {
  return PAGE_PANEL_TOOLS.has(toolName) || toolName === OPEN_URL_TOOL;
}

export function pagePanelAllowedForTrigger(triggerSource: string | null | undefined): boolean {
  return !!triggerSource && PAGE_PANEL_TRIGGER_SOURCES.has(triggerSource);
}

function unavailable(content: string): PagePanelResult {
  return { ok: false, content, unavailable: true };
}

interface RunOwner {
  userId: string;
  allowed: boolean;
  conversationId: string | null;
  orgId: string;
}

const ownerCache = new Map<string, RunOwner & { at: number }>();

async function runOwner(runId: string): Promise<RunOwner | null> {
  const cached = ownerCache.get(runId);
  if (cached && Date.now() - cached.at < OWNER_CACHE_MS) return cached;
  const run = await prisma.agentRun.findUnique({
    where: { sessionId: runId },
    select: { userId: true, triggerSource: true, conversationId: true, orgId: true },
  });
  if (!run) return null;
  const entry = {
    userId: run.userId,
    allowed: pagePanelAllowedForTrigger(run.triggerSource),
    conversationId: run.conversationId,
    orgId: run.orgId,
    at: Date.now(),
  };
  ownerCache.set(runId, entry);
  if (ownerCache.size > 5000) {
    const oldest = ownerCache.keys().next().value;
    if (oldest !== undefined) ownerCache.delete(oldest);
  }
  return entry;
}

function tooBig(args: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(args).length > MAX_ARG_CHARS;
  } catch {
    return true;
  }
}

export async function callPagePanelTool(input: {
  userId: string;
  sessionId: string | null | undefined;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<PagePanelResult> {
  const { userId, toolName, args } = input;
  const runId = input.sessionId?.trim() ?? "";
  if (!isPagePanelTool(toolName)) return { ok: false, content: `Unknown page tool: ${toolName}` };
  if (!runId) return unavailable("Browser panel tools need a run started from the Xyne AI screen.");
  if (tooBig(args)) return { ok: false, content: "Arguments are too large for a page tool." };

  const owner = await runOwner(runId);
  if (!owner || owner.userId !== userId || !owner.allowed) {
    return unavailable("Browser panel tools only work for runs started from the Xyne AI screen.");
  }

  const redis = redisService.getConnection();
  const presence = parsePresence(await redis.get(presenceKey(runId)).catch(() => null));
  if (presence?.userId !== userId) {
    return unavailable("The Xyne AI screen for this run is not open on the desktop app.");
  }
  if (toolName === OPEN_URL_TOOL) return openInPanel(owner, runId, args);

  const deadlineMs = DEADLINES_MS[toolName] ?? READ_DEADLINE_MS;
  const call: PagePanelCall = { id: randomUUID(), runId, toolName, args, expiresAt: Date.now() + deadlineMs };
  await redis.set(callKey(call.id), JSON.stringify({ userId, runId }), "EX", RESULT_TTL_SECONDS);
  await redis.rpush(queueKey(runId), JSON.stringify(call));
  await redis.expire(queueKey(runId), QUEUE_TTL_SECONDS);

  while (Date.now() < call.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, RESULT_POLL_MS));
    const raw = await redis.get(resultKey(call.id)).catch(() => null);
    if (!raw) continue;
    await redis.del(resultKey(call.id), callKey(call.id)).catch(() => undefined);
    try {
      const parsed = JSON.parse(raw) as PagePanelResult;
      log.info(`[page-panel] ${toolName} ok=${parsed.ok === true} run=${runId}`);
      return {
        ok: parsed.ok === true,
        content: typeof parsed.content === "string" ? parsed.content : "",
        ...(parsed.image ? { image: parsed.image } : {}),
      };
    } catch {
      return { ok: false, content: "The browser panel returned an unreadable result." };
    }
  }

  log.warn(`[page-panel] ${toolName} expired run=${runId}`);
  return { ok: false, content: `The browser panel did not answer ${toolName} in time.` };
}

function parsePresence(raw: string | null): { userId: string; panelOpen: boolean } | null {
  if (!raw) return null;
  const [userId, panel] = raw.split("|");
  return userId ? { userId, panelOpen: panel === "1" } : null;
}

async function openInPanel(owner: RunOwner, runId: string, args: Record<string, unknown>): Promise<PagePanelResult> {
  const raw = typeof args["url"] === "string" ? args["url"].trim() : "";
  if (!/^https?:\/\//i.test(raw)) return { ok: false, content: "Error: url must be an absolute http(s) URL." };
  if (!owner.conversationId) return unavailable("This run has no conversation to open the page in.");
  const { recordConversationArtifact, normalizeExternalUrl, detectLinkProvider } = await import("./conversation-artifacts.js");
  const normalized = normalizeExternalUrl(raw);
  if (!normalized) return { ok: false, content: "Error: url could not be parsed." };
  const title = typeof args["title"] === "string" && args["title"].trim() ? args["title"].trim() : new URL(raw).host;
  await recordConversationArtifact({
    conversationId: owner.conversationId,
    runId,
    kind: "PAGE",
    refService: "EXTERNAL",
    refId: normalized,
    url: raw,
    provider: detectLinkProvider(normalized),
    title,
    createdByUserId: owner.userId,
    orgId: owner.orgId,
  });
  log.info(`[page-panel] open-url run=${runId} host=${new URL(raw).host}`);

  const redis = redisService.getConnection();
  const until = Date.now() + PANEL_OPEN_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, RESULT_POLL_MS));
    const presence = parsePresence(await redis.get(presenceKey(runId)).catch(() => null));
    if (presence?.panelOpen) break;
  }
  return {
    ok: true,
    content:
      `Opened ${raw} in the user's browser panel on the right of the Xyne AI screen. ` +
      "Use page-snapshot, page-read, page-click and page-type to work with it.",
  };
}

export async function nextPagePanelCall(
  userId: string,
  runIds: ReadonlyArray<string>,
  panelOpen = true,
): Promise<PagePanelCall | null> {
  const redis = redisService.getConnection();
  for (const runId of runIds.slice(0, MAX_RUNS_PER_POLL)) {
    const owner = await runOwner(runId).catch(() => null);
    if (!owner || owner.userId !== userId || !owner.allowed) continue;
    await redis.set(presenceKey(runId), `${userId}|${panelOpen ? "1" : "0"}`, "EX", PRESENCE_TTL_SECONDS).catch(() => undefined);
    for (;;) {
      const raw = await redis.lpop(queueKey(runId)).catch(() => null);
      if (!raw) break;
      try {
        const call = JSON.parse(raw) as PagePanelCall;
        if (call.expiresAt > Date.now()) return call;
      } catch (err) {
        log.warn(`[page-panel] dropped unreadable call run=${runId}: ${errMsg(err)}`);
      }
    }
  }
  return null;
}

function readImage(value: unknown): { data: string; mimeType: string } | undefined {
  const image = value as { data?: unknown; mimeType?: unknown } | null | undefined;
  if (!image || typeof image.data !== "string" || !image.data || typeof image.mimeType !== "string") return undefined;
  if (!/^image\/(png|jpeg|webp)$/.test(image.mimeType) || image.data.length > 12 * 1024 * 1024) return undefined;
  return { data: image.data, mimeType: image.mimeType };
}

export async function resolvePagePanelCall(userId: string, callId: string, body: unknown): Promise<boolean> {
  const redis = redisService.getConnection();
  const raw = await redis.get(callKey(callId)).catch(() => null);
  if (!raw) return false;
  let owner: { userId?: string };
  try {
    owner = JSON.parse(raw) as { userId?: string };
  } catch {
    return false;
  }
  if (owner.userId !== userId) return false;
  const result = body as { ok?: unknown; content?: unknown; image?: unknown } | null;
  const image = readImage(result?.image);
  const payload: PagePanelResult = {
    ok: result?.ok === true,
    content: typeof result?.content === "string" ? result.content.slice(0, 200_000) : "",
    ...(image ? { image } : {}),
  };
  await redis.set(resultKey(callId), JSON.stringify(payload), "EX", RESULT_TTL_SECONDS);
  return true;
}
