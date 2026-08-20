import type { MouseEvent, ReactElement } from 'react';
// Same two glyphs the export modal uses, so a doc row reads the same in both places.
import { ExternalLink, File as FileIcon } from 'lucide-react';
import type { RecordingGoogleDocLink } from '../../../services/Recording/recordingService';
import { formatDate } from '../../../utils/dateUtils';
import { openLink } from '../../../utils/openLink';

interface RecordingGoogleDocsListProps {
  /** Docs exported from this recording, newest first. */
  documents: RecordingGoogleDocLink[];
  /** Section label. Defaults to 'Google Docs'. */
  heading?: string;
}

const GOOGLE_DOC_URL = (documentId: string): string =>
  `https://docs.google.com/document/d/${documentId}/edit`;

/**
 * Reads the doc list out of a raw `calls.metadata` blob.
 *
 * The screen also receives this recording live over Zero, where metadata arrives
 * as untyped JSON, so the same list has to be re-derived there — malformed or
 * partial entries are dropped rather than rendered as a broken row.
 */
export function parseRecordingGoogleDocLinks(value: unknown): RecordingGoogleDocLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    const documentId = typeof raw['documentId'] === 'string' ? raw['documentId'].trim() : '';
    if (!documentId) return [];
    const title = typeof raw['title'] === 'string' ? raw['title'].trim() : '';
    const url = typeof raw['url'] === 'string' ? raw['url'].trim() : '';
    return [
      {
        documentId,
        title: title || 'Untitled document',
        url: url || GOOGLE_DOC_URL(documentId),
        createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : '',
        createdByUserId: typeof raw['createdByUserId'] === 'string' ? raw['createdByUserId'] : '',
      },
    ];
  });
}

/** Legacy/hand-edited metadata can carry an unparseable timestamp — show no date rather than throw. */
function formatCreatedAt(createdAt: string): string | null {
  const timestamp = Date.parse(createdAt);
  return Number.isNaN(timestamp) ? null : formatDate(timestamp);
}

/**
 * Lists the Google Docs created from this recording's summary.
 *
 * The Docs API returns a document id only at creation time, so these come from
 * `calls.metadata.googleDocs` — without that list, an exported doc is reachable
 * only from whichever tab happened to be open when it was created.
 *
 * Clicks go through `openLink` rather than the browser's default navigation so
 * Electron honours the user's in-app / system-browser preference; the `href` is
 * still real, keeping hover previews and "copy link address" working.
 */
export function RecordingGoogleDocsList({
  documents,
  heading = 'Google Docs',
}: RecordingGoogleDocsListProps): ReactElement | null {
  if (documents.length === 0) return null;

  const handleOpen = (event: MouseEvent<HTMLAnchorElement>, url: string): void => {
    event.preventDefault();
    openLink(url, event);
  };

  return (
    <section className='mt-6' data-testid='recording-google-docs-list'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {heading}
      </h3>
      <ul className='mt-2 divide-y divide-border/70 rounded-lg border border-border/70'>
        {documents.map(doc => (
          <li key={doc.documentId}>
            <a
              href={doc.url}
              target='_blank'
              rel='noopener noreferrer'
              onClick={event => handleOpen(event, doc.url)}
              className='group flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50'
              data-track-category='RecordingDetailV2'
              data-track-name='open_recording_google_doc'
            >
              <FileIcon className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
              <span className='min-w-0 flex-1 truncate font-medium text-foreground group-hover:underline'>
                {doc.title}
              </span>
              {formatCreatedAt(doc.createdAt) ? (
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {formatCreatedAt(doc.createdAt)}
                </span>
              ) : null}
              <ExternalLink
                className='size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100'
                aria-hidden='true'
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
