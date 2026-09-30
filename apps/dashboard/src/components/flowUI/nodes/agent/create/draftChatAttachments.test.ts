import { describe, expect, it } from 'vitest';
import {
  admitDraftFiles,
  DRAFT_ATTACHMENT_MAX_COUNT,
  DRAFT_ATTACHMENT_MAX_FILE_BYTES,
} from './draftChatAttachments';

const MB = 1024 * 1024;
const file = (name: string, size = 1024): { name: string; size: number } => ({ name, size });

describe('admitDraftFiles', () => {
  it('admits ordinary files', () => {
    const picked = [file('notes.txt'), file('plan.pdf')];
    expect(admitDraftFiles(picked, [])).toEqual({ admitted: picked, problem: null });
  });

  it('refuses a pick made only of blocked types', () => {
    const result = admitDraftFiles([file('setup.exe')], []);
    expect(result.admitted).toEqual([]);
    expect(result.problem).toMatch(/not allowed/);
  });

  it('refuses a pick with a file over 10MB', () => {
    const result = admitDraftFiles(
      [file('ok.txt'), file('huge.zip', DRAFT_ATTACHMENT_MAX_FILE_BYTES + 1)],
      [],
    );
    expect(result.admitted).toEqual([]);
    expect(result.problem).toMatch(/huge\.zip/);
  });

  it('fills the remaining slots and says why the rest were left', () => {
    const attached = Array.from({ length: DRAFT_ATTACHMENT_MAX_COUNT - 1 }, () => ({ size: 1 }));
    const result = admitDraftFiles([file('a.txt'), file('b.txt')], attached);
    expect(result.admitted.map(picked => picked.name)).toEqual(['a.txt']);
    expect(result.problem).toMatch(/Up to 20 files/);
  });

  it('refuses a pick that takes the message over 25MB', () => {
    const result = admitDraftFiles([file('c.pdf', 9 * MB)], [{ size: 9 * MB }, { size: 9 * MB }]);
    expect(result.admitted).toEqual([]);
    expect(result.problem).toMatch(/25MB/);
  });
});
