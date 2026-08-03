import { ReactElement, useMemo, useRef, useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ShieldX, RefreshCw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTelepresenceAnalyticsAccess } from '../../hooks/useTelepresenceAnalyticsAccess';
import {
  DateRangeFilter,
  type DateRangeValue,
} from '../../components/ui/DateRangeFilter/DateRangeFilter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../utils/classNames';
import DigitalTwinCanvas from './DigitalTwinCanvas';
import DigitalTwinDeviceModal from './DigitalTwinDeviceModal';
import {
  DIGITAL_TWIN_KIND_META,
  digitalTwinDeviceKey,
  fetchDigitalTwinRooms,
  fetchDigitalTwinTimeseries,
  type DigitalTwinDevice,
} from './digitalTwinData';
import TimeseriesChart from './TimeseriesChart';
import { formatRelativeTime } from './TelepresenceAnalyticsScreen.utils';

const POLL_INTERVAL_MS = 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ALL_DEVICES_VALUE = 'all';

const AccessDenied = (): ReactElement => (
  <div className='flex h-full flex-col items-center justify-center gap-3 p-8 text-center'>
    <ShieldX size={40} className='text-muted-foreground' aria-hidden='true' />
    <h1 className='text-lg font-semibold text-foreground'>403 — Access restricted</h1>
    <p className='max-w-sm text-sm text-muted-foreground'>
      Telepresence System Analytics is limited to allow-listed users. Contact your workspace admin
      if you need access.
    </p>
  </div>
);

const LiveIndicator = ({
  isStale,
  updatedAt,
  now,
}: {
  isStale: boolean;
  updatedAt: number;
  now: number;
}): ReactElement => (
  <span
    className={cn(
      'flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs',
      isStale ? 'text-[#8a6200] dark:text-[#fac84d]' : 'text-muted-foreground',
    )}
  >
    <span
      aria-hidden='true'
      className={cn(
        'inline-block size-2 rounded-full',
        isStale ? 'bg-[#fab219]' : 'bg-[#0ca30c] animate-pulse',
      )}
    />
    {isStale
      ? `Reconnecting — showing data from ${formatRelativeTime(new Date(updatedAt).toISOString(), now)}`
      : `Live · updated ${formatRelativeTime(new Date(updatedAt).toISOString(), now)}`}
  </span>
);

const TelepresenceAnalyticsScreen = (): ReactElement => {
  const { user } = useAuth();
  const allowed = useTelepresenceAnalyticsAccess();
  const graphSectionRef = useRef<HTMLElement | null>(null);

  const [dateRange, setDateRange] = useState<DateRangeValue | null>(() => ({
    startDate: new Date(Date.now() - 24 * HOUR),
    endDate: new Date(),
  }));
  // null = show every device's line on the graph; otherwise a
  // digitalTwinDeviceKey() string narrows the chart to that one device.
  const [selectedDeviceKey, setSelectedDeviceKey] = useState<string | null>(null);
  // null = not chosen yet, falls back to the first room once data loads.
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedTwinDevice, setSelectedTwinDevice] = useState<DigitalTwinDevice | null>(null);

  // Effective range: cleared filter falls back to the default last 24h.
  const range = useMemo<DateRangeValue>(
    () =>
      dateRange ?? {
        startDate: new Date(Date.now() - 24 * HOUR),
        endDate: new Date(),
      },
    [dateRange],
  );
  const fromIso = range.startDate.toISOString();
  const toIso = range.endDate.toISOString();

  // Sample-data-only spatial layouts driving both the room canvas above and
  // the device picker below (see digitalTwinData.ts) — every device you can
  // click in the canvas has a matching line in the graph, since both read
  // from the same dataset. Real AV-shaped data (telepresenceService.ts) still
  // exists for whenever the documented backend is implemented, it's just not
  // wired into this screen anymore.
  const digitalTwinQuery = useQuery({
    queryKey: ['telepresence', 'digital-twin'],
    queryFn: fetchDigitalTwinRooms,
    enabled: Boolean(user) && allowed,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const timeseriesQuery = useQuery({
    queryKey: ['telepresence', 'digital-twin-timeseries', fromIso, toIso],
    queryFn: () => fetchDigitalTwinTimeseries(fromIso, toIso),
    enabled: Boolean(user) && allowed,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  // Manual refresh: re-hits both live queries. Tracked separately from React
  // Query's own isFetching so the button only shows busy for a click the
  // user made, not for the background 1-minute poll tick — and guards
  // against overlapping manual refreshes.
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const handleRefresh = useCallback((): void => {
    if (isManualRefreshing) return;
    setIsManualRefreshing(true);
    void Promise.allSettled([digitalTwinQuery.refetch(), timeseriesQuery.refetch()]).finally(() =>
      setIsManualRefreshing(false),
    );
  }, [isManualRefreshing, digitalTwinQuery, timeseriesQuery]);

  // Opened from a digital-twin device: narrow the graph to this device's own
  // line, close the modal, and jump to the graph section below.
  //
  // Closing the modal unmounts Radix's Dialog, which holds a scroll lock via
  // react-remove-scroll; that lock's own cleanup effect isn't guaranteed to
  // have flushed by the time a single requestAnimationFrame fires, so a
  // scrollIntoView call there can silently land while the page is still
  // locked. A second nested rAF waits a full extra frame, past that cleanup.
  const handleViewTwinHistory = useCallback(
    (roomUserId: string, device: DigitalTwinDevice): void => {
      setSelectedDeviceKey(digitalTwinDeviceKey(roomUserId, device));
      setSelectedTwinDevice(null);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          graphSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    },
    [],
  );

  // Client-side allow-list check hides the page (the nav item is hidden too).
  if (!allowed) {
    return <AccessDenied />;
  }

  const now = Date.now();
  const digitalTwinRooms = digitalTwinQuery.data ?? [];
  const points = timeseriesQuery.data ?? [];
  const chartTo = new Date(Math.min(range.endDate.getTime(), now));
  const healthIsStale = digitalTwinQuery.isError && Boolean(digitalTwinQuery.data);

  const effectiveRoomId = selectedRoomId ?? digitalTwinRooms[0]?.userId ?? null;
  const selectedTwinRoom = digitalTwinRooms.find(room => room.userId === effectiveRoomId) ?? null;

  // The graph is scoped to whichever room is showing in the canvas above —
  // "All devices" means all devices in THIS room (typically ~10-15), not
  // every device across every room (55+), which was both unreadably
  // cluttered and ambiguous (the same device names repeat in every room).
  const roomDevices = selectedTwinRoom?.devices ?? [];
  const roomPoints = selectedTwinRoom
    ? points.filter(p => p.userId === selectedTwinRoom.userId)
    : [];
  const filteredPoints = selectedDeviceKey
    ? points.filter(p => `${p.userId}|${p.deviceType}|${p.name}` === selectedDeviceKey)
    : roomPoints;

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-4xl flex-col gap-6 p-6'>
        <header className='flex flex-wrap items-center justify-between gap-3'>
          <h1 className='text-xl font-semibold text-foreground'>Telepresence Observance</h1>
          <div className='flex items-center gap-2'>
            {digitalTwinQuery.data && (
              <LiveIndicator
                isStale={healthIsStale}
                updatedAt={digitalTwinQuery.dataUpdatedAt}
                now={now}
              />
            )}
            <button
              type='button'
              onClick={handleRefresh}
              disabled={isManualRefreshing}
              aria-label='Refresh telepresence data'
              data-track-category='Telepresence_Analytics'
              data-track-name='Manual_Refresh'
              className='flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60'
            >
              <RefreshCw
                size={14}
                className={cn(isManualRefreshing && 'animate-spin')}
                aria-hidden='true'
              />
              Refresh
            </button>
          </div>
        </header>

        <section className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <h2 className='text-sm font-medium text-muted-foreground'>Room</h2>
            {digitalTwinRooms.length > 0 && (
              <Select
                {...(effectiveRoomId ? { value: effectiveRoomId } : {})}
                onValueChange={value => {
                  setSelectedRoomId(value);
                  // The graph below is scoped to this room — reset any
                  // single-device selection from the previous room so it
                  // doesn't silently point at a device that's no longer shown.
                  setSelectedDeviceKey(null);
                }}
              >
                <SelectTrigger size='sm' className='w-fit max-w-72' aria-label='Select room'>
                  <SelectValue
                    placeholder='Select a room'
                    className='min-w-0 flex-1 truncate text-left'
                  />
                </SelectTrigger>
                <SelectContent className='max-w-80'>
                  {digitalTwinRooms.map(room => (
                    <SelectItem key={room.userId} value={room.userId}>
                      <span className='block min-w-0 truncate'>{room.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {digitalTwinQuery.isError && !digitalTwinRooms.length ? (
            <div className='flex flex-col items-center gap-3 rounded-xl border border-border px-6 py-10 text-center'>
              <p className='text-sm text-muted-foreground'>Could not load room layouts.</p>
              <button
                type='button'
                onClick={() => void digitalTwinQuery.refetch()}
                data-track-category='Telepresence_Analytics'
                data-track-name='Retry_Digital_Twin_Fetch'
                className='flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent'
              >
                <RefreshCw size={14} aria-hidden='true' />
                Retry
              </button>
            </div>
          ) : digitalTwinQuery.isPending ? (
            <Skeleton className='aspect-[16/10] w-full rounded-xl' />
          ) : selectedTwinRoom ? (
            <DigitalTwinCanvas
              room={selectedTwinRoom}
              now={now}
              onSelectDevice={setSelectedTwinDevice}
            />
          ) : (
            <div className='rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground'>
              No room layouts available yet.
            </div>
          )}
        </section>

        <section
          ref={graphSectionRef}
          className='flex flex-col gap-3 rounded-xl border border-border bg-card p-4 scroll-mt-6'
        >
          <div className='flex flex-col gap-3'>
            <div>
              <h2 className='text-sm font-medium text-foreground'>Device health over time</h2>
              {selectedTwinRoom && (
                <p className='text-xs text-muted-foreground'>{selectedTwinRoom.label}</p>
              )}
            </div>
            <div className='flex flex-wrap items-center justify-between gap-4'>
              <Select
                value={selectedDeviceKey ?? ALL_DEVICES_VALUE}
                onValueChange={value =>
                  setSelectedDeviceKey(value === ALL_DEVICES_VALUE ? null : value)
                }
              >
                <SelectTrigger
                  size='sm'
                  className='w-fit max-w-82 shrink-0'
                  aria-label='Filter by device'
                >
                  <SelectValue
                    placeholder='All devices'
                    className='min-w-0 flex-1 truncate text-left'
                  />
                </SelectTrigger>
                <SelectContent className='max-w-80'>
                  <SelectItem value={ALL_DEVICES_VALUE}>All devices</SelectItem>
                  {selectedTwinRoom &&
                    roomDevices.map(device => (
                      <SelectItem
                        key={device.id}
                        value={digitalTwinDeviceKey(selectedTwinRoom.userId, device)}
                      >
                        <span className='block min-w-0 truncate'>
                          {device.name} ({DIGITAL_TWIN_KIND_META[device.kind].label})
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />
            </div>
          </div>

          {digitalTwinQuery.isError && !digitalTwinQuery.data ? (
            <div className='flex flex-col items-center gap-3 px-6 py-10 text-center'>
              <p className='text-sm text-muted-foreground'>
                Could not load telepresence health data.
              </p>
              <button
                type='button'
                onClick={() => void digitalTwinQuery.refetch()}
                data-track-category='Telepresence_Analytics'
                data-track-name='Retry_Health_Fetch'
                className='flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent'
              >
                <RefreshCw size={14} aria-hidden='true' />
                Retry
              </button>
            </div>
          ) : timeseriesQuery.isPending || digitalTwinQuery.isPending ? (
            <Skeleton className='h-64 rounded-lg' />
          ) : timeseriesQuery.isError ? (
            <div className='flex flex-col items-center gap-3 px-6 py-10 text-center'>
              <p className='text-sm text-muted-foreground'>Could not load the status history.</p>
              <button
                type='button'
                onClick={() => void timeseriesQuery.refetch()}
                data-track-category='Telepresence_Analytics'
                data-track-name='Retry_Timeseries_Fetch'
                className='flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent'
              >
                <RefreshCw size={14} aria-hidden='true' />
                Retry
              </button>
            </div>
          ) : (
            <TimeseriesChart points={filteredPoints} from={range.startDate} to={chartTo} />
          )}
        </section>
      </div>

      <DigitalTwinDeviceModal
        device={selectedTwinDevice}
        roomLabel={selectedTwinRoom?.label ?? ''}
        now={now}
        onClose={() => setSelectedTwinDevice(null)}
        onViewHistory={device => {
          if (selectedTwinRoom) handleViewTwinHistory(selectedTwinRoom.userId, device);
        }}
      />
    </div>
  );
};

export default TelepresenceAnalyticsScreen;
