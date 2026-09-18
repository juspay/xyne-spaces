import { promises as fs } from 'fs';

const INLINE_MIME_RE = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|typescript|sql|csv))/i;
const INLINE_EXT_RE = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|log|ini|toml|env|ts|tsx|js|jsx|py|rb|go|rs|java|c|h|cpp|sh|sql|html?|css)$/i;
const INLINE_CHAR_BUDGET = 120_000;

export interface RunAttachment {
  path: string;
  fileName: string;
  mimeType: string;
}

export interface AttachmentPrompt {
  note: string;
  images: RunAttachment[];
  needsFileTools: boolean;
}

function isInlineable(file: RunAttachment): boolean {
  return INLINE_MIME_RE.test(file.mimeType) || INLINE_EXT_RE.test(file.fileName);
}

export async function buildAttachmentPrompt(files: RunAttachment[]): Promise<AttachmentPrompt> {
  if (files.length === 0) return { note: '', images: [], needsFileTools: false };

  const images = files.filter((file) => file.mimeType.startsWith('image/'));
  const rest = files.filter((file) => !file.mimeType.startsWith('image/'));

  const sections: string[] = [];
  let budget = INLINE_CHAR_BUDGET;
  let needsFileTools = false;

  for (const file of rest) {
    if (isInlineable(file) && budget > 0) {
      try {
        const text = await fs.readFile(file.path, 'utf8');
        const slice = text.slice(0, budget);
        budget -= slice.length;
        sections.push(
          `File: ${file.fileName}\n\`\`\`\n${slice}${slice.length < text.length ? '\n… (truncated)' : ''}\n\`\`\``,
        );
        continue;
      } catch {
        /* fall through to the path form */
      }
    }
    needsFileTools = true;
    sections.push(`File: ${file.fileName} (${file.mimeType}) — read it at ${file.path}`);
  }

  if (images.length) {
    sections.push(
      `Images attached to this message: ${images.map((file) => file.fileName).join(', ')}.`,
    );
  }

  return {
    note:
      `<attachments>\nThe user attached these to this message; use them before answering. ` +
      `If you cannot open one of these files, say so plainly — never infer its contents from its name or guess.\n` +
      `${sections.join('\n\n')}\n</attachments>`,
    images,
    needsFileTools,
  };
}
