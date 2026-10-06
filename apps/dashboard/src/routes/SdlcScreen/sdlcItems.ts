/** What a track's files are made of, as the file list and the folder page read them. */

import { SDLC_CONTAINMENT_RELATION, SDLC_TRACK_FLAT_RELATION } from '@xyne/shared';
import { getAttachmentStreamUrl } from '../../services/clients/apiClient';

export type SdlcItemKind = 'FOLDER' | 'CANVAS' | 'LINK' | 'ATTACHMENT';

export interface SdlcFolderItem {
  id: string;
  name: string;
  /** An @xyne/icons name, shown in place of the folder mark. */
  icon: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface SdlcLinkItem {
  id: string;
  title: string;
  url: string;
  description: string | null;
  favicon: string | null;
  createdBy: string;
  createdAt: number;
}

export interface SdlcFileItem {
  id: string;
  name: string;
  url: string;
  mimetype: string;
  size: number;
  createdBy: string;
  createdAt: number;
}

export interface SdlcCanvasItem {
  id: string;
  title: string;
  typeName: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastEditedBy?: string | undefined;
  lastEditedAt?: number | undefined;
}

/** A place in a track's files: the track itself, or a folder somewhere in it. */
export interface SdlcFilesLocation {
  type: 'TRACK' | 'FOLDER';
  id: string;
  name: string;
  /** A folder's chosen icon, for its breadcrumb. */
  icon?: string | null;
}

/** `?in=`: the folder a track's file list is showing. Absent at the track's top level. */
export const SDLC_FILES_FOLDER_PARAM = 'in';

/** Any one of a track's items, told apart by kind. */
export type SdlcTrackItem =
  | (SdlcFolderItem & { kind: 'FOLDER' })
  | (SdlcCanvasItem & { kind: 'CANVAS' })
  | (SdlcLinkItem & { kind: 'LINK' })
  | (SdlcFileItem & { kind: 'ATTACHMENT' });

export function sdlcItemName(item: SdlcTrackItem): string {
  if (item.kind === 'FOLDER' || item.kind === 'ATTACHMENT') return item.name;
  if (item.kind === 'LINK') return item.title.trim() || item.url;
  return item.title;
}

/** The rows an item's own table holds, as a query joins them onto a link to it. */
interface FolderRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}
interface LinkRow {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly description: string | null;
  readonly favicon: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
}
interface AttachmentRow {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly createdBy: string;
  readonly createdAt: number;
}
interface CanvasRow {
  readonly id: string;
  readonly title: string;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastEditedBy: string | null;
  readonly lastEditedAt: number | null;
  /** Its type, which only a folder's own list needs. */
  readonly folder?: { readonly name: string } | undefined;
}

/** A link with the item it points at joined on, from the queries that list a folder. */
export interface SdlcTargetLink {
  readonly targetType: string;
  readonly targetId: string;
  readonly targetFolder?: FolderRow | undefined;
  readonly targetLink?: LinkRow | undefined;
  readonly targetFile?: AttachmentRow | undefined;
  readonly targetCanvas?: CanvasRow | undefined;
}

/** A DISCUSSION link with the item it comes from joined on. */
export interface SdlcSourceLink {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceFolder?: FolderRow | undefined;
  readonly sourceLink?: LinkRow | undefined;
  readonly sourceFile?: AttachmentRow | undefined;
  readonly sourceCanvas?: CanvasRow | undefined;
}

/**
 * The item one end of a link names. Nothing when the joined row isn't there — it was
 * deleted, isn't synced yet, or is a link someone else keeps to themselves.
 */
function itemAt(end: {
  type: string;
  folder: FolderRow | undefined;
  link: LinkRow | undefined;
  file: AttachmentRow | undefined;
  canvas: CanvasRow | undefined;
}): SdlcTrackItem | null {
  const { folder, link, file, canvas } = end;
  if (end.type === 'FOLDER' && folder) {
    return {
      kind: 'FOLDER',
      id: folder.id,
      name: folder.name,
      icon: folder.icon,
      createdBy: folder.createdBy,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    };
  }
  if (end.type === 'LINK' && link) {
    return {
      kind: 'LINK',
      id: link.id,
      title: link.title,
      url: link.url,
      description: link.description,
      favicon: link.favicon,
      createdBy: link.createdBy,
      createdAt: link.createdAt,
    };
  }
  if (end.type === 'ATTACHMENT' && file) {
    return {
      kind: 'ATTACHMENT',
      id: file.id,
      name: file.originalFilename,
      url: getAttachmentStreamUrl(file.id),
      mimetype: file.mimetype,
      size: file.size,
      createdBy: file.createdBy,
      createdAt: file.createdAt,
    };
  }
  if (end.type === 'CANVAS' && canvas) {
    return {
      kind: 'CANVAS',
      id: canvas.id,
      title: canvas.title,
      typeName: canvas.folder?.name ?? 'Artifact',
      createdBy: canvas.createdBy,
      createdAt: canvas.createdAt,
      updatedAt: canvas.updatedAt,
      lastEditedBy: canvas.lastEditedBy ?? undefined,
      lastEditedAt: canvas.lastEditedAt ?? undefined,
    };
  }
  return null;
}

export const targetItemOf = (link: SdlcTargetLink): SdlcTrackItem | null =>
  itemAt({
    type: link.targetType,
    folder: link.targetFolder,
    link: link.targetLink,
    file: link.targetFile,
    canvas: link.targetCanvas,
  });

export const sourceItemOf = (link: SdlcSourceLink): SdlcTrackItem | null =>
  itemAt({
    type: link.sourceType,
    folder: link.sourceFolder,
    link: link.sourceLink,
    file: link.sourceFile,
    canvas: link.sourceCanvas,
  });

/**
 * A lookup row: a link placing an item — in a folder, or on its track — with the
 * folders above that item, each with the edge that files it.
 */
export interface SdlcPlacingLink extends SdlcTargetLink {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly relationType: string;
  readonly sameTargetLinks?:
    | ReadonlyArray<{
        readonly sourceId: string;
        readonly sourceFolder?: { readonly name: string; readonly icon: string | null } | undefined;
        readonly sourceItemLinks?:
          | ReadonlyArray<{ readonly sourceType: string; readonly sourceId: string }>
          | undefined;
      }>
    | undefined;
}

export interface SdlcItemPlacement {
  /** What it is filed in: its track's top level, or a folder. Null until known. */
  parent: { type: 'TRACK' | 'FOLDER'; id: string } | null;
  trackId: string | null;
  /** The folders from the top of the track down to its own, as far as they are known. */
  folders: SdlcFilesLocation[];
  /** True once `folders` reaches the top of the track. */
  complete: boolean;
}

/** Where an item sits, from the lookup rows about it. */
export function sdlcItemPlacement(
  rows: readonly SdlcPlacingLink[],
  item: { type: string; id: string },
): SdlcItemPlacement {
  const own = rows.filter(row => row.targetType === item.type && row.targetId === item.id);
  const filing = own.find(row => row.relationType === SDLC_CONTAINMENT_RELATION);
  const trackId =
    own.find(row => row.relationType === SDLC_TRACK_FLAT_RELATION && row.sourceType === 'TRACK')
      ?.sourceId ?? null;
  const above = new Map<
    string,
    { name: string; icon: string | null; filedIn: { type: string; id: string } | null }
  >();
  for (const row of own) {
    for (const folder of row.sameTargetLinks ?? []) {
      const folderFiling = folder.sourceItemLinks?.[0];
      above.set(folder.sourceId, {
        name: folder.sourceFolder?.name ?? '',
        icon: folder.sourceFolder?.icon ?? null,
        filedIn: folderFiling ? { type: folderFiling.sourceType, id: folderFiling.sourceId } : null,
      });
    }
  }
  const parent: SdlcItemPlacement['parent'] =
    filing && (filing.sourceType === 'TRACK' || filing.sourceType === 'FOLDER')
      ? { type: filing.sourceType, id: filing.sourceId }
      : null;
  const folders: SdlcFilesLocation[] = [];
  let complete = parent?.type === 'TRACK';
  // Up from its own folder, through each folder's filing; a cycle in the data stops it.
  let id = parent?.type === 'FOLDER' ? parent.id : null;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const known = above.get(id);
    if (!known) break;
    folders.unshift({ type: 'FOLDER', id, name: known.name, icon: known.icon });
    complete = known.filedIn?.type === 'TRACK';
    id = known.filedIn?.type === 'FOLDER' ? known.filedIn.id : null;
  }
  return { parent, trackId, folders, complete };
}

/** `KIND:id` -> the folder holding it, for every item and folder the rows place. */
export function sdlcParentFolders(rows: readonly SdlcPlacingLink[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.relationType === SDLC_CONTAINMENT_RELATION && row.sourceType === 'FOLDER') {
      map.set(`${row.targetType}:${row.targetId}`, row.sourceId);
    }
    for (const folder of row.sameTargetLinks ?? []) {
      const folderFiling = folder.sourceItemLinks?.[0];
      if (folderFiling?.sourceType === 'FOLDER') {
        map.set(`FOLDER:${folder.sourceId}`, folderFiling.sourceId);
      }
    }
  }
  return map;
}

/** A day and month, and the year when it isn't this one: the file list's Modified. */
export function formatUpdated(value: number): string {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(!sameYear && { year: 'numeric' }),
  });
}
