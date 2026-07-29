import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { useMarkEmailRead } from '../../../hooks/useMarkEmailRead';
import { cn } from '../../../utils/classNames';

interface CallThreadEmail {
  id: string;
  body: string;
  createdAt: number;
  externalMessageId?: string | null;
}

interface CallThreadProps {
  emails: CallThreadEmail[];
  ticketId?: string | null | undefined;
  lastEmailAt?: number | null | undefined;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }> | undefined;
}

interface OzonetelSharedFields {
  agent?: string;
  monitorUcid?: string;
  ucid?: string;
  uui?: string;
  callType?: string;
  campaignName?: string;
  transferType?: string;
  transferredTo?: string;
  disposition?: string;
  comments?: string;
}

interface TelephonyMetadata extends OzonetelSharedFields {
  provider: 'ozonetel';
  externalId: string;
  workspaceId: string;
  status: 'RINGING' | 'ANSWERED' | 'ENDED' | 'MISSED' | 'FAILED';
  direction?: 'INBOUND' | 'OUTBOUND';
  callerId?: string;
  fromNumber?: string;
  toNumber?: string;
  recordingUrl?: string;
  startedAt?: string;
  endedAt?: string;
  talkTimeSec?: number;
}

interface TelephonyBodyPayload extends OzonetelSharedFields {
  provider: 'ozonetel';
  from?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  status?: string;
  recording?: string;
}

function formatTelephonyTimestamp(value?: string): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const naiveUtcMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const date = naiveUtcMatch
    ? new Date(
        `${naiveUtcMatch[1]}-${naiveUtcMatch[2]}-${naiveUtcMatch[3]}T${naiveUtcMatch[4]}:${naiveUtcMatch[5]}:${naiveUtcMatch[6]}Z`,
      )
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return value.trim();

  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatTelephonyDuration(sec?: number): string | null {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return null;
  const total = Math.max(0, Math.round(sec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':');
}

function parseTelephonyDuration(value?: string): number | undefined {
  if (!value) return undefined;
  const parts = value
    .trim()
    .split(':')
    .map(part => Number(part));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return undefined;
  const [hours, minutes, seconds] = parts as [number, number, number];
  return hours * 3600 + minutes * 60 + seconds;
}

function parseTelephonyStatus(value?: string): TelephonyMetadata['status'] | undefined {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return undefined;
  if (normalized.startsWith('answered')) return 'ANSWERED';
  if (normalized.startsWith('missed')) return 'MISSED';
  if (normalized.startsWith('failed')) return 'FAILED';
  if (normalized.startsWith('ringing')) return 'RINGING';
  return undefined;
}

function inferTelephonyDirection(callType?: string): TelephonyMetadata['direction'] {
  const normalized = callType?.trim().toLowerCase() ?? '';
  if (!normalized) return undefined;
  if (normalized.includes('inbound') || normalized.includes('incoming')) return 'INBOUND';
  return 'OUTBOUND';
}

function parseTelephonyMetadata(body: string): TelephonyMetadata | null {
  if (!body) return null;
  try {
    const payload = JSON.parse(body) as TelephonyBodyPayload;
    if (payload.provider !== 'ozonetel') return null;

    const direction = inferTelephonyDirection(payload.callType);
    const talkTimeSec = parseTelephonyDuration(payload.duration);

    return {
      provider: 'ozonetel',
      externalId: payload.monitorUcid ?? '',
      workspaceId: '',
      status: parseTelephonyStatus(payload.status) ?? 'RINGING',
      ...(direction ? { direction } : {}),
      ...(payload.from ? { callerId: payload.from, fromNumber: payload.from } : {}),
      ...(payload.agent ? { agent: payload.agent } : {}),
      ...(payload.monitorUcid ? { monitorUcid: payload.monitorUcid } : {}),
      ...(payload.ucid ? { ucid: payload.ucid } : {}),
      ...(payload.uui ? { uui: payload.uui } : {}),
      ...(payload.callType ? { callType: payload.callType } : {}),
      ...(payload.campaignName ? { campaignName: payload.campaignName } : {}),
      ...(payload.transferType ? { transferType: payload.transferType } : {}),
      ...(payload.transferredTo ? { transferredTo: payload.transferredTo } : {}),
      ...(payload.disposition ? { disposition: payload.disposition } : {}),
      ...(payload.comments ? { comments: payload.comments } : {}),
      ...(payload.recording ? { recordingUrl: payload.recording } : {}),
      ...(payload.startTime ? { startedAt: payload.startTime } : {}),
      ...(payload.endTime ? { endedAt: payload.endTime } : {}),
      ...(talkTimeSec !== undefined ? { talkTimeSec } : {}),
    };
  } catch {
    return null;
  }
}

function telephonyStatusLabel(meta: TelephonyMetadata): string {
  if (meta.status === 'ENDED' || meta.status === 'ANSWERED') return 'Answered';
  if (meta.status === 'MISSED') return 'Missed';
  if (meta.status === 'FAILED') return 'Failed';
  return 'Ringing';
}

function TelephonyField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}): ReactElement | null {
  if (!value) return null;
  return (
    <div className='rounded-xl border border-border bg-background px-3 py-2'>
      <div className='text-[11px] uppercase tracking-wide text-muted-foreground'>{label}</div>
      <div className='mt-1 text-sm text-foreground'>{value}</div>
    </div>
  );
}

function buildTelephonyFields(
  meta: TelephonyMetadata,
): Array<{ label: string; value: string | null }> {
  return [
    { label: 'Status', value: telephonyStatusLabel(meta) },
    { label: 'Duration', value: formatTelephonyDuration(meta.talkTimeSec) },
    { label: 'Started', value: formatTelephonyTimestamp(meta.startedAt) },
    { label: 'Ended', value: formatTelephonyTimestamp(meta.endedAt) },
    { label: 'Caller', value: meta.callerId ?? null },
    { label: 'Agent', value: meta.agent ?? null },
    { label: 'Monitor UCID', value: meta.monitorUcid ?? null },
    { label: 'UCID', value: meta.ucid ?? null },
    { label: 'Campaign', value: meta.campaignName ?? null },
    { label: 'Call Type', value: meta.callType ?? null },
    { label: 'Disposition', value: meta.disposition ?? null },
    { label: 'Comments', value: meta.comments ?? null },
    { label: 'Provider', value: 'Ozonetel' },
  ];
}

function CallBodyContent({ body }: { body: string }): ReactElement {
  const telephonyMeta = useMemo(() => parseTelephonyMetadata(body), [body]);

  if (!telephonyMeta) {
    return <span className='text-muted-foreground italic'>No content</span>;
  }

  const number =
    telephonyMeta.direction === 'OUTBOUND' ? telephonyMeta.toNumber : telephonyMeta.fromNumber;
  const fields = buildTelephonyFields(telephonyMeta);

  return (
    <div className='rounded-2xl border border-border bg-muted/40 p-4 text-sm text-foreground'>
      <div className='flex items-center gap-2 font-medium'>
        {telephonyMeta.direction === 'OUTBOUND' ? (
          <PhoneOutgoing size={16} />
        ) : (
          <PhoneIncoming size={16} />
        )}
        <span>{telephonyMeta.direction === 'OUTBOUND' ? 'Outbound call' : 'Inbound call'}</span>
        {number ? <span className='text-muted-foreground'>· {number}</span> : null}
      </div>
      <div className='mt-3 grid gap-2 sm:grid-cols-2'>
        {fields.map(field => (
          <TelephonyField key={field.label} label={field.label} value={field.value} />
        ))}
      </div>
      {telephonyMeta.recordingUrl ? (
        <div className='mt-4'>
          <audio controls className='h-8 w-full' src={telephonyMeta.recordingUrl}>
            <track kind='captions' />
          </audio>
        </div>
      ) : null}
    </div>
  );
}

const CallThreadItem = ({
  email,
  isCollapsed = false,
  canCollapse = true,
  onToggleCollapse,
  isRead = true,
}: {
  email: CallThreadEmail;
  isCollapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapse?: () => void;
  isRead?: boolean;
}): ReactElement => {
  const headerClickable = canCollapse && !!onToggleCollapse;
  return (
    <div
      id={`mail-${email.id}`}
      data-external-message-id={email.externalMessageId || undefined}
      className={cn(
        'w-full scroll-mt-20 transition-colors',
        '[content-visibility:auto] [contain-intrinsic-size:auto_240px]',
        !isCollapsed && 'py-4',
      )}
    >
      <div
        className={cn('px-4 py-3', headerClickable && 'cursor-pointer', !isRead && 'bg-primary/5')}
        data-track-category='Support'
        data-track-name={isCollapsed ? 'ExpandCallEntry' : 'CollapseCallEntry'}
        onClick={headerClickable ? onToggleCollapse : undefined}
        role={headerClickable ? 'button' : undefined}
        tabIndex={headerClickable ? 0 : undefined}
        onKeyDown={
          headerClickable
            ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleCollapse?.();
                }
              }
            : undefined
        }
      >
        {!isCollapsed && (
          <div>
            {email.body ? (
              <CallBodyContent body={email.body} />
            ) : (
              <span className='text-muted-foreground italic'>No content</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const CallThread = ({
  emails,
  ticketId,
  lastEmailAt,
  emailReads,
}: CallThreadProps): ReactElement => {
  const sortedEmails = useMemo(() => {
    return [...emails].sort((a, b) => {
      const aTime = a.createdAt || 0;
      const bTime = b.createdAt || 0;
      return aTime - bTime;
    });
  }, [emails]);

  const lastEmailId = sortedEmails[sortedEmails.length - 1]?.id;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    if (sortedEmails.length <= 1) return new Set();
    return new Set(sortedEmails.slice(0, -1).map(e => e.id));
  });

  const emailIdsKey = useMemo(() => sortedEmails.map(e => e.id).join('|'), [sortedEmails]);
  const prevIdsRef = useRef<Set<string>>(new Set(sortedEmails.map(e => e.id)));
  // Keep collapse behavior aligned with email thread, without sharing its header UI.
  useEffect(() => {
    setCollapsedIds(prev => {
      const currentIds = new Set(sortedEmails.map(e => e.id));
      const previousIds = prevIdsRef.current;
      const next = new Set(prev);
      for (const id of Array.from(next)) {
        if (!currentIds.has(id)) next.delete(id);
      }
      for (const email of sortedEmails) {
        if (!previousIds.has(email.id) && email.id !== lastEmailId) next.add(email.id);
      }
      if (lastEmailId) next.delete(lastEmailId);
      prevIdsRef.current = currentIds;
      return next;
    });
  }, [emailIdsKey, lastEmailId, sortedEmails]);

  const { isRead } = useMarkEmailRead(
    ticketId,
    lastEmailId ?? null,
    lastEmailAt ?? null,
    emailReads,
    true,
  );

  const toggleOne = (id: string): void => {
    if (id === lastEmailId) return;
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className='divide-y divide-gray-200 relative'>
      {sortedEmails.map(email => (
        <CallThreadItem
          key={email.id}
          email={email}
          isCollapsed={collapsedIds.has(email.id)}
          canCollapse={email.id !== lastEmailId}
          onToggleCollapse={() => toggleOne(email.id)}
          isRead={isRead}
        />
      ))}
    </div>
  );
};

export default CallThread;
