import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, type LucideIcon } from 'lucide-react';
import type { TelepresenceDevice, TelepresenceHealthStatus } from '../../types/telepresence';
import { TELEPRESENCE_CANVAS_KIND_ORDER } from './telepresenceCanvasData';

// A device that hasn't reported within this window is treated as Unavailable
// even if its last self-reported status was better.
export const INACTIVITY_THRESHOLD_MS = 60 * 1000;

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** Validated status palette (dataviz skill): good / warning / critical / neutral */
  color: string;
  badgeClassName: string;
  /** Y-level for the timeseries chart (higher = healthier) */
  chartLevel: number;
}

// Color is never the only channel — every status renders with icon + label.
export const STATUS_META: Record<TelepresenceHealthStatus, StatusMeta> = {
  HEALTHY: {
    label: 'Active',
    icon: CheckCircle2,
    color: '#0ca30c',
    badgeClassName: 'border-transparent bg-[#0ca30c]/15 text-[#0a8a0a] dark:text-[#4ade4a]',
    chartLevel: 3,
  },
  UNKNOWN: {
    label: 'Unknown',
    icon: HelpCircle,
    color: '#8a8a86',
    badgeClassName: 'border-transparent bg-muted text-muted-foreground',
    chartLevel: 2,
  },
  DEGRADED: {
    label: 'Degraded',
    icon: AlertTriangle,
    color: '#fab219',
    badgeClassName: 'border-transparent bg-[#fab219]/20 text-[#8a6200] dark:text-[#fac84d]',
    chartLevel: 1,
  },
  UNAVAILABLE: {
    label: 'Unavailable',
    icon: XCircle,
    color: '#d03b3b',
    badgeClassName: 'border-transparent bg-[#d03b3b]/15 text-[#b52f2f] dark:text-[#e57373]',
    chartLevel: 0,
  },
};

// Both `room.status` (worst device status) and each device's `status`
// (derived from connected/detected) are computed server-side and consumed
// as-is — the client never recomputes them, so there's no drift risk if the
// backend's derivation rules change.

// Reported status downgraded to UNAVAILABLE when the device has gone silent.
// Takes just the two fields it needs (structural, not TelepresenceDevice
// specifically) so it also works for the telepresence device shape, which
// carries the same status/lastReportedAt pair but no deviceType.
export const effectiveDeviceStatus = (
  device: Pick<TelepresenceDevice, 'status' | 'lastReportedAt'>,
  now: number,
): TelepresenceHealthStatus => {
  const reportedAt = new Date(device.lastReportedAt).getTime();
  if (Number.isNaN(reportedAt) || now - reportedAt > INACTIVITY_THRESHOLD_MS) return 'UNAVAILABLE';
  return device.status;
};

export const formatRelativeTime = (iso: string, now: number): string => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const seconds = Math.max(Math.round((now - t) / 1000), 0);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

// A shape any timeseries point flavor (real AV or telepresence-canvas) satisfies for
// charting purposes — deviceType widened to a plain string since the chart
// itself doesn't care which enum a point's device type came from.
export interface ChartTimeseriesPoint {
  id: string;
  userId: string;
  deviceType: string;
  name: string;
  status: TelepresenceHealthStatus;
  connected: number;
  detected: number;
  description: string | null;
  reportedAt: string;
}

export interface DeviceLane {
  key: string;
  userId: string;
  name: string;
  deviceType: string;
  /** Points sorted ascending by reportedAt */
  points: ChartTimeseriesPoint[];
}

// Points are typically a flat array mixing all rooms and device types.
// Group per device — identity is (userId, deviceType, name) — and sort each
// group ascending by reportedAt; never assume the source pre-sorts.
export const groupPointsByDevice = (points: ChartTimeseriesPoint[]): DeviceLane[] => {
  const lanes = new Map<string, DeviceLane>();
  for (const point of points) {
    const key = `${point.userId}|${point.deviceType}|${point.name}`;
    const lane = lanes.get(key) ?? {
      key,
      userId: point.userId,
      name: point.name,
      deviceType: point.deviceType,
      points: [],
    };
    lane.points.push(point);
    lanes.set(key, lane);
  }
  const grouped = [...lanes.values()];
  for (const lane of grouped) {
    lane.points.sort((a, b) => new Date(a.reportedAt).getTime() - new Date(b.reportedAt).getTime());
  }
  grouped.sort((a, b) => {
    const byType =
      TELEPRESENCE_CANVAS_KIND_ORDER.indexOf(
        a.deviceType as (typeof TELEPRESENCE_CANVAS_KIND_ORDER)[number],
      ) -
      TELEPRESENCE_CANVAS_KIND_ORDER.indexOf(
        b.deviceType as (typeof TELEPRESENCE_CANVAS_KIND_ORDER)[number],
      );
    if (byType !== 0) return byType;
    const byRoom = a.userId.localeCompare(b.userId);
    return byRoom !== 0 ? byRoom : a.name.localeCompare(b.name);
  });
  return grouped;
};
