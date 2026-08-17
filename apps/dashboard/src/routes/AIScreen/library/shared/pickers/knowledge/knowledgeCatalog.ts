import type { KbCollectionNode, KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';

export type KbScope = 'COLLECTIONS' | 'USER';

export interface KbGrantLabel {
  key: string;
  label: string;
  detail: string | null;
  selection: KbSelection;
}

interface KbIndexEntry {
  name: string;
  files: Map<string, string>;
}

export function buildKbIndex(tree: readonly KbCollectionNode[]): Map<string, KbIndexEntry> {
  const index = new Map<string, KbIndexEntry>();

  const walk = (node: KbCollectionNode): void => {
    const files = new Map<string, string>();
    for (const item of node.items ?? []) files.set(item.id, item.name);
    index.set(node.id, { name: node.name, files });
    for (const child of node.children ?? []) walk(child);
  };

  for (const root of tree) walk(root);
  return index;
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
