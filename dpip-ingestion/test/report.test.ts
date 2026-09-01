import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, it, mock } from 'node:test';

import {
  buildDpipReportPayload,
  dpipOverviewFileName,
  dpipReportFileName,
  generateDpipOverviewHtml,
  generateDpipReportHtml,
  sendDpipReportsToXyne,
} from '../src/report';
import {
  DPIP_TABLE_NAMES,
  type DpipRow,
  type DpipTableName,
} from '../src/types';

function emptyTables(): Record<DpipTableName, DpipRow[]> {
  return Object.fromEntries(
    DPIP_TABLE_NAMES.map((table) => [table, []]),
  ) as Record<DpipTableName, DpipRow[]>;
}

const ENV_NAMES = [
  'XYNE_SPACES_API_URL',
  'XYNE_SPACES_APP_JWT',
  'XYNE_SPACES_CHANNEL_ID',
  'XYNE_SPACES_MESSAGE',
] as const;
const originalEnvironment = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  mock.restoreAll();
  for (const name of ENV_NAMES) {
    const value = originalEnvironment[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('DPIP HTML report', () => {
  it('serializes all tables and preserves bigint values as strings', () => {
    const tables = emptyTables();
    tables.screenings.push({
      screening_date: '2026-07-30',
      party_id: 'party-1',
      screening_status: 'MATCH',
      count: 9_007_199_254_740_993n,
    });

    const payload = buildDpipReportPayload(tables);
    const screenings = payload.find(
      ({ table }) => table === 'screenings',
    );

    assert.deepEqual(screenings?.data[1], [
      '2026-07-30',
      'party-1',
      'MATCH',
      '9007199254740993',
    ]);
    assert.deepEqual(
      payload.map(({ table }) => table),
      DPIP_TABLE_NAMES,
    );
  });

  it('injects escaped data into the attachment template', () => {
    const tables = emptyTables();
    tables.reports.push({
      identifier_type: 'PAN',
      reported_date: '2026-07-30',
      party_id: 'party-1',
      sub_source: '</template><script>alert(1)</script>',
      status: 'ALL',
      metrics_type: 'reports_count',
      metrics_value: 4n,
    });
    const template = `<html>
<template id="dpip-email-body"> </template>
</html>`;

    const html = generateDpipReportHtml(template, tables);

    assert.match(html, /"table":"reports"/);
    assert.match(
      html,
      /&lt;\/template&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
    );
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  });

  it('injects the same escaped snapshot into the overview template', () => {
    const tables = emptyTables();
    tables.reports.push({
      identifier_type: 'ALL',
      reported_date: '2026-07-30',
      party_id: 'bank-1',
      sub_source: 'daily',
      status: 'ALL',
      metrics_type: 'reports_count',
      metrics_value: 4n,
    });
    const template = '<template id="dpip-overview-data"></template>';

    const html = generateDpipOverviewHtml(template, tables);

    assert.match(html, /"table":"reports"/);
    assert.match(html, /"bank-1"/);
  });

  it('keeps the production overview template compatible with the payload', async () => {
    const tables = emptyTables();
    tables.screenings.push({
      screening_date: '2026-07-30',
      party_id: 'bank-1',
      screening_status: 'MATCH',
      count: 3n,
    });
    const template = await readFile(
      new URL('../DPIP_Overview.html', import.meta.url),
      'utf8',
    );

    const html = generateDpipOverviewHtml(template, tables);

    assert.match(html, /<template id="dpip-overview-data">\[{/);
    assert.match(html, /"table":"screenings"/);
    assert.match(html, /"bank-1"/);
    assert.doesNotMatch(html, /\u0000/);
  });

  it('ignores template-tag examples inside HTML comments', () => {
    const tables = emptyTables();
    const template = `<!--
Replace content inside the <template id="dpip-email-body"> element.
-->
<template id="dpip-email-body"> </template>
<header>DPIP report</header>`;

    const html = generateDpipReportHtml(template, tables);

    assert.match(
      html,
      /<!--\s*Replace content inside the <template id="dpip-email-body"> element\.\s*-->/,
    );
    assert.match(
      html,
      /^<template id="dpip-email-body">\[\{"table":"reports"/m,
    );
    assert.match(html, /<header>DPIP report<\/header>/);
  });

  it('builds identifier-type bars from identifiers_count metric rows', async () => {
    const template = await readFile(
      new URL('../Report.html', import.meta.url),
      'utf8',
    );
    const start = template.indexOf('const identifierTypes =');
    const end = template.indexOf('const subSources =', start);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const identifierTypeChartSource = template.slice(start, end);

    assert.match(
      identifierTypeChartSource,
      /aggregate\(\s*metricReports\.filter/,
    );
    assert.match(
      identifierTypeChartSource,
      /"identifier_type",\s*"identifiers_count"/,
    );
  });

  it('uses UTC report date in attachment filename', () => {
    const now = new Date('2026-07-30T23:59:59.000Z');
    assert.equal(dpipReportFileName(now), 'dpip-daily-report-2026-07-30.html');
    assert.equal(dpipOverviewFileName(now), 'dpip-overview-2026-07-30.html');
  });

  it('uploads both HTML reports as attachments on one Xyne message', async () => {
    process.env.XYNE_SPACES_API_URL = 'https://spaces.example.test/';
    process.env.XYNE_SPACES_APP_JWT = 'test-jwt';
    process.env.XYNE_SPACES_CHANNEL_ID = 'channel-1';

    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fakeFetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({
          ok: true,
          file: {
            id: 'attachment-1',
            shares: {
              public: {
                'channel-1': [{ ts: 'message-1' }],
              },
            },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const delivery = await sendDpipReportsToXyne(
      '<html>report</html>',
      '<html>overview</html>',
      fakeFetch,
    );

    assert.equal(
      requestUrl,
      'https://spaces.example.test/api/apps/slack/files.upload',
    );
    assert.equal(
      new Headers(requestInit?.headers).get('authorization'),
      'Bearer test-jwt',
    );
    assert.ok(requestInit?.body instanceof FormData);
    const form = requestInit.body;
    assert.equal(form.get('channels'), 'channel-1');
    assert.equal(form.get('file'), null);
    const files = form.getAll('files');
    assert.equal(files.length, 2);
    assert.ok(files.every((file) => file instanceof Blob));
    assert.ok(
      files.every((file) => file.type === 'text/html; charset=utf-8'),
    );
    const fileNames = files.map((file) =>
      file instanceof File ? file.name : '',
    );
    assert.match(
      fileNames[0] ?? '',
      /^dpip-daily-report-\d{4}-\d{2}-\d{2}\.html$/,
    );
    assert.match(
      fileNames[1] ?? '',
      /^dpip-overview-\d{4}-\d{2}-\d{2}\.html$/,
    );
    assert.deepEqual(delivery, {
      conversationId: 'message-1',
      messageId: 'message-1',
      attachmentId: 'attachment-1',
    });
  });

  it('logs the Xyne application error without secrets or report data', async () => {
    process.env.XYNE_SPACES_API_URL = 'https://spaces.example.test/';
    process.env.XYNE_SPACES_APP_JWT = 'secret-test-jwt';
    process.env.XYNE_SPACES_CHANNEL_ID = 'channel-1';

    const errorLog = mock.method(console, 'error', () => undefined);
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, error: 'not_in_channel' }),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch;

    await assert.rejects(
      sendDpipReportsToXyne(
        '<html>sensitive report</html>',
        '<html>sensitive overview</html>',
        fakeFetch,
      ),
      /Xyne Spaces report upload failed: not_in_channel/,
    );

    assert.equal(errorLog.mock.callCount(), 1);
    const entry = JSON.parse(
      String(errorLog.mock.calls[0]?.arguments[0]),
    ) as Record<string, unknown>;
    assert.equal(entry.severity, 'ERROR');
    assert.equal(entry.event, 'dpip_report_upload_failed');
    assert.equal(entry.http_status, 403);
    assert.equal(entry.app_error, 'not_in_channel');
    assert.equal(entry.response_content_type, 'application/json');
    assert.equal(entry.response_is_json, true);
    assert.equal(typeof entry.response_bytes, 'number');
    assert.equal(typeof entry.duration_ms, 'number');
    assert.doesNotMatch(JSON.stringify(entry), /secret-test-jwt/);
    assert.doesNotMatch(JSON.stringify(entry), /sensitive report/);
  });

  it('logs Xyne network failures with the original error details', async () => {
    process.env.XYNE_SPACES_API_URL = 'https://spaces.example.test/';
    process.env.XYNE_SPACES_APP_JWT = 'secret-test-jwt';
    process.env.XYNE_SPACES_CHANNEL_ID = 'channel-1';

    const errorLog = mock.method(console, 'error', () => undefined);
    const fakeFetch = (async () => {
      const error = new TypeError('fetch failed');
      Object.assign(error, { code: 'ECONNREFUSED' });
      throw error;
    }) as typeof fetch;

    await assert.rejects(
      sendDpipReportsToXyne(
        '<html>sensitive report</html>',
        '<html>sensitive overview</html>',
        fakeFetch,
      ),
      /fetch failed/,
    );

    assert.equal(errorLog.mock.callCount(), 1);
    const entry = JSON.parse(
      String(errorLog.mock.calls[0]?.arguments[0]),
    ) as Record<string, unknown>;
    assert.equal(entry.severity, 'ERROR');
    assert.equal(entry.event, 'dpip_report_upload_request_failed');
    assert.equal(entry.error_type, 'TypeError');
    assert.equal(entry.error_message, 'fetch failed');
    assert.equal(entry.error_code, 'ECONNREFUSED');
    assert.equal(typeof entry.error_stack, 'string');
    assert.equal(typeof entry.duration_ms, 'number');
    assert.doesNotMatch(JSON.stringify(entry), /secret-test-jwt/);
    assert.doesNotMatch(JSON.stringify(entry), /sensitive report/);
  });
});
