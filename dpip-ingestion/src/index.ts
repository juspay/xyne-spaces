import { timingSafeEqual } from 'node:crypto';

import { http } from '@google-cloud/functions-framework';

import { writeDpipTables } from './database';
import {
  DpipPayloadError,
  parseDpipPayloadDetailed,
} from './parser';
import {
  DPIP_TABLE_NAMES,
  type DpipRowError,
  type DpipTableSummary,
} from './types';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_ERRORS = 20;

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

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(405).json({ status: 'error', message: 'Method not allowed' });
    return;
  }

  const expectedSecret = process.env.DPIP_BEARER_SECRET;
  if (
    expectedSecret === undefined ||
    !secretsMatch(bearerToken(req.get('authorization')), expectedSecret)
  ) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const body = rawBody(req.rawBody, req.body);
  if (body.byteLength > MAX_BODY_BYTES) {
    res.status(413).json({ status: 'error', message: 'Payload too large' });
    return;
  }

  try {
    const parsed = parseDpipPayloadDetailed(body.toString('utf8'));
    const writeStats = await writeDpipTables(parsed.tables);
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

    console.log(
      JSON.stringify({
        severity: 'INFO',
        event: 'dpip_ingestion_completed',
        ...(id === undefined ? {} : { request_id: id }),
        status: partial ? 'partial' : 'success',
        duration_ms: Date.now() - startedAt,
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
      }),
    );

    res.status(partial ? 207 : 200).json({
      status: partial ? 'partial' : 'success',
      tables: summaries,
      ...responseErrors,
    });
  } catch (error) {
    if (error instanceof DpipPayloadError) {
      console.warn(
        JSON.stringify({
          severity: 'WARNING',
          event: 'dpip_payload_rejected',
          ...(id === undefined ? {} : { request_id: id }),
          reason: 'invalid_payload_structure',
          duration_ms: Date.now() - startedAt,
        }),
      );
      res.status(400).json({ status: 'error', message: error.message });
      return;
    }

    console.error(
      JSON.stringify({
        severity: 'ERROR',
        event: 'dpip_ingestion_failed',
        ...(id === undefined ? {} : { request_id: id }),
        error_type:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        duration_ms: Date.now() - startedAt,
      }),
    );
    res
      .status(500)
      .json({ status: 'error', message: 'Internal server error' });
  }
});

export { parseDpipPayload } from './parser';
