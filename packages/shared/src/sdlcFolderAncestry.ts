/**
 * Keeping an item's folder edges (SDLC_FOLDER_FLAT_RELATION) in step with where it
 * is filed. Pure: the Zero mutators and the Prisma writers each read the same three
 * things, hand them here, and write what comes back, so the rule lives once.
 */

import { SDLC_TREE_TARGET_TYPES } from "./sdlc.js";

export type SdlcTreeItemType = (typeof SDLC_TREE_TARGET_TYPES)[number];

export function isSdlcTreeItemType(type: string): type is SdlcTreeItemType {
  return (SDLC_TREE_TARGET_TYPES as readonly string[]).includes(type);
}

export interface SdlcFolderEdge {
  id: string;
  sourceId: string;
  targetType: string;
  targetId: string;
}

export interface SdlcFolderEdgePlan {
  /** Folder edges to delete, by id. */
  remove: string[];
  /** Folder edges to write: from `sourceId`, a folder, to the item. */
  add: Array<{ sourceId: string; targetType: string; targetId: string }>;
}

/**
 * What changes when `item` comes to sit under `ancestors`, the folders above its new
 * place: none at a track's top level or once it is unfiled. A folder carries
 * everything beneath it along, so each of those keeps the folders between it and
 * `item`, and trades the rest for `ancestors` and `item` itself.
 *
 * `descendants` are what sits under `item` — only a folder has any — and `existing`
 * the folder edges into `item` and into each of them.
 */
export function planSdlcFolderEdges(input: {
  item: { type: string; id: string };
  ancestors: readonly string[];
  descendants: ReadonlyArray<{ type: string; id: string }>;
  existing: readonly SdlcFolderEdge[];
}): SdlcFolderEdgePlan {
  const { item, descendants, existing } = input;
  const beneath = new Set(descendants.map((descendant) => descendant.id));
  // Never an item, or anything under it, above itself: that would be a cycle.
  const ancestors = [...new Set(input.ancestors)].filter(
    (id) => id !== item.id && !beneath.has(id),
  );
  const innerFolders = new Set(
    descendants
      .filter((descendant) => descendant.type === "FOLDER")
      .map((folder) => folder.id),
  );
  const incoming = new Map<string, SdlcFolderEdge[]>();
  for (const edge of existing) {
    const list = incoming.get(edge.targetId) ?? [];
    list.push(edge);
    incoming.set(edge.targetId, list);
  }

  const plan: SdlcFolderEdgePlan = { remove: [], add: [] };
  /** Leaves `target` under exactly `above`, plus whichever current folders `keep` says stay. */
  const settle = (
    target: { type: string; id: string },
    above: readonly string[],
    keep: (sourceId: string) => boolean,
  ) => {
    const present = new Set<string>();
    for (const edge of incoming.get(target.id) ?? []) {
      const wanted =
        edge.sourceId !== target.id && (above.includes(edge.sourceId) || keep(edge.sourceId));
      if (wanted && !present.has(edge.sourceId)) {
        present.add(edge.sourceId);
      } else {
        plan.remove.push(edge.id);
      }
    }
    for (const sourceId of above) {
      if (sourceId !== target.id && !present.has(sourceId)) {
        plan.add.push({ sourceId, targetType: target.type, targetId: target.id });
      }
    }
  };

  settle(item, ancestors, () => false);
  const aboveDescendants = [...ancestors, item.id];
  for (const descendant of descendants) {
    settle(descendant, aboveDescendants, (sourceId) => innerFolders.has(sourceId));
  }
  return plan;
}
