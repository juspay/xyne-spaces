import type { SkillFileMeta } from '@/services/claw/clawSkillsTypes';

export const SKILL_MD = 'SKILL.md';

export interface SkillTreeFile {
  kind: 'file';
  name: string;
  path: string;
  /** null for SKILL.md, which lives on `Skill.content` rather than a file row. */
  fileId: string | null;
}

export interface SkillTreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: SkillTreeNode[];
}

export type SkillTreeNode = SkillTreeFile | SkillTreeFolder;

function sortNodes(nodes: SkillTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) if (node.kind === 'folder') sortNodes(node.children);
}

/**
 * Folders are implicit in `relativePath` — there is no folder row in the
 * database, so the tree is derived by splitting each path on '/'.
 */
export function buildSkillFileTree(files: readonly SkillFileMeta[]): SkillTreeNode[] {
  const root: SkillTreeFolder = { kind: 'folder', name: '', path: '', children: [] };

  for (const file of files) {
    const segments = file.relativePath.split('/').filter(Boolean);
    const leaf = segments.pop();
    if (!leaf) continue;

    let cursor = root;
    for (const segment of segments) {
      const existing = cursor.children.find(
        (node): node is SkillTreeFolder => node.kind === 'folder' && node.name === segment,
      );
      if (existing) {
        cursor = existing;
        continue;
      }
      const folder: SkillTreeFolder = {
        kind: 'folder',
        name: segment,
        path: cursor.path ? `${cursor.path}/${segment}` : segment,
        children: [],
      };
      cursor.children.push(folder);
      cursor = folder;
    }

    cursor.children.push({
      kind: 'file',
      name: leaf,
      path: file.relativePath,
      fileId: file.id,
    });
  }

  sortNodes(root.children);
  return [{ kind: 'file', name: SKILL_MD, path: SKILL_MD, fileId: null }, ...root.children];
}

export function collectFolderPaths(nodes: readonly SkillTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    paths.push(node.path);
    paths.push(...collectFolderPaths(node.children));
  }
  return paths;
}
