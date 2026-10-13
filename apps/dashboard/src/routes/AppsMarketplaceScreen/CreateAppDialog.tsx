import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button/index';
import { IconPopoverPicker } from '@/components/AppIcon/IconPopoverPicker';
import { createBlankArtifactApp } from '@/services/claw/artifactAppsService';
import { copyTextToClipboard } from '@/utils/clipboardUtils';
import { appInitCommand } from '@/components/ArtifactApp/appInitCommand';

const MAX_TITLE = 120;
const MIN_DESCRIPTION = 5;
const MAX_DESCRIPTION = 500;

/**
 * Create app: name it, then build it locally.
 *
 * The app is created with nothing built yet, so its id exists before any code
 * does. The second step hands out the one command that installs the Spaces CLI
 * and scaffolds a project already pointed at this app — its first
 * `spaces app push` becomes version 1.
 */
export const CreateAppDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement => {
  const queryClient = useQueryClient();
  const [icon, setIcon] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = (): void => {
    setIcon(null);
    setTitle('');
    setDescription('');
    setCreated(null);
    setCopied(false);
  };

  const create = useMutation({
    mutationFn: () =>
      createBlankArtifactApp({
        title: title.trim(),
        description: description.trim(),
        ...(icon ? { icon } : {}),
      }),
    onSuccess: ({ app }) => {
      setCreated({ id: app.id, title: app.title });
      void queryClient.invalidateQueries({ queryKey: ['artifact-apps', 'mine'] });
    },
    onError: (error: unknown) => {
      toast.error('Could not create the app', {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });

  const close = (): void => {
    onOpenChange(false);
    reset();
  };

  const command = created ? appInitCommand(created.title, created.id) : '';
  const copy = (): void => {
    copyTextToClipboard(command)
      .then(() => setCopied(true))
      .catch(() => toast.error('Could not copy the command'));
  };

  const descriptionTooShort = description.trim().length < MIN_DESCRIPTION;
  const canCreate = title.trim().length > 0 && !descriptionTooShort && !create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={next => (next ? onOpenChange(true) : close())}
      title={created ? `Start building ${created.title}` : 'Create app'}
      description={
        created
          ? 'Paste this in your terminal to install the Spaces CLI and set up the project.'
          : "Build your own front end on your workspace's data."
      }
      className={
        created ? 'w-[min(92vw,44rem)] max-w-[44rem]' : 'w-[min(92vw,30rem)] max-w-[30rem]'
      }
    >
      {created ? (
        <div className='flex flex-col'>
          <div className='flex flex-col gap-5 px-6 pb-5 pt-6'>
            <div className='flex items-start justify-between gap-4'>
              <h2 className='text-xl font-semibold text-foreground'>
                Start building {created.title}
              </h2>
              <button
                type='button'
                onClick={close}
                aria-label='Close'
                className='-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                data-track-category='Apps'
                data-track-name='CreateAppCommandClose'
              >
                <X className='size-4' aria-hidden='true' />
              </button>
            </div>
            <p className='text-sm leading-6 text-muted-foreground'>
              Paste this in your terminal. It installs the Spaces CLI, sets up the project and signs
              you in. Then build it with your favourite coding tool.
            </p>
            <div className='flex justify-end'>
              <Button
                type='button'
                onClick={copy}
                className='bg-foreground text-background hover:bg-foreground/90'
                data-track-category='Apps'
                data-track-name='CreateAppCopyCommand'
              >
                {copied ? (
                  <Check className='size-4' aria-hidden='true' />
                ) : (
                  <Copy className='size-4' aria-hidden='true' />
                )}
                {copied ? 'Copied' : 'Copy command'}
              </Button>
            </div>
          </div>
          <div className='flex flex-col gap-3 rounded-b-lg border-t border-border bg-muted/40 px-6 pb-6 pt-4'>
            <span className='flex items-center gap-1.5 text-sm text-muted-foreground'>
              {copied && <Check className='size-3.5 text-emerald-600' aria-hidden='true' />}
              {copied ? 'Copied, paste it into your terminal' : 'Paste it into your terminal'}
            </span>
            <pre className='whitespace-pre-wrap break-all rounded-xl bg-zinc-900 px-5 py-4 font-mono text-[13px] leading-6 text-zinc-100'>
              {command}
            </pre>
          </div>
        </div>
      ) : (
        <form
          className='flex flex-col gap-5 p-6'
          onSubmit={e => {
            e.preventDefault();
            if (canCreate) create.mutate();
          }}
        >
          <div className='flex items-start justify-between gap-4'>
            <div className='flex flex-col gap-1'>
              <h2 className='text-xl font-semibold text-foreground'>Create app</h2>
              <p className='text-sm text-muted-foreground'>
                Build your own front end on your workspace&apos;s data.
              </p>
            </div>
            <button
              type='button'
              onClick={close}
              aria-label='Close'
              className='-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='Apps'
              data-track-name='CreateAppClose'
            >
              <X className='size-4' aria-hidden='true' />
            </button>
          </div>

          <div className='flex items-end gap-3'>
            <div className='flex flex-col gap-1.5'>
              <span className='text-sm font-medium text-foreground'>Icon</span>
              <IconPopoverPicker value={icon} onChange={setIcon} />
            </div>
            <label className='flex flex-1 flex-col gap-1.5'>
              <span className='text-sm font-medium text-foreground'>Name</span>
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={MAX_TITLE}
                placeholder='Monitor Tickets'
                data-track-category='Apps'
                data-track-name='CreateAppName'
                className='h-12 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </label>
          </div>

          <label className='flex flex-col gap-1.5'>
            <span className='text-sm font-medium text-foreground'>Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={MAX_DESCRIPTION}
              minLength={MIN_DESCRIPTION}
              required
              aria-invalid={description.length > 0 && descriptionTooShort}
              rows={3}
              placeholder="What it shows, and who it's for."
              data-track-category='Apps'
              data-track-name='CreateAppDescription'
              className='w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
            />
            {description.length > 0 && descriptionTooShort && (
              <span className='text-xs text-muted-foreground'>
                At least {MIN_DESCRIPTION} characters.
              </span>
            )}
          </label>

          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={close}
              data-track-category='Apps'
              data-track-name='CreateAppCancel'
            >
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={!canCreate}
              data-track-category='Apps'
              data-track-name='CreateAppSubmit'
            >
              {create.isPending ? 'Creating…' : 'Create app'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
};
