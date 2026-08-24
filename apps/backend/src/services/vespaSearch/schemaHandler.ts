import { Request, Response } from 'express';
import { logger } from '@/utils/logger';

const CONFIG_SERVER_BASE = (
  process.env['VESPA_CONFIG_SERVER_URL'] ?? 'http://127.0.0.1:19071'
).replace(/\/+$/, '');

const SCHEMA_BASE_URL = `${CONFIG_SERVER_BASE}/application/v2/tenant/default/application/default/environment/default/region/default/instance/default/content/schemas`;

if (!process.env['VESPA_CONFIG_SERVER_URL']) {
  logger.warn('[schemaHandler] VESPA_CONFIG_SERVER_URL is not set — falling back to http://127.0.0.1:19071');
}

// Vespa schema names are plain identifiers; anything else is not a schema we
// serve and must not be interpolated into the config-server path.
const SCHEMA_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export const schemaHandler = async (req: Request, res: Response): Promise<void> => {
  const schemaName = req.query['schema'];
  if (typeof schemaName !== 'string' || !SCHEMA_NAME_PATTERN.test(schemaName)) {
    res.status(400).send('Invalid schema name');
    return;
  }
  const url = `${SCHEMA_BASE_URL}/${encodeURIComponent(schemaName)}.sd`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error('[schemaHandler] Vespa config server returned error', { schemaName, status: response.status, text });
      res.status(response.status).send(`Failed to fetch schema "${schemaName}": ${text.slice(0, 200)}`);
      return;
    }
    const content = await response.text();
    res.type('text/plain').send(content);
  } catch (error) {
    logger.error('[schemaHandler] Failed to reach Vespa config server', { schemaName, url, error });
    res.status(503).send(`Could not reach Vespa config server at ${CONFIG_SERVER_BASE}`);
  }
};
