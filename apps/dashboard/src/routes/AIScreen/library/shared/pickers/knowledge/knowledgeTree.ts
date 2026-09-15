import {
  FileBarGraph,
  FileCode,
  FileDefault,
  FilePdfFormat,
  FileText,
  PhotoImageDefault,
} from '@xyne/icons';
import type { KbCollectionNode, KbFile, KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import { matchesLibrarySearch } from '../../librarySearch';

export type KbIconComponent = typeof FileDefault;

const FILE_KINDS: ReadonlyArray<{
  extensions: readonly string[];
  label: string;
  icon: KbIconComponent;
}> = [
  { extensions: ['pdf'], label: 'PDF', icon: FilePdfFormat },
  {
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'heic'],
    label: 'Image',
    icon: PhotoImageDefault,
  },
  { extensions: ['xls', 'xlsx', 'csv', 'tsv'], label: 'Spreadsheet', icon: FileBarGraph },
  { extensions: ['doc', 'docx', 'txt', 'md', 'rtf'], label: 'Document', icon: FileText },
  {
    extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'json', 'yaml', 'yml', 'sh'],
    label: 'Code',
    icon: FileCode,
  },
];

/** Icon + human kind for a file, derived from its extension. */
export function describeFile(name: string): { label: string; icon: KbIconComponent } {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const kind = FILE_KINDS.find(candidate => candidate.extensions.includes(extension));
  if (kind) return { label: kind.label, icon: kind.icon };
  return { label: extension ? extension.toUpperCase() : 'File', icon: FileDefault };
}

export interface KbGrantIndex {
  /** Collections granted whole — every descendant comes along. */
  collections: Set<string>;
  files: Set<string>;
}

export function indexGrants(grants: readonly KbSelection[]): KbGrantIndex {
  const collections = new Set<string>();
  const files = new Set<string>();
  for (const grant of grants) {
    if (grant.fileId) files.add(grant.fileId);
    else collections.add(grant.collectionId);
  }
  return { collections, files };
}

export function countFiles(node: KbCollectionNode): number {
  let total = node.items?.length ?? 0;
  for (const child of node.children ?? []) total += countFiles(child);
  return total;
}

/** Every collection and file id at or below `node`. */
export function collectSubtree(node: KbCollectionNode): KbGrantIndex {
  const collections = new Set<string>();
  const files = new Set<string>();
  const walk = (current: KbCollectionNode): void => {
    collections.add(current.id);
    for (const item of current.items ?? []) files.add(item.id);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return { collections, files };
}

export function findCollection(
  tree: readonly KbCollectionNode[],
  id: string,
): KbCollectionNode | undefined {
  for (const root of tree) {
    const walk = (node: KbCollectionNode): KbCollectionNode | undefined => {
      if (node.id === id) return node;
      for (const child of node.children ?? []) {
        const hit = walk(child);
        if (hit) return hit;
      }
      return undefined;
    };
    const hit = walk(root);
    if (hit) return hit;
  }
  return undefined;
}

export function findFile(
  tree: readonly KbCollectionNode[],
  fileId: string,
): { file: KbFile; parent: KbCollectionNode } | undefined {
  const walk = (node: KbCollectionNode): { file: KbFile; parent: KbCollectionNode } | undefined => {
    for (const item of node.items ?? [])
      if (item.id === fileId) return { file: item, parent: node };
    for (const child of node.children ?? []) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const root of tree) {
    const hit = walk(root);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Grants live against any node in the tree, but the browse grid is keyed by
 * root collection — so a grant three folders deep still has to light up (and be
 * removable from) its root card.
 */
export function grantsUnder(root: KbCollectionNode, grants: readonly KbSelection[]): KbSelection[] {
  const subtree = collectSubtree(root);
  return grants.filter(grant => subtree.collections.has(grant.collectionId));
}

/** How many files a set of grants reaches — a whole-collection grant counts its subtree. */
export function countGrantedFiles(
  tree: readonly KbCollectionNode[],
  grants: readonly KbSelection[],
): number {
  let total = 0;
  for (const grant of grants) {
    if (grant.fileId) {
      total += 1;
      continue;
    }
    const node = findCollection(tree, grant.collectionId);
    total += node ? countFiles(node) : 0;
  }
  return total;
}

/**
 * Adds a whole-collection grant, dropping any grant it now covers so the same
 * file is never granted twice.
 */
export function grantCollection(
  grants: readonly KbSelection[],
  node: KbCollectionNode,
): KbSelection[] {
  const subtree = collectSubtree(node);
  const kept = grants.filter(grant =>
    grant.fileId ? !subtree.files.has(grant.fileId) : !subtree.collections.has(grant.collectionId),
  );
  return [...kept, { collectionId: node.id, fileId: null }];
}

export function revokeCollection(
  grants: readonly KbSelection[],
  collectionId: string,
): KbSelection[] {
  return grants.filter(grant => !(grant.collectionId === collectionId && grant.fileId === null));
}

export function grantFile(
  grants: readonly KbSelection[],
  parent: KbCollectionNode,
  file: KbFile,
): KbSelection[] {
  return [...grants, { collectionId: parent.id, fileId: file.id }];
}

export function revokeFile(grants: readonly KbSelection[], fileId: string): KbSelection[] {
  return grants.filter(grant => grant.fileId !== fileId);
}

export function matchesQuery(root: KbCollectionNode, query: string): boolean {
  return matchesLibrarySearch({ name: root.name }, query);
}
