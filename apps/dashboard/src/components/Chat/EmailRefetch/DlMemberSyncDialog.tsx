import React, { useCallback, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { cn } from '../../../utils/classNames';
import { RangeCalendar } from './RangeCalendar';
import { useOAuthProviders } from '../../../hooks/useOAuthProviders';
import { apiInstance } from '../../../services/clients/apiClient';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';

type Mode = 'last-30d' | 'last-3mo' | 'last-6mo' | 'custom';

interface PresetOption {
  value: Exclude<Mode, 'custom'>;
  label: string;
  days: number;
}

const PRESETS: PresetOption[] = [
  { value: 'last-30d', label: 'Last 30 days', days: 30 },
  { value: 'last-3mo', label: 'Last 3 months', days: 90 },
  { value: 'last-6mo', label: 'Last 6 months', days: 180 },
];

const MAX_RANGE_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const daysAgo = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return startOfDay(d);
};

const formatRange = (start: Date, end: Date): string => {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const sameYear = start.getFullYear() === end.getFullYear();
  const sY = `${months[start.getMonth()]} ${start.getDate()}${sameYear ? '' : `, ${start.getFullYear()}`}`;
  const eY = `${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  return `${sY} – ${eY}`;
};

const formatTriggerDate = (d: Date | null, placeholder: string): string => {
  if (!d) return placeholder;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

const getStartSyncErrorMessage = (err: unknown): string => {
  if (isAxiosError<{ error?: string }>(err)) {
    return err.response?.data?.error ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
};

interface DlMemberSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
}

export const DlMemberSyncDialog: React.FC<DlMemberSyncDialogProps> = ({
  open,
  onOpenChange,
  channelId,
}) => {
  const [step, setStep] = useState<'range' | 'provider'>('range');
  const [mode, setMode] = useState<Mode>('last-3mo');
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { data: providers } = useOAuthProviders();

  const resolved = useMemo<{ startDate: Date; endDate: Date } | null>(() => {
    if (mode === 'custom') {
      if (!customStart || !customEnd) return null;
      return { startDate: startOfDay(customStart), endDate: endOfDay(customEnd) };
    }
    const preset = PRESETS.find(p => p.value === mode);
    if (!preset) return null;
    return { startDate: daysAgo(preset.days), endDate: endOfDay(new Date()) };
  }, [mode, customStart, customEnd]);

  const customRangeError = useMemo<string | null>(() => {
    if (mode !== 'custom' || !customStart || !customEnd) return null;
    if (customStart > customEnd) return 'Start date must be on or before end date';
    const span = endOfDay(customEnd).getTime() - startOfDay(customStart).getTime();
    if (span > MAX_RANGE_DAYS * MS_PER_DAY) return `Range cannot exceed ${MAX_RANGE_DAYS} days`;
    return null;
  }, [mode, customStart, customEnd]);

  const isRangeReady = mode !== 'custom' || (!!customStart && !!customEnd && !customRangeError);

  const handleProviderSelect = useCallback(
    async (provider: 'google' | 'microsoft') => {
      if (!resolved) return;
      setIsRedirecting(true);
      try {
        const res = await apiInstance.post<{ authUrl: string }>(
          `/integrations/desk/${channelId}/dl-member-sync-init`,
          {
            startDate: resolved.startDate.toISOString(),
            endDate: resolved.endDate.toISOString(),
            provider,
          },
        );
        window.location.href = res.data.authUrl;
      } catch (err: unknown) {
        const msg = getStartSyncErrorMessage(err);
        toast.error('Failed to start sync', { description: msg });
        setIsRedirecting(false);
      }
    },
    [resolved, channelId],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setStep('range');
        setIsRedirecting(false);
      }
      onOpenChange(open);
    },
    [onOpenChange],
  );

  const renderPreset = (value: Mode, label: string): React.ReactElement => {
    const active = mode === value;
    return (
      <button
        key={value}
        type='button'
        onClick={() => setMode(value)}
        data-track-category='Support'
        data-track-name='SelectDlMemberSyncRangePreset'
        data-track-metadata={JSON.stringify({ mode: value })}
        className={cn(
          'flex flex-col items-start justify-center gap-0.5 rounded-lg border-2 px-3 py-2 min-h-[58px] transition-all text-left',
          active
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted/40',
        )}
      >
        <span className='text-sm font-medium'>{label}</span>
      </button>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title='Sync older emails'
      description='Backfill older DL emails from a member mailbox.'
      className='max-w-lg'
    >
      <div className='p-6 space-y-5'>
        <div>
          <div className='text-lg font-semibold text-foreground'>Sync older emails</div>
          <p className='text-sm text-muted-foreground mt-0.5'>
            {step === 'range'
              ? 'Choose how far back to fetch emails sent to this distribution list.'
              : 'Sign in with a member mailbox that has the older DL emails.'}
          </p>
        </div>

        {step === 'range' && (
          <>
            <div className='space-y-2'>
              <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
                Time range
              </div>
              <div className='grid grid-cols-2 gap-2'>
                {PRESETS.map(p => renderPreset(p.value, p.label))}
                {renderPreset('custom', 'Custom')}
              </div>
            </div>

            {mode === 'custom' && (
              <div className='space-y-2'>
                <div className='grid grid-cols-2 gap-2'>
                  <DateField
                    label='From'
                    value={customStart}
                    rangeForVisual={{ start: customStart, end: customEnd }}
                    onPick={d => setCustomStart(d)}
                    placeholder='Start date'
                    maxDate={customEnd ?? new Date()}
                  />
                  <DateField
                    label='To'
                    value={customEnd}
                    rangeForVisual={{ start: customStart, end: customEnd }}
                    onPick={d => setCustomEnd(d)}
                    placeholder='End date'
                    {...(customStart && { minDate: customStart })}
                    maxDate={new Date()}
                  />
                </div>
                {(customStart || customEnd || customRangeError) && (
                  <div className='text-xs text-muted-foreground'>
                    {!customStart && 'Pick a start date.'}
                    {customStart && !customEnd && 'Now pick the end date.'}
                    {customStart && customEnd && !customRangeError && (
                      <span className='text-foreground'>{formatRange(customStart, customEnd)}</span>
                    )}
                    {customRangeError && <p className='text-destructive'>{customRangeError}</p>}
                  </div>
                )}
              </div>
            )}

            {mode !== 'custom' && resolved && (
              <div className='rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
                Will sync emails received{' '}
                <span className='text-foreground font-medium'>
                  {formatRange(resolved.startDate, resolved.endDate)}
                </span>
              </div>
            )}

            <div className='flex justify-end gap-2 pt-1'>
              <Button
                variant='outline'
                type='button'
                onClick={() => handleOpenChange(false)}
                data-track-category='Support'
                data-track-name='CLOSE_DL_SYNC_DIALOG'
              >
                Cancel
              </Button>
              <Button
                type='button'
                disabled={!isRangeReady}
                onClick={() => setStep('provider')}
                data-track-category='Support'
                data-track-name='DL_SYNC_BACK_TO_PROVIDER'
              >
                Next
              </Button>
            </div>
          </>
        )}

        {step === 'provider' && (
          <>
            <div className='space-y-2'>
              <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
                Connect email account
              </div>
              <div className='flex flex-col gap-2'>
                {providers?.microsoft && (
                  <Button
                    variant='outline'
                    className='justify-start gap-3 h-12 text-left'
                    onClick={() => {
                      void handleProviderSelect('microsoft');
                    }}
                    data-track-category='Support'
                    data-track-name='DL_SYNC_SELECT_MICROSOFT'
                    disabled={isRedirecting}
                  >
                    {isRedirecting ? (
                      <Loader2 size={18} className='animate-spin' />
                    ) : (
                      <MicrosoftIcon />
                    )}
                    <span>Sign in with Microsoft</span>
                  </Button>
                )}
                {providers?.google && (
                  <Button
                    variant='outline'
                    className='justify-start gap-3 h-12 text-left'
                    onClick={() => {
                      void handleProviderSelect('google');
                    }}
                    data-track-category='Support'
                    data-track-name='DL_SYNC_SELECT_GOOGLE'
                    disabled={isRedirecting}
                  >
                    {isRedirecting ? (
                      <Loader2 size={18} className='animate-spin' />
                    ) : (
                      <GoogleIcon />
                    )}
                    <span>Sign in with Google</span>
                  </Button>
                )}
              </div>
            </div>

            <div className='rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400'>
              Only distribution-list emails from the selected range will be synced. Existing tickets
              will not be duplicated.
            </div>

            <div className='flex justify-end gap-2 pt-1'>
              <Button
                variant='outline'
                type='button'
                onClick={() => setStep('range')}
                data-track-category='Support'
                data-track-name='DL_SYNC_BACK_TO_RANGE'
              >
                Back
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};

const MicrosoftIcon: React.FC = () => (
  <svg width='18' height='18' viewBox='0 0 21 21' fill='none'>
    <rect x='1' y='1' width='9' height='9' fill='#F25022' />
    <rect x='11' y='1' width='9' height='9' fill='#7FBA00' />
    <rect x='1' y='11' width='9' height='9' fill='#00A4EF' />
    <rect x='11' y='11' width='9' height='9' fill='#FFB900' />
  </svg>
);

const GoogleIcon: React.FC = () => (
  <svg width='18' height='18' viewBox='0 0 24 24'>
    <path
      d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z'
      fill='#4285F4'
    />
    <path
      d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
      fill='#34A853'
    />
    <path
      d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
      fill='#FBBC05'
    />
    <path
      d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
      fill='#EA4335'
    />
  </svg>
);

interface DateFieldProps {
  label: string;
  value: Date | null;
  rangeForVisual: { start: Date | null; end: Date | null };
  onPick: (date: Date) => void;
  placeholder: string;
  minDate?: Date;
  maxDate?: Date;
}

const DateField: React.FC<DateFieldProps> = ({
  label,
  value,
  rangeForVisual,
  onPick,
  placeholder,
  minDate,
  maxDate,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className='space-y-1'>
      <span className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type='button'
            className={cn(
              'w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm flex items-center justify-between gap-2',
              'hover:border-muted-foreground/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors',
              value ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className='truncate'>{formatTriggerDate(value, placeholder)}</span>
            <CalendarIcon className='size-3.5 text-muted-foreground shrink-0' />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            align='start'
            side='bottom'
            avoidCollisions
            collisionPadding={16}
            className={cn(
              'z-50 rounded-lg border border-border bg-popover shadow-md',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'duration-150',
            )}
          >
            <RangeCalendar
              value={value}
              range={rangeForVisual}
              onSelect={d => {
                onPick(d);
                setOpen(false);
              }}
              {...(minDate && { minDate })}
              {...(maxDate && { maxDate })}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
};

export default DlMemberSyncDialog;
