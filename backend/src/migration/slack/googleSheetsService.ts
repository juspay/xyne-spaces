/**
 * Google Sheets Service for Slack Migration
 *
 * Reads channel migration config from the Google Sheet and writes status back.
 *
 * Sheet columns (1-indexed in Sheets, 0-indexed here):
 *   A (0) : SlackChannelName        ← human-readable name for accountability
 *   B (1) : slackChannelId
 *   C (2) : XyneChanneld
 *   D (3) : From Date (dd-mm-yyyy or empty/"daily")
 *   E (4) : PostChannelNotification (true/false)
 *   F (5) : Status
 *   G (6) : Failure Reason
 */

import { google, sheets_v4 } from 'googleapis';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export interface SheetRow {
  rowIndex: number; // 1-based row index in the sheet (row 1 = header)
  slackChannelName: string; // human-readable channel name (col A)
  slackChannelId: string;
  xyneChannelId: string;
  fromDate: string; // raw value from sheet, e.g. "18-05-2026", "daily", ""
  postNotification: boolean;
  status: string;
  failureReason: string;
  isDaily: boolean; // true if fromDate is empty or "daily"
}

const SHEET_RANGE = 'Sheet1!A2:G'; // skip header row

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

  return google.sheets({ version: 'v4', auth: oauth2Client as any });
}

function getSpreadsheetId(): string {
  const id = process.env.MIGRATION_SHEET_ID || '1_lljpA7-FKUrrU6x9j7E3-HeTeRDXB_BxHToKSh6WLo';
  return id;
}

/**
 * Read all data rows from the migration sheet.
 * Returns rows that have at least a Slack channel ID.
 */
export async function readSheetRows(): Promise<SheetRow[]> {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SHEET_RANGE,
  });

  const values = response.data.values || [];
  const rows: SheetRow[] = [];

  values.forEach((row, index) => {
    const slackChannelName = (row[0] || '').toString().trim();
    const slackChannelId = (row[1] || '').toString().trim();
    if (!slackChannelId) return; // skip empty rows

    const xyneChannelId = (row[2] || '').toString().trim();
    const fromDateRaw = (row[3] || '').toString().trim();
    const postNotificationRaw = (row[4] || '').toString().trim().toLowerCase();
    const status = (row[5] || '').toString().trim();
    const failureReason = (row[6] || '').toString().trim();

    const isDaily =
      !fromDateRaw || fromDateRaw.toLowerCase() === 'daily';

    rows.push({
      rowIndex: index + 2, // +2 because index is 0-based and we skip the header row
      slackChannelName,
      slackChannelId,
      xyneChannelId,
      fromDate: fromDateRaw,
      postNotification: postNotificationRaw === 'true',
      status,
      failureReason,
      isDaily,
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

  // Columns F and G (Status and Failure Reason)
  const range = `Sheet1!F${rowIndex}:G${rowIndex}`;

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
