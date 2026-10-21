import type { ReactElement, ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Avatar from '../../components/ui/Avatar/Avatar';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { formatFileSize } from './fileKind';
import { sdlcItemName, type SdlcFilesLocation, type SdlcTrackItem } from './sdlcItems';

function formatWhen(value: number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Person(props: { userId: string }): ReactElement {
  const user = useUser(props.userId);
  return (
    <span className='flex min-w-0 items-center gap-2'>
      <Avatar userId={props.userId} size='xs' showActiveStatus={false} />
      <span className='truncate'>{user ? getUserDisplayName(user) : 'Unknown'}</span>
    </span>
  );
}

function Detail(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <>
      <dt className='text-muted-foreground'>{props.label}</dt>
      <dd className='min-w-0'>{props.children}</dd>
    </>
  );
}

/**
 * Everything the file list knows about one item, in place of the columns it has no
 * room for: who made it, when, and when it last changed. Links and files are never
 * edited, so they have only a creation time.
 */
export function SdlcItemInfoDialog(props: {
  item: SdlcTrackItem | null;
  /** What it is, in words, as the list's Type column says. */
  typeLabel: string;
  icon: ReactNode;
  /** The folders from the track down to the one holding it. */
  location: readonly SdlcFilesLocation[];
  onClose: () => void;
}): ReactElement {
  const { item } = props;
  return (
    <Dialog
      open={item !== null}
      onOpenChange={open => {
        if (!open) props.onClose();
      }}
      title={item ? `${sdlcItemName(item)} info` : 'Info'}
      className='max-w-lg'
    >
      {item && (
        <div className='p-6'>
          <div className='flex min-w-0 items-center gap-3'>
            <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted'>
              {props.icon}
            </span>
            <h2 className='min-w-0 break-words text-base font-semibold tracking-tight'>
              {sdlcItemName(item)}
            </h2>
          </div>
          <dl className='mt-6 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
            <Detail label='Type'>{props.typeLabel}</Detail>
            {item.kind === 'ATTACHMENT' && (
              <Detail label='Size'>
                <span className='tabular-nums'>{formatFileSize(item.size)}</span>
              </Detail>
            )}
            {item.kind === 'LINK' && (
              <Detail label='Address'>
                <a
                  href={item.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='block truncate text-primary underline-offset-2 hover:underline'
                  title={item.url}
                  data-track-category='SdlcHub'
                  data-track-name='FilesInfoLinkOpened'
                >
                  {item.url}
                </a>
              </Detail>
            )}
            {item.kind === 'LINK' && item.description?.trim() && (
              <Detail label='Description'>
                <span className='break-words'>{item.description}</span>
              </Detail>
            )}
            <Detail label='Location'>
              <span className='break-words'>
                {props.location.map(step => step.name).join(' / ')}
              </span>
            </Detail>
            <Detail label='Owner'>
              <Person userId={item.createdBy} />
            </Detail>
            <Detail label='Created'>
              <span className='tabular-nums'>{formatWhen(item.createdAt)}</span>
            </Detail>
            {item.kind === 'FOLDER' && (
              <Detail label='Updated'>
                <span className='tabular-nums'>{formatWhen(item.updatedAt)}</span>
              </Detail>
            )}
            {item.kind === 'CANVAS' && (
              <Detail label='Last edited'>
                <span className='tabular-nums'>
                  {formatWhen(item.lastEditedAt ?? item.updatedAt)}
                </span>
              </Detail>
            )}
            {item.kind === 'CANVAS' && item.lastEditedBy && (
              <Detail label='Last edited by'>
                <Person userId={item.lastEditedBy} />
              </Detail>
            )}
          </dl>
          <div className='mt-7 flex justify-end'>
            <Button
              variant='outline'
              onClick={props.onClose}
              data-track-category='SdlcHub'
              data-track-name='FilesInfoClosed'
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
