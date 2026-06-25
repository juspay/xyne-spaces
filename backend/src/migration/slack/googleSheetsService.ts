/**
 * Google Sheets Service for Slack Migration
 *
 * Reads channel migration config from the Google Sheet and writes status back.
 *
 * Sheet columns (1-indexed in Sheets, 0-indexed here):
 *   A (0) : SlackChannelName        ← human-readable name for accountability
 *   B (1) : slackChannelId
 *   C (2) : XyneChannelId
 *   D (3) : projectId               ← for auto-creating channel when XyneChannelId is empty
 *   E (4) : From Date (dd-mm-yyyy, yyyy-mm-dd, or empty/"daily")
 *   F (5) : PostChannelNotification (true/false)
 *   G (6) : Status
 *   H (7) : Failure Reason
 *   I (8) : lastSyncedDate (YYYY-MM-DD) ← updated after each successful batch;
 *           used to resume from the correct point after a pod restart
 */

import * as https from 'https';
import { google, sheets_v4 } from 'googleapis';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export interface SheetRow {
  rowIndex: number; // 1-based row index in the sheet (row 1 = header)
  slackChannelName: string; // human-readable channel name (col A)
  slackChannelId: string;
  xyneChannelId: string;
  projectId: string; // project ID for auto-creating channel when XyneChannelId is empty (col D)
  fromDate: string; // raw value from sheet, e.g. "18-05-2026", "2026-05-18", "daily", ""
  postNotification: boolean;
  status: string;
  failureReason: string;
  isDaily: boolean; // true if fromDate is empty or "daily"
  lastSyncedDate: string; // YYYY-MM-DD of the last successfully completed batch (col I), empty if never run
}

const SHEET_RANGE = 'Sheet1!A2:I'; // skip header row

/**
 * Build an authenticated Sheets client using the existing OAuth2 credentials
 * already configured in the environment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 * plus a dedicated refresh token for Sheets scope.
 *
 * One-time setup to get MIGRATION_SHEETS_REFRESH_TOKEN:
 *   1. Go to Google OAuth Playground: https://developers.google.com/oauthplayground
 *   2. In settings (⚙️) check "Use your own OAuth credentials" and fill in your
 *      GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
 *   3. Authorise scope: https://www.googleapis.com/auth/spreadsheets
 *   4. Exchange auth code for tokens → copy the "Refresh token" value.
 *   5. Set MIGRATION_SHEETS_REFRESH_TOKEN=<that value> in your env.
 */
// A plain HTTPS agent that connects DIRECTLY to Google (Node agents ignore
// HTTPS_PROXY). Supplying our own agent makes gaxios skip its proxy branch
// (gaxios honours opts.agent over HTTPS_PROXY), so both the OAuth token refresh
// and the Sheets API calls bypass the egress proxy that was prematurely closing
// connections to oauth2.googleapis.com. keepAlive:false avoids reusing stale sockets.
const directAgent = new https.Agent({ keepAlive: false });

function getSheets(): sheets_v4.Sheets {
  // Use shared Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET via config.email)
  const clientId = config.email.clientId;
  const clientSecret = config.email.clientSecret;
  const refreshToken = process.env.MIGRATION_SHEETS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      '[GoogleSheets] Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or MIGRATION_SHEETS_REFRESH_TOKEN',
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // Force the direct agent onto the OAuth2 client's transporter. Both the token
  // refresh and every Sheets request go through this transporter, and gaxios
  // merges `defaults` into each request — so this bypasses the egress proxy.
  const transporter = (oauth2Client as any).transporter;
  if (transporter) {
    transporter.defaults = { ...(transporter.defaults || {}), agent: directAgent };
  }

  return google.sheets({ version: 'v4', auth: oauth2Client as any });
}

function getSpreadsheetId(): string {
  const id = process.env.MIGRATION_SHEET_ID || '1_lljpA7-FKUrrU6x9j7E3-HeTeRDXB_BxHToKSh6WLo';
  return id;
}

// Transient network errors when talking to Google (token refresh or the Sheets
// API) — these are safe to retry. They surface as Node stream/socket errors,
// not as auth failures like `invalid_grant`.
const TRANSIENT_ERROR_CODES = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

/**
 * Run a Google API call with retries on transient network errors.
 * Non-transient errors (e.g. invalid credentials, bad request) are re-thrown
 * immediately so we don't mask real problems.
 */
async function withTransientRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (!TRANSIENT_ERROR_CODES.has(err?.code) || attempt === attempts) {
        throw err;
      }
      const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s, ...
      logger.warn(
        `[GoogleSheets] ${label} failed (attempt ${attempt}/${attempts}, ${err?.code}), retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Read all data rows from the migration sheet.
 * Returns rows that have at least a Slack channel ID.
 */
export async function readSheetRows(): Promise<SheetRow[]> {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();

  const response = await withTransientRetry('readSheetRows', () =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: SHEET_RANGE,
    }),
  );

  const values = response.data.values || [];
  const rows: SheetRow[] = [];

  values.forEach((row, index) => {
    const slackChannelName = (row[0] || '').toString().trim();
    const slackChannelId = (row[1] || '').toString().trim();
    if (!slackChannelId) return; // skip empty rows

    const xyneChannelId = (row[2] || '').toString().trim();
    const projectId = (row[3] || '').toString().trim();
    const fromDateRaw = (row[4] || '').toString().trim();
    const postNotificationRaw = (row[5] || '').toString().trim().toLowerCase();
    const status = (row[6] || '').toString().trim();
    const failureReason = (row[7] || '').toString().trim();
    const lastSyncedDate = (row[8] || '').toString().trim();

    const isDaily =
      !fromDateRaw || fromDateRaw.toLowerCase() === 'daily';

    rows.push({
      rowIndex: index + 2, // +2 because index is 0-based and we skip the header row
      slackChannelName,
      slackChannelId,
      xyneChannelId,
      projectId,
      fromDate: fromDateRaw,
      postNotification: postNotificationRaw === 'true',
      status,
      failureReason,
      isDaily,
      lastSyncedDate,
    });
  });

  logger.info(`[GoogleSheets] Read ${rows.length} channel rows from sheet`);
  return rows;
}

/**
 * Write status and failure reason back to a specific row.
 * @param rowIndex  1-based row index (same as SheetRow.rowIndex)
 * @param status    e.g. "Migrated", "Migrated (19-05-2026)", "Failed"
 * @param failureReason  error message or ""
 */
export async function updateSheetRowStatus(
  rowIndex: number,
  status: string,
  failureReason: string,
): Promise<void> {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();

  // Columns G and H (Status and Failure Reason)
  const range = `Sheet1!G${rowIndex}:H${rowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[status, failureReason]],
    },
  });

  logger.info(`[GoogleSheets] Updated row ${rowIndex}: status="${status}" reason="${failureReason}"`);
}

/**
 * Write the last successfully synced date to column H for a specific row.
 * Called after each successful processJob so restarts can resume from the correct point.
 * @param rowIndex     1-based row index (same as SheetRow.rowIndex)
 * @param isoDate      YYYY-MM-DD date of the batch that just completed
 */
export async function updateSheetLastSyncedDate(
  rowIndex: number,
  isoDate: string,
): Promise<void> {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();

  const range = `Sheet1!I${rowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[isoDate]],
    },
  });

  logger.info(`[GoogleSheets] Updated row ${rowIndex}: lastSyncedDate="${isoDate}"`);
}
