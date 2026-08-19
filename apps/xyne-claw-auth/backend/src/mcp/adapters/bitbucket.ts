import type { StdioMcpAdapter, McpToolInfo } from "../types.js";
import type { Citation } from "xyne-claw-shared";
import { prefixChunk } from "./grafana.js";

export const bitbucketAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "bitbucket",
  healthCheck: { name: "list_projects", params: { limit: 1, start: 0 } },
  writeTools: ["merge_pull_request"],
  credentialFields: [
    { name: "username", label: "Bitbucket Username", type: "text", placeholder: "your-username" },
    { name: "token", label: "Bitbucket Token", type: "password", placeholder: "Enter your Bitbucket access token" },
    { name: "baseUrl", label: "Bitbucket Base URL", type: "text", placeholder: "https://bitbucket.juspay.net", optional: true },
  ],
  buildCommand(credentials) {
    const username = credentials["username"] as string;
    const token = credentials["token"] as string;
    const baseUrl = (credentials["baseUrl"] as string) || "https://bitbucket.juspay.net";
    return {
      cmd: "npx",
      args: ["-y", "@nexus2520/bitbucket-mcp-server@2.2.0"],
      env: {
        BITBUCKET_USERNAME: username,
        BITBUCKET_TOKEN: token,
        BITBUCKET_BASE_URL: baseUrl,
      },
    };
  },
};

// ── Custom Bitbucket tools (handled locally, not forwarded to MCP server) ──

export const BITBUCKET_CUSTOM_TOOLS: McpToolInfo[] = [
  {
    name: "upload-pr-screenshot",
    description:
      "Upload a screenshot to a Bitbucket pull request. Returns a markdown image link that can be embedded in the PR description.\n\n" +
      "Pass the image bytes via `fileData` (base64). For screenshots taken with `sandbox-pw-screenshot`, the bytes are returned inline in the tool result — pass that base64 string here. " +
      "`fileName` is required (used for the upload filename and the markdown alt text).",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Bitbucket project key (e.g. XYNE)" },
        repoSlug: { type: "string", description: "Repository slug (e.g. xyne-spaces)" },
        prId: { type: "string", description: "Pull request ID (number as string)" },
        fileData: { type: "string", description: "Base64-encoded image bytes. Use the bytes from sandbox-pw-screenshot's [ATTACHMENT:...] payload." },
        fileName: { type: "string", description: "Filename to use for the upload (e.g. page.png)." },
        mimeType: { type: "string", description: "MIME type of the image (default: image/png)" },
        caption: { type: "string", description: "Caption/alt text for the image" },
      },
      required: ["projectKey", "repoSlug", "prId", "fileData"],
    },
  },
  {
    name: "get-pr-comments",
    description:
      "Get ALL comments on a Bitbucket pull request, paginated. Bypasses the upstream MCP's 20-comment cap on its PR-comments tool by walking the activities API directly. " +
      "Returns a flat list of comments with replies, comment state (resolved/open), inline-anchor info (file path, line, lineType), and IDs/parent IDs so the agent can reconstruct threads. " +
      "Use `includeDeleted=true` to also include comments marked as deleted (default: false — deleted comments are filtered out).",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Bitbucket project key (e.g. XYNE)" },
        repoSlug: { type: "string", description: "Repository slug (e.g. xyne-spaces)" },
        prId: { type: "string", description: "Pull request ID (number as string)" },
        maxComments: {
          type: "number",
          description: "Safety cap on total comments returned (default: 500). Increase only if you really need it — large PRs can have thousands of activity rows.",
        },
        includeDeleted: {
          type: "boolean",
          description: "Include comments whose text is the soft-delete placeholder. Default: false.",
        },
      },
      required: ["projectKey", "repoSlug", "prId"],
    },
  },

  {
    name: "list-pull-requests",
    description:
      "List pull requests with SERVER-SIDE filtering by state and target branch, walking every page to completion. " +
      "Use this instead of listing PRs page-by-page and filtering client-side — Bitbucket Server filters target branch natively " +
      "(`at=refs/heads/<branch>&direction=INCOMING`), so client-side filtering silently under-counts whenever a page boundary falls " +
      "inside the filtered set.\n\n" +
      "Returns a MANIFEST built for provable completeness: the exact PR id list, the count, and a `complete` flag that is true ONLY when " +
      "Bitbucket reported isLastPage (i.e. the whole result set was enumerated, not truncated by `max`). Every returned PR is also " +
      "re-checked client-side against `targetBranch`; any mismatch is reported in `targetBranchMismatches` rather than silently dropped. " +
      "If you need 'the last N merged PRs into branch X', call this once with state=MERGED, targetBranch=X, order=NEWEST, max=N.",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Bitbucket project key (e.g. JBIZ)" },
        repoSlug: { type: "string", description: "Repository slug (e.g. ardra-b2b)" },
        state: {
          type: "string",
          enum: ["MERGED", "OPEN", "DECLINED", "ALL"],
          description: "PR state filter. Default MERGED.",
        },
        targetBranch: {
          type: "string",
          description: "Destination branch name (e.g. vpa-beta) — bare name or refs/heads/<name>. Filtered server-side.",
        },
        order: { type: "string", enum: ["NEWEST", "OLDEST"], description: "Sort order. Default NEWEST." },
        max: { type: "number", description: "Maximum PRs to return (default 1000). `complete` reports whether the full set fit." },
        idsOnly: { type: "boolean", description: "Return only the id manifest, omitting per-PR rows. Default false." },
      },
      required: ["projectKey", "repoSlug"],
    },
  },

  {
    name: "get-pr-template",
    description:
      "Fetch a repository's pull-request description template so a bot can pre-fill a PR body. " +
      "Bitbucket Data Center has no native PR-template API, so this reads a template FILE from the repo. " +
      "By default it probes common paths (PULL_REQUEST_TEMPLATE.md, .bitbucket/, docs/, .github/) and returns " +
      "the first that exists. Pass `path` to fetch one explicit file (no probing); pass `at` to pin a " +
      "branch/tag/commit (defaults to the repo default branch). Returns JSON: " +
      "{ found, path, at, content, triedPaths }. found=false means no template exists \u2014 handle that case.",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Bitbucket project key (e.g. XYNE)" },
        repoSlug: { type: "string", description: "Repository slug (e.g. xyne-spaces)" },
        at: { type: "string", description: "Optional branch/tag/commit to read from. Defaults to the repo default branch." },
        path: { type: "string", description: "Optional explicit template file path. If set, only this path is fetched (no probing)." },
      },
      required: ["projectKey", "repoSlug"],
    },
  },
];

// ── Citation URL builders ───────────────────────────────────────────────────

function prUrl(baseUrl: string, projectKey: string, repoSlug: string, prId: string | number): string {
  return `${baseUrl}/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}/overview`;
}

function fileUrl(baseUrl: string, projectKey: string, repoSlug: string, path: string, at?: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const q = at ? `?at=${encodeURIComponent(at)}` : "";
  return `${baseUrl}/projects/${projectKey}/repos/${repoSlug}/browse/${encodedPath}${q}`;
}

function branchUrl(baseUrl: string, projectKey: string, repoSlug: string, branch: string): string {
  return `${baseUrl}/projects/${projectKey}/repos/${repoSlug}/browse?at=${encodeURIComponent(`refs/heads/${branch}`)}`;
}

function commitUrl(baseUrl: string, projectKey: string, repoSlug: string, commitId: string): string {
  return `${baseUrl}/projects/${projectKey}/repos/${repoSlug}/commits/${commitId}`;
}

// ── Upstream bitbucket-mcp-server tools (get_pull_request, get_branch, …) ──
// These run through the generic stdio `callTool`/throttle path (mcp.ts), NOT
// the local switch above, so they carry no citation by default. Each entry
// says which of the tool's params identify the PR/branch/file/commit to link.
const UPSTREAM_BITBUCKET_TOOLS: Record<string, "pr" | "branch" | "file" | "commit"> = {
  get_pull_request: "pr",
  update_pull_request: "pr",
  merge_pull_request: "pr",
  decline_pull_request: "pr",
  add_comment: "pr",
  delete_comment: "pr",
  get_pull_request_diff: "pr",
  set_pr_approval: "pr",
  set_review_status: "pr",
  list_pr_tasks: "pr",
  create_pr_task: "pr",
  update_pr_task: "pr",
  delete_pr_task: "pr",
  set_pr_task_status: "pr",
  convert_pr_item: "pr",
  list_pr_commits: "pr",
  get_branch: "branch",
  delete_branch: "branch",
  list_branch_commits: "branch",
  get_file_content: "file",
  get_file_blame: "file",
  get_commit_detail: "commit",
};

export function buildUpstreamBitbucketCitation(
  baseUrl: string,
  tool: string,
  params: Record<string, unknown>,
): Citation | null {
  const kind = UPSTREAM_BITBUCKET_TOOLS[tool];
  if (!kind) return null;

  const base = baseUrl.replace(/\/+$/, "");
  const workspace = params["workspace"] as string | undefined;
  const repository = params["repository"] as string | undefined;
  if (!workspace || !repository) return null;

  if (kind === "pr") {
    const prId = params["pull_request_id"] as string | number | undefined;
    if (prId === undefined || prId === null) return null;
    return { kind: "external", url: prUrl(base, workspace, repository, prId), chunkIndex: 1, label: `Bitbucket PR #${prId}` };
  }
  if (kind === "branch") {
    const branch = params["branch_name"] as string | undefined;
    if (!branch) return null;
    return { kind: "external", url: branchUrl(base, workspace, repository, branch), chunkIndex: 1, label: `Bitbucket branch ${branch}` };
  }
  if (kind === "file") {
    const filePath = params["file_path"] as string | undefined;
    if (!filePath) return null;
    const branch = params["branch"] as string | undefined;
    return { kind: "external", url: fileUrl(base, workspace, repository, filePath, branch), chunkIndex: 1, label: `Bitbucket file ${filePath}` };
  }
  const commitId = params["commit_id"] as string | undefined;
  if (!commitId) return null;
  return { kind: "external", url: commitUrl(base, workspace, repository, commitId), chunkIndex: 1, label: `Bitbucket commit ${commitId.slice(0, 8)}` };
}

/**
 * Handle the upload-pr-screenshot tool call.
 * Uploads the file to Bitbucket Server attachments API, then comments on the PR with the image.
 */
export async function handleUploadPrScreenshot(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const username = credentials["username"] as string;
  const token = credentials["token"] as string;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.juspay.net").replace(/\/+$/, "");

  const projectKey = params["projectKey"] as string;
  const repoSlug = params["repoSlug"] as string;
  const prId = params["prId"] as string;
  const fileData = params["fileData"] as string | undefined;
  const explicitFileName = params["fileName"] as string | undefined;
  const mimeType = (params["mimeType"] as string | undefined) || "image/png";

  if (!fileData || typeof fileData !== "string") {
    throw new Error("upload-pr-screenshot: fileData (base64) is required");
  }
  const comma = fileData.indexOf(",");
  const b64 = fileData.startsWith("data:") && comma >= 0 ? fileData.slice(comma + 1) : fileData;
  const fileBuffer = Buffer.from(b64, "base64");
  if (fileBuffer.length === 0) {
    throw new Error("upload-pr-screenshot: fileData decoded to empty bytes");
  }
  const fileName = explicitFileName?.trim() || `screenshot-${Date.now()}.png`;

  const caption = (params["caption"] as string) || fileName;

  const authHeader = "Basic " + Buffer.from(`${username}:${token}`).toString("base64");

  // Upload as repo attachment — Bitbucket Server returns attachment metadata with links
  const uploadUrl = `${baseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}/attachments`;

  const boundary = "----XyneUpload" + Date.now();
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n`,
    `Content-Type: ${mimeType}\r\n\r\n`,
  ];
  const bodyEnd = `\r\n--${boundary}--\r\n`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(bodyParts.join("")),
    fileBuffer,
    Buffer.from(bodyEnd),
  ]);

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "X-Atlassian-Token": "no-check",
    },
    body: bodyBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`Bitbucket attachment upload failed (${uploadRes.status}): ${errText.slice(0, 300)}`);
  }

  const attachments = (await uploadRes.json()) as { attachments?: Array<{ url?: string; link?: string }> };
  const attachment = attachments.attachments?.[0];
  const attachmentUrl = attachment?.url || attachment?.link;

  if (!attachmentUrl) {
    throw new Error("Bitbucket did not return an attachment URL");
  }

  // The URL from the API may be relative — make it absolute
  const fullUrl = attachmentUrl.startsWith("http") ? attachmentUrl : `${baseUrl}${attachmentUrl}`;

  // Add a PR comment with the embedded image
  const commentUrl = `${baseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}/pull-requests/${prId}/comments`;
  const commentBody = `![${caption}](${fullUrl})\n\n**${caption}**`;

  const commentRes = await fetch(commentUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: commentBody }),
  });

  const citations: Citation[] = [
    { kind: "external", url: prUrl(baseUrl, projectKey, repoSlug, prId), chunkIndex: 1, label: `Bitbucket PR #${prId}` },
  ];

  if (!commentRes.ok) {
    // Attachment uploaded but comment failed — still return the URL
    return {
      content: prefixChunk(1, `Screenshot uploaded: ${fullUrl}\n(Warning: Failed to add PR comment — add manually)`),
      citations,
    };
  }

  return {
    content: prefixChunk(1, `Screenshot uploaded and added to PR #${prId}:\n![${caption}](${fullUrl})`),
    citations,
  };
}

// ── get-pr-comments ────────────────────────────────────────────────────────

/** Shape of a comment row in the flattened output. */
interface FlatComment {
  id: number;
  parentId: number | null;
  /** Bitbucket activity ID — useful for cross-referencing in the UI. */
  activityId?: number;
  author: string;
  authorEmail?: string;
  text: string;
  createdDate: number;
  updatedDate?: number;
  /** "OPEN" | "RESOLVED" | "PENDING" — Bitbucket-Server comment thread state. */
  state?: string;
  /** True when this comment was soft-deleted (text replaced with placeholder). */
  deleted: boolean;
  /** Inline-comment anchor (set on inline file comments, absent on PR-level comments). */
  anchor?: {
    path?: string;
    srcPath?: string;
    line?: number;
    lineType?: "ADDED" | "REMOVED" | "CONTEXT";
    fileType?: "FROM" | "TO";
    diffType?: string;
  };
}

/** Raw comment shape returned by Bitbucket Server's activities API. Only the
 *  fields we consume are typed — everything else is allowed via the index sig. */
interface BbComment {
  id: number;
  parent?: { id: number };
  author?: { displayName?: string; emailAddress?: string };
  text?: string;
  createdDate?: number;
  updatedDate?: number;
  state?: string;
  comments?: BbComment[];
  [k: string]: unknown;
}

interface BbActivity {
  id?: number;
  action?: string;
  comment?: BbComment;
  commentAnchor?: {
    path?: string;
    srcPath?: string;
    line?: number;
    lineType?: "ADDED" | "REMOVED" | "CONTEXT";
    fileType?: "FROM" | "TO";
    diffType?: string;
  };
  [k: string]: unknown;
}

interface BbActivitiesPage {
  values?: BbActivity[];
  size?: number;
  isLastPage?: boolean;
  nextPageStart?: number;
}

/**
 * Recursively walks a comment thread and pushes each comment (plus replies)
 * into `out`. Bitbucket nests replies in `comment.comments[]`; the wire
 * format also stores `parent.id` on each child, which we surface as
 * `parentId` for downstream consumers.
 */
function collectThread(
  comment: BbComment,
  activityId: number | undefined,
  anchor: BbActivity["commentAnchor"] | undefined,
  parentId: number | null,
  out: FlatComment[],
  includeDeleted: boolean,
): void {
  // Bitbucket replaces the text of deleted comments with the literal string
  // "This comment was deleted." (configurable). The reliable signal is
  // `state === "DELETED"` but older Bitbucket Server versions don't emit
  // that, so we fall back to a text match. Conservative — if either says
  // deleted, treat as deleted.
  const stateRaw = typeof comment.state === "string" ? comment.state : undefined;
  const deleted =
    stateRaw === "DELETED" ||
    comment.text?.trim() === "This comment was deleted." ||
    false;

  if (!deleted || includeDeleted) {
    const flat: FlatComment = {
      id: comment.id,
      parentId,
      author: comment.author?.displayName ?? "unknown",
      text: comment.text ?? "",
      createdDate: comment.createdDate ?? 0,
      deleted,
    };
    if (activityId !== undefined) flat.activityId = activityId;
    if (comment.author?.emailAddress) flat.authorEmail = comment.author.emailAddress;
    if (comment.updatedDate !== undefined) flat.updatedDate = comment.updatedDate;
    if (stateRaw) flat.state = stateRaw;
    if (anchor) flat.anchor = anchor;
    out.push(flat);
  }

  for (const reply of comment.comments ?? []) {
    collectThread(reply, activityId, anchor, comment.id, out, includeDeleted);
  }
}

/**
 * Walk the Bitbucket Server activities endpoint for a PR with pagination,
 * extract every COMMENTED activity, flatten threads, return JSON.
 */
export async function handleGetPrComments(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const username = credentials["username"] as string;
  const token = credentials["token"] as string;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.juspay.net").replace(/\/+$/, "");

  const projectKey = params["projectKey"] as string;
  const repoSlug = params["repoSlug"] as string;
  const prId = params["prId"] as string;
  const maxComments = typeof params["maxComments"] === "number" ? (params["maxComments"] as number) : 500;
  const includeDeleted = params["includeDeleted"] === true;

  if (!projectKey || !repoSlug || !prId) {
    throw new Error("get-pr-comments: projectKey, repoSlug, and prId are required");
  }

  const authHeader = "Basic " + Buffer.from(`${username}:${token}`).toString("base64");
  const pageSize = 100;
  const out: FlatComment[] = [];
  let start = 0;
  let pagesWalked = 0;
  const maxPages = 200; // hard ceiling — 20k activities is plenty even for huge PRs

  while (out.length < maxComments && pagesWalked < maxPages) {
    const url =
      `${baseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}` +
      `/pull-requests/${prId}/activities?start=${start}&limit=${pageSize}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Bitbucket activities API failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const page = (await res.json()) as BbActivitiesPage;
    pagesWalked++;

    for (const activity of page.values ?? []) {
      if (activity.action !== "COMMENTED" || !activity.comment) continue;
      collectThread(activity.comment, activity.id, activity.commentAnchor, null, out, includeDeleted);
      if (out.length >= maxComments) break;
    }

    if (page.isLastPage || out.length >= maxComments) break;
    if (typeof page.nextPageStart === "number") {
      start = page.nextPageStart;
    } else {
      // Defensive — older Bitbucket Server omits nextPageStart on last page.
      start += pageSize;
    }
  }

  const truncated = out.length >= maxComments;
  const content = JSON.stringify(
    {
      total: out.length,
      truncated,
      pagesWalked,
      maxComments,
      comments: out,
    },
    null,
    2,
  );
  const citations: Citation[] = [
    { kind: "external", url: prUrl(baseUrl, projectKey, repoSlug, prId), chunkIndex: 1, label: `Bitbucket PR #${prId} comments` },
  ];
  return { content: prefixChunk(1, content), citations };
}


/**
 * Handle the get-pr-template tool call.
 * Bitbucket Data Center has no native PR-template API, so we read a template FILE from the
 * repo via the raw content endpoint, probing a small ordered list of conventional paths.
 * Read-only. Uses the same Basic-auth credentials as every other Bitbucket call — Bitbucket
 * enforces repo read ACL on the token, so this grants no new privilege.
 */
const DEFAULT_PR_TEMPLATE_PATHS = [
  "PULL_REQUEST_TEMPLATE.md",
  ".bitbucket/pull_request_template.md",
  ".bitbucket/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
];

export async function handleGetPrTemplate(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const username = credentials["username"] as string;
  const token = credentials["token"] as string;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.juspay.net").replace(/\/+$/, "");

  const projectKey = params["projectKey"] as string;
  const repoSlug = params["repoSlug"] as string;
  const at = (params["at"] as string | undefined)?.trim() || undefined;
  const explicitPath = (params["path"] as string | undefined)?.trim() || undefined;

  if (!projectKey || !repoSlug) {
    throw new Error("get-pr-template: projectKey and repoSlug are required");
  }
  // Guard the caller-supplied path: encodeURIComponent does NOT encode ".", so a ".." segment
  // would survive as real path traversal. Reject absolute paths and any ".." / empty segment.
  if (
    explicitPath &&
    (/^[\\/]/.test(explicitPath) || explicitPath.split(/[\\/]/).some((seg) => seg === ".." || seg === ""))
  ) {
    throw new Error("get-pr-template: path must be a relative repo path with no '..' or empty segments");
  }

  const authHeader = "Basic " + Buffer.from(`${username}:${token}`).toString("base64");
  const candidates = explicitPath ? [explicitPath] : DEFAULT_PR_TEMPLATE_PATHS;
  const tried: string[] = [];

  for (const path of candidates) {
    // Encode each path segment to prevent traversal / stray query chars leaking into the URL.
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    let url = `${baseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}/raw/${encodedPath}`;
    if (at) url += `?at=${encodeURIComponent(at)}`;

    tried.push(path);
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "text/plain" },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 404) continue; // no such file -> try next candidate
    if (res.status === 401 || res.status === 403) {
      throw new Error(`get-pr-template: not authorized to read ${projectKey}/${repoSlug} (${res.status})`);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Bitbucket raw file API failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const content = await res.text();
    const body = JSON.stringify({ found: true, path, at: at ?? null, content, triedPaths: tried }, null, 2);
    const citations: Citation[] = [
      { kind: "external", url: fileUrl(baseUrl, projectKey, repoSlug, path, at), chunkIndex: 1, label: `Bitbucket file ${path}` },
    ];
    return { content: prefixChunk(1, body), citations };
  }

  return { content: JSON.stringify({ found: false, path: null, at: at ?? null, content: null, triedPaths: tried }, null, 2) };
}

// ── list-pull-requests ────────────────────────────────────────────────────────

interface BbPrRef {
  id?: string;                 // e.g. refs/heads/vpa-beta
  displayId?: string;          // e.g. vpa-beta
  repository?: { slug?: string; project?: { key?: string } };
}

interface BbPullRequest {
  id?: number;
  title?: string;
  state?: string;
  createdDate?: number;
  updatedDate?: number;
  closedDate?: number;
  author?: { user?: { name?: string; displayName?: string } };
  fromRef?: BbPrRef;
  toRef?: BbPrRef;
}

interface BbPrPage {
  values?: BbPullRequest[];
  size?: number;
  isLastPage?: boolean;
  nextPageStart?: number;
}

/** `vpa-beta` and `refs/heads/vpa-beta` are the same branch; callers pass either. */
function normalizeBranchRef(branch: string): { ref: string; displayId: string } {
  const trimmed = branch.trim().replace(/^\/+|\/+$/g, "");
  const displayId = trimmed.replace(/^refs\/heads\//, "");
  return { ref: `refs/heads/${displayId}`, displayId };
}

/**
 * Enumerate pull requests with server-side state + target-branch filtering.
 *
 * The upstream MCP's PR list returns one page and leaves target-branch matching
 * to the caller. Filtering client-side across pages is where "the last 1000
 * merged PRs into <branch>" quietly becomes a partial list: each page is capped
 * BEFORE the filter, so a page of 100 may contribute 3 matches, and stopping at
 * N pages stops at an arbitrary point in the filtered set. Bitbucket Server
 * supports `at=<ref>&direction=INCOMING`, which applies the branch filter before
 * pagination — so a page boundary can no longer hide matches.
 *
 * Completeness is reported, not assumed: `complete` is true only when Bitbucket
 * itself said isLastPage. A caller that needs a provable manifest can assert on
 * that flag rather than trusting a count.
 */
export async function handleListPullRequests(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const username = credentials["username"] as string;
  const token = credentials["token"] as string;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.juspay.net").replace(/\/+$/, "");

  const projectKey = params["projectKey"] as string;
  const repoSlug = params["repoSlug"] as string;
  if (!projectKey || !repoSlug) {
    throw new Error("list-pull-requests: projectKey and repoSlug are required");
  }

  const state = ((params["state"] as string) || "MERGED").toUpperCase();
  const order = ((params["order"] as string) || "NEWEST").toUpperCase();
  const max = typeof params["max"] === "number" ? Math.max(1, params["max"] as number) : 1000;
  const idsOnly = params["idsOnly"] === true;
  const targetBranchRaw = typeof params["targetBranch"] === "string" ? (params["targetBranch"] as string).trim() : "";
  const target = targetBranchRaw ? normalizeBranchRef(targetBranchRaw) : null;

  const authHeader = "Basic " + Buffer.from(`${username}:${token}`).toString("base64");
  const pageSize = 100;
  const collected: BbPullRequest[] = [];
  const mismatches: Array<{ id: number; toRef: string }> = [];
  let start = 0;
  let pagesWalked = 0;
  let sawLastPage = false;
  const maxPages = 500; // 50k PRs — far beyond any real repo, purely a runaway guard

  while (collected.length < max && pagesWalked < maxPages) {
    const qs = new URLSearchParams({
      state,
      order,
      limit: String(pageSize),
      start: String(start),
    });
    if (target) {
      // `at` alone matches EITHER side of the PR; direction=INCOMING restricts
      // it to PRs whose DESTINATION is this ref, which is what "merged into X"
      // means. Without direction, PRs merged FROM this branch leak in.
      qs.set("at", target.ref);
      qs.set("direction", "INCOMING");
    }

    const url = `${baseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}/pull-requests?${qs.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Bitbucket pull-requests API failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const page = (await res.json()) as BbPrPage;
    pagesWalked++;
    const values = page.values ?? [];

    for (const pr of values) {
      if (typeof pr.id !== "number") continue;
      // Belt-and-braces: re-assert the server-side filter actually held. A
      // mismatch is surfaced, never silently dropped — a wrong filter that
      // quietly returns fewer rows is exactly the failure this tool exists to
      // rule out.
      if (target) {
        const toDisplay = pr.toRef?.displayId ?? pr.toRef?.id?.replace(/^refs\/heads\//, "") ?? "";
        if (toDisplay !== target.displayId) {
          mismatches.push({ id: pr.id, toRef: toDisplay || "(unknown)" });
          continue;
        }
      }
      collected.push(pr);
      if (collected.length >= max) break;
    }

    if (page.isLastPage === true) { sawLastPage = true; break; }
    const next = typeof page.nextPageStart === "number" ? page.nextPageStart : start + values.length;
    // No forward progress => stop rather than loop forever on a server that
    // omits both isLastPage and nextPageStart.
    if (values.length === 0 || next <= start) { sawLastPage = values.length === 0; break; }
    start = next;
  }

  const ids = collected.map((pr) => pr.id as number);
  const complete = sawLastPage && collected.length < max;

  const manifest = {
    projectKey,
    repoSlug,
    state,
    targetBranch: target?.displayId ?? null,
    order,
    count: ids.length,
    /** TRUE only when Bitbucket reported isLastPage — i.e. this is the entire
     *  matching set, not a page-limited prefix. Assert on this before claiming
     *  "all N were processed". */
    complete,
    truncatedByMax: collected.length >= max,
    pagesWalked,
    ids,
    ...(mismatches.length > 0 ? { targetBranchMismatches: mismatches } : {}),
    ...(idsOnly ? {} : {
      pullRequests: collected.map((pr) => ({
        id: pr.id,
        title: pr.title ?? "",
        state: pr.state ?? "",
        author: pr.author?.user?.displayName ?? pr.author?.user?.name ?? "",
        fromRef: pr.fromRef?.displayId ?? "",
        toRef: pr.toRef?.displayId ?? "",
        closedDate: pr.closedDate ? new Date(pr.closedDate).toISOString() : null,
        updatedDate: pr.updatedDate ? new Date(pr.updatedDate).toISOString() : null,
      })),
    }),
  };

  return { content: JSON.stringify(manifest, null, 2) };
}
