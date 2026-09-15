import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { BaseStrategy } from './BaseStrategy';
import type { ProcessingResult, StrategyConfig } from '../types';
import type {
  SpreadsheetParseWorkerInput,
  SpreadsheetParseWorkerMessage,
} from './spreadsheetParseWorker';

/**
 * Parses Excel workbooks (see spreadsheetParseWorker) inside a worker thread.
 * SheetJS parsing is synchronous, so a pathological workbook parsed on the main
 * thread blocks the event loop and stalls every queue in the ingestion process.
 *
 * If parsing does not finish within the timeout, the thread is killed and parse()
 * rejects; the mapper then indexes the file by metadata with empty chunks.
 */
export class SpreadsheetStrategy extends BaseStrategy {
  private chunkSize: number;

  constructor(config?: StrategyConfig) {
    super();
    this.chunkSize = Math.max(config?.chunkSize ?? DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE);
  }

  async parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
    const result = await parseInWorkerThread(buffer, this.chunkSize, vespaDocId);
    return { ...result, processingMethod: this.getName() };
  }

  getName(): string {
    return 'spreadsheet-xlsx';
  }
}

const DEFAULT_CHUNK_SIZE = 4_000;
const MIN_CHUNK_SIZE = 512;
const PARSE_TIMEOUT_MS = 60_000;

// Source runs under tsx (.ts) in dev and compiled (.js) in dist.
const PARSE_WORKER_PATH = fileURLToPath(
  new URL(
    import.meta.url.endsWith('.ts') ? './spreadsheetParseWorker.ts' : './spreadsheetParseWorker.js',
    import.meta.url
  )
);

function parseInWorkerThread(
  buffer: Buffer,
  chunkSize: number,
  vespaDocId: string
): Promise<ProcessingResult> {
  return new Promise((resolve, reject) => {
    const workerInput: SpreadsheetParseWorkerInput = { workbookBytes: buffer, chunkSize };
    const worker = new Worker(PARSE_WORKER_PATH, { workerData: workerInput });

    // Promise settles once; later reject/resolve calls from exit/terminate are no-ops.
    const timeout = setTimeout(() => {
      reject(
        new Error(`Spreadsheet parsing timed out after ${PARSE_TIMEOUT_MS}ms for ${vespaDocId}`)
      );
      void worker.terminate();
    }, PARSE_TIMEOUT_MS);

    worker.once('message', (message: SpreadsheetParseWorkerMessage) => {
      clearTimeout(timeout);
      if (message.status === 'success') {
        resolve(message.result);
      } else {
        reject(new Error(message.errorMessage));
      }
    });

    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Spreadsheet parse worker failed for ${vespaDocId}: ${error.message}`));
    });

    worker.once('exit', (exitCode) => {
      clearTimeout(timeout);
      reject(new Error(`Spreadsheet parse worker exited with code ${exitCode} for ${vespaDocId}`));
    });
  });
}
