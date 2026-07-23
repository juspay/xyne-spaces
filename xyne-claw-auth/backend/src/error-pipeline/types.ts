// Data model for the Grafana → Claw error auto-fix pipeline.
//
// Flow: Grafana (per-container, deduped) → POST /error-pipeline/ingest →
// classify (domain + bug/noise) → route into a per-domain bucket queue →
// ephemeral agent fixes → PR. See GRAFANA_CLAW_ERROR_PIPELINE.md.

/** One deduped error, as Grafana's webhook delivers it. */
export interface IncomingError {
  source: string;
  message: string;
  normMessage?: string;
  sampleRequestId?: string;
  count?: number;
  occurredAt?: number;
}

export type ClassifySignal = "rule" | "default";

export interface ClassifyResult {
  bucket: string;
  reason: string;
  signal: ClassifySignal;
}

/** A unit of work sitting in a bucket queue. */
export interface WorkItem {
  errorKey: string;
  error: IncomingError;
  classification: ClassifyResult;
  enqueuedAt: number;
}
