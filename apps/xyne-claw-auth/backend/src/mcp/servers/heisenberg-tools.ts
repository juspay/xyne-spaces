import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

// HEISENBERG_BASE_URL is set by adapters/heisenberg.ts from
// CONFIG.heisenbergBaseUrl when it spawns this server; the placeholder only
// surfaces when the deployment never configured the endpoint.
const DEFAULT_BASE_URL = "<heisenberg-url>";
const JSON_REQUEST_TIMEOUT_MS = 120_000;
const MAX_SQL_BYTES = 1024 * 1024;
const MAX_REQUEST_ID_LENGTH = 512;
const MAX_LOG_PATH_LENGTH = 4096;
const MAX_IDENTIFIER_LENGTH = 256;

const FORBIDDEN_SQL_KEYWORDS = /\b(?:ALTER|ANALYZE|ATTACH|CALL|COPY|CREATE|DELETE|DETACH|DO|DROP|EXPORT|GRANT|IMPORT|INSERT|INSTALL|INTO|LOAD|LOCK|MERGE|PRAGMA|REVOKE|SET|TRANSACTION|TRUNCATE|UPDATE|USE|VACUUM)\b/i;
const UNSAFE_SQL_FUNCTIONS = /\b(?:(?:READ|SCAN|SQLITE|POSTGRES|MYSQL|DUCKDB|ICEBERG|DELTA)_[A-Z0-9_$]*|HTTP[A-Z0-9_$]*|GLOB|NEXTVAL|PARQUET_SCAN|QUERY|QUERY_TABLE|SETVAL)\s*\(/i;

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

export interface HeisenbergTool extends Tool {
  handler: ToolHandler;
}

type SanitizedLogRecord = {
  _id: string;
  hb: {
    request_id: string;
    file_path: string;
  };
  value?: {
    schemaName?: string;
    tableName?: string;
  };
};

function baseUrl(): string {
  return (process.env["HEISENBERG_BASE_URL"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function textResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

async function requestText(
  path: string,
  init: RequestInit = {},
): Promise<CallToolResult> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(JSON_REQUEST_TIMEOUT_MS),
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    return textResult(`Heisenberg API HTTP ${response.status}: ${formatBody(body).slice(0, 4_000)}`, true);
  }
  return textResult(formatBody(body));
}

function requiredString(args: Record<string, unknown>, name: string): string | null {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalIdentifier(value: unknown, name: string): { value?: string; error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string" || !value.trim()) {
    return { error: `log_record.value.${name} must be a non-empty string when provided.` };
  }
  const normalized = value.trim();
  if (normalized.length > MAX_IDENTIFIER_LENGTH) {
    return { error: `log_record.value.${name} exceeds ${MAX_IDENTIFIER_LENGTH} characters.` };
  }
  return { value: normalized };
}

function sanitizeLogRecord(
  value: unknown,
  requestId: string,
): { record: SanitizedLogRecord } | { error: string } {
  const record = objectRecord(value);
  if (!record) return { error: "log_record must be an object from heisenberg_search_logs." };

  const searchHitId = typeof record["_id"] === "string" ? record["_id"].trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(searchHitId)) {
    return { error: "log_record._id must be the 64-character hexadecimal ID returned by heisenberg_search_logs." };
  }

  const hb = objectRecord(record["hb"]);
  if (!hb) return { error: "log_record.hb is required." };

  const hitRequestId = typeof hb["request_id"] === "string" ? hb["request_id"].trim() : "";
  if (!hitRequestId || hitRequestId.length > MAX_REQUEST_ID_LENGTH) {
    return { error: "log_record.hb.request_id must be a valid Heisenberg request ID." };
  }
  if (hitRequestId !== requestId) {
    return { error: "log_record.hb.request_id must match the requested Heisenberg run ID." };
  }

  const filePath = typeof hb["file_path"] === "string" ? hb["file_path"].trim() : "";
  if (!filePath || filePath.length > MAX_LOG_PATH_LENGTH || filePath.includes("\0")) {
    return { error: "log_record.hb.file_path must be a valid indexed log path." };
  }
  if (!/\.app\.log$/i.test(filePath.replace(/\\/g, "/"))) {
    return { error: "log_record.hb.file_path must identify a Newton .app.log source." };
  }

  const sanitized: SanitizedLogRecord = {
    _id: searchHitId,
    hb: {
      request_id: hitRequestId,
      file_path: filePath,
    },
  };

  if (record["value"] !== undefined && record["value"] !== null) {
    const hitValue = objectRecord(record["value"]);
    if (!hitValue) return { error: "log_record.value must be an object when provided." };
    const schemaName = optionalIdentifier(hitValue["schemaName"], "schemaName");
    if (schemaName.error) return { error: schemaName.error };
    const tableName = optionalIdentifier(hitValue["tableName"], "tableName");
    if (tableName.error) return { error: tableName.error };
    if (schemaName.value || tableName.value) {
      sanitized.value = {
        ...(schemaName.value ? { schemaName: schemaName.value } : {}),
        ...(tableName.value ? { tableName: tableName.value } : {}),
      };
    }
  }

  return { record: sanitized };
}

/**
 * Remove quoted values, quoted identifiers, and comments while preserving the
 * remaining SQL shape. This boundary check is deliberately conservative; the
 * Heisenberg service still performs authoritative parser-based validation.
 */
function executableSql(sql: string): { value?: string; error?: string } {
  const chars = sql.split("");
  const visible = sql.split("");
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) visible[index] = " ";
  };

  for (let index = 0; index < chars.length;) {
    const char = chars[index];
    const next = chars[index + 1];

    if (char === "'" || char === '"') {
      const quote = char;
      const start = index++;
      let closed = false;
      while (index < chars.length) {
        if (chars[index] === quote) {
          if (chars[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) return { error: "SQL contains an unterminated quoted value or identifier." };
      blank(start, index);
      continue;
    }

    if (char === "-" && next === "-") {
      const start = index;
      index += 2;
      while (index < chars.length && chars[index] !== "\n" && chars[index] !== "\r") index += 1;
      blank(start, index);
      continue;
    }

    if (char === "/" && next === "*") {
      const start = index;
      index += 2;
      let depth = 1;
      while (index < chars.length && depth > 0) {
        if (chars[index] === "/" && chars[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (chars[index] === "*" && chars[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) return { error: "SQL contains an unterminated block comment." };
      blank(start, index);
      continue;
    }

    if (char === "$") {
      const remainder = sql.slice(index);
      const tag = remainder.match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const start = index;
        index += tag.length;
        const closingIndex = sql.indexOf(tag, index);
        if (closingIndex < 0) return { error: "SQL contains an unterminated dollar-quoted value." };
        index = closingIndex + tag.length;
        blank(start, index);
        continue;
      }
    }

    index += 1;
  }

  return { value: visible.join("") };
}

function validateReadOnlySql(sql: string): string | null {
  if (Buffer.byteLength(sql, "utf8") > MAX_SQL_BYTES) {
    return `SQL exceeds the ${MAX_SQL_BYTES}-byte limit.`;
  }

  const executable = executableSql(sql);
  if (executable.error) return executable.error;

  let statement = executable.value?.trim() ?? "";
  if (!statement) return "SQL must contain a query.";
  if (statement.endsWith(";")) statement = statement.slice(0, -1).trimEnd();
  if (statement.includes(";")) return "Exactly one SQL statement is allowed.";
  if (!/^(?:SELECT|WITH)\b/i.test(statement)) {
    return "Only read-only SELECT or WITH queries are allowed.";
  }
  if (FORBIDDEN_SQL_KEYWORDS.test(statement)) {
    return "Write, DDL, administrative, and transaction operations are not allowed.";
  }
  if (UNSAFE_SQL_FUNCTIONS.test(statement)) {
    return "External-access and state-changing SQL functions are not allowed.";
  }
  return null;
}

function queryPath(path: string, args: Record<string, unknown>, keys: readonly string[]): string {
  const url = new URL(path, "https://heisenberg.invalid");
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

function startPipelineBody(args: Record<string, unknown>): Record<string, unknown> {
  const mappings: ReadonlyArray<readonly [string, string]> = [
    ["pull_request", "pull-request"],
    ["repo_name", "repo-name"],
    ["newton_hs", "newton-hs"],
    ["newton_hs_pull_request", "newton-hs-pull-request"],
    ["npci_mocking", "npci-mocking"],
    ["passetto_hs", "passetto-hs"],
    ["test_suite", "test-suite"],
    ["turing", "turing"],
    ["common_mocker", "common-mocker"],
    ["newton_coverage", "newton-coverage"],
    ["override_recording", "override-recording"],
    ["apis_covered", "apis-covered"],
  ];
  const body: Record<string, unknown> = {};
  for (const [inputName, apiName] of mappings) {
    const value = args[inputName];
    if (value !== undefined && value !== null && value !== "") body[apiName] = value;
  }
  return body;
}

const requestIdInputSchema = {
  type: "string",
  minLength: 1,
  description: "Full Heisenberg request ID.",
} as const;

const duckDbResolutionSchema = {
  type: "object",
  description: "Optional target resolution returned by compatibility checking or supplied to resolve an ambiguity.",
  properties: {
    source: { type: "string", description: "Newton service/source." },
    database_group: { type: "string", description: "Database group such as CONFIG, INFO, or TX." },
    shard_key_column: { type: "string" },
    shard_key_value: {
      description: "Shard-key value, or multiple values for a finite multi-shard query.",
      oneOf: [
        { type: ["string", "number", "boolean"] },
        { type: "array", items: { type: ["string", "number", "boolean"] } },
      ],
    },
    schema: { type: "string" },
    schemas: { type: "array", items: { type: "string" } },
    physical_database: { type: "string" },
    physical_databases: { type: "array", items: { type: "string" } },
    all_shards: { type: "boolean", description: "Query all captured shards when the compatibility response permits it." },
  },
  additionalProperties: false,
} as const;

const duckDbProperties = {
  id: requestIdInputSchema,
  sql: {
    type: "string",
    minLength: 1,
    description: "A read-only PostgreSQL SELECT query to validate or run against captured Parquet data.",
  },
  log_record: {
    type: "object",
    description:
      "Routing fields copied from one hit returned by heisenberg_search_logs for the same request ID.",
    properties: {
      _id: {
        type: "string",
        pattern: "^[a-fA-F0-9]{64}$",
        description: "The search-hit ID returned by heisenberg_search_logs.",
      },
      hb: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            minLength: 1,
            maxLength: MAX_REQUEST_ID_LENGTH,
            description: "Must match the id supplied to this DuckDB tool.",
          },
          file_path: {
            type: "string",
            minLength: 1,
            maxLength: MAX_LOG_PATH_LENGTH,
            pattern: "\\.[aA][pP][pP]\\.[lL][oO][gG]$",
            description: "Newton application log path returned by heisenberg_search_logs.",
          },
        },
        required: ["request_id", "file_path"],
        additionalProperties: false,
      },
      value: {
        type: "object",
        properties: {
          schemaName: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH },
          tableName: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH },
        },
        additionalProperties: false,
      },
    },
    required: ["_id", "hb"],
    additionalProperties: false,
  },
  resolution: duckDbResolutionSchema,
} as const;

const health: HeisenbergTool = {
  name: "heisenberg_health",
  description: "Check whether the Heisenberg pipeline API is healthy.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => requestText("/checks/health"),
};

const startPipeline: HeisenbergTool = {
  name: "heisenberg_start_pipeline",
  description:
    "Queue a Heisenberg pipeline for an explicit pull request. This creates a pipeline/Kubernetes job and requires user approval.",
  inputSchema: {
    type: "object",
    properties: {
      pull_request: { type: "integer", minimum: 1, description: "Pull request number to test." },
      repo_name: {
        type: "string",
        enum: ["newton-hs", "newton-hs-tools", "npci-mocking"],
        default: "newton-hs",
        description: "Repository containing the pull request.",
      },
      newton_hs: { type: "string", description: "Optional Newton build/commit override." },
      newton_hs_pull_request: { type: "integer", minimum: 1, description: "Newton PR to use for non-Newton repository runs." },
      npci_mocking: { type: "string", description: "Optional NPCI mocking build/commit override." },
      passetto_hs: { type: "string", description: "Optional Passetto build/commit override." },
      test_suite: { type: "string", description: "Optional test-suite commit override." },
      turing: { type: "string", description: "Optional credit-issuance/Turing commit override." },
      common_mocker: { type: "string", description: "Optional common-mocker commit override." },
      newton_coverage: { type: "boolean", default: false, description: "Calculate full Newton coverage." },
      override_recording: { type: "boolean", default: false, description: "Override ART recording mode." },
      apis_covered: {
        type: "array",
        items: { type: "string" },
        description: "APIs to exclude from coverage calculation because they are already covered.",
      },
    },
    required: ["pull_request"],
    additionalProperties: false,
  },
  handler: async (args) => {
    if (!Number.isInteger(args["pull_request"]) || Number(args["pull_request"]) < 1) {
      return textResult("pull_request must be a positive integer", true);
    }
    return requestText("/hb/start", {
      method: "POST",
      body: JSON.stringify(startPipelineBody(args)),
    });
  },
};

const getStatus: HeisenbergTool = {
  name: "heisenberg_get_status",
  description: "Get live or final status for a Heisenberg pipeline request ID.",
  inputSchema: {
    type: "object",
    properties: { id: requestIdInputSchema },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    if (!id) return textResult("id is required", true);
    return requestText("/hb/status", { method: "POST", body: JSON.stringify({ id }) });
  },
};

const getFailedTestcases: HeisenbergTool = {
  name: "heisenberg_get_failed_testcases",
  description: "Get failed testcase details for a Heisenberg pipeline request.",
  inputSchema: {
    type: "object",
    properties: { id: requestIdInputSchema },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    if (!id) return textResult("id is required", true);
    return requestText(`/hb/failed-testcases/${encodeURIComponent(id)}`);
  },
};

const getCoverage: HeisenbergTool = {
  name: "heisenberg_get_coverage",
  description: "Get code coverage for a Heisenberg pipeline request.",
  inputSchema: {
    type: "object",
    properties: {
      id: requestIdInputSchema,
      full_coverage: { type: "boolean", default: false, description: "Include full Newton codebase coverage when available." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    if (!id) return textResult("id is required", true);
    const suffix = args["full_coverage"] === true ? "?fullCoverage=true" : "";
    return requestText(`/hb/coverage/${encodeURIComponent(id)}${suffix}`);
  },
};

const getRecentRuns: HeisenbergTool = {
  name: "heisenberg_get_recent_runs",
  description: "List recent Heisenberg runs, or all runs for a specific pull request.",
  inputSchema: {
    type: "object",
    properties: {
      pr: { type: "integer", minimum: 1, description: "Optional pull request number." },
      repo_name: {
        type: "string",
        enum: ["newton-hs", "newton-hs-tools", "npci-mocking"],
        description: "Repository name used with pr.",
      },
    },
    additionalProperties: false,
  },
  handler: async (args) => requestText(queryPath("/hb/recent-runs", args, ["pr", "repo_name"])),
};

const getTestsuiteDetails: HeisenbergTool = {
  name: "heisenberg_get_testsuite_details",
  description: "List Heisenberg test-suite names, durations, and testcase counts.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => requestText("/hb/testsuite-details"),
};

const indexLogs: HeisenbergTool = {
  name: "heisenberg_index_logs",
  description:
    "Queue asynchronous Elasticsearch indexing for a completed Heisenberg log archive. This requires user approval.",
  inputSchema: {
    type: "object",
    properties: { id: requestIdInputSchema },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    if (!id) return textResult("id is required", true);
    return requestText(`/hb/logs/${encodeURIComponent(id)}?index=true`);
  },
};

const getLogIndexStatus: HeisenbergTool = {
  name: "heisenberg_get_log_index_status",
  description: "Get Elasticsearch indexing status for a completed Heisenberg log archive.",
  inputSchema: {
    type: "object",
    properties: { id: requestIdInputSchema },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    if (!id) return textResult("id is required", true);
    return requestText(`/hb/logs/${encodeURIComponent(id)}?index_status=true`);
  },
};

const searchLogs: HeisenbergTool = {
  name: "heisenberg_search_logs",
  description:
    "Search an indexed Heisenberg log archive with KQL. Use heisenberg_index_logs first and poll heisenberg_get_log_index_status until indexed.",
  inputSchema: {
    type: "object",
    properties: {
      id: requestIdInputSchema,
      search: { type: "string", description: "KQL search expression. An empty string lists matching request logs." },
      source: { type: "string", description: "Optional indexed log source filter." },
      size: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      cursor: { type: "string", description: "Pagination cursor returned by a previous search." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    if (!id) return textResult("id is required", true);
    const url = new URL(`/hb/logs/${encodeURIComponent(id)}`, "https://heisenberg.invalid");
    // Heisenberg distinguishes an omitted search action from an empty KQL query.
    url.searchParams.set("search", typeof args["search"] === "string" ? args["search"] : "");
    for (const key of ["source", "size", "cursor"] as const) {
      const value = args[key];
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return requestText(`${url.pathname}${url.search}`);
  },
};

const checkDuckDbCompatibility: HeisenbergTool = {
  name: "heisenberg_check_duckdb_compatibility",
  description:
    "Validate and resolve a read-only PostgreSQL query against database snapshots captured in a Heisenberg log archive, without executing it.",
  inputSchema: {
    type: "object",
    properties: duckDbProperties,
    required: ["id", "sql", "log_record"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    const sql = requiredString(args, "sql");
    if (!id) return textResult("id is required", true);
    if (!sql) return textResult("sql is required", true);
    const sqlError = validateReadOnlySql(sql);
    if (sqlError) return textResult(sqlError, true);
    const logRecord = sanitizeLogRecord(args["log_record"], id);
    if ("error" in logRecord) return textResult(logRecord.error, true);
    return requestText(`/hb/logs/${encodeURIComponent(id)}/duckdb/compatibility`, {
      method: "POST",
      body: JSON.stringify({
        sql,
        log_record: logRecord.record,
        ...(args["resolution"] ? { resolution: args["resolution"] } : {}),
      }),
    });
  },
};

const queryDuckDb: HeisenbergTool = {
  name: "heisenberg_query_logs_duckdb",
  description:
    "Run a compatibility-checked, read-only SQL query against Parquet snapshots captured in a Heisenberg log archive. Results are limited by Heisenberg.",
  inputSchema: {
    type: "object",
    properties: duckDbProperties,
    required: ["id", "sql", "log_record"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = requiredString(args, "id");
    const sql = requiredString(args, "sql");
    if (!id) return textResult("id is required", true);
    if (!sql) return textResult("sql is required", true);
    const sqlError = validateReadOnlySql(sql);
    if (sqlError) return textResult(sqlError, true);
    const logRecord = sanitizeLogRecord(args["log_record"], id);
    if ("error" in logRecord) return textResult(logRecord.error, true);
    return requestText(`/hb/logs/${encodeURIComponent(id)}/duckdb/query`, {
      method: "POST",
      body: JSON.stringify({
        sql,
        log_record: logRecord.record,
        ...(args["resolution"] ? { resolution: args["resolution"] } : {}),
      }),
    });
  },
};

export const HEISENBERG_TOOLS: readonly HeisenbergTool[] = [
  health,
  startPipeline,
  getStatus,
  getFailedTestcases,
  getCoverage,
  getRecentRuns,
  getTestsuiteDetails,
  indexLogs,
  getLogIndexStatus,
  searchLogs,
  checkDuckDbCompatibility,
  queryDuckDb,
];

export const HEISENBERG_TOOL_NAMES = HEISENBERG_TOOLS.map((tool) => tool.name);
