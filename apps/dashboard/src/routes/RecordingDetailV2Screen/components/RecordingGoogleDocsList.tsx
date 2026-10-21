import type { MouseEvent, ReactElement } from 'react';
// Same two glyphs the export modal uses, so a doc row reads the same in both places.
import { ExternalLink, File as FileIcon } from 'lucide-react';
import type { RecordingGoogleDocLink } from '../../../services/Recording/recordingService';
import { useSelf, useUsersById } from '../../../hooks/useUsers';
import { formatDate } from '../../../utils/dateUtils';
import { getUserDisplayName } from '../../../utils/userDisplayName';
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

/** One muted trailing line: who exported it, when, or both. */
function formatDocMeta(exportedBy: string | null, createdAt: string): string | null {
  const parts = [exportedBy ? `Exported by ${exportedBy}` : null, formatCreatedAt(createdAt)];
  const meta = parts.filter(Boolean).join(' · ');
  return meta || null;
}

/**
 * Lists the Google Docs created from this recording's summary.
 *
 * The Docs API returns a document id only at creation time, so these come from
 * `calls.metadata.googleDocs` — without that list, an exported doc is reachable
 * only from whichever tab happened to be open when it was created.
 *
 * Everyone with the recording sees the list, and rows exported by someone else
 * are attributed. A doc lives in the exporting user's own Drive, so Xyne cannot
 * grant anyone else access to it — naming who exported it is the only useful
 * thing to say, and it is who a collaborator has to ask (PRD §11.4). The link
 * stays real either way, so "copy link address" gives them something to send.
 *
 * Clicks go through `openLink` rather than the browser's default navigation so
 * Electron honours the user's in-app / system-browser preference; the `href` is
 * still real, keeping hover previews and "copy link address" working.
 */
export function RecordingGoogleDocsList({
  documents,
  heading = 'Google Docs',
}: RecordingGoogleDocsListProps): ReactElement | null {
  const currentUser = useSelf();
  const usersById = useUsersById();

  if (documents.length === 0) return null;

  // Your own exports need no attribution, and legacy entries carry no exporter
  // at all — neither is worth a row that says "Exported by Unknown".
  const exporterName = (createdByUserId: string): string | null => {
    if (!createdByUserId || createdByUserId === currentUser?.id) return null;
    const user = usersById.get(createdByUserId);
    return user ? getUserDisplayName(user) : null;
  };

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
        {documents.map(doc => {
          const meta = formatDocMeta(exporterName(doc.createdByUserId), doc.createdAt);
          return (
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
                {meta ? (
                  <span className='shrink-0 text-xs text-muted-foreground'>{meta}</span>
                ) : null}
                <ExternalLink
                  className='size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100'
                  aria-hidden='true'
                />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
