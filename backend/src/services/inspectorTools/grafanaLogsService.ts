import axios from 'axios';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const getGrafanaConfig = () => ({
  url: config.grafana.url,
  token: config.grafana.token,
  logsDatasourceId: config.grafana.logsDatasourceId,
});

// ---------------------------------------------------------------------------
// LogsQL escaping & validation
// ---------------------------------------------------------------------------

const SAFE_FIELD_NAME = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const LOGSQL_RAW_DISALLOWED = /[|;]/;
// Only allow event:in("name1","name2",...) pattern for raw logsql filters
const LOGSQL_EVENT_IN_PATTERN = /^event:in\((?:"[a-zA-Z_][a-zA-Z0-9_]*"(?:,"[a-zA-Z_][a-zA-Z0-9_]*")*)\)$/;

function escapeLogsql(value: string): string {
  value = value.replace(/[\x00-\x1f\x7f]/g, '');
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function validateFieldName(name: string): string {
  if (!SAFE_FIELD_NAME.test(name)) {
    throw new Error(`Invalid LogsQL field name: "${name}"`);
  }
  return name;
}

function validateRawLogsql(value: string): string {
  const trimmed = value.trim();
  if (LOGSQL_RAW_DISALLOWED.test(trimmed)) {
    throw new Error("raw logsql_filters must not contain '|' or ';' characters");
  }
  if (!LOGSQL_EVENT_IN_PATTERN.test(trimmed)) {
    throw new Error('logsql_filters must match event:in("event1","event2",...) pattern');
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// LogsQL query builder
// ---------------------------------------------------------------------------

const FIELD_FILTER_TEMPLATES: Record<string, string> = {
  level: 'level:="{value}"',
  container: 'container:"{value}"',
  namespace: 'namespace:"{value}"',
  pod: 'pod:"{value}"',
  event: 'event:"{value}"',
  message: 'message:"{value}"',
  sessionId: 'sessionId:"{value}"',
  requestId: 'requestId:"{value}"',
  platformName: 'platformName:="{value}"',
};

export interface LogQueryParams {
  email?: string;
  level?: string;
  container?: string;
  namespace?: string;
  pod?: string;
  event?: string;
  message?: string;
  sessionId?: string;
  requestId?: string;
  platformName?: string;
  keyword?: string;
  excludeFilters?: Record<string, string>;
  logsqlFilters?: string;
  limit: number;
  offset: number;
}

function buildLogsqlQuery(params: LogQueryParams): string {
  const parts: string[] = [];

  if (params.email) {
    parts.push(`"${escapeLogsql(params.email)}"`);
  }

  const structuredParams: Record<string, string | undefined> = {
    level: params.level,
    container: params.container,
    namespace: params.namespace,
    pod: params.pod,
    event: params.event,
    message: params.message,
    sessionId: params.sessionId,
    requestId: params.requestId,
    platformName: params.platformName,
  };

  for (const [fieldName, fieldValue] of Object.entries(structuredParams)) {
    if (fieldValue) {
      const escaped = escapeLogsql(fieldValue);
      const template = FIELD_FILTER_TEMPLATES[fieldName];
      parts.push(template.replace('{value}', escaped));
    }
  }

  if (params.keyword) {
    parts.push(`"${escapeLogsql(params.keyword)}"`);
  }

  if (params.excludeFilters) {
    for (const [fieldName, fieldValue] of Object.entries(params.excludeFilters)) {
      const safeField = validateFieldName(fieldName);
      const escapedValue = escapeLogsql(fieldValue);
      parts.push(`${safeField}:!="${escapedValue}"`);
    }
  }

  if (params.logsqlFilters) {
    parts.push(validateRawLogsql(params.logsqlFilters));
  }

  let query = parts.length > 0 ? parts.join(' AND ') : '*';
  query += ` | delete _msg, _stream, _stream_id | sort by (_time desc) limit ${params.limit}`;
  return query;
}

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

async function executeLogsqlQuery(start: string, end: string, query: string): Promise<string> {
  const grafanaConfig = getGrafanaConfig();

  if (!grafanaConfig.url) {
    throw new Error('GRAFANA_URL is not configured');
  }

  const dsId = grafanaConfig.logsDatasourceId;
  const endpoint = `${grafanaConfig.url}/api/datasources/proxy/${dsId}/select/logsql/query`;

  logger.debug(`[GrafanaLogs] Querying: endpoint=${endpoint}, start=${start}, end=${end}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (grafanaConfig.token) {
    headers['Authorization'] = `Bearer ${grafanaConfig.token}`;
  }

  const response = await axios.post(endpoint, new URLSearchParams({ query, start, end }), {
    headers,
    timeout: 60000,
  });

  if (typeof response.data === 'string') {
    return response.data;
  }
  return JSON.stringify(response.data, null, 2);
}

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

const EXTRACT_FIELDS = [
  'level',
  '_time',
  'message',
  'event',
  'container',
  'email',
  'emailId',
  'requestId',
  'sessionId',
];
const STACK_TRACE_RE = /^\s+at\s|^Traceback|^Caused by:|^\s+File\s|^\s+raise\s/;

export interface LogEntry {
  [key: string]: unknown;
}

export interface LogSummary {
  summary: {
    total_entries: number;
    severity_counts: Record<string, number>;
    unique_error_patterns: number;
  };
  error_patterns: Array<{
    pattern: string;
    count: number;
    first_seen: string | null;
    last_seen: string | null;
    sample_log: Record<string, unknown>;
  }>;
  extracted_ids: {
    request_ids: string[];
    session_ids: string[];
  };
  stack_traces: string[];
  raw_logs: Array<Record<string, unknown>>;
}

function parseAndStructureLogs(rawText: string): LogSummary {
  const lines = rawText.trim() ? rawText.trim().split('\n') : [];
  const parsedEntries: Array<Record<string, unknown>> = [];
  const severityCounter: Record<string, number> = {};
  const errorPatternMap: Record<string, Array<Record<string, unknown>>> = {};
  const requestIds = new Set<string>();
  const sessionIds = new Set<string>();
  const stackTraceLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (STACK_TRACE_RE.test(line)) {
      stackTraceLines.push(line);
      continue;
    }

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      if (line && !line.startsWith('{')) {
        stackTraceLines.push(line);
      }
      continue;
    }

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    parsedEntries.push(entry);

    const level = (entry.level as string) || 'UNKNOWN';
    const upperLevel = typeof level === 'string' ? level.toUpperCase() : 'UNKNOWN';
    severityCounter[upperLevel] = (severityCounter[upperLevel] || 0) + 1;

    for (const ridField of ['requestId', 'request_id']) {
      const rid = entry[ridField];
      if (rid && typeof rid === 'string') requestIds.add(rid);
    }
    for (const sidField of ['sessionId', 'session_id']) {
      const sid = entry[sidField];
      if (sid && typeof sid === 'string') sessionIds.add(sid);
    }

    const patternKey = (entry.message as string) || (entry.event as string) || '';
    if (typeof patternKey === 'string' && patternKey) {
      if (!errorPatternMap[patternKey]) errorPatternMap[patternKey] = [];
      errorPatternMap[patternKey].push(entry);
    }
  }

  const errorPatterns = Object.entries(errorPatternMap)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 20)
    .map(([pattern, entries]) => {
      const times = entries.map((e) => e._time as string).filter(Boolean);
      const sampleLog: Record<string, unknown> = {};
      for (const field of EXTRACT_FIELDS) {
        const val = entries[0][field];
        if (val !== undefined && val !== null) sampleLog[field] = val;
      }
      return {
        pattern: pattern.slice(0, 200),
        count: entries.length,
        first_seen: times.length > 0 ? times.sort()[0] : null,
        last_seen: times.length > 0 ? times.sort()[times.length - 1] : null,
        sample_log: sampleLog,
      };
    });

  // Return all parsed entries with full fields
  const uniqueEntries = parsedEntries;

  const uniqueErrorCount = errorPatterns.filter((p) =>
    ['ERROR', 'FATAL', 'CRITICAL'].includes(((p.sample_log.level as string) || '').toUpperCase())
  ).length;

  const stackTraces: string[] = [];
  if (stackTraceLines.length > 0) {
    let currentTrace: string[] = [];
    for (const stLine of stackTraceLines) {
      if (stLine.startsWith('Traceback') || stLine.startsWith('Caused by:')) {
        if (currentTrace.length > 0) {
          stackTraces.push(currentTrace.slice(0, 10).join('\n'));
        }
        currentTrace = [stLine];
      } else {
        currentTrace.push(stLine);
      }
    }
    if (currentTrace.length > 0) {
      stackTraces.push(currentTrace.slice(0, 10).join('\n'));
    }
    stackTraces.splice(5);
  }

  return {
    summary: {
      total_entries: parsedEntries.length,
      severity_counts: severityCounter,
      unique_error_patterns: uniqueErrorCount,
    },
    error_patterns: errorPatterns,
    extracted_ids: {
      request_ids: [...requestIds].sort().slice(0, 50),
      session_ids: [...sessionIds].sort().slice(0, 50),
    },
    stack_traces: stackTraces,
    raw_logs: uniqueEntries,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FetchLogsParams {
  startTime: string;
  endTime: string;
  email?: string;
  keyword?: string;
  level?: string;
  container?: string;
  namespace?: string;
  pod?: string;
  sessionId?: string;
  requestId?: string;
  logsqlFilters?: string;
  limit?: number;
  offset?: number;
}

export async function fetchLogs(params: FetchLogsParams): Promise<{
  status: string;
  generated_logsql: string;
  summary: LogSummary['summary'];
  error_patterns: LogSummary['error_patterns'];
  extracted_ids: LogSummary['extracted_ids'];
  stack_traces: LogSummary['stack_traces'];
  raw_logs: LogSummary['raw_logs'];
}> {
  const limit = params.limit ?? 250;
  const offset = params.offset ?? 0;

  const query = buildLogsqlQuery({
    email: params.email,
    keyword: params.keyword,
    level: params.level,
    container: params.container,
    namespace: params.namespace,
    pod: params.pod,
    sessionId: params.sessionId,
    requestId: params.requestId,
    logsqlFilters: params.logsqlFilters,
    limit,
    offset,
  });

  logger.info(`[GrafanaLogs] Generated LogsQL query, limit=${limit}, offset=${offset}`);

  const rawLogs = await executeLogsqlQuery(params.startTime, params.endTime, query);
  const structured = parseAndStructureLogs(rawLogs);

  return {
    status: 'success',
    generated_logsql: query,
    ...structured,
  };
}
