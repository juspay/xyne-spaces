import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DPIP_TABLE_SPECS } from './schema';
import {
  contextLogFields,
  type DpipLogContext,
  errorLogFields,
  logError,
  logInfo,
} from './logging';
import {
  DPIP_TABLE_NAMES,
  type DpipRow,
  type DpipTableName,
  type DpipValue,
} from './types';

const REPORT_TEMPLATE_PATTERN =
  /^[ \t]*<template id="dpip-email-body">[\s\S]*?<\/template>/m;
const OVERVIEW_TEMPLATE_PATTERN =
  /^[ \t]*<template id="dpip-overview-data">[\s\S]*?<\/template>/m;
const DEFAULT_MESSAGE = 'DPIP Daily Registry Intelligence Report (v2)';

interface DpipReportBlock {
  table: DpipTableName;
  data: DpipValue[][];
}

export interface DpipReportDelivery {
  conversationId: string;
  messageId: string;
  attachmentId?: string;
}

function jsonValue(value: DpipValue): DpipValue {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function buildDpipReportPayload(
  tables: Readonly<Record<DpipTableName, DpipRow[]>>,
): DpipReportBlock[] {
  return DPIP_TABLE_NAMES.map((table) => {
    const fields = Object.keys(DPIP_TABLE_SPECS[table].fields);
    return {
      table,
      data: [
        fields,
        ...tables[table].map((row) =>
          fields.map((field) => {
            const value = row[field];
            if (value === undefined) {
              throw new Error(
                `Missing report field ${field} in table ${table}`,
              );
            }
            return jsonValue(value);
          }),
        ),
      ],
    };
  });
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function generateDpipReportHtml(
  template: string,
  tables: Readonly<Record<DpipTableName, DpipRow[]>>,
): string {
  if (!REPORT_TEMPLATE_PATTERN.test(template)) {
    throw new Error('DPIP report template payload area not found');
  }

  const payload = JSON.stringify(buildDpipReportPayload(tables));
  return template.replace(
    REPORT_TEMPLATE_PATTERN,
    `<template id="dpip-email-body">${escapeHtmlText(payload)}</template>`,
  );
}

export function generateDpipOverviewHtml(
  template: string,
  tables: Readonly<Record<DpipTableName, DpipRow[]>>,
): string {
  if (!OVERVIEW_TEMPLATE_PATTERN.test(template)) {
    throw new Error('DPIP overview template payload area not found');
  }

  const payload = JSON.stringify(buildDpipReportPayload(tables));
  return template.replace(
    OVERVIEW_TEMPLATE_PATTERN,
    `<template id="dpip-overview-data">${escapeHtmlText(payload)}</template>`,
  );
}

export async function loadDpipReportTemplate(): Promise<string> {
  const configuredPath =
    process.env.DPIP_REPORT_TEMPLATE_PATH ?? 'Report.html';
  return readFile(resolve(process.cwd(), configuredPath), 'utf8');
}

export async function loadDpipOverviewTemplate(): Promise<string> {
  const configuredPath =
    process.env.DPIP_OVERVIEW_TEMPLATE_PATH ?? 'DPIP_Overview.html';
  return readFile(resolve(process.cwd(), configuredPath), 'utf8');
}

export function dpipReportFileName(now = new Date()): string {
  return `dpip-daily-report-v2-${now.toISOString().slice(0, 10)}.html`;
}

export function dpipOverviewFileName(now = new Date()): string {
  return `dpip-overview-v2-${now.toISOString().slice(0, 10)}.html`;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function appUploadUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/apps/slack/files.upload`;
}

function responseObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function sendDpipReportsToXyne(
  reportHtml: string,
  overviewHtml: string,
  fetchImplementation: typeof fetch = fetch,
  logContext?: DpipLogContext,
): Promise<DpipReportDelivery> {
  const apiUrl = requiredEnvironmentVariable('XYNE_SPACES_API_URL');
  const appJwt = requiredEnvironmentVariable('XYNE_SPACES_APP_JWT');
  const channelId = requiredEnvironmentVariable('XYNE_SPACES_CHANNEL_ID');
  const reportFileName = dpipReportFileName();
  const overviewFileName = dpipOverviewFileName();

  const form = new FormData();
  form.append('channels', channelId);
  form.append(
    'initial_comment',
    process.env.XYNE_SPACES_MESSAGE?.trim() || DEFAULT_MESSAGE,
  );
  form.append(
    'files',
    new Blob([reportHtml], { type: 'text/html; charset=utf-8' }),
    reportFileName,
  );
  form.append(
    'files',
    new Blob([overviewHtml], { type: 'text/html; charset=utf-8' }),
    overviewFileName,
  );

  const uploadStartedAt = Date.now();
  const commonLogFields = {
    ...contextLogFields(logContext),
    file_names: [reportFileName, overviewFileName],
    report_count: 2,
    report_bytes:
      Buffer.byteLength(reportHtml, 'utf8') +
      Buffer.byteLength(overviewHtml, 'utf8'),
  };
  logInfo('dpip_report_upload_started', commonLogFields);

  let response: Response;
  try {
    response = await fetchImplementation(appUploadUrl(apiUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    logError('dpip_report_upload_request_failed', {
      ...commonLogFields,
      duration_ms: Date.now() - uploadStartedAt,
      ...errorLogFields(error),
    });
    throw error;
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    logError('dpip_report_upload_response_read_failed', {
      ...commonLogFields,
      http_status: response.status,
      duration_ms: Date.now() - uploadStartedAt,
      ...errorLogFields(error),
    });
    throw error;
  }
  let responseBody: unknown;
  let responseIsJson = true;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    responseBody = undefined;
    responseIsJson = false;
  }
  const body = responseObject(responseBody);

  if (!response.ok || body?.ok !== true) {
    const appError =
      typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
    logError('dpip_report_upload_failed', {
      ...contextLogFields(logContext),
      http_status: response.status,
      app_error: appError,
      response_content_type:
        response.headers.get('content-type') ?? 'unknown',
      response_is_json: responseIsJson,
      response_bytes: Buffer.byteLength(responseText, 'utf8'),
      duration_ms: Date.now() - uploadStartedAt,
    });
    throw new Error(`Xyne Spaces report upload failed: ${appError}`);
  }

  const file = responseObject(body.file);
  const shares = responseObject(file?.shares);
  const publicShares = responseObject(shares?.public);
  const firstChannelShares = Array.isArray(publicShares?.[channelId])
    ? publicShares[channelId]
    : undefined;
  const firstShare =
    Array.isArray(firstChannelShares) && firstChannelShares.length > 0
      ? responseObject(firstChannelShares[0])
      : undefined;

  const conversationId =
    typeof firstShare?.ts === 'string' ? firstShare.ts : '';
  const messageId = conversationId;
  const attachmentId = typeof file?.id === 'string' ? file.id : undefined;

  logInfo('dpip_report_upload_completed', {
    ...contextLogFields(logContext),
    http_status: response.status,
    duration_ms: Date.now() - uploadStartedAt,
    ...(attachmentId === undefined ? {} : { attachment_id: attachmentId }),
    ...(messageId.length === 0 ? {} : { message_id: messageId }),
  });

  return {
    conversationId,
    messageId,
    ...(attachmentId === undefined ? {} : { attachmentId }),
  };
}
