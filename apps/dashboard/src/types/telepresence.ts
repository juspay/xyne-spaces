// Response shapes for the telepresence-monitoring API (base path
// /api/telepresence-monitoring):
//   GET /health            — current snapshot per room (session-authenticated)
//   GET /health/timeseries — history log within a range (session-authenticated)
// The POST /health variant is the x-s2s-key ingestion endpoint devices report
// to and is never called from the browser.

export type TelepresenceDeviceType = 'TV' | 'CAMERA' | 'MICROPHONE' | 'SPEAKER';

// Derived server-side from connected/detected:
//   connected === 0                  → UNKNOWN (nothing configured)
//   connected > 0 && detected === 0  → UNAVAILABLE
//   detected < connected             → DEGRADED
//   detected === connected           → HEALTHY
export type TelepresenceHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface TelepresenceDevice {
  id: string;
  deviceType: TelepresenceDeviceType;
  name: string;
  status: TelepresenceHealthStatus;
  /** Total devices of this type the user has set up */
  connected: number;
  /** How many of those are currently detected/working */
  detected: number;
  lastReportedAt: string;
  /** Freeform placement metadata reported by the device (physicalRole/spatial) — no fixed shape. */
  layoutConfig?: unknown;
}

export interface TelepresenceRoom {
  userId: string;
  /** Worst device status (severity: UNAVAILABLE > DEGRADED > UNKNOWN > HEALTHY) */
  status: TelepresenceHealthStatus;
  /** Celsius, from the most recent report for this room — null until any report lands. */
  cpuTemperature: number | null;
  lastReportedAt: string;
  devices: TelepresenceDevice[];
  /** Same shape as devices, filtered to status !== HEALTHY */
  activeIssues: TelepresenceDevice[];
}

export interface TelepresenceHealthResponse {
  success: boolean;
  data: {
    rooms: TelepresenceRoom[];
  };
}

export interface TelepresenceTimeseriesPoint {
  id: string;
  userId: string;
  deviceType: TelepresenceDeviceType;
  name: string;
  status: TelepresenceHealthStatus;
  connected: number;
  detected: number;
  cpuTemperature: number;
  description: string | null;
  reportedAt: string;
  layoutConfig?: unknown;
}

export interface TelepresenceTimeseriesResponse {
  success: boolean;
  data: {
    points: TelepresenceTimeseriesPoint[];
  };
}

// GET /health/timeseries query params. Device types are boolean flags; if none
// are true, all types are included.
export interface TelepresenceTimeseriesParams {
  userId?: string;
  /** ISO date-time, start of range (inclusive) — required */
  from: string;
  /** ISO date-time, end of range (inclusive) — required */
  to: string;
  /** Include TV device type */
  screen?: boolean;
  camera?: boolean;
  microphone?: boolean;
  speaker?: boolean;
}
