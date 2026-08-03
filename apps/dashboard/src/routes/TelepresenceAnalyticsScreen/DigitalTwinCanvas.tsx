import { ReactElement } from 'react';
import {
  DIGITAL_TWIN_KIND_IMAGE,
  DIGITAL_TWIN_KIND_META,
  type DigitalTwinDevice,
  type DigitalTwinRoom,
} from './digitalTwinData';
import { STATUS_META, effectiveDeviceStatus } from './TelepresenceAnalyticsScreen.utils';

// A schematic front-elevation "floor plan" of one room's physical AV/compute/
// sensor layout: a grid of wall displays, a center camera and corner sensors
// positioned within that same front-wall zone, and a compute rack in a
// separate side zone. Every element sits in its own row of normal document
// flow (never absolutely stacked on percentage coordinates) so no two device
// hit-targets can ever overlap, regardless of container size — each stays
// independently clickable.

const DisplayCell = ({
  device,
  now,
  onClick,
}: {
  device: DigitalTwinDevice;
  now: number;
  onClick: () => void;
}): ReactElement => {
  const status = effectiveDeviceStatus(device, now);
  const meta = STATUS_META[status];
  const image = DIGITAL_TWIN_KIND_IMAGE.DISPLAY;
  const Icon = DIGITAL_TWIN_KIND_META.DISPLAY.icon;
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={`${device.name}: ${meta.label}`}
      data-track-category='Telepresence_Analytics'
      data-track-name='Open_Digital_Twin_Device'
      data-track-metadata={JSON.stringify({ kind: device.kind })}
      className='relative flex aspect-video items-center justify-center overflow-hidden rounded-md border-2 bg-card transition-transform hover:z-10 hover:scale-[1.06]'
      style={{ borderColor: meta.color }}
    >
      {image ? (
        <img src={image} alt='' className='h-full w-full object-cover' />
      ) : (
        <Icon size={15} style={{ color: meta.color }} aria-hidden='true' />
      )}
      {status !== 'HEALTHY' && (
        <span
          className='absolute -right-1 -top-1 size-2.5 rounded-full border border-card'
          style={{ backgroundColor: meta.color }}
          aria-hidden='true'
        />
      )}
    </button>
  );
};

const MARKER_SIZES = {
  // Camera/sensors — a small icon tile.
  sm: { box: 'size-9', icon: 16 },
  // Compute — a bigger, LED-display-style tile so the real device photo
  // reads clearly, same treatment as the wall-screen cells.
  lg: { box: 'size-16', icon: 26 },
} as const;

// A normal (non-absolutely-positioned) flex item — its place on the canvas
// comes entirely from where its parent row/column puts it, never from
// percentage coordinates, so it can't drift on top of a sibling.
const PointMarker = ({
  device,
  now,
  onClick,
  size = 'sm',
}: {
  device: DigitalTwinDevice;
  now: number;
  onClick: () => void;
  size?: keyof typeof MARKER_SIZES;
}): ReactElement => {
  const status = effectiveDeviceStatus(device, now);
  const meta = STATUS_META[status];
  const kindMeta = DIGITAL_TWIN_KIND_META[device.kind];
  const image = DIGITAL_TWIN_KIND_IMAGE[device.kind];
  const Icon = kindMeta.icon;
  const { box, icon } = MARKER_SIZES[size];
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={`${device.name}: ${meta.label}`}
      data-track-category='Telepresence_Analytics'
      data-track-name='Open_Digital_Twin_Device'
      data-track-metadata={JSON.stringify({ kind: device.kind })}
      className='flex flex-col items-center gap-1 transition-transform hover:z-10 hover:scale-110'
    >
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 ${box}`}
        style={{ backgroundColor: `${kindMeta.accent}1a`, borderColor: meta.color }}
      >
        {image ? (
          <img src={image} alt='' className='h-full w-full object-cover' />
        ) : (
          <Icon size={icon} style={{ color: kindMeta.accent }} aria-hidden='true' />
        )}
      </span>
      {status !== 'HEALTHY' && (
        <span
          className='size-1.5 rounded-full'
          style={{ backgroundColor: meta.color }}
          aria-hidden='true'
        />
      )}
    </button>
  );
};

type GridSpatial = Extract<DigitalTwinDevice['spatial'], { layout: 'grid' }>;
type FrontWallPoint = DigitalTwinDevice & { spatial: { layout: 'point'; zone: 'front_wall' } };

const DigitalTwinCanvas = ({
  room,
  now,
  onSelectDevice,
}: {
  room: DigitalTwinRoom;
  now: number;
  onSelectDevice: (device: DigitalTwinDevice) => void;
}): ReactElement => {
  const displays = room.devices
    .filter((d): d is DigitalTwinDevice & { spatial: GridSpatial } => d.spatial.layout === 'grid')
    .sort((a, b) => a.spatial.row - b.spatial.row || a.spatial.col - b.spatial.col);
  const gridSpec = displays[0]?.spatial;

  const wallPoints = room.devices.filter(
    (d): d is FrontWallPoint => d.spatial.layout === 'point' && d.spatial.zone === 'front_wall',
  );
  // A room can have more than one camera (e.g. a boardroom with a wide-angle
  // cam, a PTZ presenter cam, and a whiteboard cam) — render every one in the
  // center row rather than just the first.
  const cameras = wallPoints.filter(d => d.kind === 'CAMERA');
  // Corners are placed above/below the midline of the front-wall zone —
  // split on that instead of hardcoding which named device goes where, so
  // any future point device slots into the same two rows automatically.
  const bySide = (d: FrontWallPoint): number => d.spatial.x;
  const topSensors = wallPoints
    .filter(d => d.kind !== 'CAMERA' && d.spatial.y < 0.5)
    .sort((a, b) => bySide(a) - bySide(b));
  const bottomSensors = wallPoints
    .filter(d => d.kind !== 'CAMERA' && d.spatial.y >= 0.5)
    .sort((a, b) => bySide(a) - bySide(b));

  const sideRackPoints = room.devices.filter(
    (d): d is DigitalTwinDevice & { spatial: { layout: 'point'; zone: 'side_rack' } } =>
      d.spatial.layout === 'point' && d.spatial.zone === 'side_rack',
  );

  return (
    <div className='relative flex aspect-[16/10] w-full gap-4 rounded-xl border border-border bg-muted/20 p-4'>
      {/* Front-wall zone: a vertical stack of rows (top sensors, the display
          grid, the camera, bottom sensors) — normal flow, so each row owns
          its own space and nothing can land on top of anything else. */}
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <p className='pointer-events-none text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
          Front wall
        </p>

        <div className='flex items-start justify-between'>
          {topSensors.map(device => (
            <PointMarker
              key={device.id}
              device={device}
              now={now}
              onClick={() => onSelectDevice(device)}
            />
          ))}
        </div>

        {gridSpec && (
          <div
            className='grid flex-1 gap-1.5'
            style={{
              gridTemplateColumns: `repeat(${gridSpec.cols}, 1fr)`,
              gridTemplateRows: `repeat(${gridSpec.rows}, 1fr)`,
            }}
          >
            {displays.map(device => (
              <DisplayCell
                key={device.id}
                device={device}
                now={now}
                onClick={() => onSelectDevice(device)}
              />
            ))}
          </div>
        )}

        {cameras.length > 0 && (
          <div className='flex items-center justify-center gap-4'>
            {cameras.map(device => (
              <PointMarker
                key={device.id}
                device={device}
                now={now}
                onClick={() => onSelectDevice(device)}
              />
            ))}
          </div>
        )}

        <div className='flex items-end justify-between'>
          {bottomSensors.map(device => (
            <PointMarker
              key={device.id}
              device={device}
              now={now}
              onClick={() => onSelectDevice(device)}
            />
          ))}
        </div>
      </div>

      {/* Side-rack zone: a separate column, entirely outside the front-wall
          zone's space. */}
      {sideRackPoints.length > 0 && (
        <div className='flex w-24 shrink-0 flex-col items-center gap-2'>
          <p className='pointer-events-none text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            Side rack
          </p>
          <div className='flex flex-1 flex-col items-center justify-center gap-3'>
            {sideRackPoints.map(device => (
              <PointMarker
                key={device.id}
                device={device}
                now={now}
                onClick={() => onSelectDevice(device)}
                size='lg'
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DigitalTwinCanvas;
