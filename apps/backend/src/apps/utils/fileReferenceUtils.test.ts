import {
  extractFileReferenceIds,
  resolveReferencedAttachments,
  mergeAttachments,
  MAX_FILE_REFERENCES,
  type ReferencedAttachmentRow,
  type ReferencedAttachmentRepo,
} from './fileReferenceUtils';

const WS = 'ws_1';
const CONV = 'conv_1';

function row(overrides: Partial<ReferencedAttachmentRow> & { id: string }): ReferencedAttachmentRow {
  return {
    workspaceId: WS,
    conversationId: CONV,
    originalFilename: `${overrides.id}.pdf`,
    mimetype: 'application/pdf',
    size: 123,
    url: `gs://bucket/${overrides.id}`,
    isDeleted: false,
    ...overrides,
  };
}

function repoFrom(rows: ReferencedAttachmentRow[]): ReferencedAttachmentRepo {
  const byId = new Map(rows.map(r => [r.id, r]));
  return { findById: async (id: string) => byId.get(id) ?? null };
}

describe('extractFileReferenceIds', () => {
  it('returns [] for empty / missing content', () => {
    expect(extractFileReferenceIds(undefined)).toEqual([]);
    expect(extractFileReferenceIds(null)).toEqual([]);
    expect(extractFileReferenceIds('')).toEqual([]);
    expect(extractFileReferenceIds('<p>no chips here</p>')).toEqual([]);
  });

  it('extracts the attachment id from a file-reference span', () => {
    const html = '<p>see <span data-file-reference data-attachment-id="att_1" class="chip">@spec.pdf</span></p>';
    expect(extractFileReferenceIds(html)).toEqual(['att_1']);
  });

  it('is tolerant of attribute order and extra attributes', () => {
    const html =
      '<span class="x" data-attachment-id="att_2" data-file-name="a.pdf" data-file-reference role="button">@a.pdf</span>';
    expect(extractFileReferenceIds(html)).toEqual(['att_2']);
  });

  it('extracts multiple ids and de-duplicates preserving order', () => {
    const html = [
      '<span data-file-reference data-attachment-id="att_a">@a</span>',
      '<span data-file-reference data-attachment-id="att_b">@b</span>',
      '<span data-file-reference data-attachment-id="att_a">@a again</span>',
    ].join(' ');
    expect(extractFileReferenceIds(html)).toEqual(['att_a', 'att_b']);
  });

  it('ignores plain channel / user mention spans', () => {
    const html =
      '<span data-channel-mention data-channel-id="c1">#general</span>' +
      '<span data-mention data-user-id="u1">@bob</span>';
    expect(extractFileReferenceIds(html)).toEqual([]);
  });

  it('caps the number of extracted ids at MAX_FILE_REFERENCES', () => {
    const html = Array.from({ length: MAX_FILE_REFERENCES + 5 }, (_, i) =>
      `<span data-file-reference data-attachment-id="att_${i}">@f</span>`,
    ).join('');
    expect(extractFileReferenceIds(html)).toHaveLength(MAX_FILE_REFERENCES);
  });
});

describe('resolveReferencedAttachments', () => {
  const ctx = (repo: ReferencedAttachmentRepo) => ({ workspaceId: WS, conversationId: CONV, repo });

  it('resolves a valid in-thread attachment to an AppEventAttachment', async () => {
    const repo = repoFrom([row({ id: 'att_1', originalFilename: 'spec.pdf', size: 999 })]);
    const out = await resolveReferencedAttachments(['att_1'], ctx(repo));
    expect(out).toEqual([
      { attachmentId: 'att_1', fileName: 'spec.pdf', fileSize: 999, mimeType: 'application/pdf', fileUrl: 'gs://bucket/att_1' },
    ]);
  });

  it('drops ids that do not exist', async () => {
    const repo = repoFrom([row({ id: 'att_1' })]);
    const out = await resolveReferencedAttachments(['missing'], ctx(repo));
    expect(out).toEqual([]);
  });

  it('drops attachments from a different workspace (cross-tenant guard)', async () => {
    const repo = repoFrom([row({ id: 'att_1', workspaceId: 'ws_other' })]);
    const out = await resolveReferencedAttachments(['att_1'], ctx(repo));
    expect(out).toEqual([]);
  });

  it('drops attachments from a different conversation (cross-thread guard)', async () => {
    const repo = repoFrom([row({ id: 'att_1', conversationId: 'conv_other' })]);
    const out = await resolveReferencedAttachments(['att_1'], ctx(repo));
    expect(out).toEqual([]);
  });

  it('drops soft-deleted attachments', async () => {
    const repo = repoFrom([row({ id: 'att_1', isDeleted: true })]);
    const out = await resolveReferencedAttachments(['att_1'], ctx(repo));
    expect(out).toEqual([]);
  });

  it('drops attachments with no storage url yet', async () => {
    const repo = repoFrom([row({ id: 'att_1', url: '' })]);
    const out = await resolveReferencedAttachments(['att_1'], ctx(repo));
    expect(out).toEqual([]);
  });

  it('survives repo errors on a single id without failing the batch', async () => {
    const repo: ReferencedAttachmentRepo = {
      findById: async (id: string) => {
        if (id === 'boom') throw new Error('db down');
        return row({ id });
      },
    };
    const out = await resolveReferencedAttachments(['boom', 'att_ok'], ctx(repo));
    expect(out.map(a => a.attachmentId)).toEqual(['att_ok']);
  });

  it('returns [] for an empty id list without touching the repo', async () => {
    const findById = jest.fn();
    const out = await resolveReferencedAttachments([], { workspaceId: WS, conversationId: CONV, repo: { findById } });
    expect(out).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
  });
});

describe('mergeAttachments', () => {
  const a = { attachmentId: 'a', fileName: 'a', fileSize: 1, mimeType: 'x', fileUrl: 'u' };
  const b = { attachmentId: 'b', fileName: 'b', fileSize: 1, mimeType: 'x', fileUrl: 'u' };
  const aDup = { attachmentId: 'a', fileName: 'a-dup', fileSize: 2, mimeType: 'y', fileUrl: 'v' };

  it('concatenates disjoint lists', () => {
    expect(mergeAttachments([a], [b])).toEqual([a, b]);
  });

  it('de-duplicates by attachmentId, uploaded wins', () => {
    expect(mergeAttachments([a], [aDup, b])).toEqual([a, b]);
  });

  it('handles undefined inputs', () => {
    expect(mergeAttachments(undefined, [b])).toEqual([b]);
    expect(mergeAttachments([a], undefined)).toEqual([a]);
    expect(mergeAttachments(undefined, undefined)).toEqual([]);
  });
});
