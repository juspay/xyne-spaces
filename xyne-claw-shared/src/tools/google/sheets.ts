/**
 * Google Sheets API helpers — create spreadsheets, write values.
 * Requires scope: https://www.googleapis.com/auth/spreadsheets
 */

import { googleFetch } from "./oauth.js";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_SHEET_ROWS_PER_REQUEST = 500;
const MAX_SHEET_COLUMNS_PER_ROW = 100;
const MAX_SHEET_CELLS_PER_REQUEST = 20_000;

interface SpreadsheetResponse {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  properties?: { title?: string };
}

function validateSheetValues(values: string[][]): void {
  if (values.length === 0) throw new Error("values cannot be empty");
  if (values.length > MAX_SHEET_ROWS_PER_REQUEST) {
    throw new Error(`Too many rows. Max ${MAX_SHEET_ROWS_PER_REQUEST} rows per request.`);
  }
  let totalCells = 0;
  for (const row of values) {
    if (row.length > MAX_SHEET_COLUMNS_PER_ROW) {
      throw new Error(`Too many columns in a row. Max ${MAX_SHEET_COLUMNS_PER_ROW}.`);
    }
    totalCells += row.length;
  }
  if (totalCells > MAX_SHEET_CELLS_PER_REQUEST) {
    throw new Error(`Too many cells. Max ${MAX_SHEET_CELLS_PER_REQUEST} cells per request.`);
  }
}

/** Create a new Google Spreadsheet and optionally write initial rows. */
export async function createSpreadsheetWithValues(
  token: string,
  title: string,
  values?: string[][],
  range = "Sheet1!A1",
): Promise<string> {
  if (!title.trim()) throw new Error("Spreadsheet title cannot be empty");
  const created = (await googleFetch(BASE, token, {
    method: "POST",
    body: JSON.stringify({ properties: { title } }),
  })) as SpreadsheetResponse;

  const lines = [
    `Spreadsheet created: ${title}`,
    `Spreadsheet ID: ${created.spreadsheetId}`,
    `URL: ${created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`}`,
  ];

  if (values && values.length > 0) {
    await updateValues(token, created.spreadsheetId, range, values);
    lines.push(`Initialized ${values.length} row(s) at ${range}`);
  }

  return lines.join("\n");
}

/** Update values in a sheet range (overwrites). Range example: "Sheet1!A1". */
export async function updateValues(
  token: string,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<string> {
  if (!range.trim()) throw new Error("range is required");
  validateSheetValues(values);
  await googleFetch(
    `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    token,
    { method: "PUT", body: JSON.stringify({ values }) },
  );
  return `Updated ${values.length} row(s) in ${range}`;
}

/** Append rows after the last row in a sheet range. */
export async function appendValues(
  token: string,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<string> {
  if (!range.trim()) throw new Error("range is required");
  validateSheetValues(values);
  await googleFetch(
    `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { method: "POST", body: JSON.stringify({ values }) },
  );
  return `Appended ${values.length} row(s) to ${range}`;
}
