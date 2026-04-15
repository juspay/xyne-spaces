import { Request, Response } from 'express';
import { z } from 'zod';
import { fetchLogs } from '../services/inspectorTools/grafanaLogsService.js';
import { logger } from '../utils/logger.js';

const GetLogsSchema = z.object({
  startTime: z.string().datetime({ message: 'startTime must be a valid ISO 8601 datetime' }),
  endTime: z.string().datetime({ message: 'endTime must be a valid ISO 8601 datetime' }),
  email: z.string().min(1).optional(),
  keyword: z.string().min(1).optional(),
  level: z.string().min(1).optional(),
  container: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  pod: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  logsqlFilters: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * GET /api/inspectorTools/logs
 * Query Grafana/VictoriaLogs
 */
export async function getLogs(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = GetLogsSchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid input',
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const params = parseResult.data;

    const result = await fetchLogs({
      startTime: params.startTime,
      endTime: params.endTime,
      email: params.email,
      keyword: params.keyword,
      level: params.level,
      container: params.container,
      namespace: params.namespace,
      pod: params.pod,
      sessionId: params.sessionId,
      requestId: params.requestId,
      logsqlFilters: params.logsqlFilters,
      limit: params.limit,
      offset: params.offset,
    });

    res.json(result);
  } catch (error) {
    logger.error('[InspectorTools] getLogs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
}
