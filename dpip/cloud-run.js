// src/index.ts
import { timingSafeEqual } from "node:crypto";
import { http } from "@google-cloud/functions-framework";

// src/database.ts
import { Pool } from "pg";

// src/schema.ts
var DPIP_TABLE_SPECS = {
  reports: {
    fields: {
      identifier_type: "text",
      reported_date: "date",
      party_id: "text",
      sub_source: "text",
      status: "text",
      metrics_type: "text",
      metrics_value: "bigint"
    },
    key: [
      "identifier_type",
      "reported_date",
      "party_id",
      "sub_source",
      "status",
      "metrics_type"
    ]
  },
  screenings: {
    fields: {
      screening_date: "date",
      party_id: "text",
      screening_status: "text",
      count: "bigint"
    },
    key: ["screening_date", "party_id", "screening_status"]
  },
  cluster_external_entities: {
    fields: {
      cluster_count: "bigint",
      num_external_entities: "bigint",
      last_updated_date: "date"
    },
    key: ["cluster_count", "num_external_entities", "last_updated_date"]
  },
  external_entity_identifiers: {
    fields: {
      party_id: "text",
      external_entity_count: "bigint",
      num_identifiers: "bigint",
      last_updated_date: "date"
    },
    key: [
      "party_id",
      "external_entity_count",
      "num_identifiers",
      "last_updated_date"
    ]
  },
  cluster_identifiers: {
    fields: {
      cluster_count: "bigint",
      num_identifiers: "bigint",
      last_updated_date: "date"
    },
    key: ["cluster_count", "num_identifiers", "last_updated_date"]
  },
  party_identifiers: {
    fields: {
      party_ids: "text",
      num_identifiers: "bigint",
      last_updated_date: "date"
    },
    key: ["party_ids", "num_identifiers", "last_updated_date"]
  }
};

// src/types.ts
var DPIP_TABLE_NAMES = [
  "reports",
  "screenings",
  "cluster_external_entities",
  "external_entity_identifiers",
  "cluster_identifiers",
  "party_identifiers"
];

// src/database.ts
var BATCH_SIZE = 500;
var pool;
function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (value === void 0 || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
function getPool() {
  if (pool !== void 0) {
    return pool;
  }
  const instanceConnectionName = requiredEnvironmentVariable(
    "INSTANCE_CONNECTION_NAME"
  );
  const host = process.env.DB_HOST ?? `/cloudsql/${instanceConnectionName}`;
  pool = new Pool({
    host,
    port: Number(process.env.DB_PORT ?? "5432"),
    database: requiredEnvironmentVariable("DB_NAME"),
    user: requiredEnvironmentVariable("DB_USER"),
    password: requiredEnvironmentVariable("DB_PASSWORD"),
    max: 2,
    idleTimeoutMillis: 3e4,
    connectionTimeoutMillis: 1e4,
    application_name: "dpip-daily-ingestion"
  });
  pool.on("error", () => {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        event: "dpip_database_pool_error"
      })
    );
  });
  return pool;
}
function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
function valuesClause(rows, fields) {
  const values = [];
  const groups = rows.map((row) => {
    const placeholders = fields.map((field) => {
      const value = row[field];
      if (value === void 0) {
        throw new Error(`Missing database field: ${field}`);
      }
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return { sql: groups.join(", "), values };
}
async function writeReports(client, rows) {
  const stats = { inserted: 0, updated: 0, conflicts: 0 };
  const fields = Object.keys(DPIP_TABLE_SPECS.reports.fields);
  for (const batch of chunks(rows, BATCH_SIZE)) {
    const values = valuesClause(batch, fields);
    const result = await client.query(
      `
        INSERT INTO dpip.reports (
          identifier_type,
          reported_date,
          party_id,
          sub_source,
          status,
          metrics_type,
          metrics_value
        )
        VALUES ${values.sql}
        ON CONFLICT (
          identifier_type,
          reported_date,
          party_id,
          sub_source,
          status,
          metrics_type
        )
        DO UPDATE SET
          metrics_value = EXCLUDED.metrics_value
        RETURNING (xmax = 0) AS inserted
      `,
      values.values
    );
    for (const row of result.rows) {
      if (row.inserted) {
        stats.inserted += 1;
      } else {
        stats.updated += 1;
      }
    }
  }
  return stats;
}
async function writeScreenings(client, rows) {
  const stats = { inserted: 0, updated: 0, conflicts: 0 };
  const fields = Object.keys(DPIP_TABLE_SPECS.screenings.fields);
  for (const batch of chunks(rows, BATCH_SIZE)) {
    const values = valuesClause(batch, fields);
    const result = await client.query(
      `
        INSERT INTO dpip.screenings (
          screening_date,
          party_id,
          screening_status,
          count
        )
        VALUES ${values.sql}
        ON CONFLICT (
          screening_date,
          party_id,
          screening_status
        )
        DO UPDATE SET
          count = EXCLUDED.count
        RETURNING (xmax = 0) AS inserted
      `,
      values.values
    );
    for (const row of result.rows) {
      if (row.inserted) {
        stats.inserted += 1;
      } else {
        stats.updated += 1;
      }
    }
  }
  return stats;
}
async function writeHistoryTable(client, table, rows) {
  const stats = { inserted: 0, updated: 0, conflicts: 0 };
  const fields = Object.keys(DPIP_TABLE_SPECS[table].fields);
  for (const batch of chunks(rows, BATCH_SIZE)) {
    const values = valuesClause(batch, fields);
    const result = await client.query(
      `
        INSERT INTO dpip.${table} (${fields.join(", ")})
        VALUES ${values.sql}
        ON CONFLICT DO NOTHING
        RETURNING 1
      `,
      values.values
    );
    stats.inserted += result.rowCount ?? 0;
    stats.conflicts += batch.length - (result.rowCount ?? 0);
  }
  return stats;
}
async function writeDpipTables(tables) {
  const client = await getPool().connect();
  const stats = {};
  try {
    await client.query("BEGIN");
    for (const table of DPIP_TABLE_NAMES) {
      if (table === "reports") {
        stats[table] = await writeReports(client, tables[table]);
      } else if (table === "screenings") {
        stats[table] = await writeScreenings(client, tables[table]);
      } else {
        stats[table] = await writeHistoryTable(
          client,
          table,
          tables[table]
        );
      }
    }
    await client.query("COMMIT");
    return stats;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          event: "dpip_database_rollback_failed"
        })
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

// src/parser.ts
var TABLE_NAME_SET = new Set(DPIP_TABLE_NAMES);
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var NON_NEGATIVE_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
var REPORT_METRIC_TYPES = /* @__PURE__ */ new Set([
  "reports_count",
  "identifiers_count",
  "external_entities_count",
  "clusters_count"
]);
var DEEP_DISCOVERY_FOOTER_PATTERN = /^[ \t]*=+[ \t]*(?:\r?\n[\s\S]*|$)/m;
var DpipPayloadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DpipPayloadError";
  }
};
function emptyTables() {
  const tables = {};
  for (const table of DPIP_TABLE_NAMES) {
    tables[table] = [];
  }
  return tables;
}
function emptyParseStats() {
  const stats = {};
  for (const table of DPIP_TABLE_NAMES) {
    stats[table] = { received: 0, duplicates: 0, invalid: 0 };
  }
  return stats;
}
function decodeHtmlEntities(value) {
  return value.replace(/&#x([0-9a-f]+);/gi, (entity, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    return Number.isInteger(codePoint) && codePoint <= 1114111 ? String.fromCodePoint(codePoint) : entity;
  }).replace(/&#(\d+);/g, (entity, decimal) => {
    const codePoint = Number.parseInt(decimal, 10);
    return Number.isInteger(codePoint) && codePoint <= 1114111 ? String.fromCodePoint(codePoint) : entity;
  }).replace(/&nbsp;/gi, "\xA0").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
}
function htmlEmailToText(value) {
  return decodeHtmlEntities(
    value.replace(/<!--[\s\S]*?-->/g, "").replace(
      /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      ""
    ).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n").replace(/<[^>]+>/g, "")
  ).replace(/\u00a0/g, " ");
}
function stripKnownEmailFooters(value) {
  return value.replace(DEEP_DISCOVERY_FOOTER_PATTERN, "").trim();
}
function normalizeInput(input) {
  if (typeof input !== "string") {
    return input;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new DpipPayloadError("Request body is empty");
  }
  const candidates = [
    stripKnownEmailFooters(trimmed.replace(/<br\s*\/?>/gi, "\n"))
  ];
  if (/<\/?[a-z][^>]*>|&(?:nbsp|quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/i.test(trimmed)) {
    candidates.push(stripKnownEmailFooters(htmlEmailToText(trimmed)));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
    }
  }
  throw new DpipPayloadError("Invalid JSON");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseTableName(value) {
  if (typeof value !== "string" || !TABLE_NAME_SET.has(value)) {
    throw new DpipPayloadError(
      typeof value === "string" ? `Unknown table: ${value}` : "Table name must be a string"
    );
  }
  return value;
}
function validateHeaders(table, value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DpipPayloadError(`Invalid headers for table: ${table}`);
  }
  if (!value.every((header) => typeof header === "string")) {
    throw new DpipPayloadError(`Invalid headers for table: ${table}`);
  }
  const headers = value;
  const expected = Object.keys(DPIP_TABLE_SPECS[table].fields);
  const uniqueHeaders = new Set(headers);
  if (uniqueHeaders.size !== headers.length || headers.length !== expected.length || expected.some((header) => !uniqueHeaders.has(header))) {
    throw new DpipPayloadError(`Invalid headers for table: ${table}`);
  }
  return headers;
}
function parseDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return void 0;
  }
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return void 0;
  }
  return value;
}
function parseBigInt(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : void 0;
  }
  if (typeof value === "string" && NON_NEGATIVE_INTEGER_PATTERN.test(value)) {
    return BigInt(value);
  }
  return void 0;
}
function parseField(value, type, field) {
  switch (type) {
    case "text": {
      if (value !== null && typeof value !== "string") {
        return void 0;
      }
      const textValue = value === null ? "null" : value.trim();
      if (textValue.toLowerCase() === "null") {
        return "null";
      }
      if (field === "metrics_type") {
        const metricType = textValue.toLowerCase();
        return REPORT_METRIC_TYPES.has(metricType) ? metricType : void 0;
      }
      if (field === "party_id") {
        const partyId = textValue.toLowerCase();
        return partyId.length > 0 ? partyId : void 0;
      }
      if (field === "party_ids") {
        const partyIds = [
          ...new Set(
            textValue.split(",").map((partyId) => partyId.trim().toLowerCase()).filter((partyId) => partyId.length > 0)
          )
        ].sort();
        return partyIds.length > 0 ? partyIds.join(", ") : void 0;
      }
      return textValue.length > 0 ? textValue : void 0;
    }
    case "date":
      return parseDate(value);
    case "bigint":
      return parseBigInt(value);
  }
}
function invalidMessage(type) {
  switch (type) {
    case "text":
      return "Must be a non-empty string";
    case "date":
      return "Invalid date";
    case "bigint":
      return "Must be a non-negative integer";
  }
}
function serializeKey(row, fields) {
  return fields.map((field) => {
    const value = row[field];
    if (value === void 0) {
      throw new Error(`Missing parsed key field: ${field}`);
    }
    const encoded = value.toString();
    return `${typeof value}:${encoded.length}:${encoded}`;
  }).join("|");
}
function parseDpipPayloadDetailed(input) {
  const payload = normalizeInput(input);
  if (!Array.isArray(payload)) {
    throw new DpipPayloadError("Payload must be an array");
  }
  const tables = emptyTables();
  const parseStats = emptyParseStats();
  const errors = [];
  const seenTables = /* @__PURE__ */ new Set();
  for (const block of payload) {
    if (!isRecord(block)) {
      throw new DpipPayloadError("Every table block must be an object");
    }
    const table = parseTableName(block.table);
    if (seenTables.has(table)) {
      throw new DpipPayloadError(`Repeated table: ${table}`);
    }
    seenTables.add(table);
    if (!Array.isArray(block.data) || block.data.length === 0) {
      throw new DpipPayloadError(`Missing data for table: ${table}`);
    }
    const headers = validateHeaders(table, block.data[0]);
    const spec = DPIP_TABLE_SPECS[table];
    const deduplicated = /* @__PURE__ */ new Map();
    const stats = parseStats[table];
    for (let index = 1; index < block.data.length; index += 1) {
      const rowNumber = index;
      const inputRow = block.data[index];
      stats.received += 1;
      if (!Array.isArray(inputRow) || inputRow.length !== headers.length) {
        stats.invalid += 1;
        errors.push({
          table,
          row: rowNumber,
          message: "Wrong column count"
        });
        continue;
      }
      const row = {};
      let valid = true;
      for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
        const field = headers[columnIndex];
        if (field === void 0) {
          throw new Error("Validated header missing");
        }
        const fieldType = spec.fields[field];
        if (fieldType === void 0) {
          throw new Error(`Validated field missing from spec: ${field}`);
        }
        const parsed = parseField(inputRow[columnIndex], fieldType, field);
        if (parsed === void 0) {
          valid = false;
          errors.push({
            table,
            row: rowNumber,
            field,
            message: invalidMessage(fieldType)
          });
        } else {
          row[field] = parsed;
        }
      }
      if (!valid) {
        stats.invalid += 1;
        continue;
      }
      const key = serializeKey(row, spec.key);
      const previous = deduplicated.get(key);
      if (previous !== void 0) {
        stats.duplicates += 1;
        errors.push({
          table,
          row: previous.rowNumber,
          message: "Duplicate key superseded by a later row"
        });
      }
      deduplicated.set(key, { row, rowNumber });
    }
    tables[table] = [...deduplicated.values()].map(({ row }) => row);
  }
  const missing = DPIP_TABLE_NAMES.filter((table) => !seenTables.has(table));
  if (missing.length > 0) {
    throw new DpipPayloadError(`Missing tables: ${missing.join(", ")}`);
  }
  if (payload.length !== DPIP_TABLE_NAMES.length) {
    throw new DpipPayloadError("Payload must contain exactly six table blocks");
  }
  return { tables, errors, parseStats };
}
function parseDpipPayload(input) {
  const { tables, errors } = parseDpipPayloadDetailed(input);
  return { tables, errors };
}

// src/index.ts
var MAX_BODY_BYTES = 5 * 1024 * 1024;
var MAX_RESPONSE_ERRORS = 20;
function requestId(headers) {
  const requestHeader = headers["x-request-id"];
  if (typeof requestHeader === "string" && requestHeader.length <= 128) {
    return requestHeader;
  }
  const traceHeader = headers["x-cloud-trace-context"];
  if (typeof traceHeader === "string") {
    const trace = traceHeader.split("/")[0];
    if (trace !== void 0 && /^[a-f0-9]{32}$/i.test(trace)) {
      return trace;
    }
  }
  return void 0;
}
function bearerToken(authorization) {
  if (authorization === void 0) {
    return void 0;
  }
  const match = /^Bearer (.+)$/i.exec(authorization);
  return match?.[1];
}
function secretsMatch(actual, expected) {
  if (actual === void 0) {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
function rawBody(requestRawBody, parsedBody) {
  if (requestRawBody !== void 0) {
    return requestRawBody;
  }
  if (Buffer.isBuffer(parsedBody)) {
    return parsedBody;
  }
  if (typeof parsedBody === "string") {
    return Buffer.from(parsedBody, "utf8");
  }
  if (parsedBody === void 0 || parsedBody === null) {
    return Buffer.alloc(0);
  }
  return Buffer.from(JSON.stringify(parsedBody), "utf8");
}
function errorResponse(errors) {
  return {
    total_errors: errors.length,
    errors: errors.slice(0, MAX_RESPONSE_ERRORS),
    errors_truncated: errors.length > MAX_RESPONSE_ERRORS
  };
}
http("ingestDpip", async (req, res) => {
  const startedAt = Date.now();
  const id = requestId(req.headers);
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    res.status(405).json({ status: "error", message: "Method not allowed" });
    return;
  }
  const expectedSecret = process.env.DPIP_BEARER_SECRET;
  if (expectedSecret === void 0 || !secretsMatch(bearerToken(req.get("authorization")), expectedSecret)) {
    res.status(401).json({ status: "error", message: "Unauthorized" });
    return;
  }
  const body = rawBody(req.rawBody, req.body);
  if (body.byteLength > MAX_BODY_BYTES) {
    res.status(413).json({ status: "error", message: "Payload too large" });
    return;
  }
  try {
    const parsed = parseDpipPayloadDetailed(body.toString("utf8"));
    const writeStats = await writeDpipTables(parsed.tables);
    const summaries = DPIP_TABLE_NAMES.map((table) => ({
      table,
      received: parsed.parseStats[table].received,
      inserted: writeStats[table].inserted,
      updated: writeStats[table].updated,
      duplicates: parsed.parseStats[table].duplicates + writeStats[table].conflicts,
      invalid: parsed.parseStats[table].invalid
    }));
    const responseErrors = errorResponse(parsed.errors);
    const partial = responseErrors.total_errors > 0 || summaries.some((summary) => summary.duplicates > 0);
    console.log(
      JSON.stringify({
        severity: "INFO",
        event: "dpip_ingestion_completed",
        ...id === void 0 ? {} : { request_id: id },
        status: partial ? "partial" : "success",
        duration_ms: Date.now() - startedAt,
        tables: summaries.map(
          ({ table, received, inserted, updated, duplicates, invalid }) => ({
            table,
            received,
            inserted,
            updated,
            duplicates,
            invalid
          })
        )
      })
    );
    res.status(partial ? 207 : 200).json({
      status: partial ? "partial" : "success",
      tables: summaries,
      ...responseErrors
    });
  } catch (error) {
    if (error instanceof DpipPayloadError) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          event: "dpip_payload_rejected",
          ...id === void 0 ? {} : { request_id: id },
          reason: "invalid_payload_structure",
          duration_ms: Date.now() - startedAt
        })
      );
      res.status(400).json({ status: "error", message: error.message });
      return;
    }
    console.error(
      JSON.stringify({
        severity: "ERROR",
        event: "dpip_ingestion_failed",
        ...id === void 0 ? {} : { request_id: id },
        error_type: error instanceof Error ? error.constructor.name : "UnknownError",
        duration_ms: Date.now() - startedAt
      })
    );
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});
export {
  parseDpipPayload
};
