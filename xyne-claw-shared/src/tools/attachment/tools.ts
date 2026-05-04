import type { ToolDefinition } from "../types.js";

/**
 * Tool to prepare file attachments for sending to Spaces.
 * Returns a special marker that xyne-claw extracts and sends via webhook.
 */
export const sendAttachmentTool: ToolDefinition = {
  slug: "send-attachment",
  name: "Send File Attachment",
  description:
    "Prepare a file to be sent as an attachment to the channel. " +
    "The file will be uploaded when the agent's response is processed. " +
    "Supported files: images (PNG, JPG, GIF), documents (PDF, DOCX), and any other file type.",
  source: "custom:attachment",
  inputSchema: {
    type: "object",
    properties: {
      fileName: {
        type: "string",
        description: "Name of the file including extension (e.g., 'report.pdf', 'chart.png')",
      },
      mimeType: {
        type: "string",
        description: "MIME type of the file (e.g., 'application/pdf', 'image/png', 'text/csv')",
      },
      data: {
        type: "string",
        description: "Base64 encoded file content",
      },
    },
    required: ["fileName", "mimeType", "data"],
  },
  async execute(args, _ctx) {
    const fileName = args["fileName"] as string;
    const mimeType = args["mimeType"] as string;
    const data = args["data"] as string;

    if (!fileName || !fileName.trim()) {
      throw new Error("fileName is required");
    }
    if (!mimeType || !mimeType.trim()) {
      throw new Error("mimeType is required");
    }
    if (!data || !data.trim()) {
      throw new Error("data (base64 content) is required");
    }

    // Validate base64 format (basic check)
    try {
      Buffer.from(data, "base64");
    } catch {
      throw new Error("data must be valid base64 encoded content");
    }

    // Return format recognized by xyne-claw/src/custom-tools.ts ATTACHMENT_RE regex
    // Format: [ATTACHMENT:filename:mimetype]
    // base64data
    return `[ATTACHMENT:${fileName}:${mimeType}]\n${data}`;
  },
};
