import Papa from 'papaparse';
import { MAX_ROWS } from '../spreadsheet/limits';

export interface CsvWorkerRequest {
  file: File;
  /** A tab for TSV; empty to let the parser guess. */
  delimiter: string;
}

export type CsvWorkerResponse =
  | { ok: true; rows: string[][]; truncated: boolean }
  | { ok: false; error: string };

/**
 * Reads and parses a CSV or TSV off the page's thread: a file of tens of megabytes
 * takes seconds to parse, and on the page those seconds would freeze it. Parsing stops
 * at MAX_ROWS, as a preview reads no further.
 */
self.onmessage = async (event: MessageEvent<CsvWorkerRequest>) => {
  // Only the page that made a dedicated worker can message it, and its messages carry
  // no origin: one that does came from elsewhere and is ignored.
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  try {
    const text = await event.data.file.text();
    const { data } = Papa.parse<string[]>(text, {
      delimiter: event.data.delimiter,
      skipEmptyLines: 'greedy',
      preview: MAX_ROWS + 1,
    });
    const response: CsvWorkerResponse = {
      ok: true,
      rows: data.slice(0, MAX_ROWS),
      truncated: data.length > MAX_ROWS,
    };
    self.postMessage(response);
  } catch (error) {
    const response: CsvWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : 'Unreadable file',
    };
    self.postMessage(response);
  }
};
