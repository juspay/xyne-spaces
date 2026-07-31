import { TelepresenceDeviceType, TelepresenceHealthStatus } from '@prisma/client';

export interface TelepresenceDeviceReportInput {
  deviceType: TelepresenceDeviceType;
  name?: string;
  /** Total number of devices of this type the user has set up. */
  connected: number;
  /** Number of those devices currently detected/working. */
  detected: number;
  description?: string;
  [key: string]: unknown;
}

export interface TelepresenceHealthReportRequest {
  userId: string;
  reportedAt: Date;
  cpuTemperature: number;
  devices: TelepresenceDeviceReportInput[];
  [key: string]: unknown;
}

export interface TelepresenceDeviceHealthRecord {
  id: string;
  deviceType: TelepresenceDeviceType;
  name: string | null;
  status: TelepresenceHealthStatus;
  connected: number;
  detected: number;
  lastReportedAt: Date;
}

export interface TelepresenceRoomHealthSummary {
  userId: string;
  status: TelepresenceHealthStatus;
  cpuTemperature: number | null;
  lastReportedAt: Date | null;
  devices: TelepresenceDeviceHealthRecord[];
  activeIssues: TelepresenceDeviceHealthRecord[];
}

export interface TelepresenceHealthReportResponse {
  userId: string;
  status: TelepresenceHealthStatus;
  updatedDeviceCount: number;
}

export interface TelepresenceHealthTimeSeriesFilters {
  userId?: string;
  from: Date;
  to: Date;
  deviceTypes?: TelepresenceDeviceType[];
}

export interface TelepresenceHealthLogPoint {
  id: string;
  userId: string;
  deviceType: TelepresenceDeviceType;
  name: string | null;
  status: TelepresenceHealthStatus;
  connected: number;
  detected: number;
  cpuTemperature: number;
  description: string | null;
  reportedAt: Date;
}
