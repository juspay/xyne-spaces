import type { StdioMcpAdapter, McpToolInfo } from "../types.js";
import type { Citation } from "xyne-claw-shared";
import { prefixChunk } from "./grafana.js";

export const githubAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "github",
  healthCheck: { name: "search_repositories", params: { query: "test" } },
  writeTools: [
    "create_repository",
    "merge_pull_request",
  ],
  credentialFields: [
    { name: "token", label: "GitHub Personal Access Token", type: "password", placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx" },
  ],
  buildCommand(credentials) {
    const token = credentials["token"] as string;

    return {
      cmd: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"],
      env: {
        GITHUB_TOKEN: token,
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
      },
    };
  },
};

// ── Custom GitHub tools (handled locally, not forwarded to MCP server) ──

export const GITHUB_CUSTOM_TOOLS: McpToolInfo[] = [
  {
    name: "upload-pr-attachment",
    description:
      "Upload proof-of-test media (screenshot or screen recording) to GitHub's attachment CDN and get back markdown to embed in a PR body or issue comment. " +
      "Nothing is committed to a branch, so proof media never enters the repo's history.\n\n" +
      "IMAGES AND VIDEO ONLY: png, jpg, gif, webp, svg, mp4, webm, mov. GitHub rejects pdf, zip, txt, log, json and csv outright — " +
      "for a log or other non-media artifact, paste the relevant excerpt into the PR body as a fenced code block instead.\n\n" +
      "Pass the bytes via `fileData` (base64). For screenshots from `sandbox-pw-screenshot`, or any file read with `sandbox-read-file`, the bytes are returned inline in the tool result — pass that base64 string here. " +
      "`fileName` is required and its EXTENSION decides the content type.\n\n" +
      "Videos: record with Playwright, then transcode webm to mp4 (`ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p out.mp4`) for broad playback. " +
      "The returned markdown puts a video URL on its own bare line because that is what makes GitHub render a player — `![](...)` does not.\n\n" +
      "Pass `prNumber` to also post the markdown as a comment on that PR/issue. " +
      "The asset inherits the repository's visibility, so for a private repo the URL only renders for people who can already see the repo.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repository owner / org (e.g. juspay)" },
        repo: { type: "string", description: "Repository name (e.g. xyne-spaces)" },
        fileData: { type: "string", description: "Base64-encoded file bytes. Use the bytes from sandbox-pw-screenshot's [ATTACHMENT:...] payload or sandbox-read-file's [INSPECT:...] payload." },
        fileName: { type: "string", description: "Filename for the upload, e.g. login-flow.mp4. The extension sets the content type." },
        prNumber: { type: "number", description: "Optional PR or issue number. When set, the markdown is also posted as a comment there." },
        caption: { type: "string", description: "Alt text / caption. Defaults to the filename." },
      },
      required: ["owner", "repo", "fileData", "fileName"],
    },
  },
];

// ── Citation URL builders ───────────────────────────────────────────────────

function prUrl(owner: string, repo: string, prNumber: number | string): string {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

// ── upload-pr-attachment ────────────────────────────────────────────────────

/**
 * Extensions GitHub's attachment endpoint accepts. This is IMAGES AND VIDEO
 * ONLY — verified against the live endpoint on 2026-08-15: png/jpg/gif/webp/
 * svg/mp4/webm/mov return 201, while pdf, zip, txt, json, csv and
 * application/octet-stream all return 422 "Validation Failed". There is no
 * container format that smuggles a log or a PDF through, so callers with a
 * non-media artifact must use a different channel entirely.
 *
 * Rejecting locally saves a round trip and, more importantly, lets the error
 * name a route that actually works instead of suggesting a zip that 422s too.
 */
const ATTACHMENT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

const UNSUPPORTED_TYPE_HINT =
  "GitHub PR attachments accept images and video only (png, jpg, gif, webp, svg, mp4, webm, mov) — " +
  "pdf, zip, txt, json and csv are all rejected. For a log or other non-media artifact, paste the " +
  "relevant excerpt into the PR body as a fenced code block, or send the file to the user with " +
  "`sandbox-deliver-files`.";

const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

/** GitHub caps attachment uploads; 100 MB is the video ceiling in the web UI. */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const GITHUB_API_VERSION = "2026-03-10";

/**
 * GitHub renders a player for a video URL on its OWN bare line; the `![]()`
 * image syntax does not. Images are the reverse. Getting this wrong is the
 * single most common reason a "proof video" shows up as a dead link.
 */
export function embedMarkdown(caption: string, url: string, contentType: string): string {
  if (VIDEO_MIME.has(contentType)) return url;
  if (IMAGE_MIME.has(contentType)) return `![${caption}](${url})`;
  return `[${caption}](${url})`;
}

/**
 * Handle the upload-pr-attachment tool call.
 *
 * Uses the same undocumented endpoint the GitHub web UI hits when you drag a
 * file into a comment box:
 *
 *   POST https://uploads.github.com/user-attachments/assets
 *        ?name=<f>&content_type=<mime>&repository_id=<id>
 *
 * The token needs PUSH access to the repo (GitHub answers 404 otherwise —
 * it does not distinguish "missing" from "not yours" here). Runs in claw-auth
 * because that is where the connection's PAT lives; it is decrypted per call
 * and never leaves this process.
 */
export async function handleUploadPrAttachment(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const token = credentials["token"] as string;

  const owner = (params["owner"] as string | undefined)?.trim();
  const repo = (params["repo"] as string | undefined)?.trim();
  const fileData = params["fileData"] as string | undefined;
  const fileName = (params["fileName"] as string | undefined)?.trim();
  const prNumberRaw = params["prNumber"];

  if (!owner || !repo) {
    throw new Error("upload-pr-attachment: owner and repo are required");
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw new Error("upload-pr-attachment: owner/repo contain unsupported characters");
  }
  if (!fileData || typeof fileData !== "string") {
    throw new Error("upload-pr-attachment: fileData (base64) is required");
  }
  if (!fileName) {
    throw new Error("upload-pr-attachment: fileName is required (its extension sets the content type)");
  }

  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const contentType = ATTACHMENT_MIME[ext];
  if (!contentType) {
    throw new Error(
      `upload-pr-attachment: cannot attach '.${ext || "(no extension)"}'. ${UNSUPPORTED_TYPE_HINT}`,
    );
  }

  // Accept a bare base64 string or a data: URI, same as the Bitbucket tool.
  const comma = fileData.indexOf(",");
  const b64 = fileData.startsWith("data:") && comma >= 0 ? fileData.slice(comma + 1) : fileData;
  const fileBuffer = Buffer.from(b64, "base64");
  if (fileBuffer.length === 0) {
    throw new Error("upload-pr-attachment: fileData decoded to empty bytes");
  }
  if (fileBuffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `upload-pr-attachment: ${(fileBuffer.length / (1024 * 1024)).toFixed(1)} MB exceeds GitHub's 100 MB attachment limit — shorten the recording or re-encode at a lower bitrate`,
    );
  }

  const caption = (params["caption"] as string | undefined)?.trim() || fileName;
  const auth = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "xyne-spaces",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };

  // The upload endpoint keys off the numeric repository id, not owner/name.
  const lookupRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { ...auth, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (lookupRes.status === 404) {
    throw new Error(
      `upload-pr-attachment: ${owner}/${repo} not found. The connected GitHub token needs push access to it.`,
    );
  }
  if (lookupRes.status === 401 || lookupRes.status === 403) {
    throw new Error(
      `upload-pr-attachment: GitHub rejected the connected token (${lookupRes.status}) — it may be expired or missing repo scope.`,
    );
  }
  if (!lookupRes.ok) {
    const errText = await lookupRes.text().catch(() => "");
    throw new Error(`GitHub repo lookup failed (${lookupRes.status}): ${errText.slice(0, 300)}`);
  }
  const repositoryId = Number(((await lookupRes.json()) as { id?: unknown }).id);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error("GitHub repo lookup returned no usable repository id");
  }

  const uploadUrl =
    `https://uploads.github.com/user-attachments/assets` +
    `?name=${encodeURIComponent(fileName)}` +
    `&content_type=${encodeURIComponent(contentType)}` +
    `&repository_id=${repositoryId}`;

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { ...auth, Accept: "application/json", "Content-Type": contentType },
    body: fileBuffer,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (uploadRes.status === 422) {
    throw new Error(
      `upload-pr-attachment: GitHub rejected content type '${contentType}'. ${UNSUPPORTED_TYPE_HINT}`,
    );
  }
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`GitHub attachment upload failed (${uploadRes.status}): ${errText.slice(0, 300)}`);
  }
  const assetUrl = ((await uploadRes.json().catch(() => null)) as { url?: unknown } | null)?.url;
  if (typeof assetUrl !== "string" || !assetUrl.startsWith("https://")) {
    throw new Error("GitHub accepted the upload but returned no asset URL");
  }

  const markdown = embedMarkdown(caption, assetUrl, contentType);
  const prNumber =
    typeof prNumberRaw === "number" && Number.isSafeInteger(prNumberRaw) && prNumberRaw > 0
      ? prNumberRaw
      : undefined;

  if (prNumber === undefined) {
    return {
      content: prefixChunk(
        1,
        `Uploaded ${fileName} (${(fileBuffer.length / 1024).toFixed(0)} KB). Paste this into the PR body verbatim — a video URL must stay on its own bare line:\n\n${markdown}`,
      ),
    };
  }

  // PR/issue comments share the issues endpoint on GitHub.
  const commentRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: { ...auth, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ body: markdown }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  const citations: Citation[] = [
    { kind: "external", url: prUrl(owner, repo, prNumber), chunkIndex: 1, label: `GitHub PR #${prNumber}` },
  ];

  if (!commentRes.ok) {
    const errText = await commentRes.text().catch(() => "");
    // The upload succeeded — surface the URL rather than losing it to the
    // comment failure, same as the Bitbucket tool does.
    return {
      content: prefixChunk(
        1,
        `Uploaded ${fileName}: ${assetUrl}\n(Warning: could not comment on #${prNumber} — HTTP ${commentRes.status}: ${errText.slice(0, 200)}. Add it manually:)\n\n${markdown}`,
      ),
      citations,
    };
  }

  return {
    content: prefixChunk(1, `Uploaded ${fileName} and commented on #${prNumber}:\n\n${markdown}`),
    citations,
  };
}
