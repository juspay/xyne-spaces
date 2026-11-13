import type { ReactNode } from 'react';
import type { Action } from '@xyne/workflow-sdk';

export type FileEntry = {
  kind: 'file';
  id: string;
  name: string;
  format: string;
  caption?: string;
  columns?: Readonly<Record<string, string>>;
  status?: string;
  /** Free-form tags (workflow metadata) — for filtering/search. */
  tags?: string[];
  /**
   * The caller's permitted actions on this row, from the authorizer. Row
   * controls (rename/move/delete/share) gate on it via `canPerform`; `undefined`
   * means optimistic-allow (no authorizer / not projected). Never the security
   * boundary — the backend enforces.
   */
  permittedActions?: readonly Action[];
};

export type FolderEntry = {
  kind: 'folder';
  id: string;
  name: string;
  caption?: string;
  columns?: Readonly<Record<string, string>>;
  status?: string;
  /** See {@link FileEntry.permittedActions}. Also carries the CONTAINER actions
   *  (`workflow:create`/`folder:create`) that gate "New … inside this folder". */
  permittedActions?: readonly Action[];
};

export type BrowserEntry = FileEntry | FolderEntry;

export type ColumnDef = {
  key: string;
  header: string;
  width?: string;
  render?: (entry: BrowserEntry) => ReactNode;
  mdOnly?: boolean;
};

export type LeadingRenderer = (entry: BrowserEntry, size: 'sm' | 'md') => ReactNode;

export type ViewMode = 'grid' | 'list';
