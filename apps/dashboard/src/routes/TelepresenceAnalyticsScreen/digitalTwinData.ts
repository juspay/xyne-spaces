import { Cpu, Mic, Monitor, Video, Volume2, type LucideIcon } from 'lucide-react';
import type { TelepresenceDeviceType, TelepresenceHealthStatus } from '../../types/telepresence';
import { telepresenceService } from '../../services/Telepresence/telepresenceService';

// Digital-twin room layouts: a spatial floor-plan replica of each room's
// physical AV layout, built from the real telepresence-monitoring API
// (GET /health, GET /health/timeseries) — the sole room view AND the sole
// source for the "Device health over time" graph on the Observance screen, so
// every device you can click in the spatial canvas also has a matching line
// in the chart.
//
// The real API only reports TV | CAMERA | MICROPHONE | SPEAKER per device,
// plus a room-level `cpuTemperature` and a freeform `layoutConfig` blob with
// no enforced shape (backend validation just accepts arbitrary JSON). This
// module maps that real data onto the same DISPLAY/CAMERA/MICROPHONE/SPEAKER
// canvas, plus one synthesized "Room Controller" COMPUTE tile per room to
// carry the room-level cpuTemperature reading. Where `layoutConfig` carries
// `{ physicalRole, spatial: { zone, gridPosition: { row, col } } }` (the shape
// this repo's own ingestion tooling writes — see
// backend/scripts/seed-telepresence-health.sh) it's used to place/order
// devices; otherwise devices fall back to a deterministic auto-layout so the
// canvas never breaks on a report that omits it.

export type DigitalTwinDeviceKind = 'DISPLAY' | 'CAMERA' | 'MICROPHONE' | 'SPEAKER' | 'COMPUTE';

// Fixed display order for charts/legends grouping by kind.
export const DIGITAL_TWIN_KIND_ORDER: DigitalTwinDeviceKind[] = [
  'DISPLAY',
  'CAMERA',
  'MICROPHONE',
  'SPEAKER',
  'COMPUTE',
];

export type DigitalTwinSpatial =
  // Displays tile a grid on the front wall — position given as (row, col)
  // out of (rows, cols), 1-indexed, filled in row-major order.
  | { layout: 'grid'; zone: 'front_wall'; row: number; col: number; rows: number; cols: number }
  // Everything else is a single point, normalized 0..1 within its zone.
  | { layout: 'point'; zone: 'front_wall' | 'side_rack'; x: number; y: number };

export interface DigitalTwinDevice {
  id: string;
  kind: DigitalTwinDeviceKind;
  name: string;
  physicalRole: string;
  status: TelepresenceHealthStatus;
  connected: number;
  detected: number;
  lastReportedAt: string;
  spatial: DigitalTwinSpatial;
  /** Celsius — present on the room's synthesized COMPUTE tile, absent otherwise. */
  cpuTemperature?: number;
}

export interface DigitalTwinRoom {
  userId: string;
  label: string;
  devices: DigitalTwinDevice[];
}

export const DIGITAL_TWIN_KIND_META: Record<
  DigitalTwinDeviceKind,
  { label: string; icon: LucideIcon; accent: string }
> = {
  DISPLAY: { label: 'Display', icon: Monitor, accent: '#2a78d6' },
  CAMERA: { label: 'Camera', icon: Video, accent: '#4a3aa7' },
  MICROPHONE: { label: 'Microphone', icon: Mic, accent: '#b45309' },
  SPEAKER: { label: 'Speaker', icon: Volume2, accent: '#0e7490' },
  COMPUTE: { label: 'Compute', icon: Cpu, accent: '#199e70' },
};

// Real device photo per kind, served from public/images/telepresence/ — a
// kind without an entry here falls back to its icon (DIGITAL_TWIN_KIND_META
// above). Fill in CAMERA/MICROPHONE/SPEAKER as those photos are added.
export const DIGITAL_TWIN_KIND_IMAGE: Partial<Record<DigitalTwinDeviceKind, string>> = {
  DISPLAY: '/images/telepresence/LED43Inch.png',
  COMPUTE: '/images/telepresence/CPU.png',
};

const DEVICE_TYPE_TO_KIND: Record<TelepresenceDeviceType, DigitalTwinDeviceKind> = {
  TV: 'DISPLAY',
  CAMERA: 'CAMERA',
  MICROPHONE: 'MICROPHONE',
  SPEAKER: 'SPEAKER',
};

// The real API has no human-friendly room name — `userId` is the only
// identifier a room reports. Best-effort title-case fallback for display
// until a real display-name field exists.
const humanizeUserId = (userId: string): string =>
  userId
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

interface ParsedLayoutEntry {
  physicalRole?: string;
  spatial?: { zone?: string; gridPosition?: { row?: number; col?: number } };
}

// `layoutConfig` is validated server-side only as "any JSON value" — parse
// defensively and fall back to an empty result for anything that doesn't
// match the `{ physicalRole, spatial }` shape this repo's own devices write.
const parseLayoutConfig = (raw: unknown): ParsedLayoutEntry[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ParsedLayoutEntry => typeof entry === 'object' && entry !== null,
  );
};

const isSideRackZone = (zone: string | undefined): boolean =>
  typeof zone === 'string' && zone.toLowerCase().includes('rack');

interface RoomDeviceInput {
  id: string;
  deviceType: TelepresenceDeviceType;
  name: string;
  status: TelepresenceHealthStatus;
  connected: number;
  detected: number;
  lastReportedAt: string;
  layoutConfig?: unknown;
}

const buildDisplayDevices = (devices: RoomDeviceInput[]): DigitalTwinDevice[] => {
  if (devices.length === 0) return [];
  const placed = devices.map((device, index) => {
    const entry = parseLayoutConfig(device.layoutConfig)[0];
    return {
      device,
      entry,
      row: entry?.spatial?.gridPosition?.row ?? 0,
      col: entry?.spatial?.gridPosition?.col ?? index,
    };
  });
  const rows = Math.max(...placed.map(p => p.row)) + 1;
  const cols = Math.max(...placed.map(p => p.col)) + 1;
  return placed.map(({ device, entry, row, col }) => ({
    id: device.id,
    kind: 'DISPLAY',
    name: device.name,
    physicalRole: entry?.physicalRole ?? 'wall_display',
    status: device.status,
    connected: device.connected,
    detected: device.detected,
    lastReportedAt: device.lastReportedAt,
    spatial: { layout: 'grid', zone: 'front_wall', row: row + 1, col: col + 1, rows, cols },
  }));
};

// Point-layout devices (camera/microphone/speaker): cameras render centered
// in their own row; everything else splits across the top/bottom of the
// front wall (or the side rack, for anything explicitly reporting that
// zone) — see DigitalTwinCanvas, which groups purely by kind and zone/y, not
// by exact coordinates. `layoutConfig`'s gridPosition (when present) only
// influences left-right ordering and top/bottom placement, since the real
// API never promises true spatial coordinates.
const buildPointDevices = (
  devices: RoomDeviceInput[],
  kind: Extract<DigitalTwinDeviceKind, 'CAMERA' | 'MICROPHONE' | 'SPEAKER'>,
): DigitalTwinDevice[] => {
  const withLayout = devices.map((device, index) => {
    const entry = parseLayoutConfig(device.layoutConfig)[0];
    return {
      device,
      entry,
      row: entry?.spatial?.gridPosition?.row ?? index,
      col: entry?.spatial?.gridPosition?.col ?? index,
      sideRack: isSideRackZone(entry?.spatial?.zone),
    };
  });

  const cameraLike = kind === 'CAMERA';
  const frontWall = withLayout.filter(w => !w.sideRack);
  const sideRack = withLayout.filter(w => w.sideRack);

  const frontWallDevices = frontWall.map((w, i) => {
    const x = cameraLike
      ? frontWall.length === 1
        ? 0.5
        : 0.15 + (i * 0.7) / (frontWall.length - 1)
      : Math.min(0.92, Math.max(0.08, 0.1 + w.col * 0.18));
    const y = cameraLike ? 0.68 : w.row % 2 === 0 ? 0.06 : 0.94;
    return {
      id: w.device.id,
      kind,
      name: w.device.name,
      physicalRole: w.entry?.physicalRole ?? kind.toLowerCase(),
      status: w.device.status,
      connected: w.device.connected,
      detected: w.device.detected,
      lastReportedAt: w.device.lastReportedAt,
      spatial: { layout: 'point' as const, zone: 'front_wall' as const, x, y },
    };
  });

  const sideRackDevices = sideRack.map(w => ({
    id: w.device.id,
    kind,
    name: w.device.name,
    physicalRole: w.entry?.physicalRole ?? kind.toLowerCase(),
    status: w.device.status,
    connected: w.device.connected,
    detected: w.device.detected,
    lastReportedAt: w.device.lastReportedAt,
    spatial: { layout: 'point' as const, zone: 'side_rack' as const, x: 0.5, y: 0.5 },
  }));

  return [...frontWallDevices, ...sideRackDevices];
};

const mapRoomToDigitalTwin = (room: {
  userId: string;
  cpuTemperature: number | null;
  lastReportedAt: string;
  devices: RoomDeviceInput[];
}): DigitalTwinRoom => {
  const byType = (type: TelepresenceDeviceType): RoomDeviceInput[] =>
    room.devices.filter(d => d.deviceType === type);

  const devices: DigitalTwinDevice[] = [
    ...buildDisplayDevices(byType('TV')),
    ...buildPointDevices(byType('CAMERA'), 'CAMERA'),
    ...buildPointDevices(byType('MICROPHONE'), 'MICROPHONE'),
    ...buildPointDevices(byType('SPEAKER'), 'SPEAKER'),
  ];

  if (room.cpuTemperature !== null) {
    devices.push({
      id: `${room.userId}-cpu-room`,
      kind: 'COMPUTE',
      name: 'Room Controller',
      physicalRole: 'room_controller',
      status: 'HEALTHY',
      connected: 1,
      detected: 1,
      lastReportedAt: room.lastReportedAt,
      spatial: { layout: 'point', zone: 'side_rack', x: 0.5, y: 0.5 },
      cpuTemperature: room.cpuTemperature,
    });
  }

  return { userId: room.userId, label: humanizeUserId(room.userId), devices };
};

export const fetchDigitalTwinRooms = async (): Promise<DigitalTwinRoom[]> => {
  const response = await telepresenceService.getHealth();
  return response.data.rooms.map(mapRoomToDigitalTwin);
};

// Identity key for a single digital-twin device — mirrors the shape
// groupPointsByDevice keys lanes by (userId|deviceType|name), so picking a
// device here filters the graph down to exactly its own line.
export const digitalTwinDeviceKey = (roomUserId: string, device: DigitalTwinDevice): string =>
  `${roomUserId}|${device.kind}|${device.name}`;

export interface DigitalTwinTimeseriesPoint {
  id: string;
  userId: string;
  deviceType: DigitalTwinDeviceKind;
  name: string;
  status: TelepresenceHealthStatus;
  connected: number;
  detected: number;
  description: string | null;
  reportedAt: string;
}

export const fetchDigitalTwinTimeseries = async (
  from: string,
  to: string,
): Promise<DigitalTwinTimeseriesPoint[]> => {
  const response = await telepresenceService.getTimeseries({ from, to });
  // The room-level "Room Controller" COMPUTE tile has no corresponding
  // per-device log rows (cpuTemperature is a room-level reading, not a
  // logged device) — its lane is simply absent from history, which is
  // accurate rather than fabricated.
  return response.data.points.map(point => ({
    id: point.id,
    userId: point.userId,
    deviceType: DEVICE_TYPE_TO_KIND[point.deviceType],
    name: point.name,
    status: point.status,
    connected: point.connected,
    detected: point.detected,
    description: point.description,
    reportedAt: point.reportedAt,
  }));
};
