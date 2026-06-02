import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Router, type Response } from "express";
import { runTask, pushAttachment, applyCopilotProxyIfNeeded, RunCancelledError, QuotaExhaustedError, isQuotaExhaustedError, type ImageContent } from "../agent.js";
import { SessionLockedError } from "../session-lock.js";
import { validateS2SKey } from "../middleware/auth.js";
import { loadMcpToolsForUser } from "../mcp.js";
import { loadCustomTools } from "../custom-tools.js";
import { buildCopilotTool } from "../copilot.js";
import { buildSubagentTools, loadDeepwikiTools, loadContext7Tools, loadPlaywrightTools, type SkillTrigger } from "../subagent-tools.js";
import { parseToolsConfig, COPILOT_SYSTEM_INSTRUCTION } from "xyne-claw-shared";
import { SERVER, PATHS, LITELLM } from "../config.js";
import { judgeChainContinuation } from "../chain-judge.js";
import { listSubsystemTaxonomy } from "../memory.js";
import { buildMemorySearchTool } from "../memory-search.js";
import { createWorkspace, deleteWorkspace, ensureRepoWorktree, deleteRepoWorktree, writeWorkspaceTextFiles, writeWorkspaceBinaryFiles } from "../workspace.js";
import { takeLlmCitations } from "xyne-claw-shared";
import { isXlsxAttachment, xlsxBufferToMarkdown } from "../xlsx-attachment.js";
import { isPdfAttachment, pdfBufferToMarkdown } from "../pdf-attachment.js";
import { isVideoAttachment, videoBufferToContext, type VideoKeyframe } from "../video-attachment.js";
import { isDocxAttachment, docxBufferToMarkdown } from "../docx-attachment.js";
import { isPptxAttachment, pptxBufferToMarkdown } from "../pptx-attachment.js";
import { isHtmlAttachment, htmlBufferToMarkdown } from "../html-attachment.js";
import { isZipAttachment, zipBufferToContextFiles } from "../zip-attachment.js";
import {
  TEXT_ATTACHMENT_MIME_TYPES as _TEXT_ATTACHMENT_MIME_TYPES,
  TEXT_ATTACHMENT_EXTENSIONS as _TEXT_ATTACHMENT_EXTENSIONS,
  isTextAttachment as _isTextAttachment,
  normalizeAttachmentBase64 as _normalizeAttachmentBase64,
} from "../attachment-write.js";

const router = Router();

interface ActiveRunControl {
  abortController: AbortController;
}

const activeRuns = new Map<string, ActiveRunControl>();

// Allowlists + helpers moved to `attachment-write.ts` so the webhook flow and
// the `spaces-fetch-attachment` marker decoder (xyne-claw/src/mcp.ts) share
// one definition. Re-exported as locals so the existing call sites below
// (text-filter, decode, xlsx/pdf detection) keep working without churn.
const TEXT_ATTACHMENT_MIME_TYPES = _TEXT_ATTACHMENT_MIME_TYPES;
const TEXT_ATTACHMENT_EXTENSIONS = _TEXT_ATTACHMENT_EXTENSIONS;

// Appended to the agent's systemPrompt at runTime when channelId is present
// (i.e. the agent is replying in a Spaces chat thread). Lives in the system
// role — pi-coding-agent treats it as background context, not a user message,
// so the model accepts it silently instead of replying "Noted — will use the
// inline span format" every turn (which is what happened when this lived in
// the per-turn promptInjections path).
// Common instruction appended to ALL agent system prompts (not just chat replies).
// Lives in the system role so the model accepts it silently.
const CITATION_GUIDE = `

## Citation System

You have access to the \`add-citations\` tool which lets you attach citations to key points in your responses.

**When to cite:**
- When you make factual claims backed by tool results
- When summarizing information retrieved from searches, databases, or APIs

**When NOT to cite:**
- Do NOT cite every tool result — only cite sources that directly support a specific claim
- Do NOT cite general conversational statements

**How to cite:**
1. Make your factual claim in the response
2. Call \`add-citations\` ONCE at the end of your response with all cited keypoints
3. Each keypoint should be 1-2 sentences max

**Citation format:**
- \`label\`: Human-readable header in 1-2 words
- \`kind\`: One of "thread", "canvas", "ticket", "external"
- Include relevant IDs/names based on kind

Examples:

**Thread citation** (when citing messages from a channel):
\`\`\`json
{
  "keypoints": [
    {
      "point": "Alice reported the outage at 14:30 UTC",
      "citation": {
        "label": "incident-response",
        "kind": "thread",
        "channelId": "ch_abc123",
        "conversationId": "conv_xyz789"
      }
    }
  ]
}
\`\`\`

**Ticket citation** (when citing a ticket — include channelId + conversationId to make it a clickable link):
\`\`\`json
{
  "keypoints": [
    {
      "point": "Bug SAM-1234 is marked as P1 and assigned to Bob",
      "citation": {
        "label": "P1 Bug",
        "kind": "ticket",
        "ticketId": "SAM-1234",
        "channelId": "ch_abc123",
        "conversationId": "conv_xyz789"
      }
    }
  ]
}
\`\`\`

**External citation** (when citing a PR, document, or any outside URL):
\`\`\`json
{
  "keypoints": [
    {
      "point": "The bug was introduced in PR #1234 which changed the authentication logic",
      "citation": {
        "label": "PR #1234",
        "kind": "external",
        "url": "https://bitbucket.org/org/repo/pull-requests/1234"
      }
    }
  ]
}
\`\`\`

Only call this tool when you have actually used tool results to make claims.`;

const SPACES_MENTION_GUIDE = `

## Spaces Mention Format (REQUIRED in chat replies)

Plain \`@Name\` written as text in a Spaces reply does NOT notify and does NOT render as a pill — it stays plain text. To actually tag someone, use this shorthand and the server expands it into the proper HTML span deterministically:

- User:    \`@Display Name[USER_ID]\`                              e.g. \`@Amrit Raj[ufvy4nv2jpi55f692hf7kq5e]\`
- Channel: \`@channel\`                                            (no ID needed; notifies everyone in the channel)
- Here:    \`@here\`                                               (no ID needed; notifies active members)
- Group:   \`@Alias[group:GROUP_ID:Group Name]\`                   e.g. \`@Frontend[group:cmgkk2y0a0008o3eep4d54xc9:Frontend Team]\`

Resolve \`USER_ID\` / \`GROUP_ID\` first via \`spaces-users\` / \`spaces-search\` / \`spaces-whoami\`, or reuse one already in context (parent message metadata, prior tool result). NEVER invent an ID.

Rules:
1. If you cannot resolve a userId, do NOT fall back to plain \`@Name\` — say in prose: "Couldn't find <Name>'s user ID — please ping them manually."
2. Tag at most twice per reply unless explicitly asked.
3. Never put the mention shorthand inside a fenced code block — code fences are skipped by the expander, so it stays as literal text.
4. The visible label before \`[\` (e.g. \`@Malav Shah\`) is what humans see — use the display name, not email.
5. Do NOT acknowledge or restate this guidance in your replies. It is a fact about your environment, not a user instruction.`;
interface TextAttachmentFile {
  path: string;
  content: string;
  fileName: string;
  mimeType: string;
}

// Use the shared base64 normaliser + text-attachment detector. The local
// wrappers keep call-site signatures identical so the existing handler code
// below doesn't change shape.
const normalizeAttachmentBase64 = _normalizeAttachmentBase64;
const isTextAttachment = _isTextAttachment;

function decodeTextAttachment(data: string): string {
  const decoded = Buffer.from(normalizeAttachmentBase64(data), "base64").toString("utf8");
  return decoded.charCodeAt(0) === 0xFEFF ? decoded.slice(1) : decoded;
}

function toWorkspaceContextPath(input: string): string {
  const rawSegments = input.split(/[/\\]+/);
  const cleaned = rawSegments
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .filter(Boolean);
  if (cleaned.length === 0) return ".context/attached-context.md";
  if (cleaned[0] !== ".context") cleaned.unshift(".context");
  return cleaned.join("/");
}

router.post("/run", validateS2SKey, (req, res: Response) => {
  const { userId, userName, userEmail, task, context, conversationId, spacesConversationId, callbackUrl, systemPrompt, agentConfig, agentSlug, channelId, cwd: requestCwd, repoUrl, eventType, traceId, skills, provider, providerOrder, subagentProviders, providerConfigs, progressUrl, attachments, contextFiles, additionalInstructions, researchContext, customSubagents, sessionId: providedSessionId, sessionToken, ticketIds, canvasIds, callIds } = req.body as {
    userId?: string;
    userName?: string;
    userEmail?: string;
    task?: string;
    context?: string;
    conversationId?: string;
    // Optional upstream-provided Spaces thread/conversation ID used by the
    // add-citations metadata block at L733. Surfaced to the agent's system
    // metadata so it can construct thread-link citations even when the
    // agent session's own conversationId is a synthetic one (e.g. scheduled
    // job IDs). Caller-side wiring: webhook.ts / agent-chat.ts forward this
    // field when they have a Spaces conversation context.
    spacesConversationId?: string;
    callbackUrl?: string;
    systemPrompt?: string;
    agentConfig?: Record<string, unknown>;
    agentSlug?: string;
    channelId?: string;
    cwd?: string;
    repoUrl?: string;
    eventType?: string;
    traceId?: string;
    skills?: { slug?: string; name: string; description?: string; content: string }[];
    provider?: string;
    // Ordered fallback chain set by the agent owner via the Provider tab.
    // First entry is the primary parent; subsequent entries are walked on
    // quota exhaustion before dropping to "spaces" (LiteLLM/Kimi).
    providerOrder?: string[];
    subagentProviders?: Record<string, string>;
    providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string }>;
    progressUrl?: string;
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
    contextFiles?: Array<{ path: string; content: string }>;
    additionalInstructions?: string;
    researchContext?: { type: string; id?: string; name: string; repositoryId?: string; productId?: string };
    customSubagents?: import("../subagent-tools.js").CustomSubagentSpec[];
    // claw-auth-issued per-run identifiers. sessionId is the URL-bound run id;
    // sessionToken is an HMAC bearer used on every outbound /sessions/:sessionId/mcp/*
    // call back to claw-auth. Both REQUIRED in production — required check below.
    sessionId?: string;
    sessionToken?: string;
    ticketIds?: string[];
    canvasIds?: string[];
    callIds?: string[];
  };

  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    res.status(400).json({ success: false, error: "userId is required" });
    return;
  }

  if (!task || typeof task !== "string" || task.trim().length === 0) {
    res.status(400).json({ success: false, error: "task is required and must be a non-empty string" });
    return;
  }

  if (!providedSessionId || typeof providedSessionId !== "string" || providedSessionId.trim().length === 0) {
    res.status(400).json({ success: false, error: "sessionId is required (must be minted by claw-auth)" });
    return;
  }
  if (!sessionToken || typeof sessionToken !== "string" || sessionToken.trim().length === 0) {
    res.status(400).json({ success: false, error: "sessionToken is required (must be minted by claw-auth)" });
    return;
  }

  const sessionId = providedSessionId.trim();

  // Return sessionId immediately
  res.json({ success: true, sessionId });

  console.log(`[skill-debug] /run received: sessionId=${sessionId} agentSlug=${agentSlug ?? "(none)"} skills.length=${skills?.length ?? 0}`);
  if (skills && skills.length > 0) {
    console.log(`[skill-debug] /run skill names: ${JSON.stringify(skills.map((s) => s.name))}`);
  }

  const abortController = new AbortController();
  activeRuns.set(sessionId, { abortController });

  // Process in background
  processTask(sessionId, sessionToken.trim(), userId.trim(), task.trim(), context, userName, userEmail, conversationId, spacesConversationId, callbackUrl, systemPrompt, agentConfig, agentSlug, channelId, requestCwd, repoUrl, eventType, traceId, skills, provider, providerOrder, subagentProviders, providerConfigs, progressUrl, attachments, contextFiles, additionalInstructions, researchContext, customSubagents, ticketIds, canvasIds, callIds, abortController.signal, () => abortController.abort())
    .finally(() => {
      activeRuns.delete(sessionId);
    });
});

router.post("/run/:sessionId/cancel", validateS2SKey, (req, res: Response) => {
  const { sessionId } = req.params as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const active = activeRuns.get(sessionId);
  if (!active) {
    res.json({ success: true, sessionId, status: "not_running" });
    return;
  }

  active.abortController.abort();
  res.json({ success: true, sessionId, status: "cancelled" });
});

async function processTask(
  sessionId: string,
  sessionToken: string,
  userId: string,
  task: string,
  context: string | undefined,
  userName: string | undefined,
  userEmail: string | undefined,
  conversationId: string | undefined,
  spacesConversationId: string | undefined,
  callbackUrl: string | undefined,
  systemPrompt: string | undefined,
  agentConfig: Record<string, unknown> | undefined,
  agentSlug: string | undefined,
  channelId: string | undefined,
  requestCwd: string | undefined,
  repoUrl: string | undefined,
  eventType: string | undefined,
  traceId: string | undefined,
  skills: { slug?: string; name: string; description?: string; content: string }[] | undefined,
  provider: string | undefined,
  providerOrder: string[] | undefined,
  subagentProviders: Record<string, string> | undefined,
  providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string }> | undefined,
  progressUrl: string | undefined,
  attachments: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
  contextFiles: Array<{ path: string; content: string }> | undefined,
  additionalInstructions: string | undefined,
  researchContext: { type: string; id?: string; name: string; repositoryId?: string; productId?: string } | undefined,
  customSubagents: import("../subagent-tools.js").CustomSubagentSpec[] | undefined,
  ticketIds: string[] | undefined,
  canvasIds: string[] | undefined,
  callIds: string[] | undefined,
  abortSignal?: AbortSignal,
  abortRun?: () => void,
): Promise<void> {
  let mcpCleanup: (() => Promise<void>) | undefined;
  let repoCwd: string | undefined;
  const tid = traceId ?? sessionId.slice(0, 8);
  const log = (msg: string) => console.log(`[run] [${tid}] ${msg}`);
  const logErr = (msg: string, err?: unknown) => console.error(`[run] [${tid}] ${msg}`, err ?? "");

  // Hoisted so the catch handler can recover pendingResponses when
  // respond-to-user fires the abort (graceful copilot termination).
  let customToolsResult: ReturnType<typeof loadCustomTools> | undefined;

  try {
    log(`Session ${sessionId}: starting for user ${userId}, progressUrl=${progressUrl ?? "none"}`);

    // Set up repo worktree if repoUrl provided.
    // Retry up to 3 times with backoff — git fetch/clone can fail transiently
    // under contention or with flaky bitbucket. Without retry, a single failed
    // attempt drops the agent into a tool-less workspace and the LLM gives up
    // (we hit this on session 333b813a in prod — empty result, 7 wasted tokens).
    if (repoUrl && !requestCwd) {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          repoCwd = await ensureRepoWorktree(repoUrl, sessionId, agentSlug);
          log(`Repo worktree ready at ${repoCwd}`);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < maxAttempts) {
            const delayMs = 2000 * attempt; // 2s, 4s
            logErr(`Worktree setup attempt ${attempt}/${maxAttempts} failed (${msg}); retrying in ${delayMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            logErr(`Worktree setup failed after ${maxAttempts} attempts:`, err);
          }
        }
      }
    }

    const imageAttachments = attachments?.filter((a) => a.mimeType.startsWith("image/")) ?? [];
    const textAttachments = attachments
      ?.filter((a) => isTextAttachment(a.fileName, a.mimeType))
      .map<TextAttachmentFile>((a) => ({
        path: a.fileName,
        content: decodeTextAttachment(a.data),
        fileName: a.fileName,
        mimeType: a.mimeType,
      })) ?? [];

    // Xlsx is parsed server-side into a multi-sheet markdown blob and then
    // flows through the same .context/ workspace-file path as csv/md/txt.
    // Async because exceljs.load is async; runs in parallel with the rest of
    // the setup below.
    const xlsxAttachments = attachments?.filter((a) => isXlsxAttachment(a.fileName, a.mimeType)) ?? [];
    const xlsxDerivedFiles = await Promise.all(
      xlsxAttachments.map(async (a) => {
        const buf = Buffer.from(normalizeAttachmentBase64(a.data), "base64");
        const md = await xlsxBufferToMarkdown(buf, a.fileName);
        return { path: `${a.fileName}.md`, content: md };
      }),
    );

    // PDF: same pattern as xlsx — server-side text extraction via unpdf,
    // result lands as a markdown sibling at `.context/<name>.pdf.md` so the
    // agent reads it through its normal file-read tool.
    //
    // We ALSO keep the raw PDF bytes at `.context/<name>` (no .md suffix) so
    // tools like fill-pdf-form / inspect-pdf-form can read the actual PDF
    // off disk. Without this, user-uploaded templates can't be filled —
    // unpdf-extraction destroys the AcroForm field structure.
    const pdfAttachments = attachments?.filter((a) => isPdfAttachment(a.fileName, a.mimeType)) ?? [];
    const pdfBuffersByName: Array<{ fileName: string; buf: Buffer }> = [];
    const pdfDerivedFiles = await Promise.all(
      pdfAttachments.map(async (a) => {
        const buf = Buffer.from(normalizeAttachmentBase64(a.data), "base64");
        pdfBuffersByName.push({ fileName: a.fileName, buf });
        const md = await pdfBufferToMarkdown(buf, a.fileName);
        return { path: `${a.fileName}.md`, content: md };
      }),
    );

    // Video: deterministic ingest-time preprocessing. ffmpeg extracts
    // scene-change frames, a rolling-state vision loop builds a textual
    // narrative (carried forward as text, not images, so long clips stay
    // bounded), and we surface BOTH the narrative (as a `.context/` file)
    // AND a spread of keyframes (injected into the opening prompt below).
    // Done HERE, before the agent loop, so the agent never spends its turn
    // running ffmpeg itself. Models can't ingest video — only frames.
    const videoAttachments = attachments?.filter((a) => isVideoAttachment(a.fileName, a.mimeType)) ?? [];
    const videoKeyframes: VideoKeyframe[] = [];
    const videoDerivedFiles = await Promise.all(
      videoAttachments.map(async (a) => {
        const buf = Buffer.from(normalizeAttachmentBase64(a.data), "base64");
        const { narrative, keyframes } = await videoBufferToContext(buf, a.fileName);
        videoKeyframes.push(...keyframes);
        return { path: `${a.fileName}.video.md`, content: narrative };
      }),
    );
    if (videoAttachments.length > 0) {
      log(`Video ingest: ${videoAttachments.length} video(s) → ${videoKeyframes.length} keyframe(s) + narrative(s)`);
    }

    // DOCX — mammoth → markdown, written to `.context/<name>.docx.md`.
    const docxAttachments = attachments?.filter((a) => isDocxAttachment(a.fileName, a.mimeType)) ?? [];
    const docxDerivedFiles = await Promise.all(
      docxAttachments.map(async (a) => {
        const buf = Buffer.from(normalizeAttachmentBase64(a.data), "base64");
        const md = await docxBufferToMarkdown(buf, a.fileName);
        return { path: `${a.fileName}.md`, content: md };
      }),
    );

    // PPTX — JSZip → per-slide markdown, written to `.context/<name>.pptx.md`.
    const pptxAttachments = attachments?.filter((a) => isPptxAttachment(a.fileName, a.mimeType)) ?? [];
    const pptxDerivedFiles = await Promise.all(
      pptxAttachments.map(async (a) => {
        const buf = Buffer.from(normalizeAttachmentBase64(a.data), "base64");
        const md = await pptxBufferToMarkdown(buf, a.fileName);
        return { path: `${a.fileName}.md`, content: md };
      }),
    );

    // HTML — raw markup written to `.context/<name>.html` (capped at 200KB).
    // Models read tags inline; no DOM stripping needed.
    const htmlAttachments = attachments?.filter((a) => isHtmlAttachment(a.fileName, a.mimeType)) ?? [];
    const htmlDerivedFiles = await Promise.all(
      htmlAttachments.map(async (a) => {
        const buf = Buffer.from(normalizeAttachmentBase64(a.data), "base64");
        const md = await htmlBufferToMarkdown(buf, a.fileName);
        return { path: a.fileName, content: md };
      }),
    );

    // ZIP — unzip, dispatch each entry through the same per-type pipeline,
    // namespace outputs under the archive name. Nested .zip entries are NOT
    // recursed (they show up in the manifest as skipped-nested-zip). Hard
    // caps: 200 entries, 50 MB/entry, 200 MB total — see zip-attachment.ts.
    const zipAttachments = attachments?.filter((a) => isZipAttachment(a.fileName, a.mimeType)) ?? [];
    const zipDerivedFiles: Array<{ path: string; content: string }> = [];
    for (const a of zipAttachments) {
      const buf = Buffer.from(normalizeAttachmentBase64(a.data), "base64");
      const { files: entries, manifest } = await zipBufferToContextFiles(buf, a.fileName);
      const extractedCount = manifest.filter((m) => m.status === "extracted").length;
      const skippedCount = manifest.length - extractedCount;
      log(`Zip ingest: ${a.fileName} → extracted=${extractedCount} skipped=${skippedCount}`);
      for (const e of entries) {
        zipDerivedFiles.push({ path: `${a.fileName}/${e.path}`, content: e.content });
      }
    }

    const derivedContextFiles = [
      ...textAttachments.map(({ path, content }) => ({ path, content })),
      ...xlsxDerivedFiles,
      ...pdfDerivedFiles,
      ...videoDerivedFiles,
      ...docxDerivedFiles,
      ...pptxDerivedFiles,
      ...htmlDerivedFiles,
      ...zipDerivedFiles,
    ];
    const mergedContextFiles = [...(contextFiles ?? []), ...derivedContextFiles];

    // Use provided cwd, repo workspace, or create an ephemeral workspace
    const workspaceDir = requestCwd ?? repoCwd ?? await createWorkspace(sessionId);
    if (mergedContextFiles.length > 0) {
      const written = await writeWorkspaceTextFiles(workspaceDir, mergedContextFiles);
      log(`Attached context files written: ${written.length}`);
    }
    // Drop the raw PDF bytes next to the extracted markdown — keeps
    // fill-pdf-form / inspect-pdf-form able to open the actual PDF off disk.
    // Path mirrors the markdown: `.context/<originalFileName>` (no extra suffix).
    if (pdfBuffersByName.length > 0) {
      const writtenBin = await writeWorkspaceBinaryFiles(
        workspaceDir,
        pdfBuffersByName.map((p) => ({ path: p.fileName, data: p.buf })),
      );
      log(`Raw PDF originals kept: ${writtenBin.length}`);
    }

    const toolPermissions = (agentConfig?.["toolPermissions"] as Record<string, string> | undefined) ?? {};
    const { groups: mcpGroups, cleanup, getPendingActions } = await loadMcpToolsForUser(sessionId, sessionToken, workspaceDir, toolPermissions, agentSlug);
    mcpCleanup = cleanup;

    const meta: Record<string, string> = { userId };
    if (userName) meta["userName"] = userName;
    if (userEmail) meta["userEmail"] = userEmail;
    if (agentSlug) meta["agentSlug"] = agentSlug;
    if (channelId) meta["channelId"] = channelId;
    if (conversationId) meta["conversationId"] = conversationId;

    // For google-agent: fetch the user's Google OAuth token from xyne-claw-auth
    const effectiveConfig = { ...(agentConfig ?? {}) };
    // Parent agent's provider config — looked up from user's provider credentials.
    // We also reuse it to drive custom:create-ppt so PPT generation uses the
    // same user credential/model instead of shared env keys.
    const parentProviderConfig = (provider === "copilot" || provider === "claude" || provider === "codex")
      ? providerConfigs?.[provider]
      : undefined;

    if (provider && parentProviderConfig?.apiKey) {
      const resolvedForPpt = provider === "copilot"
        ? await applyCopilotProxyIfNeeded(provider, parentProviderConfig)
        : parentProviderConfig;
      const pptBaseUrl = resolvedForPpt?.baseUrl
        ?? (provider === "claude" ? "https://api.anthropic.com" : "https://api.openai.com/v1");
      effectiveConfig["PPT_PROVIDER"] = provider;
      effectiveConfig["PPT_BASE_URL"] = pptBaseUrl;
      effectiveConfig["PPT_API_KEY"] = resolvedForPpt?.apiKey ?? parentProviderConfig.apiKey;
      effectiveConfig["PPT_MODEL"] = resolvedForPpt?.model ?? parentProviderConfig.model;
      if (provider === "claude") {
        effectiveConfig["PPT_AUTH_TYPE"] = resolvedForPpt?.authType ?? parentProviderConfig.authType ?? "api_key";
      }
      log(`PPT tool configured from user provider=${provider} model=${effectiveConfig["PPT_MODEL"] as string}`);
    }

    // Inject Google OAuth token whenever the agent has any google-* custom tool
    // selected (or for the legacy google-agent slug). This lets any agent with
    // google tools attached actually call them — not just the built-in google-agent.
    const preToolsConfig = parseToolsConfig(effectiveConfig);
    const wantsGoogle = agentSlug === "google-agent"
      || (preToolsConfig?.custom ?? []).some((s) => s.startsWith("google-"));
    const wantsMicrosoft = agentSlug === "microsoft-agent"
      || (preToolsConfig?.custom ?? []).some((s) => s.startsWith("microsoft-"));

    if (wantsGoogle && SERVER.authServiceUrl) {
      try {
        const tokenRes = await fetch(`${SERVER.authServiceUrl}/claw/api/v1/users/${userId}/oauth/google/token`, {
          headers: SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {},
        });
        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as { success: boolean; data?: { accessToken: string } };
          if (tokenData.success && tokenData.data?.accessToken) {
            effectiveConfig["GOOGLE_ACCESS_TOKEN"] = tokenData.data.accessToken;
            log("Google OAuth token injected");
          } else {
            log("Google token fetch failed — no token returned");
          }
        } else {
          log(`Google token fetch failed — HTTP ${tokenRes.status}`);
        }
      } catch (err) {
        logErr("Google token fetch error:", err);
      }
    }

    // For microsoft-agent (or any agent with microsoft-* tools): fetch token
    if (wantsMicrosoft && SERVER.authServiceUrl) {
      try {
        const tokenRes = await fetch(`${SERVER.authServiceUrl}/claw/api/v1/users/${userId}/oauth/microsoft/token`, {
          headers: SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {},
        });
        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as { success: boolean; data?: { accessToken: string } };
          if (tokenData.success && tokenData.data?.accessToken) {
            effectiveConfig["MICROSOFT_ACCESS_TOKEN"] = tokenData.data.accessToken;
            log("Microsoft OAuth token injected");
          } else {
            log("Microsoft token fetch failed — no token returned");
          }
        } else {
          log(`Microsoft token fetch failed — HTTP ${tokenRes.status}`);
        }
      } catch (err) {
        logErr("Microsoft token fetch error:", err);
      }
    }

    customToolsResult = loadCustomTools(
      effectiveConfig,
      meta,
      (att) => pushAttachment(progressUrl, sessionId, att),
      researchContext,
      progressUrl,
      sessionId,
      SERVER.s2sKey,
      sessionToken,
    );
    const { tools: customToolDefs, getAttachments, getPendingQuestions, getPendingActions: getCustomPendingActions, getPendingResponses } = customToolsResult;

    // Load deepwiki/context7/playwright MCP tool groups (stdio transport, cached).
    // Playwright doesn't get its own subagent — its tools are spliced into the
    // sandbox subagent's palette via bonusToolsBySubagent below.
    const [deepwikiGroup, context7Group, playwrightGroup] = await Promise.all([
      loadDeepwikiTools(),
      loadContext7Tools(),
      loadPlaywrightTools(),
    ]);

    // Extract skill triggers from agent config (needed by both subagent tools and runTask)
    const rawTriggers = (agentConfig?.["skillTriggers"] as Array<{ toolName: string; skillSlug: string; when: string; prompt?: string }>) ?? [];
    const resolvedTriggers = rawTriggers
      .filter((t) => t.toolName && t.skillSlug)
      .map((t) => {
        const skill = skills?.find((s) => s.name === t.skillSlug);
        return skill ? { toolName: t.toolName, skillSlug: t.skillSlug, skillContent: skill.content, when: t.when as "before" | "after", prompt: t.prompt } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    // Extract prompt injections (per-turn system reminders)
    const rawInjections = (agentConfig?.["promptInjections"] as Array<{ id: string; label: string; content: string; enabled: boolean }>) ?? [];
    const activeInjections = rawInjections
      .filter((p) => p.enabled && typeof p.content === "string" && p.content.trim().length > 0)
      .map((p) => ({ id: p.id, label: p.label || "Reminder", content: p.content }));

    // Memory — opt-in per agent via agentConfig.memoryEnabled=true.
    // No more inject-all-recalled-facts. Instead: inject a tiny taxonomy hint
    // and let the agent search on demand via the memory-search tool.
    //
    // The Digital Twin (slug=digital-twin) is per-user: scope the taxonomy
    // to memories tagged `user:<userId>` so the injected hint doesn't leak
    // other users' subsystem counts. Other memory-enabled agents see the
    // full shared taxonomy.
    const memoryEnabled = agentConfig?.["memoryEnabled"] === true || agentConfig?.["memoryEnabled"] === "true";
    if (agentSlug && memoryEnabled) {
      const isDigitalTwin = agentSlug === "digital-twin";
      const taxonomy = await listSubsystemTaxonomy(
        agentSlug,
        isDigitalTwin ? { userTag: `user:${userId}` } : undefined,
      ).catch(() => []);
      if (taxonomy.length > 0) {
        const lines = taxonomy
          .slice(0, 12)
          .map((s) => `- ${s.name} (${s.memoryCount} ${s.memoryCount === 1 ? "memory" : "memories"})`)
          .join("\n");
        activeInjections.push({
          id: "__memory-taxonomy",
          label: isDigitalTwin ? "Your Personal Memory" : "Shared Knowledge Bank",
          content: isDigitalTwin
            ? [
                "You have a personal memory bank — facts about THIS user that they",
                "themselves approved. Currently you have memories under these clusters:",
                "",
                lines,
                "",
                "When you need to know how the user works, who they collaborate with,",
                "what they prefer, or what they own, call `memory-search` FIRST with a",
                "specific natural-language query. Never invent facts about the user —",
                "only use what the tool returns.",
              ].join("\n")
            : [
                "You have access to a shared knowledge bank for this agent. It contains",
                "facts learned across past sessions, grouped by subsystem:",
                "",
                lines,
                "",
                "When a user question overlaps any subsystem, call the `memory-search`",
                "tool FIRST with a specific natural-language query. Do not invent facts",
                "from memory — only use what the tool returns.",
              ].join("\n"),
        });
      }
    }

    // Mention-format guidance is appended to the agent's systemPrompt below
    // (search for SPACES_MENTION_GUIDE). It is NOT a per-turn injection
    // because the model misreads `[System Reminder]` user messages as
    // user requests and replies with "Noted — will use ..." every turn.

    // Resolve subagent-level skills: NONE by default — users opt skills in
    // per-subagent via agent.config.subagentSkills. Rationale: a parent
    // agent's skills are often tuned for the parent's context (e.g. release
    // notes templates) and become noise/cost when injected into every child
    // (spaces, bitbucket, deepwiki, ...) without the user asking for it.
    //
    // Resolution:
    //   subagentSkills.spaces = ["skill-a"]   → only skill-a goes to spaces
    //   subagentSkills.spaces = []            → no skills (same as absent)
    //   subagentSkills.spaces is not set      → no skills (DEFAULT)
    //
    // Previous behavior was "inherit ALL parent skills by default" — flipped
    // here. Agents that depended on the old default need to explicitly list
    // the skills they want propagated per subagent.
    const allSkills = skills ?? [];
    const rawSubagentSkills = (agentConfig?.["subagentSkills"] as Record<string, string[]> | undefined);

    let resolvedSubagentSkills: Record<string, Array<{ slug?: string; name: string; description?: string; content: string }>> | undefined;
    if (rawSubagentSkills) {
      resolvedSubagentSkills = {};
      for (const [subagentName, skillNames] of Object.entries(rawSubagentSkills)) {
        const resolved = skillNames
          .map((name) => allSkills.find((s) => s.name === name))
          .filter((s): s is NonNullable<typeof s> => s != null);
        if (resolved.length > 0) {
          resolvedSubagentSkills[subagentName] = resolved;
        }
        // empty array → omit; the subagent gets no skills
      }
      if (Object.keys(resolvedSubagentSkills).length === 0) {
        resolvedSubagentSkills = undefined;
      }
    }

    // Combine all MCP groups and build subagent wrappers (also wraps matching custom tools like pgm)
    const allGroups = [...mcpGroups, ...(deepwikiGroup ? [deepwikiGroup] : []), ...(context7Group ? [context7Group] : [])];
    // Parent agent's provider — used as default for subagents that don't have an override
    const parentProvider = provider === "copilot" ? "copilot" : provider === "claude" ? "claude" : provider === "codex" ? "codex" : "spaces";
    // Shared ref: subagents append their inner MCP tool names here so chain
    // `toolsMustInclude`/`toolsMustExclude` conditions can target specific
    // nested tools (e.g. Bitbucket__create_pull_request), not just the
    // subagent wrapper names returned by the parent agent.
    const subagentInnerTools: string[] = [];
    // Splice playwright MCP tools into the sandbox subagent palette so the
    // child LLM can drive a browser via typed tools instead of bootstrapping
    // chromium inside the VM via `sandbox-run`. Browser runs in xyne-claw pod
    // — see loadPlaywrightTools for the reachability/concurrency caveats.
    const bonusToolsBySubagent: Record<string, typeof customToolDefs> = {};
    if (playwrightGroup && playwrightGroup.tools.length > 0) {
      bonusToolsBySubagent["sandbox"] = playwrightGroup.tools;
    }
    // Splice the bitbucket `upload-pr-screenshot` tool into the sandbox
    // subagent palette. The sandbox child LLM has the screenshot bytes in
    // its context (sandbox-pw-screenshot returns base64 inline) but no
    // upload tool; the parent has the upload tool but not the bytes. This
    // gives the sandbox subagent a direct path to attach screenshots to a
    // Bitbucket PR without round-tripping through the parent.
    const bitbucketGroup = mcpGroups.find((g) => g.serverType === "bitbucket");
    const uploadPrScreenshot = bitbucketGroup?.tools.find((t) => /upload-pr-screenshot/.test(t.name));
    if (uploadPrScreenshot) {
      bonusToolsBySubagent["sandbox"] = [...(bonusToolsBySubagent["sandbox"] ?? []), uploadPrScreenshot];
    }

    // Parse agent-level tool config up-front. Used both for the post-build
    // filter (further down) AND for the directPickSuffixes hoist below — when
    // a user ticks a single tool (e.g. bitbucket.get_pull_request) in the
    // agent UI without picking the whole bitbucket subagent, the runtime
    // should still expose that one tool to the parent. Without this, picking
    // individual tools from a subagent-backed connector was a silent no-op.
    const toolsConfigEarly = parseToolsConfig(effectiveConfig);
    const directPickSuffixes = toolsConfigEarly?.direct ?? [];

    const { subagentTools, directTools, remainingCustomTools } = buildSubagentTools(
      allGroups, customToolDefs,
      resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
      resolvedSubagentSkills,
      { parentProvider, subagentProviders, providerConfigs },
      {
        ...(progressUrl ? { progressUrl } : {}),
        parentSessionId: sessionId,
        parentToolsUsed: subagentInnerTools,
        parentMeta: {
          ...(conversationId ? { conversationId } : {}),
          ...(agentSlug ? { agentSlug } : {}),
        },
        // Propagate the cancel signal so any in-flight subagent session
        // (sandbox, spaces, bitbucket, ...) disposes itself when the user
        // hits Stop, instead of running for its full duration and orphaning
        // the result back to a parent that's already thrown RunCancelledError.
        ...(abortSignal ? { abortSignal } : {}),
      },
      bonusToolsBySubagent,
      customSubagents,
      directPickSuffixes,
    );

    // Parent-direct hoist for ALL sandbox tools (source = "custom:sandbox",
    // covers both compute/file tools in xyne-claw-shared/src/tools/sandbox/
    // and browser tools in xyne-claw-shared/src/tools/sandbox-pw/).
    //
    // These remain available to the sandbox subagent's child LLM via its
    // palette — nothing is removed there. What changes: the parent agent
    // also sees them, so:
    //   - agents like Doctor that delegate to the sandbox subagent still
    //     work (subagent palette unchanged);
    //   - agents like Merchant Paglu that DON'T use the sandbox subagent
    //     can still call sandbox-create / sandbox-run / sandbox-write-file /
    //     sandbox-read-file directly to do their own compute.
    //
    // Per-agent gating still happens at the agent.config.tools filter below —
    // hoisting just makes the tools VISIBLE to the parent if selected; agents
    // that don't select them won't see them.
    const parentHoistedTools = customToolDefs.filter((t) => {
      const src = (t as { source?: string }).source ?? "";
      return src === "custom:sandbox";
    });

    let allTools = [
      ...subagentTools,          // spaces, bitbucket, grafana, deepwiki, context7, pgm, sandbox
      ...directTools,            // write tools (create-ticket, send-message)
      ...remainingCustomTools,   // custom tools not wrapped in a subagent
      ...parentHoistedTools,     // sandbox tools hoisted for parent's context
    ];

    log(`Tools: ${subagentTools.length} subagents, ${directTools.length} direct, ${customToolDefs.length} custom, ${parentHoistedTools.length} parent-hoisted`);

    // Apply agent-level tool config from DB (agent.config.tools). Reuses the
    // toolsConfigEarly parse we did above for the directPickSuffixes hoist.
    if (toolsConfigEarly) {
      const allowedSubagents = new Set(toolsConfigEarly.subagents ?? []);
      const allowedDirect = toolsConfigEarly.direct ?? [];
      const allowedCustom = new Set(toolsConfigEarly.custom ?? []);

      allTools = allTools.filter((t) => {
        if (subagentTools.some((s) => s.name === t.name)) return allowedSubagents.has(t.name);
        if (directTools.some((d) => d.name === t.name)) return allowedDirect.some((d: string) => t.name.endsWith(d));
        if (customToolDefs.some((c) => c.name === t.name)) return allowedCustom.has(t.name);
        return true;
      });

      log(`Agent tools config applied: ${allTools.length} tools after filtering`);
    }

    // Inject copilot respond-to-user tool if provider is copilot
    const isCopilot = provider === "copilot";
    const effectiveModel = parentProviderConfig?.model ?? LITELLM.model;
    log(`provider=${provider ?? "spaces"} isCopilot=${isCopilot} model=${effectiveModel}`);
    if (isCopilot) {
      const copilotTool = buildCopilotTool(getPendingResponses, abortRun);
      allTools.push(copilotTool);
      log("Copilot mode — injected respond-to-user tool");
    }

    if (agentSlug && memoryEnabled) {
      allTools.push(buildMemorySearchTool(agentSlug, userId, sessionId));
      log("Memory enabled — injected memory-search tool");
    }

    const tools = allTools.length > 0 ? allTools : undefined;

    // Inject event type into context so the agent knows how it was invoked
    let fullContext = context;
    if (eventType) {
      const eventNote = `## Event Type: ${eventType}`;
      fullContext = fullContext ? `${eventNote}\n\n${fullContext}` : eventNote;
    }
    // Inject metadata so agents can reference channelId/conversationId in tool calls
    const metaLines = [
      "## Session Metadata",
      ...(channelId ? [`- channelId: ${channelId}`] : []),
      ...(conversationId ? [`- agent session/conversationId: ${conversationId}`] : []),
      ...(spacesConversationId && typeof spacesConversationId === "string" ? [`- spacesConversationId/threadId: ${spacesConversationId} \n This conversation/thread id is attached by the user as context for this claw agent session` ] : []),
    ];
    if (metaLines.length > 1) {
      fullContext = fullContext ? `${fullContext}\n\n${metaLines.join("\n")}` : metaLines.join("\n");
    }

    // Surface every derived context file to the agent — without this, files
    // written under .context/ (xlsx → <name>.md, pdf → <name>.md) are
    // invisible: the LLM sees only the user's free-text turn and replies
    // "I don't see any attachment". Each entry shows the ORIGINAL filename
    // plus the path the agent's read tool should use.
    const attachmentEntries: Array<{ label: string; path: string }> = [
      ...textAttachments.map((a) => ({
        label: `${a.fileName} (${a.mimeType || "application/octet-stream"})`,
        path: a.fileName,
      })),
      ...xlsxAttachments.map((a) => ({
        label: `${a.fileName} (xlsx, extracted to markdown)`,
        path: `${a.fileName}.md`,
      })),
      ...pdfAttachments.map((a) => ({
        label: `${a.fileName} (pdf, text-extracted to markdown)`,
        path: `${a.fileName}.md`,
      })),
    ];
    if (attachmentEntries.length > 0) {
      const attachmentContext = [
        "## Attached Files",
        ...attachmentEntries.map((e) => `- ${e.label} → \`.context/${e.path}\``),
        "These files were uploaded with the user's message and are available under `.context/`. Read them before responding.",
      ].join("\n");
      fullContext = fullContext ? `${fullContext}\n\n${attachmentContext}` : attachmentContext;
    }

    // Inject copilot system instructions
    if (isCopilot) {
      // COPILOT_SYSTEM_INSTRUCTION imported at top
      const copilotNote = `\n\n${COPILOT_SYSTEM_INSTRUCTION}`;
      fullContext = fullContext ? `${fullContext}${copilotNote}` : copilotNote;
    }
    // Inject additional instructions if provided (backend-contextual guidance not shown in UI)
    if (additionalInstructions) {
      const instructionsNote = `\n\n## Additional Instructions\n${additionalInstructions}`;
      fullContext = fullContext ? `${fullContext}${instructionsNote}` : instructionsNote;
    }

    // Inject ticket/canvas/call IDs from the frontend into context metadata
    // so the agent knows which specific items the user is asking about
    console.log(`[run] Injecting referenced items: ticketIds=${JSON.stringify(ticketIds)}, canvasIds=${JSON.stringify(canvasIds)}, callIds=${JSON.stringify(callIds)}`);
    if (ticketIds?.length || canvasIds?.length || callIds?.length) {
      const idLines = [
        "## Referenced Items",
        ...(ticketIds?.length ? [`- Ticket IDs: ${ticketIds.join(", ")}`] : []),
        ...(canvasIds?.length ? [`- Canvas IDs: ${canvasIds.join(", ")}`] : []),
        ...(callIds?.length ? [`- Call IDs: ${callIds.join(", ")}`] : []),
      ];
      fullContext = fullContext ? `${fullContext}\n\n${idLines.join("\n")}` : idLines.join("\n");
    }

    // Key sessions by conversationId + agentSlug so each agent has its own session per thread
    const sessionKey = conversationId && agentSlug ? `${conversationId}_${agentSlug}` : conversationId;
    const runtimeProvider = parentProviderConfig ? provider : undefined;
    const providerConfig = parentProviderConfig;
    // Convert image attachments to ImageContent format for the LLM, then
    // append video keyframes extracted at ingest (see videoBufferToContext).
    // The narrative `.context/<name>.video.md` carries the full description;
    // these keyframes let the agent look at key moments directly.
    const imageContents: ImageContent[] | undefined = [
      ...imageAttachments.map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType })),
      ...videoKeyframes.map((f) => ({ type: "image" as const, data: f.data, mimeType: f.mimeType })),
    ];

    const fileAttachments = textAttachments.map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      path: toWorkspaceContextPath(a.fileName),
    }));

    // Mention guidance is appended to the agent's system prompt only when
    // running in a chat thread (channelId present). Empty/sandbox runs keep
    // the original prompt untouched.
    // Citation guide is appended to ALL agents (not conditional on channelId).
    // SPACES_MENTION_GUIDE is only for chat threads (channelId present).
    const basePrompt = (systemPrompt ?? "").trimEnd();
    const effectiveSystemPrompt = channelId
      ? `${basePrompt}${CITATION_GUIDE}${SPACES_MENTION_GUIDE}`
      : `${basePrompt}${CITATION_GUIDE}`; 

    // Quota fallback wrapper: walks the agent owner's `providerOrder` on
    // 429 / insufficient_quota / out-of-credits, then drops to "spaces" (Kimi
    // via LiteLLM) as the terminal fallback. If providerOrder isn't set we
    // collapse to the previous behavior (single retry on Kimi).
    //
    // Build the attempt chain:
    //   - First entry = the current parent (runtimeProvider).
    //   - Subsequent entries = remaining providers from `providerOrder`
    //     for which we actually have credentials in `providerConfigs`.
    //   - Final entry = "spaces" (Kimi) unless the parent already was it.
    type Attempt = { provider: string | undefined; config: typeof providerConfig | undefined };
    const attempts: Attempt[] = [{ provider: runtimeProvider, config: providerConfig }];
    if (providerOrder && providerOrder.length > 0) {
      for (const p of providerOrder) {
        if (p === runtimeProvider) continue;
        if (p === "spaces") continue; // appended last
        const cfg = providerConfigs?.[p];
        if (!cfg) continue;
        attempts.push({ provider: p, config: cfg });
      }
    }
    if (runtimeProvider && runtimeProvider !== "spaces") {
      attempts.push({ provider: "spaces", config: undefined });
    }

    const runAttempt = (a: Attempt) => runTask(
      userId, task, fullContext, userName, userEmail, tools,
      effectiveSystemPrompt, workspaceDir, sessionKey,
      a.provider, a.config, progressUrl, sessionId,
      imageContents?.length ? imageContents : undefined,
      fileAttachments.length > 0 ? fileAttachments : undefined,
      skills,
      resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
      activeInjections.length > 0 ? activeInjections : undefined,
      abortSignal,
      // Raw Spaces identity for progress callbacks → lets /webhook/progress fall
      // back to claw-auth's conv-keyed session index (mirrors the /result body).
      { conversationId: conversationId ?? null, agentSlug: agentSlug ?? null },
    );

    let result: Awaited<ReturnType<typeof runTask>>;
    let fellBackProvider: string | null = null;
    let lastErr: unknown = undefined;
    let attemptedAny = false;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i]!;
      try {
        if (attemptedAny) {
          fellBackProvider = (a.provider ?? "spaces");
          const prev = attempts[i - 1]?.provider ?? "spaces";
          log(`Quota fallback: ${prev} → ${a.provider ?? "spaces"}. Underlying: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
        }
        result = await runAttempt(a);
        if (attemptedAny) log(`Quota fallback succeeded on ${a.provider ?? "spaces"}.`);
        lastErr = undefined;
        break;
      } catch (err) {
        attemptedAny = true;
        lastErr = err;
        const userCancelled = err instanceof RunCancelledError || abortSignal?.aborted;
        const isQuota = err instanceof QuotaExhaustedError || isQuotaExhaustedError(err);
        if (userCancelled || !isQuota) throw err;
        // else: continue to next attempt
      }
    }
    if (lastErr !== undefined) throw lastErr;
    // result is assigned in the loop on success; this assertion narrows the type for downstream code.
    result = result!;

    const resultAttachments = getAttachments();
    const pendingQuestions = getPendingQuestions();
    const pendingActions = [...getPendingActions(), ...getCustomPendingActions()];
    const pendingResponses = getPendingResponses();

    // Flatten: parent's top-level tools + nested MCP tools run inside subagents.
    // Chain conditions evaluate against this combined list so users can match
    // on specific inner tools (Bitbucket__create_pull_request) in addition to
    // subagent wrappers (bitbucket).
    const combinedToolsUsed = [...result.toolsUsed, ...subagentInnerTools];

    const lat = result.latency;
    const latencyStr = lat
      ? ` | total=${lat.totalMs}ms llm=${lat.llmTotalMs}ms (wait=${lat.llmWaitMs}ms decode=${lat.llmDecodeMs}ms) tools=${lat.toolMs}ms turns=${lat.llmTurns} retries=${lat.llmRetries}` +
        (lat.firstTurnTtftMs != null ? ` ttft=${lat.firstTurnTtftMs}ms` : "") +
        (lat.tokensPerSec != null ? ` tps=${lat.tokensPerSec}` : "")
      : "";
    log(`Completed: ${combinedToolsUsed.length} tools used (${result.toolsUsed.length} top-level + ${subagentInnerTools.length} nested), ${resultAttachments.length} attachment(s), ${pendingQuestions.length} question(s), ${pendingActions.length} pending action(s), ${pendingResponses.length} copilot response(s), resultLength=${result.text.length}${latencyStr}`);

    // Rescue empty-text runs that delivered an attachment. If the agent
    // called an attachment-emitting tool (e.g. create-html-report) and then
    // ended its turn with no chat-visible text, Spaces hides the message
    // entirely and shows "Sorry, I wasn't able to produce a response."
    // Promote the most recent attachment tool's summary (e.g. the agent's
    // own `summary` parameter to create-html-report) to result.text so the
    // user gets a real reply alongside the attachment.
    let finalResultText = result.text;
    if (
      (!finalResultText || !finalResultText.trim()) &&
      resultAttachments.length > 0 &&
      customToolsResult
    ) {
      const fallback = customToolsResult.getLastAttachmentSummary();
      if (fallback && fallback.trim()) {
        finalResultText = fallback.trim();
        log(`Rescued empty result.text from attachment summary (length=${finalResultText.length})`);
      }
    }

    // Retrieve LLM-provided citations from add_citations tool
    const llmCitations = takeLlmCitations(sessionId);
    log(`llmCitations retrieved: ${llmCitations?.length ?? 0} keypoint(s) for session ${sessionId}`);

    await sendCallback(callbackUrl, {
      sessionId,
      userId,
      conversationId: conversationId ?? null,
      agentSlug: agentSlug ?? null,
      status: "completed",
      result: finalResultText,
      toolsUsed: combinedToolsUsed,
      tokenUsage: result.tokenUsage,
      ...(result.latency ? { latency: result.latency } : {}),
      ...(result.toolInvocations.length > 0 ? { toolInvocations: result.toolInvocations } : {}),
      ...(resultAttachments.length > 0 ? { attachments: resultAttachments } : {}),
      ...(pendingQuestions.length > 0 ? { pendingQuestions } : {}),
      ...(pendingActions.length > 0 ? { pendingActions } : {}),
      ...(pendingResponses.length > 0 ? { pendingResponses } : {}),
      ...(llmCitations && llmCitations.length > 0 ? { llmCitations } : {}),
      ...(provider === "copilot" || provider === "claude" || provider === "codex" ? { provider } : {}),
    });


  } catch (err) {
    // HA: another pod already owns this conversation's lock. Skip silently —
    // do NOT send a failure callback, so the owning pod's real result is the
    // one that reaches claw-auth. (Happens when run-recovery refires a run that
    // the original, still-alive pod is also processing.)
    if (err instanceof SessionLockedError) {
      log(`Skipped: conversation locked by another worker (sessionId=${sessionId})`);
      return;
    }
    // If respond-to-user fired before the abort propagated, this is a
    // graceful copilot-mode termination — treat as completed so the response
    // actually posts to Spaces instead of being silently dropped as a cancel.
    const pendingResponsesAtError = customToolsResult?.getPendingResponses() ?? [];
    // Recover attachments collected during the run too. Without this, any
    // tool that pushed via `[ATTACHMENT:...]` (create-html-report,
    // create-ppt, sandbox-deliver-files, etc.) — which all run BEFORE the
    // terminating `respond-to-user` call — would have their attachments
    // silently dropped, because this catch block ran instead of the normal
    // completion path that aggregates them at line ~665.
    const attachmentsAtError = customToolsResult?.getAttachments() ?? [];
    if (
      pendingResponsesAtError.length > 0 &&
      (err instanceof RunCancelledError || abortSignal?.aborted)
    ) {
      log(`Session terminated by respond-to-user (${pendingResponsesAtError.length} response(s), ${attachmentsAtError.length} attachment(s)): ${sessionId}`);
      // Retrieve LLM-provided citations from add_citations tool (same as success path)
      const llmCitationsAtError = takeLlmCitations(sessionId);
      log(`llmCitations retrieved at respond-to-user: ${llmCitationsAtError?.length ?? 0} keypoint(s) for session ${sessionId}`);
      await sendCallback(callbackUrl, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        status: "completed",
        result: "",
        pendingResponses: pendingResponsesAtError,
        ...(attachmentsAtError.length > 0 ? { attachments: attachmentsAtError } : {}),
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
        ...(llmCitationsAtError && llmCitationsAtError.length > 0 ? { llmCitations: llmCitationsAtError } : {}),
        ...(provider === "copilot" || provider === "claude" || provider === "codex" ? { provider } : {}),
      });
    } else if (err instanceof RunCancelledError || abortSignal?.aborted) {
      log(`Session cancelled: ${sessionId}`);
      await sendCallback(callbackUrl, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        status: "cancelled",
        ...(err instanceof RunCancelledError && err.partialText ? { result: err.partialText } : {}),
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
      });
    } else {
      logErr(`Session failed: ${err instanceof Error ? err.message : String(err)}`);

      await sendCallback(callbackUrl, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        status: "failed",
        error: err instanceof Error ? err.message : "Internal error",
      });
    }
  } finally {
    if (mcpCleanup) {
      await mcpCleanup().catch(() => {});
    }
    if (!requestCwd && repoCwd && repoUrl) {
      // Clean up git worktree
      await deleteRepoWorktree(repoUrl, sessionId, agentSlug).catch((err) => {
        console.warn(`[run] [${tid}] Worktree cleanup failed:`, err);
      });
    } else if (!requestCwd) {
      // Clean up ephemeral workspace (non-repo case)
      await deleteWorkspace(sessionId).catch(() => {});
    }
  }
}

async function sendCallback(callbackUrl: string | undefined, payload: Record<string, unknown>): Promise<void> {
  const url = callbackUrl ?? `${SERVER.authServiceUrl}/claw/api/v1/sessions/${payload["sessionId"] as string}/result`;
  const sid = (payload["sessionId"] as string | undefined) ?? "?";
  const body = JSON.stringify(payload);
  // Up to 3 attempts on transient failures (network throw OR 5xx OR 408/429).
  // We never retry 4xx other than 408/429 — those are caller-shape errors and
  // re-sending won't help. Each attempt is logged so a silent drop becomes
  // impossible. Backoff: 1s, 3s.
  const BACKOFFS_MS = [1000, 3000];
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
        },
        body,
      });
      if (res.ok) {
        if (attempt > 1) {
          console.log(`[run] Callback to ${url} succeeded on attempt ${attempt} (session=${sid})`);
        }
        return;
      }
      // Non-2xx: read a snippet of the body so the failure mode is visible.
      const text = await res.text().catch(() => "");
      const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      console.error(
        `[run] Callback ${res.status} from ${url} (session=${sid}, attempt=${attempt}, bytes=${body.length}, retryable=${retryable}): ${text.slice(0, 300)}`,
      );
      if (!retryable || attempt === 3) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      console.error(
        `[run] Callback to ${url} threw (session=${sid}, attempt=${attempt}, bytes=${body.length}): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt === 3) return;
    }
    const wait = BACKOFFS_MS[attempt - 1] ?? 3000;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (lastErr) {
    console.error(`[run] Callback exhausted retries to ${url} (session=${sid}): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}

// ── Chain judge endpoint (called by xyne-claw-auth webhook) ──────────────

router.post("/chain-judge", validateS2SKey, async (req, res: Response) => {
  const { agentResult, sourceAgent, targetAgent, taskTemplate, userQuery, judgeContext } = req.body as {
    agentResult?: string;
    sourceAgent?: string;
    targetAgent?: string;
    taskTemplate?: string;
    userQuery?: string;
    judgeContext?: string;
  };

  if (!agentResult || !sourceAgent || !targetAgent) {
    res.status(400).json({ success: false, error: "agentResult, sourceAgent, targetAgent required" });
    return;
  }

  const decision = await judgeChainContinuation(agentResult, sourceAgent, targetAgent, taskTemplate, userQuery, judgeContext);
  res.json({ success: true, data: decision });
});

// ── Generate agent prompt (called by xyne-claw-auth) ──────────────────────

router.post("/generate-prompt", validateS2SKey, async (req, res: Response) => {
  const { intent, agentName, existingPrompt } = req.body as { intent?: string; agentName?: string; existingPrompt?: string };

  if (!intent || typeof intent !== "string") {
    res.status(400).json({ success: false, error: "intent is required" });
    return;
  }

  const isUpdate = existingPrompt && typeof existingPrompt === "string" && existingPrompt.trim().length > 0;

  const userMessage = isUpdate
    ? `Here is the current system prompt for an agent${agentName ? ` called "${agentName}"` : ""}:\n\n---\n${existingPrompt}\n---\n\nThe user wants to update it with the following instructions:\n\n"${intent}"\n\nApply the requested changes to the existing prompt. Keep the parts that are not affected by the update. Return the full updated prompt.`
    : `Generate a system prompt for an agent${agentName ? ` called "${agentName}"` : ""}. The user described it as:\n\n"${intent}"\n\nThe prompt should:\n- Define the agent's role and personality\n- List what the agent can and cannot do\n- Include guidelines for response style\n- Be concise but thorough (200-400 words)`;

  try {
    const llmRes = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content: "You generate and update system prompts for AI agents. Return ONLY the system prompt text, no explanation or markdown wrapping.",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!llmRes.ok) {
      res.status(500).json({ success: false, error: `LLM returned ${llmRes.status}` });
      return;
    }

    const data = (await llmRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const prompt = data.choices?.[0]?.message?.content?.trim() ?? "";

    res.json({ success: true, data: { prompt } });
  } catch (err) {
    console.error("[generate-prompt] Failed:", err);
    res.status(500).json({ success: false, error: "Failed to generate prompt" });
  }
});

// ── Suggest tools for an agent (called by xyne-claw-auth) ────────────────
// Given the agent's intent (a short description or full system prompt) and a
// catalog of available tools, ask the LLM to pick a small, sensible default
// set. The endpoint is intentionally side-effect-free: it just returns a
// proposal and the UI renders it as a diff for the user to accept.

router.post("/suggest-tools", validateS2SKey, async (req, res: Response) => {
  const {
    intent,
    catalog,
  } = req.body as {
    intent?: string;
    catalog?: {
      subagents: Array<{ name: string; description: string }>;
      integrations: Array<{
        slug: string;
        label: string;
        readTools: Array<{ name: string; description: string; riskLevel: string }>;
        writeTools: Array<{ name: string; description: string; riskLevel: string }>;
      }>;
    };
  };

  if (!intent || typeof intent !== "string" || intent.trim().length === 0) {
    res.status(400).json({ success: false, error: "intent is required" });
    return;
  }
  if (!catalog || typeof catalog !== "object") {
    res.status(400).json({ success: false, error: "catalog is required" });
    return;
  }

  // Compress the catalog into a token-cheap form. Tool descriptions are
  // truncated; an LLM doesn't need 500 chars per tool to recognise intent.
  const truncate = (s: string, n: number) => {
    const trimmed = (s ?? "").trim();
    return trimmed.length <= n ? trimmed : trimmed.slice(0, n - 1) + "…";
  };

  const subagentList = (catalog.subagents ?? [])
    .map((s) => `- ${s.name}: ${truncate(s.description, 120)}`)
    .join("\n");

  const integrationBlocks = (catalog.integrations ?? [])
    .map((i) => {
      const readLines = i.readTools
        .map((t) => `    - ${t.name}${t.description ? ": " + truncate(t.description, 100) : ""}`)
        .join("\n");
      const writeLines = i.writeTools
        .map((t) => `    - ${t.name} [${t.riskLevel}]${t.description ? ": " + truncate(t.description, 100) : ""}`)
        .join("\n");
      return [
        `## ${i.label} (slug: ${i.slug})`,
        readLines ? `  read tools:\n${readLines}` : "",
        writeLines ? `  write tools:\n${writeLines}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const userMessage = [
    "Select an appropriate, minimal set of tools for this agent based on its purpose.",
    "",
    "Agent intent / system prompt:",
    "---",
    intent,
    "---",
    "",
    "Available subagents (specialists this agent can delegate to):",
    subagentList || "(none)",
    "",
    "Available integrations and their tools:",
    integrationBlocks || "(none)",
    "",
    "Rules:",
    "- Be conservative. Prefer read-only tools. Only include write/destructive tools when the intent clearly demands them.",
    "- Prefer subagents (delegation) over a long list of raw integration tools when a matching specialist exists.",
    "- Aim for under 15 individual tools across all integrations unless intent demands more.",
    "- For each pick, give a one-sentence reason citing what in the intent justifies it.",
    "",
    "Return a strict JSON object matching this shape (no prose, no markdown wrapping):",
    `{
  "subagents": ["subagent-name", ...],
  "integrations": [
    { "slug": "integration-slug", "readTools": ["tool_name", ...], "writeTools": ["tool_name", ...] },
    ...
  ],
  "reasoning": { "subagent-or-tool-name": "one-sentence why", ... }
}`,
  ].join("\n");

  try {
    const llmRes = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content: "You select tools for AI agents. You return ONLY a JSON object — no prose, no markdown fences. Be conservative and prefer read-only tools.",
          },
          { role: "user", content: userMessage },
        ],
        // Response is a small JSON object; cap is mainly a safety bound.
        max_tokens: 2000,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!llmRes.ok) {
      res.status(500).json({ success: false, error: `LLM returned ${llmRes.status}` });
      return;
    }

    const data = (await llmRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ success: false, error: "LLM returned non-JSON" });
      return;
    }

    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error("[suggest-tools] Failed:", err);
    res.status(500).json({ success: false, error: "Failed to suggest tools" });
  }
});

export { router as runRouter };
