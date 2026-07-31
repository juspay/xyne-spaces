import { TelepresenceDeviceType } from '@prisma/client';
import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { telepresenceMonitoringService } from './service';
import {
  TelepresenceHealthQuerySchema,
  TelepresenceHealthReportRequestSchema,
  TelepresenceHealthTimeSeriesQuerySchema,
} from './validation';

const DEVICE_TYPE_FLAG_MAP: Record<string, TelepresenceDeviceType> = {
  screen: 'TV',
  camera: 'CAMERA',
  microphone: 'MICROPHONE',
  speaker: 'SPEAKER',
};

export class TelepresenceMonitoringController {
  reportHealth = async (req: Request, res: Response): Promise<void> => {
    try {
      const validationResult = TelepresenceHealthReportRequestSchema.safeParse(req.body);

      if (!validationResult.success) {
        logger.warn('[TelepresenceMonitoringController] Invalid health report payload received', {
          path: req.path,
          errors: validationResult.error.flatten(),
        });

        res.status(400).json({
          success: false,
          error: 'Invalid input',
          details: validationResult.error.flatten(),
        });
        return;
      }

      const data = await telepresenceMonitoringService.reportHealth({
        ...validationResult.data,
        reportedAt: new Date(validationResult.data.reportedAt),
      });

      res.status(202).json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('[TelepresenceMonitoringController] Failed to process health report', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to process telepresence health report',
      });
    }
  };

  getHealth = async (req: Request, res: Response): Promise<void> => {
    try {
      const validationResult = TelepresenceHealthQuerySchema.safeParse(req.query);

      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid input',
          details: validationResult.error.flatten(),
        });
        return;
      }

      const rooms = await telepresenceMonitoringService.getHealth(validationResult.data);

      res.status(200).json({
        success: true,
        data: { rooms },
      });
    } catch (error) {
      logger.error('[TelepresenceMonitoringController] Failed to fetch health data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch telepresence health data',
      });
    }
  };

  getHealthTimeSeries = async (req: Request, res: Response): Promise<void> => {
    try {
      const validationResult = TelepresenceHealthTimeSeriesQuerySchema.safeParse(req.query);

      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid input',
          details: validationResult.error.flatten(),
        });
        return;
      }

      const { userId, from, to, screen, camera, microphone, speaker } = validationResult.data;
      const flags: Record<string, boolean | undefined> = { screen, camera, microphone, speaker };
      const selectedFlags = Object.entries(flags).filter(([, value]) => value === true);
      const deviceTypes = selectedFlags.length > 0
        ? selectedFlags.map(([key]) => DEVICE_TYPE_FLAG_MAP[key])
        : undefined;

      const points = await telepresenceMonitoringService.getHealthTimeSeries({
        userId,
        from: new Date(from),
        to: new Date(to),
        deviceTypes,
      });

      res.status(200).json({
        success: true,
        data: { points },
      });
    } catch (error) {
      logger.error('[TelepresenceMonitoringController] Failed to fetch health time series data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to fetch telepresence health time series data',
      });
    }
  };
}

export const telepresenceMonitoringController = new TelepresenceMonitoringController();
