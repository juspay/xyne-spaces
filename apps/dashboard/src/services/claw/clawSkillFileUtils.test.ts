import { describe, expect, it } from 'vitest';

import { readSkillBundleFromFileList } from './clawSkillFileUtils';

// Minimal stand-in for the browser File objects an <input webkitdirectory> pick
// produces. readSkillBundleFromFileList only reads name/type/size/webkitRelativePath
// and, for text files, text() — so a real File or DOM is unnecessary.
function stubFile(webkitRelativePath: string, content: string, type = 'text/markdown'): File {
  const name = webkitRelativePath.split('/').pop() ?? webkitRelativePath;
  return {
    name,
    type,
    size: content.length,
    webkitRelativePath,
    text: async () => content,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  } as unknown as File;
}

// The function only does Array.from(files), so an array is an adequate FileList.
function asFileList(files: File[]): FileList {
  return files as unknown as FileList;
}

describe('readSkillBundleFromFileList — folder upload split (regression for PR #1403)', () => {
  it('routes SKILL.md into mainContent and sends ONLY sibling files to files[]', async () => {
    const bundle = await readSkillBundleFromFileList(
      asFileList([
        stubFile('my-skill/SKILL.md', '# My Skill\ninstructions'),
        stubFile('my-skill/reference.md', 'reference body'),
        stubFile('my-skill/data/config.json', '{"a":1}', 'application/json'),
      ]),
    );

    // SKILL.md body becomes the canonical skill content (Skill.content via updateSkill),
    // NOT a sibling file (the files endpoint rejects a "SKILL.md" relativePath).
    expect(bundle.mainContent).toBe('# My Skill\ninstructions');
    expect(bundle.folderSlug).toBe('my-skill');

    const paths = bundle.files.map(f => f.relativePath).sort();
    expect(paths).toEqual(['data/config.json', 'reference.md']);
    // The exact regression: SKILL.md must never be sent to replaceSkillFiles.
    expect(bundle.files.some(f => f.relativePath === 'SKILL.md')).toBe(false);
  });

  it('leaves mainContent null when a folder upload has no SKILL.md', async () => {
    const bundle = await readSkillBundleFromFileList(
      asFileList([
        stubFile('my-skill/reference.md', 'reference body'),
        stubFile('my-skill/notes.md', 'notes'),
      ]),
    );

    expect(bundle.mainContent).toBeNull();
    expect(bundle.files.map(f => f.relativePath).sort()).toEqual(['notes.md', 'reference.md']);
  });
});
