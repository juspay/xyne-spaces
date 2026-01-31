import { Request, Response } from 'express';
import { ApiResponse, HealthCheckResponse } from '@/types/express';
import { DatabaseClient } from '@/database/client';

export class HealthController {
  public static async getHealth(_req: Request, res: Response): Promise<void> {
    try {
      const memoryUsage = process.memoryUsage();
      const isDatabaseHealthy = await DatabaseClient.healthCheck();

      const healthData: HealthCheckResponse = {
        status: isDatabaseHealthy ? 'OK' : 'DEGRADED',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        },
        database: {
          status: isDatabaseHealthy ? 'connected' : 'disconnected',
          connected: isDatabaseHealthy,
        },
      };

      const response: ApiResponse<HealthCheckResponse> = {
        success: true,
        data: healthData,
        timestamp: new Date().toISOString(),
      };

      res.status(isDatabaseHealthy ? 200 : 503).json(response);
    } catch (error) {
      const response: ApiResponse = {
        success: false,
        error: 'Health check failed',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    }
  }

  public static async getReadiness(_req: Request, res: Response): Promise<void> {
    try {
      // Check database connectivity for readiness
      const isDatabaseReady = await DatabaseClient.healthCheck();
      const isDatabaseConnected = DatabaseClient.isConnectionReady();

      const isReady = isDatabaseReady && isDatabaseConnected;

      if (isReady) {
        const response: ApiResponse = {
          success: true,
          data: {
            status: 'ready',
            database: {
              connected: isDatabaseConnected,
              healthy: isDatabaseReady,
            },
          },
          timestamp: new Date().toISOString(),
        };
        res.status(200).json(response);
      } else {
        const response: ApiResponse = {
          success: false,
          error: 'Service not ready',
          data: {
            database: {
              connected: isDatabaseConnected,
              healthy: isDatabaseReady,
            },
          },
          timestamp: new Date().toISOString(),
        };
        res.status(503).json(response);
      }
    } catch (error) {
      const response: ApiResponse = {
        success: false,
        error: 'Readiness check failed',
        timestamp: new Date().toISOString(),
      };

      res.status(503).json(response);
    }
  }

  public static async getLiveness(_req: Request, res: Response): Promise<void> {
    // Simple liveness check - if the process is running, it's alive
    const response: ApiResponse = {
      success: true,
      data: { status: 'alive', pid: process.pid },
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  }
}