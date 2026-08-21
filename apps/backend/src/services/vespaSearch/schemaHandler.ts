import { Request, Response } from 'express';
import { logger } from '@/utils/logger';

const CONFIG_SERVER_BASE = (
  process.env['VESPA_CONFIG_SERVER_URL'] ?? 'http://127.0.0.1:19071'
).replace(/\/+$/, '');

const SCHEMA_BASE_URL = `${CONFIG_SERVER_BASE}/application/v2/tenant/default/application/default/environment/default/region/default/instance/default/content/schemas`;

if (!process.env['VESPA_CONFIG_SERVER_URL']) {
  logger.warn('[schemaHandler] VESPA_CONFIG_SERVER_URL is not set — falling back to http://127.0.0.1:19071');
}

export const schemaHandler = async (req: Request, res: Response): Promise<void> => {
  const schemaNameRaw = req.query['schema'];
  const schemaName = typeof schemaNameRaw === 'string' ? schemaNameRaw : '';
  // Encode the caller-supplied schema name so it can only ever be a single path segment:
  // this stops `../` traversal or host manipulation from redirecting the fetch to another
  // endpoint on the internal Vespa config server. Valid schema names are unaffected.
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
