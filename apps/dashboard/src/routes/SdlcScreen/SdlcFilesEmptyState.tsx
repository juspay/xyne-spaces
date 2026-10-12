import type { ReactElement } from 'react';
import { FileText, Folder, FolderOpen, Link2, Upload } from 'lucide-react';
import type { SdlcFilesLocation } from './sdlcItems';

/** An empty folder, or a track with nothing in it yet, and the ways to add to it. */
export function FilesEmptyState(props: {
  here: SdlcFilesLocation;
  /** Where it is shown, for the analytics events: the file list unless told otherwise. */
  place?: string;
  onNewArtifact: () => void;
  onUploadFile: () => void;
  onAddLink: () => void;
  onNewFolder: () => void;
}): ReactElement {
  const atTrack = props.here.type === 'TRACK';
  return (
    // A third of the way down rather than centred: it sits where the eye lands first,
    // and stays put however tall the window is.
    <div className='flex h-full min-h-[320px] flex-col items-center justify-start px-6 pb-12 pt-[12vh] text-center'>
      <div className='mb-5 grid size-14 place-items-center rounded-2xl border border-border bg-muted/40'>
        {atTrack ? (
          <FileText className='size-6 text-muted-foreground' aria-hidden='true' />
        ) : (
          <FolderOpen className='size-6 text-muted-foreground' aria-hidden='true' />
        )}
      </div>
      <h3 className='text-[15px] font-semibold text-foreground'>
        {atTrack ? `No files in ${props.here.name} yet` : `${props.here.name} is empty`}
      </h3>
      {/* Four ways in, weighed the same: none of them is the one you're meant to pick. */}
      <div className='mt-5 grid w-full max-w-[680px] grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2.5'>
        {(
          [
            {
              label: 'New artifact',
              hint: 'A doc, PRD or spec',
              icon: FileText,
              run: props.onNewArtifact,
              track: 'NewArtifactOpened',
            },
            {
              label: 'Upload file',
              hint: 'PDFs, docs, sheets, images',
              icon: Upload,
              run: props.onUploadFile,
              track: 'UploadFileOpened',
            },
            {
              label: 'Add link',
              hint: 'Jira, Figma, dashboards',
              icon: Link2,
              run: props.onAddLink,
              track: 'AddLinkOpened',
            },
            {
              label: 'New folder',
              hint: 'Group related items',
              icon: Folder,
              run: props.onNewFolder,
              track: 'NewFolderOpened',
            },
          ] as const
        ).map(option => (
          <button
            key={option.label}
            type='button'
            onClick={option.run}
            className='group flex flex-col items-start gap-3 rounded-xl border border-border p-3.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            data-track-category='SdlcHub'
            data-track-name={option.track}
            data-track-metadata={JSON.stringify({ place: props.place ?? 'files-empty' })}
          >
            <span className='grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground'>
              <option.icon className='size-4' />
            </span>
            <span>
              <span className='block text-[13px] font-semibold text-foreground'>
                {option.label}
              </span>
              <span className='mt-0.5 block text-xs text-muted-foreground'>{option.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
