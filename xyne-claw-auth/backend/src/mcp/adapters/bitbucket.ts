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
      args: ["-y", "@nexus2520/bitbucket-mcp-server"],
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
      "Upload a screenshot file to a Bitbucket pull request. Returns a markdown image link that can be embedded in the PR description. " +
      "The file must exist on disk (e.g. screenshots taken during testing).",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Bitbucket project key (e.g. XYNE)" },
        repoSlug: { type: "string", description: "Repository slug (e.g. xyne-spaces)" },
        prId: { type: "string", description: "Pull request ID (number as string)" },
        filePath: { type: "string", description: "Absolute path to the screenshot file on disk" },
        caption: { type: "string", description: "Caption/alt text for the image" },
      },
      required: ["projectKey", "repoSlug", "prId", "filePath"],
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
  const { readFile } = await import("node:fs/promises");
  const { basename } = await import("node:path");

  const username = credentials["username"] as string;
  const token = credentials["token"] as string;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.example.com").replace(/\/+$/, "");

  const projectKey = params["projectKey"] as string;
  const repoSlug = params["repoSlug"] as string;
  const prId = params["prId"] as string;
  const filePath = params["filePath"] as string;
  const caption = (params["caption"] as string) || basename(filePath);

  // Read file from disk
  const fileBuffer = await readFile(filePath);
  const fileName = basename(filePath);

  const authHeader = "Basic " + Buffer.from(`${username}:${token}`).toString("base64");

  // Upload as repo attachment — Bitbucket Server returns attachment metadata with links
  const uploadUrl = `${baseUrl}/rest/api/1.0/projects/${projectKey}/repos/${repoSlug}/attachments`;

  const boundary = "----XyneUpload" + Date.now();
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n`,
    `Content-Type: image/png\r\n\r\n`,
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
