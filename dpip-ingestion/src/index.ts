import { timingSafeEqual } from 'node:crypto';

import { http } from '@google-cloud/functions-framework';

import { readAllDpipTables, writeDpipTables } from './database';
import {
  contextLogFields,
  type DpipLogContext,
  errorLogFields,
  logError,
  logInfo,
  logWarning,
} from './logging';
import {
  DpipPayloadError,
  parseDpipPayloadDetailed,
} from './parser';
import {
  generateDpipReportHtml,
  generateDpipOverviewHtml,
  loadDpipOverviewTemplate,
  loadDpipReportTemplate,
  sendDpipReportsToXyne,
} from './report';
import {
  DPIP_TABLE_NAMES,
  type DpipRowError,
  type DpipTableSummary,
} from './types';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_ERRORS = 20;

type DpipPipelineStage =
  | 'payload_parsing'
  | 'database_write'
  | 'report_source_loading'
  | 'report_generation'
  | 'xyne_report_upload';

function requestId(headers: Record<string, unknown>): string | undefined {
  const requestHeader = headers['x-request-id'];
  if (typeof requestHeader === 'string' && requestHeader.length <= 128) {
    return requestHeader;
  }

  const traceHeader = headers['x-cloud-trace-context'];
  if (typeof traceHeader === 'string') {
    const trace = traceHeader.split('/')[0];
    if (trace !== undefined && /^[a-f0-9]{32}$/i.test(trace)) {
      return trace;
    }
  }

  return undefined;
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }

  const match = /^Bearer (.+)$/i.exec(authorization);
  return match?.[1];
}

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function rawBody(
  requestRawBody: Buffer | undefined,
  parsedBody: unknown,
): Buffer {
  if (requestRawBody !== undefined) {
    return requestRawBody;
  }
  if (Buffer.isBuffer(parsedBody)) {
    return parsedBody;
  }
  if (typeof parsedBody === 'string') {
    return Buffer.from(parsedBody, 'utf8');
  }
  if (parsedBody === undefined || parsedBody === null) {
    return Buffer.alloc(0);
  }
  return Buffer.from(JSON.stringify(parsedBody), 'utf8');
}

function errorResponse(errors: DpipRowError[]): {
  total_errors: number;
  errors: DpipRowError[];
  errors_truncated: boolean;
} {
  return {
    total_errors: errors.length,
    errors: errors.slice(0, MAX_RESPONSE_ERRORS),
    errors_truncated: errors.length > MAX_RESPONSE_ERRORS,
  };
}

http('ingestDpip', async (req, res) => {
  const startedAt = Date.now();
  const id = requestId(req.headers);
  const logContext: DpipLogContext | undefined =
    id === undefined ? undefined : { requestId: id };
  const requestLogFields = contextLogFields(logContext);

  logInfo('dpip_ingestion_request_received', {
    ...requestLogFields,
    method: req.method,
    content_type: req.get('content-type') ?? 'unknown',
    content_length: req.get('content-length') ?? 'unknown',
  });

  if (req.method !== 'POST') {
    logWarning('dpip_ingestion_request_rejected', {
      ...requestLogFields,
      reason: 'method_not_allowed',
      method: req.method,
      duration_ms: Date.now() - startedAt,
    });
    res.set('Allow', 'POST');
    res.status(405).json({ status: 'error', message: 'Method not allowed' });
    return;
  }

  const expectedSecret = process.env.DPIP_BEARER_SECRET;
  if (expectedSecret === undefined || expectedSecret.length === 0) {
    logError('dpip_ingestion_configuration_failed', {
      ...requestLogFields,
      missing_environment_variable: 'DPIP_BEARER_SECRET',
      duration_ms: Date.now() - startedAt,
    });
    res
      .status(500)
      .json({ status: 'error', message: 'Internal server error' });
    return;
  }

  if (!secretsMatch(bearerToken(req.get('authorization')), expectedSecret)) {
    logWarning('dpip_ingestion_request_rejected', {
      ...requestLogFields,
      reason: 'unauthorized',
      duration_ms: Date.now() - startedAt,
    });
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const body = rawBody(req.rawBody, req.body);
  if (body.byteLength > MAX_BODY_BYTES) {
    logWarning('dpip_ingestion_request_rejected', {
      ...requestLogFields,
      reason: 'payload_too_large',
      body_bytes: body.byteLength,
      maximum_body_bytes: MAX_BODY_BYTES,
      duration_ms: Date.now() - startedAt,
    });
    res.status(413).json({ status: 'error', message: 'Payload too large' });
    return;
  }

  let stage: DpipPipelineStage = 'payload_parsing';
  let stageStartedAt = Date.now();
  try {
    const parsed = parseDpipPayloadDetailed(body.toString('utf8'));
    logInfo('dpip_payload_parsed', {
      ...requestLogFields,
      body_bytes: body.byteLength,
      duration_ms: Date.now() - stageStartedAt,
      row_errors: parsed.errors.length,
      tables: DPIP_TABLE_NAMES.map((table) => ({
        table,
        received: parsed.parseStats[table].received,
        duplicates: parsed.parseStats[table].duplicates,
        invalid: parsed.parseStats[table].invalid,
      })),
    });

    stage = 'database_write';
    stageStartedAt = Date.now();
    const writeStats = await writeDpipTables(parsed.tables, logContext);
    logInfo('dpip_database_write_completed', {
      ...requestLogFields,
      duration_ms: Date.now() - stageStartedAt,
      tables: DPIP_TABLE_NAMES.map((table) => ({
        table,
        inserted: writeStats[table].inserted,
        updated: writeStats[table].updated,
        conflicts: writeStats[table].conflicts,
      })),
    });

    stage = 'report_source_loading';
    stageStartedAt = Date.now();
    const snapshotStartedAt = Date.now();
    const templateStartedAt = Date.now();
    const [reportTables, reportTemplate, overviewTemplate] = await Promise.all([
      readAllDpipTables(logContext).then(
        (tables) => {
          logInfo('dpip_report_snapshot_loaded', {
            ...requestLogFields,
            duration_ms: Date.now() - snapshotStartedAt,
            tables: DPIP_TABLE_NAMES.map((table) => ({
              table,
              rows: tables[table].length,
            })),
          });
          return tables;
        },
        (error: unknown) => {
          logError('dpip_report_snapshot_load_failed', {
            ...requestLogFields,
            duration_ms: Date.now() - snapshotStartedAt,
            ...errorLogFields(error),
          });
          throw error;
        },
      ),
      loadDpipReportTemplate().then(
        (template) => {
          logInfo('dpip_report_template_loaded', {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            template_bytes: Buffer.byteLength(template, 'utf8'),
          });
          return template;
        },
        (error: unknown) => {
          logError('dpip_report_template_load_failed', {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            ...errorLogFields(error),
          });
          throw error;
        },
      ),
      loadDpipOverviewTemplate().then(
        (template) => {
          logInfo('dpip_overview_template_loaded', {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            template_bytes: Buffer.byteLength(template, 'utf8'),
          });
          return template;
        },
        (error: unknown) => {
          logError('dpip_overview_template_load_failed', {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            ...errorLogFields(error),
          });
          throw error;
        },
      ),
    ]);

    stage = 'report_generation';
    stageStartedAt = Date.now();
    const reportHtml = generateDpipReportHtml(
      reportTemplate,
      reportTables,
    );
    const overviewHtml = generateDpipOverviewHtml(
      overviewTemplate,
      reportTables,
    );
    logInfo('dpip_report_generated', {
      ...requestLogFields,
      duration_ms: Date.now() - stageStartedAt,
      report_bytes: Buffer.byteLength(reportHtml, 'utf8'),
      overview_bytes: Buffer.byteLength(overviewHtml, 'utf8'),
    });

    stage = 'xyne_report_upload';
    stageStartedAt = Date.now();
    const reportDelivery = await sendDpipReportsToXyne(
      reportHtml,
      overviewHtml,
      fetch,
      logContext,
    );
    const summaries: DpipTableSummary[] = DPIP_TABLE_NAMES.map((table) => ({
      table,
      received: parsed.parseStats[table].received,
      inserted: writeStats[table].inserted,
      updated: writeStats[table].updated,
      duplicates:
        parsed.parseStats[table].duplicates +
        writeStats[table].conflicts,
      invalid: parsed.parseStats[table].invalid,
    }));
    const responseErrors = errorResponse(parsed.errors);
    const partial =
      responseErrors.total_errors > 0 ||
      summaries.some((summary) => summary.duplicates > 0);

    logInfo('dpip_ingestion_completed', {
      ...requestLogFields,
      status: partial ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
      report_attachment_id: reportDelivery.attachmentId,
      tables: summaries.map(
        ({ table, received, inserted, updated, duplicates, invalid }) => ({
          table,
          received,
          inserted,
          updated,
          duplicates,
          invalid,
        }),
      ),
    });

    res.status(partial ? 207 : 200).json({
      status: partial ? 'partial' : 'success',
      tables: summaries,
      report: {
        sent: true,
        attachment_id: reportDelivery.attachmentId,
      },
      ...responseErrors,
    });
  } catch (error) {
    if (error instanceof DpipPayloadError) {
      logWarning('dpip_payload_rejected', {
        ...requestLogFields,
        reason: 'invalid_payload_structure',
        duration_ms: Date.now() - startedAt,
        ...errorLogFields(error),
      });
      res.status(400).json({ status: 'error', message: error.message });
      return;
    }

    logError('dpip_ingestion_failed', {
      ...requestLogFields,
      pipeline_stage: stage,
      stage_duration_ms: Date.now() - stageStartedAt,
      duration_ms: Date.now() - startedAt,
      ...errorLogFields(error),
    });
    res
      .status(500)
      .json({ status: 'error', message: 'Internal server error' });
  }
});

export { parseDpipPayload } from './parser';
