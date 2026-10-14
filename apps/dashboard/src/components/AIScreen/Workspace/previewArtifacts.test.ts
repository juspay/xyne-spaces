import { describe, expect, it } from 'vitest';
import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';
import {
  distinctPreviewTitles,
  sortPreviewCandidates,
  withDistinctPreviewTitles,
} from './previewArtifacts';

function row(
  id: string,
  kind: ConversationArtifact['kind'],
  refId: string,
  title: string,
  createdAt: string,
  updatedAt: string = createdAt,
): ConversationArtifact {
  return {
    id,
    conversationId: 'c1',
    kind,
    refService: 'CLAW',
    refId,
    title,
    status: 'ACTIVE',
    pinned: false,
    createdAt,
    updatedAt,
    openRef: { kind, service: 'CLAW', refId },
  };
}

const NOW = new Date('2026-10-14T12:00:00Z');

describe('distinctPreviewTitles', () => {
  it('leaves a single sandbox untouched', () => {
    const rows = [
      row('p1', 'PREVIEW', 'sbx-aaaaa', 'Live preview', '2026-10-14T09:00:00Z'),
      row('d1', 'DIFF', 'sbx-aaaaa', 'Code changes', '2026-10-14T09:00:00Z'),
    ];
    expect(distinctPreviewTitles(rows, NOW).size).toBe(0);
    expect(withDistinctPreviewTitles(rows, NOW)).toBe(rows);
  });

  it('labels colliding previews with their start time', () => {
    const rows = [
      row('p1', 'PREVIEW', 'sbx-aaaaa', 'Live preview', '2026-10-14T09:00:00Z'),
      row('p2', 'PREVIEW', 'sbx-bbbbb', 'Live preview', '2026-10-14T10:30:00Z'),
      row('d1', 'DIFF', 'sbx-aaaaa', 'Code changes', '2026-10-14T09:00:00Z'),
      row('d2', 'DIFF', 'sbx-bbbbb', 'Code changes', '2026-10-14T10:30:00Z'),
    ];
    const titles = distinctPreviewTitles(rows, NOW);
    expect(titles.size).toBe(4);
    expect(titles.get('p1')).toMatch(/^Live preview · /);
    expect(titles.get('d2')).toMatch(/^Code changes · /);
    expect(titles.get('p1')).not.toBe(titles.get('p2'));
    expect(titles.get('d1')).not.toBe(titles.get('d2'));
  });

  it('adds a short sandbox id when start times collide too', () => {
    const rows = [
      row('p1', 'PREVIEW', 'agent-workspace-xfqwz', 'Live preview', '2026-10-14T09:00:00Z'),
      row('p2', 'PREVIEW', 'agent-workspace-k8m2p', 'Live preview', '2026-10-14T09:00:20Z'),
    ];
    const titles = distinctPreviewTitles(rows, NOW);
    expect(titles.get('p1')).toMatch(/…xfqwz$/);
    expect(titles.get('p2')).toMatch(/…k8m2p$/);
  });

  it('keeps a title the user renamed to something unique', () => {
    const rows = [
      row('p1', 'PREVIEW', 'sbx-aaaaa', 'Checkout page', '2026-10-14T09:00:00Z'),
      row('p2', 'PREVIEW', 'sbx-bbbbb', 'Live preview', '2026-10-14T10:30:00Z'),
    ];
    expect(distinctPreviewTitles(rows, NOW).size).toBe(0);
  });

  it('ignores other artifact kinds', () => {
    const rows = [
      row('f1', 'FILE', 'att-1', 'notes.md', '2026-10-14T09:00:00Z'),
      row('f2', 'FILE', 'att-2', 'notes.md', '2026-10-14T10:00:00Z'),
    ];
    expect(distinctPreviewTitles(rows, NOW).size).toBe(0);
  });
});

describe('sortPreviewCandidates', () => {
  it('puts the most recently used sandbox first, preview before its diff', () => {
    const rows = [
      row('p1', 'PREVIEW', 'sbx-a', 'Live preview', '2026-10-14T09:00:00Z'),
      row('d1', 'DIFF', 'sbx-a', 'Code changes', '2026-10-14T09:00:00Z', '2026-10-14T11:00:00Z'),
      row('p2', 'PREVIEW', 'sbx-b', 'Live preview', '2026-10-14T10:00:00Z'),
      row('d2', 'DIFF', 'sbx-b', 'Code changes', '2026-10-14T10:00:00Z'),
      row('f1', 'FILE', 'att-1', 'notes.md', '2026-10-14T11:30:00Z'),
    ];
    // sbx-a was created first but reused later, so it leads.
    expect(sortPreviewCandidates(rows).map(a => a.id)).toEqual(['p1', 'd1', 'p2', 'd2']);
  });

  it('returns nothing when there are no previews or diffs', () => {
    expect(
      sortPreviewCandidates([row('f1', 'FILE', 'att-1', 'a', '2026-10-14T09:00:00Z')]),
    ).toEqual([]);
  });
});
