import { useEffect, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover } from '../../../ui/Popover';
import {
  designShareQueryKey,
  designShareUrl,
  designShareViews,
  getDesignShare,
  publishDesignShare,
  publishShareErrorMessage,
  revokeDesignShare,
  type DesignShare,
} from '../../../../services/XyneAI/designShareService';

const ACTION =
  'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-50';

export function DesignShareButton({
  conversationId,
  attachmentId,
  title,
  hasUnsavedEdits,
}: {
  conversationId: string | null;
  attachmentId: string | null;
  title: string;
  hasUnsavedEdits: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const shareable = Boolean(conversationId && attachmentId);

  const trigger = (
    <button
      type='button'
      disabled={!shareable}
      aria-label='Share design'
      title={shareable ? 'Share a public link' : 'Only saved versions can be shared'}
      className='inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-secondary data-[state=open]:text-foreground'
      data-track-category='AskAI'
      data-track-name='design-share-open'
      data-testid='design-share'
    >
      <Link2 className='h-3.5 w-3.5' />
      Share
    </button>
  );

  if (!shareable) return trigger;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='end'
      sideOffset={6}
      collisionPadding={12}
      className='z-[80] w-[340px] rounded-xl border border-border bg-popover p-0 shadow-lg'
      trigger={trigger}
    >
      {open && conversationId && attachmentId && (
        <DesignSharePanel
          conversationId={conversationId}
          attachmentId={attachmentId}
          title={title}
          hasUnsavedEdits={hasUnsavedEdits}
        />
      )}
    </Popover>
  );
}

function DesignSharePanel({
  conversationId,
  attachmentId,
  title,
  hasUnsavedEdits,
}: {
  conversationId: string;
  attachmentId: string;
  title: string;
  hasUnsavedEdits: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const queryKey = designShareQueryKey(conversationId);
  const shareQuery = useQuery({
    queryKey,
    queryFn: () => getDesignShare(conversationId),
    staleTime: 0,
    refetchInterval: 10_000,
  });
  const [busy, setBusy] = useState<'publish' | 'revoke' | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const share = shareQuery.data ?? null;
  const url = share ? designShareUrl(share.sharePath, window.location.origin) : '';
  const outdated = share !== null && share.attachmentId !== attachmentId;

  const publish = async (): Promise<void> => {
    setBusy('publish');
    try {
      const next = await publishDesignShare({ attachmentId, conversationId, title });
      queryClient.setQueryData<DesignShare | null>(queryKey, next);
    } catch (error) {
      toast.error(publishShareErrorMessage(error, 'Could not create the link'));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (): Promise<void> => {
    if (!share) return;
    setBusy('revoke');
    try {
      await revokeDesignShare(share.id);
      queryClient.setQueryData<DesignShare | null>(queryKey, null);
      setConfirmRevoke(false);
      toast.success('Link revoked');
    } catch {
      toast.error('Could not revoke the link');
    } finally {
      setBusy(null);
    }
  };

  const copy = (): void => {
    void navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => toast.error('Could not copy the link'),
    );
  };

  return (
    <div className='flex flex-col gap-3 p-4' data-testid='design-share-panel'>
      <div>
        <p className='text-sm font-semibold text-foreground'>Share design</p>
        <p className='text-xs text-muted-foreground'>
          Anyone with the link can view it, without signing in.
        </p>
      </div>

      {shareQuery.isLoading ? (
        <div className='h-16 animate-pulse rounded-lg bg-muted' />
      ) : shareQuery.isError ? (
        <p className='text-xs text-muted-foreground'>
          Couldn’t load the link.{' '}
          <button
            type='button'
            onClick={() => void shareQuery.refetch()}
            className='font-medium text-foreground underline'
            data-track-category='AskAI'
            data-track-name='design-share-retry'
          >
            Retry
          </button>
        </p>
      ) : share ? (
        <>
          <div className='flex items-center gap-1.5'>
            <input
              readOnly
              value={url}
              aria-label='Share link'
              onFocus={event => event.currentTarget.select()}
              className='h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 font-mono text-[11px] text-foreground'
              data-testid='design-share-url'
              data-track-category='AskAI'
              data-track-name='design-share-select-link'
            />
            <button
              type='button'
              onClick={copy}
              className={`${ACTION} border border-border text-foreground hover:bg-secondary/60`}
              data-track-category='AskAI'
              data-track-name='design-share-copy'
              data-testid='design-share-copy'
            >
              {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              href={url}
              target='_blank'
              rel='noopener noreferrer'
              aria-label='Open link'
              title='Open link'
              className='grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              data-track-category='AskAI'
              data-track-name='design-share-open-link'
            >
              <ExternalLink className='h-3.5 w-3.5' />
            </a>
          </div>
          <p className='text-xs text-muted-foreground' data-testid='design-share-views'>
            {designShareViews(share.viewCount)}
          </p>
          {outdated && (
            <div className='flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground'>
              <span>The link shows an earlier version.</span>
              <button
                type='button'
                disabled={busy !== null}
                onClick={() => void publish()}
                className={`${ACTION} bg-foreground text-background hover:bg-foreground/90`}
                data-track-category='AskAI'
                data-track-name='design-share-update'
                data-testid='design-share-update'
              >
                {busy === 'publish' && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
                Update link
              </button>
            </div>
          )}
          {confirmRevoke ? (
            <div className='flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground'>
              <span>Anyone with the link loses access.</span>
              <span className='flex gap-1'>
                <button
                  type='button'
                  onClick={() => setConfirmRevoke(false)}
                  className={`${ACTION} text-muted-foreground hover:bg-secondary/60`}
                  data-track-category='AskAI'
                  data-track-name='design-share-revoke-cancel'
                >
                  Cancel
                </button>
                <button
                  type='button'
                  disabled={busy !== null}
                  onClick={() => void revoke()}
                  className={`${ACTION} bg-destructive text-destructive-foreground hover:bg-destructive/90`}
                  data-track-category='AskAI'
                  data-track-name='design-share-revoke-confirm'
                  data-testid='design-share-revoke-confirm'
                >
                  {busy === 'revoke' && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
                  Revoke
                </button>
              </span>
            </div>
          ) : (
            <button
              type='button'
              onClick={() => setConfirmRevoke(true)}
              className={`${ACTION} w-fit px-0 text-destructive hover:underline`}
              data-track-category='AskAI'
              data-track-name='design-share-revoke'
              data-testid='design-share-revoke'
            >
              Revoke link
            </button>
          )}
        </>
      ) : (
        <button
          type='button'
          disabled={busy !== null}
          onClick={() => void publish()}
          className={`${ACTION} h-8 w-fit bg-foreground text-background hover:bg-foreground/90`}
          data-track-category='AskAI'
          data-track-name='design-share-publish'
          data-testid='design-share-publish'
        >
          {busy === 'publish' ? (
            <Loader2 className='h-3.5 w-3.5 animate-spin' />
          ) : (
            <Link2 className='h-3.5 w-3.5' />
          )}
          Create link
        </button>
      )}

      {hasUnsavedEdits && (
        <p className='text-xs text-muted-foreground'>
          Your unsaved edits aren’t in the link. Apply them first to share them.
        </p>
      )}
    </div>
  );
}
