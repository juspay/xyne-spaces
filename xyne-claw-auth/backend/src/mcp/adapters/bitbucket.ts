import type { StdioMcpAdapter, McpToolInfo } from "../types.js";

export const bitbucketAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "bitbucket",
  healthCheck: { name: "list_projects", params: { limit: 1, start: 0 } },
  writeTools: ["merge_pull_request"],
  credentialFields: [
    { name: "username", label: "Bitbucket Username", type: "text", placeholder: "your-username" },
    { name: "token", label: "Bitbucket Token", type: "password", placeholder: "Enter your Bitbucket access token" },
    { name: "baseUrl", label: "Bitbucket Base URL", type: "text", placeholder: "https://bitbucket.example.com", optional: true },
  ],
  buildCommand(credentials) {
    const username = credentials["username"] as string;
    const token = credentials["token"] as string;
    const baseUrl = (credentials["baseUrl"] as string) || "https://bitbucket.example.com";
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
];

/**
 * Handle the upload-pr-screenshot tool call.
 * Uploads the file to Bitbucket Server attachments API, then comments on the PR with the image.
 */
export async function handleUploadPrScreenshot(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<string> {
  const username = credentials["username"] as string;
  const token = credentials["token"] as string;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.example.com").replace(/\/+$/, "");

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

  if (!commentRes.ok) {
    // Attachment uploaded but comment failed — still return the URL
    return `Screenshot uploaded: ${fullUrl}\n(Warning: Failed to add PR comment — add manually)`;
  }

  return `Screenshot uploaded and added to PR #${prId}:\n![${caption}](${fullUrl})`;
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
): Promise<string> {
  const username = credentials["username"] as string;
  const token = credentials["token"] as string;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.example.com").replace(/\/+$/, "");

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
  return JSON.stringify(
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
}
