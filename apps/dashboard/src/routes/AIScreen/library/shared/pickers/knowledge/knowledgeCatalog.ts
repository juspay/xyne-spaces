import type { KbCollectionNode, KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';

export type KbScope = 'COLLECTIONS' | 'USER';

export interface KbGrantLabel {
  key: string;
  label: string;
  detail: string | null;
  /** Dimmed trailing text on the pill, e.g. "3 files" for a whole-collection grant. */
  meta?: string | null;
  selection: KbSelection;
}

interface KbIndexEntry {
  name: string;
  files: Map<string, string>;
  /** Files in this collection and every sub-folder (a whole-collection grant covers them all). */
  fileCount: number;
}

export function buildKbIndex(tree: readonly KbCollectionNode[]): Map<string, KbIndexEntry> {
  const index = new Map<string, KbIndexEntry>();

  const walk = (node: KbCollectionNode): number => {
    const files = new Map<string, string>();
    for (const item of node.items ?? []) files.set(item.id, item.name);
    const entry: KbIndexEntry = { name: node.name, files, fileCount: files.size };
    index.set(node.id, entry);
    for (const child of node.children ?? []) entry.fileCount += walk(child);
    return entry.fileCount;
  };

  for (const root of tree) walk(root);
  return index;
}

function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

export function describeGrants(
  selections: readonly KbSelection[],
  index: Map<string, KbIndexEntry>,
): KbGrantLabel[] {
  return selections.map(selection => {
    const collection = index.get(selection.collectionId);
    const key = `${selection.collectionId}:${selection.fileId ?? '*'}`;

    if (!selection.fileId) {
      return {
        key,
        label: collection?.name ?? 'Collection',
        detail: 'Whole collection',
        meta: collection && collection.fileCount > 0 ? fileCountLabel(collection.fileCount) : null,
        selection,
      };
    }

    return {
      key,
      label: collection?.files.get(selection.fileId) ?? 'File',
      detail: collection?.name ?? null,
      selection,
    };
  });
}

export function removeGrant(
  selections: readonly KbSelection[],
  target: KbSelection,
): KbSelection[] {
  return selections.filter(
    selection =>
      !(selection.collectionId === target.collectionId && selection.fileId === target.fileId),
  );
}
