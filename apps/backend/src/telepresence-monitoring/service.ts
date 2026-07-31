import { TelepresenceHealthStatus, TelepresenceHealthView } from '@prisma/client';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  TelepresenceDeviceHealthRecord,
  TelepresenceDeviceReportInput,
  TelepresenceHealthLogPoint,
  TelepresenceHealthReportRequest,
  TelepresenceHealthReportResponse,
  TelepresenceHealthTimeSeriesFilters,
  TelepresenceRoomHealthSummary,
} from './types';

const STATUS_SEVERITY: Record<TelepresenceHealthStatus, number> = {
  UNAVAILABLE: 3,
  DEGRADED: 2,
  UNKNOWN: 1,
  HEALTHY: 0,
};

function deriveDeviceStatus(device: TelepresenceDeviceReportInput): TelepresenceHealthStatus {
  if (device.connected === 0) {
    return 'UNKNOWN';
  }

  if (device.detected === 0) {
    return 'UNAVAILABLE';
  }

  if (device.detected < device.connected) {
    return 'DEGRADED';
  }

  return 'HEALTHY';
}

function deriveOverallStatus(devices: { status: TelepresenceHealthStatus }[]): TelepresenceHealthStatus {
  if (devices.length === 0) {
    return 'UNKNOWN';
  }

  return devices.reduce<TelepresenceHealthStatus>((worst, device) => {
    return STATUS_SEVERITY[device.status] > STATUS_SEVERITY[worst] ? device.status : worst;
  }, 'HEALTHY');
}

function toDeviceRecord(row: TelepresenceHealthView): TelepresenceDeviceHealthRecord {
  return {
    id: row.id,
    deviceType: row.deviceType,
    name: row.name,
    status: row.status,
    connected: row.connected,
    detected: row.detected,
    lastReportedAt: row.lastReportedAt,
  };
}

function toRoomSummary(userId: string, rows: TelepresenceHealthView[]): TelepresenceRoomHealthSummary {
  const deviceRecords = rows.map(toDeviceRecord);
  const status = deriveOverallStatus(deviceRecords);
  const latestRow = rows.reduce<TelepresenceHealthView | null>((latest, row) => {
    if (!latest || row.lastReportedAt > latest.lastReportedAt) {
      return row;
    }
    return latest;
  }, null);

  return {
    userId,
    status,
    cpuTemperature: latestRow?.cpuTemperature ?? null,
    lastReportedAt: latestRow?.lastReportedAt ?? null,
    devices: deviceRecords,
    activeIssues: deviceRecords.filter((device) => device.status !== 'HEALTHY'),
  };
}

export class TelepresenceMonitoringService {
  async reportHealth(payload: TelepresenceHealthReportRequest): Promise<TelepresenceHealthReportResponse> {
    const { userId, devices, cpuTemperature } = payload;
    const reportedAt = payload.reportedAt;

    await db.$transaction(async (tx) => {
      for (const device of devices) {
        const status = deriveDeviceStatus(device);
        const { connected, detected } = device;
        const createdAt=new Date(Date.now());

        await tx.telepresenceHealthLog.create({
          data: {
            userId,
            deviceType: device.deviceType,
            name: device.name,
            status,
            connected,
            detected,
            cpuTemperature,
            description: device.description,
            reportedAt,
            createdAt,
          },
        });

        const name = device.name ?? '';

        await tx.telepresenceHealthView.upsert({
          where: { userId_deviceType_name: { userId, deviceType: device.deviceType, name } },
          update: { status, connected, detected, cpuTemperature, lastReportedAt: reportedAt, updatedAt: createdAt },
          create: {
            userId,
            deviceType: device.deviceType,
            name,
            status,
            connected,
            detected,
            cpuTemperature,
            lastReportedAt: reportedAt,
          },
        });
      }
    });

    const roomDevices = await db.telepresenceHealthView.findMany({ where: { userId }, take: 100 });
    const status = deriveOverallStatus(roomDevices);

    logger.info('[TelepresenceMonitoring] Health report processed', {
      userId,
      updatedDeviceCount: devices.length,
      status,
    });

    return {
      userId,
      status,
      updatedDeviceCount: devices.length,
    };
  }

  async getHealth(filters: { userId?: string }): Promise<TelepresenceRoomHealthSummary[]> {
    const rows = await db.telepresenceHealthView.findMany({
      where: {
        ...(filters.userId ? { userId: filters.userId } : {}),
      },
      orderBy: [{ userId: 'asc' }, { deviceType: 'asc' }],
      take: 100,
    });

    const roomsMap = new Map<string, TelepresenceHealthView[]>();
    for (const row of rows) {
      const existing = roomsMap.get(row.userId);
      if (existing) {
        existing.push(row);
      } else {
        roomsMap.set(row.userId, [row]);
      }
    }

    return Array.from(roomsMap.entries()).map(([userId, roomRows]) => toRoomSummary(userId, roomRows));
  }

  async getHealthTimeSeries(filters: TelepresenceHealthTimeSeriesFilters): Promise<TelepresenceHealthLogPoint[]> {
    const maxRangeDays = config.telepresenceMonitoringLifespanDays;
    const rangeDays = (filters.to.getTime() - filters.from.getTime()) / (1000 * 60 * 60 * 24);

    if (rangeDays > maxRangeDays) {
      throw new Error(`Date range must not exceed ${maxRangeDays} days`);
    }

    const rows = await db.telepresenceHealthLog.findMany({
      where: {
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.deviceTypes && filters.deviceTypes.length > 0
          ? { deviceType: { in: filters.deviceTypes } }
          : {}),
        reportedAt: {
          gte: filters.from,
          lte: filters.to,
        },
      },
      orderBy: { reportedAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      deviceType: row.deviceType,
      name: row.name,
      status: row.status,
      connected: row.connected,
      detected: row.detected,
      cpuTemperature: row.cpuTemperature,
      description: row.description,
      reportedAt: row.reportedAt,
    }));
  }
}

export const telepresenceMonitoringService = new TelepresenceMonitoringService();
