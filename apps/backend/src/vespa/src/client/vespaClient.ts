import { type ILogger } from '@xyne/vespa-ts';
import { Agent } from 'undici';
import pLimit from 'p-limit';
import { consoleLogger, getErrorMessage } from '../utils';
import { cleanDocumentFields } from '../../../utils/vespaTextValidation';
import type { InsertDocument, VespaSchema } from '../types';

type VespaConfigValues = {
  namespace: string;
  schema: VespaSchema;
  cluster?: string;
  userId?: string;
};

export interface BatchResult {
  docId: string;
  success: boolean;
  error?: string;
}

// Vespa's Document V1 API addresses a doc by URL path: /document/v1/<namespace>/<schema>/docid/<docId>.
// Every interpolated segment below is passed through encodeURIComponent so a value containing "/", "..",
// "?", "#" or "%" can't escape its slot and rewrite the request path (path injection into the feed endpoint).

class VespaClient {
  private maxRetries: number;
  private retryDelay: number;
  private feedTimeoutMs: number;
  private feedEndpoint: string;
  private queryEndpoint: string;
  private logger: ILogger;
  private feedDispatcher: Agent;
  private queryDispatcher: Agent;
  private concurrencyLimit: ReturnType<typeof pLimit>;

  constructor(
    logger?: ILogger,
    config?: {
      vespaMaxRetryAttempts?: number;
      vespaRetryDelay?: number;
      vespaBaseHost?: string;
      feedEndpoint?: string;
      queryEndpoint?: string;
      maxConnections?: number;
      maxConcurrentRequests?: number;
      feedTimeoutMs?: number;
    },
  ) {
    this.logger = logger || consoleLogger;
    this.maxRetries = config?.vespaMaxRetryAttempts || 3;
    this.retryDelay = config?.vespaRetryDelay || 1000;

    // 8083, not 8080: y-sweet owns 8080 and MESSAGE_CLASSIFIER_URL uses 8082 locally, so Vespa's feed port is
    // published on 8083 (see vespa-core/deployment/docker-compose.dev.yml).
    this.feedEndpoint = config?.feedEndpoint || `http://localhost:8083`;
    this.queryEndpoint = config?.queryEndpoint || `http://localhost:8081`;

    const maxConnections = config?.maxConnections || 16;
    const agentOptions = {
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      pipelining: 1,
      connections: maxConnections,
    };
    this.feedDispatcher = new Agent(agentOptions);
    this.queryDispatcher = new Agent(agentOptions);

    // Per-request timeout applied ONLY to document inserts (see `insert`), so a slow
    // Vespa feed — e.g. embedding at index time via the tei-batch-proxy — fails
    // predictably instead of hanging on undici's defaults. Other feed ops
    // (update/delete) and queries are unaffected. Tunable via VESPA_FEED_TIMEOUT_MS;
    // keep it >= the gateway timeout in front of Vespa so the gateway decides first.
    this.feedTimeoutMs =
      config?.feedTimeoutMs ?? (Number(process.env.VESPA_FEED_TIMEOUT_MS) || 180_000);

    this.concurrencyLimit = pLimit(config?.maxConcurrentRequests || 10);

    this.logger.info(`[VESPA CLIENT] Initialized - feedEndpoint: ${this.feedEndpoint}, queryEndpoint: ${this.queryEndpoint}, maxConnections: ${maxConnections}, maxConcurrentRequests: ${config?.maxConcurrentRequests || 10}, feedTimeoutMs: ${this.feedTimeoutMs}`);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retryCount = 0,
    timeoutMs?: number,
  ): Promise<Response> {
    const nonRetryableStatusCodes = [404];
    const dispatcher = url.startsWith(this.queryEndpoint)
      ? this.queryDispatcher
      : this.feedDispatcher;
    // Opt-in per-attempt timeout (used by `insert`): a fresh abort signal each attempt
    // so retries get the full budget. Callers that pass no timeoutMs are untouched.
    if (timeoutMs) {
      options = { ...options, signal: AbortSignal.timeout(timeoutMs) };
    }
    this.logger.info('timeout for vespa insertion',{timeoutMs});
    try {
      const response = await fetch(url, { ...options, dispatcher } as any);
      if (!response.ok) {
        // Don't need to retry for non-retryable status codes
        if (nonRetryableStatusCodes.includes(response.status)) {
          throw new Error(`Non-retryable error: ${response.status} ${response.statusText}`);
        }

        // Retry for 429 (Too Many Requests) or 5xx errors
        if ((response.status === 429 || response.status >= 500) && retryCount < this.maxRetries) {
          this.logger.info('retrying due to status: ', response.status);
          await this.delay(this.retryDelay * Math.pow(2, retryCount));
          return this.fetchWithRetry(url, options, retryCount + 1, timeoutMs);
        }
      }

      return response;
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      if (retryCount < this.maxRetries && !errorMessage.includes('Non-retryable error')) {
        await this.delay(this.retryDelay * Math.pow(2, retryCount)); // Exponential backoff
        return this.fetchWithRetry(url, options, retryCount + 1, timeoutMs);
      }
      throw error;
    }
  }

  async search<T>(payload: any): Promise<T> {
    const url = `${this.queryEndpoint}/search/`;

    try {
      const response = await this.fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Disable response compression: undici's custom Agent dispatcher we
          // configure above doesn't auto-decompress gzip, and Vespa otherwise
          // gzips any response above its threshold (hit by within-doc searches
          // that include chunks_summary + full matchfeatures). Without this,
          // response.json() chokes on raw 1f 8b... gzip bytes.
          'Accept-Encoding': 'identity',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = response.statusText;
        const errorBody = await response.text();
        this.logger.error(
          `Vespa search failed - Status: ${response.status}, StatusText: ${errorText}`,
        );
        this.logger.error(`Vespa error body: ${errorBody}`);
        throw new Error(`Failed to search: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result as T;
    } catch (error: any) {
      this.logger.error(`VespaClient.search error: ${error.message}`, error);
      throw new Error(`Vespa search error: ${error.message}`);
    }
  }

  async insert(document: InsertDocument, options: VespaConfigValues): Promise<void> {
    try {
      // Clean document fields to remove Unicode replacement characters before insertion
      const cleanedDocument = cleanDocumentFields(document);

      const url = `${this.feedEndpoint}/document/v1/${encodeURIComponent(options.namespace)}/${encodeURIComponent(options.schema)}/docid/${encodeURIComponent(document.docId)}`;
      const response = await this.fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: cleanedDocument }),
      }, 0, this.feedTimeoutMs);

      if (!response.ok) {
        const errorText = response.statusText;
        const errorBody = await response.text();
        this.logger.error(`Vespa error: ${errorBody}`);
        throw new Error(`Failed to insert document: ${response.status} ${errorText}`);
      }

      this.logger.info(`Document ${document.docId} inserted successfully`);
    } catch (error) {
      const errMessage = getErrorMessage(error);
      this.logger.error(`Error inserting document ${document.docId}: ${errMessage}`, error);


      throw new Error(`Error inserting document ${document.docId}: ${errMessage}`);
    }
  }

  async getDocument(options: VespaConfigValues & { docId: string }): Promise<any> {
    const { docId, namespace, schema } = options;
    const url = `${this.feedEndpoint}/document/v1/${encodeURIComponent(namespace)}/${encodeURIComponent(schema)}/docid/${encodeURIComponent(docId)}`;
    try {
      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          // Same reason as VespaClient.search() — our custom undici Agent
          // dispatcher doesn't auto-decompress, and the document API gzips
          // KB docs (full chunks array is large). 'identity' tells Vespa
          // to skip compression so response.json() can parse it.
          'Accept-Encoding': 'identity',
        },
      });
      if (!response.ok) {
        const errorText = response.statusText;
        const errorBody = await response.text();
        throw new Error(`Failed to fetch document: ${response.status} ${errorText} - ${errorBody}`);
      }

      const document = await response.json();
      return document;
    } catch (error) {
      const errMessage = getErrorMessage(error);
      if (errMessage.startsWith('Non-retryable error: 404')) {
        return null;
      }
      throw new Error(`Error fetching document docId: ${docId} - ${errMessage}`);
    }
  }

  async updateDocument(
    updatedFields: Record<string, any>,
    options: VespaConfigValues & { docId: string; create?: boolean },
  ): Promise<void> {
    const { docId, namespace, schema, create } = options;
    // create=true upserts: Vespa builds the doc from these assign ops when it
    // doesn't exist yet, instead of silently no-oping the partial update.
    const url = `${this.feedEndpoint}/document/v1/${encodeURIComponent(namespace)}/${encodeURIComponent(schema)}/docid/${encodeURIComponent(docId)}${
      create ? '?create=true' : ''
    }`;

    try {
      // Clean updated fields to remove Unicode replacement characters
      const cleanedFields = cleanDocumentFields(updatedFields);

      const updateObject = Object.entries(cleanedFields).reduce(
        (prev, [key, value]) => {
          prev[key] = { assign: value };
          return prev;
        },
        {} as Record<string, any>,
      );

      const response = await this.fetchWithRetry(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: updateObject,
        }),
      });

      if (!response.ok) {
        const errorText = response.statusText;
        throw new Error(`Failed to update document: ${response.status} ${errorText}`);
      }

      this.logger.info(`Successfully updated document ${docId} in schema ${schema}`);
    } catch (error) {
      const errMessage = getErrorMessage(error);
      this.logger.error(
        `Error updating document ${docId} in schema ${schema}: ${errMessage}`,
        error,
      );
      throw new Error(`Error updating document ${docId}: ${errMessage}`);
    }
  }

  async deleteDocument(options: VespaConfigValues & { docId: string }): Promise<void> {
    const { docId, namespace, schema } = options;
    const url = `${this.feedEndpoint}/document/v1/${encodeURIComponent(namespace)}/${encodeURIComponent(schema)}/docid/${encodeURIComponent(docId)}`;

    try {
      const response = await this.fetchWithRetry(url, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = response.statusText;
        throw new Error(`Failed to delete document: ${response.status} ${errorText}`);
      }

      this.logger.info(`Document ${docId} deleted successfully.`);
    } catch (error) {
      const errMessage = getErrorMessage(error);
      this.logger.error(`Error deleting document ${docId}: ${errMessage}`, error);
      throw new Error(`Error deleting document ${docId}: ${errMessage}`);
    }
  }

  async feedBatch(
    documents: InsertDocument[],
    options: VespaConfigValues,
  ): Promise<BatchResult[]> {
    this.logger.info(`[BATCH FEED] Starting batch insert of ${documents.length} documents with concurrency limit`);
    const startTime = Date.now();

    const results = await Promise.allSettled(
      documents.map((doc) =>
        this.concurrencyLimit(() => this.insert(doc, options)),
      ),
    );

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    this.logger.info(`[BATCH FEED] Completed ${successCount}/${documents.length} documents in ${duration}ms`);

    return results.map((result, index) => {
      const docId = documents[index].docId;
      if (result.status === 'fulfilled') {
        return { docId, success: true };
      }
      this.logger.error(`Batch feed failed for ${docId}: ${result.reason}`);
      return { docId, success: false, error: getErrorMessage(result.reason) };
    });
  }

  async updateBatch(
    updates: { docId: string; fields: Record<string, any> }[],
    options: VespaConfigValues & { create?: boolean },
  ): Promise<BatchResult[]> {
    this.logger.info(`[BATCH UPDATE] Starting batch update of ${updates.length} documents with concurrency limit`);
    const startTime = Date.now();

    const results = await Promise.allSettled(
      updates.map((update) =>
        this.concurrencyLimit(() =>
          this.updateDocument(update.fields, { ...options, docId: update.docId }),
        ),
      ),
    );

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    this.logger.info(`[BATCH UPDATE] Completed ${successCount}/${updates.length} documents in ${duration}ms`);

    return results.map((result, index) => {
      const docId = updates[index].docId;
      if (result.status === 'fulfilled') {
        return { docId, success: true };
      }
      this.logger.error(`Batch update failed for ${docId}: ${result.reason}`);
      return { docId, success: false, error: getErrorMessage(result.reason) };
    });
  }

  async close(): Promise<void> {
    await Promise.all([
      this.feedDispatcher.close(),
      this.queryDispatcher.close(),
    ]);
    this.logger.info('VespaClient connections closed');
  }
}

export default VespaClient;
