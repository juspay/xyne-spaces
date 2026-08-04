import { ReactElement } from 'react';
import {
  TELEPRESENCE_CANVAS_KIND_IMAGE,
  TELEPRESENCE_CANVAS_KIND_META,
  type TelepresenceCanvasDevice,
  type TelepresenceCanvasRoom,
} from './telepresenceCanvasData';
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
  device: TelepresenceCanvasDevice;
  now: number;
  onClick: () => void;
}): ReactElement => {
  const status = effectiveDeviceStatus(device, now);
  const meta = STATUS_META[status];
  const image = TELEPRESENCE_CANVAS_KIND_IMAGE.DISPLAY;
  const Icon = TELEPRESENCE_CANVAS_KIND_META.DISPLAY.icon;
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={`${device.name}: ${meta.label}`}
      data-track-category='Telepresence_Analytics'
      data-track-name='Open_Telepresence_Device'
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
  sm: { box: 'size-9', icon: 16, imageFit: 'object-cover' },
  // Compute — a bigger, taller tile matching the real device photo's
  // portrait aspect ratio, shown uncropped (object-contain) so the full
  // chassis reads clearly instead of being cut off by a square object-cover.
  lg: { box: 'h-24 w-16', icon: 26, imageFit: 'object-contain' },
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
  device: TelepresenceCanvasDevice;
  now: number;
  onClick: () => void;
  size?: keyof typeof MARKER_SIZES;
}): ReactElement => {
  const status = effectiveDeviceStatus(device, now);
  const meta = STATUS_META[status];
  const kindMeta = TELEPRESENCE_CANVAS_KIND_META[device.kind];
  const image = TELEPRESENCE_CANVAS_KIND_IMAGE[device.kind];
  const Icon = kindMeta.icon;
  const { box, icon, imageFit } = MARKER_SIZES[size];
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={`${device.name}: ${meta.label}`}
      data-track-category='Telepresence_Analytics'
      data-track-name='Open_Telepresence_Device'
      data-track-metadata={JSON.stringify({ kind: device.kind })}
      className='flex flex-col items-center gap-1 transition-transform hover:z-10 hover:scale-110'
    >
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 ${box}`}
        style={{ backgroundColor: `${kindMeta.accent}1a`, borderColor: meta.color }}
      >
        {image ? (
          <img src={image} alt='' className={`h-full w-full ${imageFit}`} />
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

type GridSpatial = Extract<TelepresenceCanvasDevice['spatial'], { layout: 'grid' }>;
type FrontWallPoint = TelepresenceCanvasDevice & {
  spatial: { layout: 'point'; zone: 'front_wall' };
};

const TelepresenceCanvas = ({
  room,
  now,
  onSelectDevice,
}: {
  room: TelepresenceCanvasRoom;
  now: number;
  onSelectDevice: (device: TelepresenceCanvasDevice) => void;
}): ReactElement => {
  const displays = room.devices
    .filter(
      (d): d is TelepresenceCanvasDevice & { spatial: GridSpatial } => d.spatial.layout === 'grid',
    )
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
    (d): d is TelepresenceCanvasDevice & { spatial: { layout: 'point'; zone: 'side_rack' } } =>
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

export default TelepresenceCanvas;
