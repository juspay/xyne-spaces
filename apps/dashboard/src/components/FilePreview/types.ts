import type { ComponentType, LazyExoticComponent } from 'react';

/** An uploaded file, as much of it as a preview needs. */
export interface PreviewFile {
  /** The attachment's id: everything about it is fetched by this. */
  id: string;
  name: string;
  mimetype: string;
  /** In bytes. */
  size: number;
}

/** What a previewer is handed to draw. */
export interface PreviewerProps {
  file: PreviewFile;
  /**
   * The file's bytes, fetched by the frame for a previewer that reads them whole
   * (`reads.kind === 'file'`). Null for one that streams from the file's address.
   */
  content: File | null;
}

/** How a previewer gets at the file. */
export type PreviewerReads =
  /** The frame fetches it whole and hands it over: text, tables, images. */
  | {
      kind: 'file';
      /** Where to fetch it from when not the original — an HEIC photo's WebP. An
       *  attachment id or an api path. */
      source?: (file: PreviewFile) => string;
    }
  /** The previewer streams it from its address itself, so it plays or draws as it
   *  arrives: video, and the viewers that fetch for themselves. */
  | { kind: 'stream' };

/** The shape the pane takes while the file is on its way. */
export type PreviewSkeleton = 'text' | 'document' | 'grid' | 'media';

/**
 * One kind of preview. The frame around it — the toolbar, loading, the states for a
 * file too large or failing to load, and download — is the same for all of them, so
 * a previewer only draws the file.
 */
export interface Previewer {
  /** Stable, for analytics and tests: `markdown`, `spreadsheet`. */
  id: string;
  /** What the file is, in words, on the toolbar: "Markdown", "Spreadsheet". */
  label: string;
  /** File-name extensions it takes, lower case and without the dot. Tried first. */
  extensions: readonly string[];
  /** MIME types it takes, for a file whose name says nothing. One ending in `/` is a
   *  prefix: `video/`. */
  mimeTypes: readonly string[];
  reads: PreviewerReads;
  /** Past this many bytes the file is offered for download instead of drawn. */
  maxBytes?: number;
  skeleton: PreviewSkeleton;
  component: LazyExoticComponent<ComponentType<PreviewerProps>>;
}
