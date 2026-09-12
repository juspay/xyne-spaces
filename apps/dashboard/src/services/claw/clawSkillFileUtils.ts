// Ported (single-bundle path) from xyne-claw-auth/frontend/src/lib/skillFileUtils.ts
// so the dashboard's skill file upload produces the exact payload the claw-auth
// backend's PUT /api/v1/skills/:slug/files expects. Keep in sync with that source.

export interface PendingSkillFile {
  relativePath: string;
  content: string;
  contentType?: string;
  sizeBytes: number;
}

export interface SkillBundle {
  /** Sibling files (everything except SKILL.md). */
  files: PendingSkillFile[];
  /** SKILL.md body, if the picker included one. */
  mainContent: string | null;
  /** Top-level folder name normalised to kebab-case, or null for flat-file picks. */
  folderSlug: string | null;
}

function isBinaryFile(f: File, relativePath: string): boolean {
  const type = (f.type || '').toLowerCase();
  if (type) {
    if (type.startsWith('text/')) return false;
    if (type === 'application/json' || type === 'application/yaml' || type === 'application/xml')
      return false;
    if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/'))
      return true;
    if (
      type === 'application/pdf' ||
      type === 'application/zip' ||
      type === 'application/octet-stream' ||
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
      return true;
  }
  const dot = relativePath.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = relativePath.slice(dot).toLowerCase();
  return new Set([
    '.pdf',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.tiff',
    '.docx',
    '.pptx',
    '.xlsx',
    '.xlsm',
    '.zip',
    '.gz',
    '.tar',
    '.ttf',
    '.otf',
    '.woff',
    '.woff2',
    '.mp3',
    '.mp4',
    '.wav',
    '.webm',
    '.mov',
    '.bin',
    '.dat',
  ]).has(ext);
}

async function fileToBase64(f: File): Promise<string> {
  const ab = await f.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function readSkillBundleFromFileList(files: FileList): Promise<SkillBundle> {
  const out: PendingSkillFile[] = [];
  let mainContent: string | null = null;
  let folderSlug: string | null = null;

  for (const f of Array.from(files)) {
    const raw = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = raw.split('/').filter(Boolean);
    if (folderSlug === null && parts.length > 1) {
      folderSlug =
        parts[0]!
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/-{2,}/g, '-')
          .replace(/^-+|-+$/g, '') || null;
    }
    const relativePath = parts.length > 1 ? parts.slice(1).join('/') : parts.join('/');

    if (isBinaryFile(f, relativePath)) {
      out.push({
        relativePath,
        content: await fileToBase64(f),
        contentType: f.type || 'application/octet-stream',
        sizeBytes: f.size,
      });
      continue;
    }
    const text = await f.text();
    if (relativePath === 'SKILL.md') {
      mainContent = text;
      continue;
    }
    out.push({
      relativePath,
      content: text,
      ...(f.type ? { contentType: f.type } : {}),
      sizeBytes: text.length,
    });
  }

  // Flat single-file pick: a user who downloaded a skill as `my-skill.md` and
  // uploads that file directly (no folder, no SKILL.md) should get its body as
  // the skill content — not silently filed as a sibling with empty content.
  // Only when there's exactly ONE markdown file and no SKILL.md/folder, so
  // folder bundles keep the SKILL.md convention and ambiguous multi-md picks
  // are left for the user to resolve.
  if (mainContent === null && folderSlug === null) {
    const mdFiles = out.filter(f => /\.(md|markdown)$/i.test(f.relativePath));
    if (mdFiles.length === 1) {
      const main = mdFiles[0]!;
      mainContent = main.content;
      out.splice(out.indexOf(main), 1);
      folderSlug =
        main.relativePath
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/-{2,}/g, '-')
          .replace(/^-+|-+$/g, '') || null;
    }
  }

  return { files: out, mainContent, folderSlug };
}

export async function readSkillFilesFromFileList(files: FileList): Promise<PendingSkillFile[]> {
  return (await readSkillBundleFromFileList(files)).files;
}
