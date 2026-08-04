import { readSkillFilesFromFileList } from '@/services/claw/clawSkillFileUtils';
import type { PendingSkillFile } from '@/services/claw/clawSkillFileUtils';
import { slugify } from '../create/wizardState';

export interface SkillPick {
  files: PendingSkillFile[];
  content: string | null;
  slug: string | null;
}

const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name);

function pathOf(file: File): string {
  const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return raw.split('/').filter(Boolean).join('/');
}

export async function readSkillPick(fileList: FileList): Promise<SkillPick> {
  const files = await readSkillFilesFromFileList(fileList);
  const picked = Array.from(fileList);

  const skillMd = picked.find(file => pathOf(file).split('/').pop() === 'SKILL.md');
  if (skillMd) {
    const segments = pathOf(skillMd).split('/');
    const folder = segments.length > 1 ? segments[segments.length - 2] : undefined;
    return {
      files,
      content: await skillMd.text(),
      slug: folder ? slugify(folder) : null,
    };
  }

  const markdown = picked.filter(file => isMarkdown(pathOf(file)));
  const only = markdown.length === 1 ? markdown[0] : undefined;
  if (only) {
    return {
      files: files.filter(file => file.relativePath !== pathOf(only)),
      content: await only.text(),
      slug: slugify(only.name.replace(/\.[^.]+$/, '')),
    };
  }

  return { files, content: null, slug: null };
}
