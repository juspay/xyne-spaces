/**
 * read-app-file — the read half of incremental updates.
 *
 * `create-app` hands back only a manifest: file *paths*, never contents. The
 * bytes go straight to object storage. So an agent asked to "change the header
 * colour" could not see the header — it rewrote all fifteen files from its
 * memory of the conversation, which is how features silently disappeared and
 * bugs fixed two versions ago came back.
 *
 * This closes that loop. Read the files you intend to change, then send only
 * those back through `create-app` with `mode: "update"`.
 *
 * Reads HEAD, the same build `create-app` merges onto, so the code you read is
 * exactly the code your patch lands on. Both go through one S2S route in
 * claw-auth, keyed by conversation — Step 1 made a conversation own exactly one
 * app, which is what makes that key unambiguous.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { REACT_ARTIFACT_CONFIG_SCHEMA } from "./tools.js";
import type { ReactArtifactFile, ReactArtifactPayload } from "./tools.js";

const READ_TIMEOUT_MS = 15_000;

/** A single file's content is capped well below the runtime's tool-result
 *  truncation so a large file arrives whole rather than silently clipped. */
const MAX_CONTENT_CHARS = 48_000;

interface HeadApp {
  payload: ReactArtifactPayload;
  versionNumber: number;
}

async function fetchHead(
  context?: ToolExecutionContext,
): Promise<{ ok: true; head: HeadApp } | { ok: false; error: string }> {
  const conversationId = context?.meta?.["conversationId"];
  if (!conversationId) {
    return { ok: false, error: "Error: this run has no conversation, so there is no app to read." };
  }

  const authUrl = context?.config?.["XYNE_CLAW_AUTH_URL"] ?? "http://localhost:3003";
  const s2sKey = context?.config?.["XYNE_CLAW_S2S_KEY"] ?? "";
  const url = `${authUrl}/claw/api/v1/internal/artifact-apps/by-conversation/${encodeURIComponent(conversationId)}/payload`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { ...(s2sKey ? { "x-s2s-key": s2sKey } : {}) },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Error: could not read the app (${message}). Retry.` };
  }

  if (res.status === 404) {
    return {
      ok: false,
      error:
        'Error: this conversation has no app yet. Build one first with create-app and `mode: "create"`.',
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Error: could not read the app (HTTP ${res.status}). Retry.` };
  }

  let body: { payload?: unknown; versionNumber?: unknown };
  try {
    body = (await res.json()) as { payload?: unknown; versionNumber?: unknown };
  } catch {
    return { ok: false, error: "Error: the app came back unreadable. Retry." };
  }

  const payload = body.payload as ReactArtifactPayload | undefined;
  if (!payload || !Array.isArray(payload.files)) {
    return { ok: false, error: "Error: the app has no readable files." };
  }

  return {
    ok: true,
    head: { payload, versionNumber: typeof body.versionNumber === "number" ? body.versionNumber : 0 },
  };
}

/** The listing shown when no path is given: enough to decide what to read next
 *  without pulling every file's contents into the context window. */
function formatListing(head: HeadApp): string {
  const { payload } = head;
  const lines = payload.files.map((f: ReactArtifactFile) => {
    const bytes = Buffer.byteLength(f.content ?? "", "utf8");
    const entry = f.path === payload.entry ? "  (entry)" : "";
    return `  ${f.path}  —  ${bytes} bytes${entry}`;
  });
  const deps = Object.keys(payload.dependencies ?? {});
  return (
    `"${payload.title}" — version ${head.versionNumber}, ${payload.files.length} file(s):\n` +
    `${lines.join("\n")}\n` +
    `dependencies: ${deps.length ? deps.join(", ") : "(none)"}\n\n` +
    "Read the files you intend to change, then call create-app with " +
    '`mode: "update"` and only those files.'
  );
}

export const readArtifactAppFileTool: ToolDefinition = {
  slug: "read-app-file",
  name: "Read app file",
  source: "custom:react-artifact",
  configSchema: REACT_ARTIFACT_CONFIG_SCHEMA,
  description:
    "Read the current source of the app this conversation has already built. Call with no `path` to " +
    "list its files, then with a `path` to read one.\n\n" +
    "ALWAYS read before you change. create-app returns only file paths, never contents, so this is " +
    "the only way to see the code you are editing — without it you are rewriting from memory, which " +
    "is how earlier features get dropped. Read the files you intend to change, then send just those " +
    'back through create-app with `mode: "update"`.\n\n' +
    "Reads the version the app is currently on, which is the same build your update merges onto — " +
    "including after the user has rolled back to an earlier version.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Exact file path to read, e.g. "/App.tsx". Omit to list every file with its size.',
      },
    },
    required: [],
  },
  execute: async (
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> => {
    const result = await fetchHead(context);
    if (!result.ok) return result.error;
    const { head } = result;

    const raw = params["path"];
    const path = typeof raw === "string" ? raw.trim() : "";
    if (!path) return formatListing(head);

    const file = head.payload.files.find((f: ReactArtifactFile) => f.path === path);
    if (!file) {
      const known = head.payload.files.map((f: ReactArtifactFile) => f.path).join(", ");
      return `Error: no file at "${path}". The app has: ${known}.`;
    }

    const content = file.content ?? "";
    if (content.length > MAX_CONTENT_CHARS) {
      return (
        `${path} (truncated at ${MAX_CONTENT_CHARS} of ${content.length} characters — ` +
        "this file is too large to edit safely; consider splitting it):\n\n" +
        content.slice(0, MAX_CONTENT_CHARS)
      );
    }
    return `${path}:\n\n${content}`;
  },
};
