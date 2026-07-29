import { Request, Response } from 'express';
import { sudoQueryService, EventProperties } from '@/services/hyperAnalytics/sudoQueryService';
import { logger } from '@/utils/logger';

interface MetricEvent {
  eventName: string;
  properties?: EventProperties;
  timestamp?: number;
}

interface BatchMetricsRequest {
  events: MetricEvent[];
}

export class SearchMetricsController {
  constructor() {
    // Initialize the sudoQuery service on first use
    sudoQueryService.initialize();
  }

  /**
   * POST /api/search-metrics/metrics
   * Receive batched search metrics events from frontend and forward to sudo-query
   */
  recordMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { events } = req.body as BatchMetricsRequest;

      if (!Array.isArray(events) || events.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid request: events array is required',
        });
        return;
      }

      // Auto-identify user from auth token if available
      if (userId && req.user) {
        sudoQueryService.identify({
          id: userId,
          name: req.user.name,
          email: req.user.email,
        });
      }

      // Process each event
      const results = {
        processed: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const event of events) {
        try {
          if (!event.eventName) {
            results.failed++;
            results.errors.push('Missing eventName');
            continue;
          }

          // Add server-side timestamp and user info
          // Flatten arrays to comma-separated strings (sudo-query SDK only accepts primitives)
          const flattenedProps = Object.fromEntries(
            Object.entries(event.properties || {}).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(',') : v,
            ]),
          );
          const properties: EventProperties = {
            ...flattenedProps,
            _receivedAt: Date.now(),
          };

          // Only add userId if it's defined
          if (userId) {
            properties._userId = userId;
          }

          if (event.timestamp) {
            properties._clientTimestamp = event.timestamp;
          }

          // Track the event
          sudoQueryService.track(event.eventName, properties);
          results.processed++;
        } catch (eventError) {
          results.failed++;
          const errorMessage = eventError instanceof Error ? eventError.message : 'Unknown error';
          results.errors.push(`Event ${event.eventName}: ${errorMessage}`);
          logger.error('[SearchMetrics] Failed to track event:', event.eventName, eventError);
        }
      }

      // Flush events to sudo-query
      try {
        await sudoQueryService.flush();
      } catch (flushError) {
        logger.error('[SearchMetrics] Flush failed:', flushError);
      }

      res.status(200).json({
        success: true,
        data: {
          processed: results.processed,
          failed: results.failed,
          total: events.length,
        },
      });

      logger.info('[SearchMetrics] Batch processed:', {
        processed: results.processed,
        failed: results.failed,
        total: events.length,
        userId,
      });
    } catch (error) {
      logger.error('[SearchMetrics] Unexpected error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  };
}

export const searchMetricsController = new SearchMetricsController();