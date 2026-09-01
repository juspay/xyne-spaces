import { spacesAppFetchMultipart } from "../surfaces/spaces/client.js";

/**
 * Upload a generated markdown document as a thread attachment.
 *
 * FILE ONLY — deliberately no `flow` parameter. `/files/filesUpload`
 * (filesController.uploadFiles) does not read a flow field, so a card passed
 * here is silently dropped and no Approve/Decline buttons ever render. Post
 * approval cards separately via `/chat/postMessage` with `flow: <FlowDefinition>`.
 */
export async function postGeneratedMarkdownFile(args: {
  channelId: string;
  conversationId: string;
  workspaceId?: string | null;
  userId: string;
  appToken: string;
  filename: string;
  /** Text body, or raw bytes when `mimeType` says the payload is binary. */
  markdown: string | Uint8Array;
  mimeType?: string;
  /** Additional files to attach to the SAME message (Spaces' filesUpload takes
   *  repeated `files` parts). Used by /experiment findings, which ships the
   *  proof zip AND the readable .md side by side — the zip is the archive, the
   *  markdown is what people actually open in the thread. */
  extraFiles?: Array<{ filename: string; content: string | Uint8Array; mimeType?: string }>;
  summary: string;
}): Promise<void> {
  const form = new FormData();
  const mimeType = args.mimeType ?? "text/markdown";
  const body = typeof args.markdown === "string"
    ? [args.markdown]
    : [new Uint8Array(args.markdown)];
  form.append("files", new Blob(body, { type: mimeType }), args.filename);
  for (const extra of args.extraFiles ?? []) {
    const extraBody = typeof extra.content === "string"
      ? [extra.content]
      : [new Uint8Array(extra.content)];
    form.append("files", new Blob(extraBody, { type: extra.mimeType ?? "text/markdown" }), extra.filename);
  }
  form.append("channelId", args.channelId);
  form.append("conversationId", args.conversationId);
  form.append("userId", args.userId);
  if (args.workspaceId) form.append("workspaceId", args.workspaceId);
  form.append("markdownText", args.summary);
  form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));
  await spacesAppFetchMultipart("/files/filesUpload", form, args.appToken);
}
