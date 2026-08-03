import { ReactElement } from 'react';
import { TrendingUp, X } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import StatusBadge from './StatusBadge';
import {
  DIGITAL_TWIN_KIND_IMAGE,
  DIGITAL_TWIN_KIND_META,
  type DigitalTwinDevice,
} from './digitalTwinData';
import { effectiveDeviceStatus, formatRelativeTime } from './TelepresenceAnalyticsScreen.utils';

const Row = ({ label, children }: { label: string; children: ReactElement }): ReactElement => (
  <div className='flex items-center justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0'>
    <span className='text-sm text-muted-foreground'>{label}</span>
    {children}
  </div>
);

const DigitalTwinDeviceModal = ({
  device,
  roomLabel,
  now,
  onClose,
  onViewHistory,
}: {
  device: DigitalTwinDevice | null;
  roomLabel: string;
  now: number;
  onClose: () => void;
  onViewHistory: (device: DigitalTwinDevice) => void;
}): ReactElement | null => {
  if (!device) return null;
  const status = effectiveDeviceStatus(device, now);
  const kindMeta = DIGITAL_TWIN_KIND_META[device.kind];
  const image = DIGITAL_TWIN_KIND_IMAGE[device.kind];
  const Icon = kindMeta.icon;

  return (
    <Dialog
      open={Boolean(device)}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={`${device.name} — ${kindMeta.label} in ${roomLabel}`}
      className='max-w-lg'
      testId='digital-twin-device-modal'
    >
      <div className='p-6'>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close'
          data-track-category='Telepresence_Analytics'
          data-track-name='Close_Digital_Twin_Device_Detail'
          className='absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <X size={16} />
        </button>

        <div className='flex items-start gap-5'>
          <div
            className='flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border'
            style={{ backgroundColor: `${kindMeta.accent}1a`, borderColor: `${kindMeta.accent}33` }}
          >
            {image ? (
              <img src={image} alt='' className='h-full w-full object-cover' />
            ) : (
              <Icon size={48} style={{ color: kindMeta.accent }} strokeWidth={1.75} />
            )}
          </div>
          <div className='min-w-0 flex-1 pt-1'>
            <h2 className='truncate text-lg font-semibold text-foreground'>{device.name}</h2>
            <p className='text-sm text-muted-foreground'>
              {kindMeta.label} · {roomLabel}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Role: {device.physicalRole.replace(/_/g, ' ')}
            </p>
          </div>
        </div>

        <div className='mt-5 flex flex-col'>
          <Row label='Status'>
            <StatusBadge status={status} />
          </Row>
          <Row label='Connected / detected'>
            <span className='font-medium tabular-nums text-foreground'>
              {device.connected} / {device.detected}
            </span>
          </Row>
          {device.cpuTemperature !== undefined && (
            <Row label='CPU temperature'>
              <span className='font-medium tabular-nums text-foreground'>
                {device.cpuTemperature}°C
              </span>
            </Row>
          )}
          <Row label='Last reported'>
            <span className='font-medium tabular-nums text-foreground'>
              {formatRelativeTime(device.lastReportedAt, now)}
            </span>
          </Row>
        </div>

        <button
          type='button'
          onClick={() => onViewHistory(device)}
          data-track-category='Telepresence_Analytics'
          data-track-name='View_Digital_Twin_Device_History'
          data-track-metadata={JSON.stringify({ kind: device.kind })}
          className='mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent'
        >
          <TrendingUp size={15} aria-hidden='true' />
          View health history
        </button>
      </div>
    </Dialog>
  );
};

export default DigitalTwinDeviceModal;
