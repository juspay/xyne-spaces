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
 * Addressed by `appId`, and read AS the run's user through claw-auth's normal
 * app ACL: the owner reads HEAD — the same build `create-app` merges onto, so
 * the code you read is exactly the code your patch lands on — and anyone else
 * reads the published version, if there is one.
 */

import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { REACT_ARTIFACT_CONFIG_SCHEMA } from "./tools.js";
import type { ReactArtifactFile } from "./tools.js";
import { loadAppForUser, parseAppId, type AgentApp } from "./appApi.js";

/** A single file's content is capped well below the runtime's tool-result
 *  truncation so a large file arrives whole rather than silently clipped. */
const MAX_CONTENT_CHARS = 48_000;

/** The listing shown when no path is given: enough to decide what to read next
 *  without pulling every file's contents into the context window. */
function formatListing(app: AgentApp): string {
  const { payload, detail } = app;
  const lines = payload.files.map((f: ReactArtifactFile) => {
    const bytes = Buffer.byteLength(f.content ?? "", "utf8");
    const entry = f.path === payload.entry ? "  (entry)" : "";
    return `  ${f.path}  —  ${bytes} bytes${entry}`;
  });
  const deps = Object.keys(payload.dependencies ?? {});
  const access = detail.isOwner
    ? "Owned by the user — read the files you intend to change, then call create-app with " +
      '`mode: "update"`, this `appId`, and only those files.'
    : `Published by ${detail.ownerName ?? "someone else"} — read-only for this user. ` +
      'To build on it, create their own app with `mode: "create"`.';
  return (
    `"${payload.title}" — version ${app.versionNumber}, ${payload.files.length} file(s):\n` +
    `${lines.join("\n")}\n` +
    `dependencies: ${deps.length ? deps.join(", ") : "(none)"}\n\n` +
    access
  );
}

export const readArtifactAppFileTool: ToolDefinition = {
  slug: "read-app-file",
  name: "Read app file",
  source: "custom:react-artifact",
  configSchema: REACT_ARTIFACT_CONFIG_SCHEMA,
  description:
    "Read the source of an app by its `appId`. Call with no `path` to list its files, then with a " +
    "`path` to read one. Works on any app the user owns, and on apps published to their workspace.\n\n" +
    "ALWAYS read before you change. create-app returns only file paths, never contents, so this is " +
    "the only way to see the code you are editing — without it you are rewriting from memory, which " +
    "is how earlier features get dropped. Read the files you intend to change, then send just those " +
    'back through create-app with `mode: "update"` and the same `appId`.\n\n' +
    "For the user's own app this reads the version the app is currently on, which is the same build " +
    "your update merges onto — including after the user has rolled back to an earlier version. For " +
    "someone else's app it reads the published version.",
  inputSchema: {
    type: "object",
    properties: {
      appId: {
        type: "string",
        description:
          "Id of the app to read — from a create-app result, or given with an app the user attached.",
      },
      path: {
        type: "string",
        description:
          'Exact file path to read, e.g. "/App.tsx". Omit to list every file with its size.',
      },
    },
    required: ["appId"],
  },
  execute: async (
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> => {
    const appId = parseAppId(params["appId"]);
    if (!appId) {
      return "Error: `appId` is required — the id from a create-app result, or of an app the user attached.";
    }

    const result = await loadAppForUser(appId, context);
    if (!result.ok) return `Error: ${result.error}`;
    const head = result.value;

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
