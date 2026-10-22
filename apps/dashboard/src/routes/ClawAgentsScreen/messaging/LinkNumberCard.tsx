/**
 * "Here is my WhatsApp number, make it me." Ported from the claw v3
 * LinkNumberPanel (XYNE-66872's two-step flow):
 *   1. POST /surfaces/:channel/my-numbers {phone} sends a one-time code,
 *   2. POST /surfaces/:channel/my-numbers/confirm {phone, code} links it on
 *      every channel the org runs.
 * The number belongs to the person, not one agent, so there is nothing to pick.
 */
import { ReactElement, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { invalidateClawMessaging, useClawMyNumbers } from '@/hooks/useClawMessaging';
import {
  confirmChannelNumber,
  requestChannelNumberCode,
  unlinkMyChannelNumber,
} from '@/services/claw/clawMessagingService';
import { ClawApiError } from '@/services/claw/clawRequest';
import type { ChannelNumberLink, MessagingChannelKey } from '@/services/claw/clawMessagingTypes';
import {
  WHATSAPP_LINK_CHANNELS,
  formatNumber,
  isCompleteCode,
  keepCodeStepAfter,
  linkErrorText,
  type MyNumber,
} from './messagingChannels';

/** A code is on its way to `phone`; `channel` is the route that sent it. */
interface Pending {
  phone: string;
  channel: MessagingChannelKey;
  expiresAt: string;
}

const TRACK_CATEGORY = 'claw-settings';

const expiryText = (expiresAt: string): string => {
  const at = new Date(expiresAt);
  return Number.isNaN(at.getTime())
    ? ''
    : ` It expires at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
};

export const LinkNumberCard = (): ReactElement => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const numbers = useClawMyNumbers(WHATSAPP_LINK_CHANNELS);
  const phoneId = useId();
  const codeId = useId();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [justLinked, setJustLinked] = useState<ChannelNumberLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** One code, whichever channel takes the request: a channel this deployment
   *  does not run refuses with 404, and the next one is tried. */
  const sendCode = async (number: string): Promise<void> => {
    setBusy(true);
    setError(null);
    let failure: unknown = null;
    try {
      for (const channel of WHATSAPP_LINK_CHANNELS) {
        try {
          const verification = await requestChannelNumberCode(channel, number);
          setPending({ phone: number, channel, expiresAt: verification.expiresAt });
          setCode('');
          return;
        } catch (err) {
          const notHere = err instanceof ClawApiError && err.status === 404;
          // Keep the first real refusal over a "not on this channel".
          if (!failure || (failure instanceof ClawApiError && failure.status === 404)) {
            failure = err;
          }
          if (!notHere) {
            break;
          }
        }
      }
      setError(linkErrorText(failure, 'send'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (!pending) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const link = await confirmChannelNumber(pending.channel, pending.phone, code);
      setJustLinked(link);
      setPending(null);
      setPhone('');
      setCode('');
      await invalidateClawMessaging(queryClient);
    } catch (err) {
      setError(linkErrorText(err, 'confirm'));
      if (!keepCodeStepAfter(err)) {
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (mine: MyNumber): Promise<void> => {
    setUnlinking(mine.display);
    try {
      const results = await Promise.allSettled(
        mine.entries.map(entry => unlinkMyChannelNumber(entry.channel, entry.senderId)),
      );
      if (results.some(result => result.status === 'rejected')) {
        toast.error(`Could not fully unlink ${mine.display}. Try again.`);
      } else {
        toast.success(`${mine.display} unlinked`);
      }
      setJustLinked(current =>
        current && formatNumber(current.senderId) === mine.display ? null : current,
      );
      await invalidateClawMessaging(queryClient);
    } finally {
      setUnlinking(null);
    }
  };

  const linked = numbers.data ?? [];

  return (
    <div
      data-testid='claw-settings-link-number'
      className='rounded-2xl border border-border bg-muted/30 p-4'
    >
      <div className='mb-3 flex items-start gap-3'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground'>
          <Phone className='size-4' />
        </div>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold text-foreground'>Your WhatsApp number</h3>
          <p className='text-xs text-muted-foreground'>
            Add the number you message from so agents answer as you, with your own access. We send a
            one-time code to confirm it is yours.
          </p>
        </div>
      </div>

      {justLinked ? (
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm text-foreground'>
          <CheckCircle2 className='size-4 shrink-0 text-emerald-600' />
          <span>
            <span className='font-mono'>{formatNumber(justLinked.senderId)}</span> now runs as{' '}
            {user?.email ?? 'you'}.{' '}
            {justLinked.sendTo ? (
              <>
                Message <span className='font-mono'>{justLinked.sendTo}</span> on WhatsApp and it
                answers as you.
              </>
            ) : (
              'Message the assistant on WhatsApp and it answers as you.'
            )}
          </span>
          <Button
            variant='link'
            size='inline'
            className='text-xs'
            onClick={() => setJustLinked(null)}
            data-track-category={TRACK_CATEGORY}
            data-track-name='LINK_NUMBER_ADD_ANOTHER'
          >
            Add another
          </Button>
        </div>
      ) : pending ? (
        <div className='space-y-2'>
          <p className='text-sm text-muted-foreground'>
            We sent a code to <span className='font-mono text-foreground'>{pending.phone}</span> on
            WhatsApp. Enter it to link the number.{expiryText(pending.expiresAt)}
          </p>
          <div className='flex items-center gap-2'>
            <label htmlFor={codeId} className='sr-only'>
              Verification code
            </label>
            <Input
              id={codeId}
              value={code}
              onChange={event => setCode(event.target.value)}
              placeholder='6-digit code'
              inputMode='numeric'
              autoComplete='one-time-code'
              maxLength={7}
              variant='flat'
              className='max-w-48 font-mono'
              onKeyDown={event => {
                if (event.key === 'Enter' && !busy && isCompleteCode(code)) {
                  void confirm();
                }
              }}
            />
            <Button
              size='sm'
              loading={busy}
              disabled={!isCompleteCode(code)}
              onClick={() => void confirm()}
              data-track-category={TRACK_CATEGORY}
              data-track-name='LINK_NUMBER_VERIFY'
            >
              Verify
            </Button>
          </div>
          <div className='flex flex-wrap items-center gap-3 text-xs'>
            <Button
              variant='link'
              size='inline'
              className='text-xs text-muted-foreground'
              disabled={busy}
              onClick={() => void sendCode(pending.phone)}
              data-track-category={TRACK_CATEGORY}
              data-track-name='LINK_NUMBER_RESEND'
            >
              Send a new code
            </Button>
            <Button
              variant='link'
              size='inline'
              className='text-xs text-muted-foreground'
              disabled={busy}
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              data-track-category={TRACK_CATEGORY}
              data-track-name='LINK_NUMBER_CHANGE'
            >
              Use a different number
            </Button>
          </div>
        </div>
      ) : (
        <div className='space-y-1.5'>
          <div className='flex items-center gap-2'>
            <label htmlFor={phoneId} className='sr-only'>
              WhatsApp number
            </label>
            <Input
              id={phoneId}
              value={phone}
              onChange={event => setPhone(event.target.value)}
              placeholder='+1 555 000 0000'
              inputMode='tel'
              autoComplete='tel'
              variant='flat'
              className='max-w-64 font-mono'
              onKeyDown={event => {
                if (event.key === 'Enter' && !busy && phone.trim().length >= 6) {
                  void sendCode(phone.trim());
                }
              }}
            />
            <Button
              size='sm'
              loading={busy}
              disabled={phone.trim().length < 6}
              onClick={() => void sendCode(phone.trim())}
              data-track-category={TRACK_CATEGORY}
              data-track-name='LINK_NUMBER_SEND_CODE'
            >
              Send code
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>
            +91 is assumed unless you add a country code.
          </p>
        </div>
      )}

      {error && (
        <p role='alert' className='mt-2 text-xs text-destructive'>
          {error}
        </p>
      )}

      <div className='mt-4'>
        {numbers.isLoading ? (
          <Skeleton className='h-9 w-full rounded-lg' />
        ) : numbers.isError ? (
          <p className='text-xs text-muted-foreground'>
            Couldn’t load your linked numbers.{' '}
            <Button
              variant='link'
              size='inline'
              className='text-xs'
              onClick={() => void numbers.refetch()}
              data-track-category={TRACK_CATEGORY}
              data-track-name='LINK_NUMBER_RETRY_LOAD'
            >
              Try again
            </Button>
          </p>
        ) : linked.length > 0 ? (
          <ul className='divide-y divide-border rounded-lg border border-border bg-background'>
            {linked.map(mine => (
              <li
                key={mine.display}
                data-testid='claw-settings-linked-number'
                className='flex items-center justify-between gap-3 px-3 py-2'
              >
                <span className='flex min-w-0 items-center gap-2'>
                  <span className='truncate font-mono text-sm text-foreground'>{mine.display}</span>
                  {mine.verified ? (
                    <Badge variant='success'>Verified</Badge>
                  ) : (
                    <Badge variant='outline'>Not verified</Badge>
                  )}
                </span>
                <span className='flex shrink-0 items-center gap-1'>
                  {!mine.verified && (
                    <Button
                      variant='ghost'
                      size='sm'
                      disabled={busy}
                      onClick={() => void sendCode(mine.display)}
                      data-track-category={TRACK_CATEGORY}
                      data-track-name='LINK_NUMBER_VERIFY_EXISTING'
                    >
                      Verify
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    size='sm'
                    className='text-destructive hover:text-destructive'
                    loading={unlinking === mine.display}
                    onClick={() => void unlink(mine)}
                    data-track-category={TRACK_CATEGORY}
                    data-track-name='LINK_NUMBER_UNLINK'
                  >
                    Unlink
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {!numbers.isLoading && !numbers.isError && linked.some(mine => !mine.verified) && (
          <p className='mt-1.5 text-xs text-muted-foreground'>
            A number that isn’t verified does nothing until you confirm a code sent to it.
          </p>
        )}
      </div>
    </div>
  );
};
