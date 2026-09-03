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
      customer_type: "text",
      metrics_type: "text",
      metrics_value: "bigint"
    },
    key: [
      "identifier_type",
      "reported_date",
      "party_id",
      "sub_source",
      "status",
      "customer_type",
      "metrics_type"
    ]
  },
  screenings: {
    fields: {
      screening_date: "date",
      party_id: "text",
      event_type: "text",
      screening_status: "text",
      count: "bigint"
    },
    key: ["screening_date", "party_id", "event_type", "screening_status"]
  },
  cluster_external_entities: {
    fields: {
      cluster_count: "bigint",
      num_external_entities: "bigint",
      last_updated_date: "date"
    },
    key: ["num_external_entities", "last_updated_date"]
  },
  external_entity_identifiers: {
    fields: {
      party_id: "text",
      external_entity_count: "bigint",
      num_identifiers: "bigint",
      last_updated_date: "date"
    },
    key: ["party_id", "num_identifiers", "last_updated_date"]
  },
  cluster_identifiers: {
    fields: {
      cluster_count: "bigint",
      num_identifiers: "bigint",
      last_updated_date: "date"
    },
    key: ["num_identifiers", "last_updated_date"]
  },
  party_identifiers: {
    fields: {
      party_ids: "text",
      num_identifiers: "bigint",
      last_updated_date: "date"
    },
    key: ["party_ids", "last_updated_date"]
  },
  entities_by_customer: {
    fields: {
      customer_type: "text",
      entity_count: "bigint",
      last_updated_date: "date"
    },
    key: ["customer_type", "last_updated_date"]
  }
};

// src/logging.ts
var MAX_ERROR_MESSAGE_LENGTH = 2e3;
var MAX_ERROR_STACK_LENGTH = 8e3;
function truncate(value, maximumLength) {
  if (value.length <= maximumLength) {
    return value;
  }
  return `${value.slice(0, maximumLength)}\u2026[truncated]`;
}
function errorCode(error) {
  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : void 0;
}
function errorLogFields(error) {
  if (!(error instanceof Error)) {
    return { error_type: "UnknownError" };
  }
  const code = errorCode(error);
  return {
    error_type: error.constructor.name,
    error_message: truncate(error.message, MAX_ERROR_MESSAGE_LENGTH),
    ...code === void 0 ? {} : { error_code: code },
    ...error.stack === void 0 ? {} : { error_stack: truncate(error.stack, MAX_ERROR_STACK_LENGTH) }
  };
}
function contextLogFields(context) {
  return context?.requestId === void 0 ? {} : { request_id: context.requestId };
}
function stringify(entry) {
  return JSON.stringify(
    entry,
    (_key, value) => typeof value === "bigint" ? value.toString() : value
  );
}
function logInfo(event, fields = {}) {
  console.log(stringify({ severity: "INFO", event, ...fields }));
}
function logWarning(event, fields = {}) {
  console.warn(stringify({ severity: "WARNING", event, ...fields }));
}
function logError(event, fields = {}) {
  console.error(stringify({ severity: "ERROR", event, ...fields }));
}

// src/types.ts
var DPIP_TABLE_NAMES = [
  "reports",
  "screenings",
  "cluster_external_entities",
  "external_entity_identifiers",
  "cluster_identifiers",
  "party_identifiers",
  "entities_by_customer"
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
    application_name: "dpip-v2-daily-ingestion"
  });
  pool.on("error", (error) => {
    logError("dpip_database_pool_error", errorLogFields(error));
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
          customer_type,
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
          customer_type,
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
          event_type,
          screening_status,
          count
        )
        VALUES ${values.sql}
        ON CONFLICT (
          screening_date,
          party_id,
          event_type,
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
async function writeDpipTables(tables, logContext) {
  const client = await getPool().connect();
  const stats = {};
  try {
    await client.query("BEGIN");
    for (const table of DPIP_TABLE_NAMES) {
      try {
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
      } catch (error) {
        logError("dpip_database_table_write_failed", {
          ...contextLogFields(logContext),
          table,
          rows: tables[table].length,
          ...errorLogFields(error)
        });
        throw error;
      }
    }
    await client.query("COMMIT");
    return stats;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logError("dpip_database_rollback_failed", {
        ...contextLogFields(logContext),
        ...errorLogFields(rollbackError)
      });
    }
    throw error;
  } finally {
    client.release();
  }
}
async function readAllDpipTables(logContext) {
  const client = await getPool().connect();
  const tables = {};
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    for (const table of DPIP_TABLE_NAMES) {
      const spec = DPIP_TABLE_SPECS[table];
      const fields = Object.keys(spec.fields);
      const textFields = fields.map(
        (field) => `${field}::text AS ${field}`
      );
      try {
        const result = await client.query(
          `
            SELECT ${textFields.join(", ")}
            FROM dpip.${table}
            ORDER BY ${spec.key.join(", ")}
          `
        );
        tables[table] = result.rows;
      } catch (error) {
        logError("dpip_database_table_read_failed", {
          ...contextLogFields(logContext),
          table,
          ...errorLogFields(error)
        });
        throw error;
      }
    }
    await client.query("COMMIT");
    return tables;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logError("dpip_database_report_snapshot_rollback_failed", {
        ...contextLogFields(logContext),
        ...errorLogFields(rollbackError)
      });
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
var CUSTOMER_TYPES = /* @__PURE__ */ new Set(["INDIVIDUAL", "MERCHANT", "ALL"]);
var DEEP_DISCOVERY_FOOTER_PATTERN = /^[ \t]*=+[ \t]*(?:\r?\n[\s\S]*|$)/m;
var HTML_EMAIL_FOOTER_PATTERN = /^(\s*\[[\s\S]*\])(?:\r\n?|\n)?<br\b[^>]*>[ \t]*=+[ \t]*(?:(?:\r\n?|\n)?<br\b[^>]*>[\s\S]*|$)/i;
var HTML_LINE_BREAK_PATTERN = /(?:\r\n?|\n)?<br\b[^>]*>/gi;
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
    ).replace(HTML_LINE_BREAK_PATTERN, " ").replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n").replace(/<[^>]+>/g, "")
  ).replace(/\u00a0/g, " ");
}
function stripKnownEmailFooters(value) {
  return value.replace(HTML_EMAIL_FOOTER_PATTERN, "$1").replace(DEEP_DISCOVERY_FOOTER_PATTERN, "").trim();
}
function normalizeInput(input) {
  if (typeof input !== "string") {
    return input;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new DpipPayloadError("Request body is empty");
  }
  const withoutFooter = stripKnownEmailFooters(trimmed);
  const candidates = [withoutFooter.replace(HTML_LINE_BREAK_PATTERN, " ")];
  if (/<\/?[a-z][^>]*>|&(?:nbsp|quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/i.test(trimmed)) {
    candidates.push(stripKnownEmailFooters(htmlEmailToText(withoutFooter)));
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
      if (field === "metrics_type") {
        const metricType = textValue.toLowerCase();
        return REPORT_METRIC_TYPES.has(metricType) ? metricType : void 0;
      }
      if (field === "customer_type") {
        const customerType = textValue.toUpperCase();
        return CUSTOMER_TYPES.has(customerType) ? customerType : void 0;
      }
      if (textValue.toLowerCase() === "null") {
        return "null";
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
function invalidMessage(type, field) {
  switch (type) {
    case "text":
      if (field === "metrics_type") {
        return `Must be one of: ${[...REPORT_METRIC_TYPES].join(", ")}`;
      }
      if (field === "customer_type") {
        return `Must be one of: ${[...CUSTOMER_TYPES].join(", ")}`;
      }
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
            message: invalidMessage(fieldType, field)
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
    throw new DpipPayloadError(
      "Payload must contain exactly seven table blocks"
    );
  }
  return { tables, errors, parseStats };
}
function parseDpipPayload(input) {
  const { tables, errors } = parseDpipPayloadDetailed(input);
  return { tables, errors };
}

// src/report.ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
var REPORT_TEMPLATE_PATTERN = /^[ \t]*<template id="dpip-email-body">[\s\S]*?<\/template>/m;
var OVERVIEW_TEMPLATE_PATTERN = /^[ \t]*<template id="dpip-overview-data">[\s\S]*?<\/template>/m;
var DEFAULT_MESSAGE = "DPIP Daily Registry Intelligence Report (v2)";
function jsonValue(value) {
  return typeof value === "bigint" ? value.toString() : value;
}
function buildDpipReportPayload(tables) {
  return DPIP_TABLE_NAMES.map((table) => {
    const fields = Object.keys(DPIP_TABLE_SPECS[table].fields);
    return {
      table,
      data: [
        fields,
        ...tables[table].map(
          (row) => fields.map((field) => {
            const value = row[field];
            if (value === void 0) {
              throw new Error(
                `Missing report field ${field} in table ${table}`
              );
            }
            return jsonValue(value);
          })
        )
      ]
    };
  });
}
function escapeHtmlText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function generateDpipReportHtml(template, tables) {
  if (!REPORT_TEMPLATE_PATTERN.test(template)) {
    throw new Error("DPIP report template payload area not found");
  }
  const payload = JSON.stringify(buildDpipReportPayload(tables));
  return template.replace(
    REPORT_TEMPLATE_PATTERN,
    `<template id="dpip-email-body">${escapeHtmlText(payload)}</template>`
  );
}
function generateDpipOverviewHtml(template, tables) {
  if (!OVERVIEW_TEMPLATE_PATTERN.test(template)) {
    throw new Error("DPIP overview template payload area not found");
  }
  const payload = JSON.stringify(buildDpipReportPayload(tables));
  return template.replace(
    OVERVIEW_TEMPLATE_PATTERN,
    `<template id="dpip-overview-data">${escapeHtmlText(payload)}</template>`
  );
}
async function loadDpipReportTemplate() {
  const configuredPath = process.env.DPIP_REPORT_TEMPLATE_PATH ?? "Report.html";
  return readFile(resolve(process.cwd(), configuredPath), "utf8");
}
async function loadDpipOverviewTemplate() {
  const configuredPath = process.env.DPIP_OVERVIEW_TEMPLATE_PATH ?? "DPIP_Overview.html";
  return readFile(resolve(process.cwd(), configuredPath), "utf8");
}
function dpipReportFileName(now = /* @__PURE__ */ new Date()) {
  return `dpip-daily-report-v2-${now.toISOString().slice(0, 10)}.html`;
}
function dpipOverviewFileName(now = /* @__PURE__ */ new Date()) {
  return `dpip-overview-v2-${now.toISOString().slice(0, 10)}.html`;
}
function requiredEnvironmentVariable2(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
function appUploadUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/api/apps/slack/files.upload`;
}
function responseObject(value) {
  return typeof value === "object" && value !== null ? value : void 0;
}
async function sendDpipReportsToXyne(reportHtml, overviewHtml, fetchImplementation = fetch, logContext) {
  const apiUrl = requiredEnvironmentVariable2("XYNE_SPACES_API_URL");
  const appJwt = requiredEnvironmentVariable2("XYNE_SPACES_APP_JWT");
  const channelId = requiredEnvironmentVariable2("XYNE_SPACES_CHANNEL_ID");
  const reportFileName = dpipReportFileName();
  const overviewFileName = dpipOverviewFileName();
  const form = new FormData();
  form.append("channels", channelId);
  form.append(
    "initial_comment",
    process.env.XYNE_SPACES_MESSAGE?.trim() || DEFAULT_MESSAGE
  );
  form.append(
    "files",
    new Blob([reportHtml], { type: "text/html; charset=utf-8" }),
    reportFileName
  );
  form.append(
    "files",
    new Blob([overviewHtml], { type: "text/html; charset=utf-8" }),
    overviewFileName
  );
  const uploadStartedAt = Date.now();
  const commonLogFields = {
    ...contextLogFields(logContext),
    file_names: [reportFileName, overviewFileName],
    report_count: 2,
    report_bytes: Buffer.byteLength(reportHtml, "utf8") + Buffer.byteLength(overviewHtml, "utf8")
  };
  logInfo("dpip_report_upload_started", commonLogFields);
  let response;
  try {
    response = await fetchImplementation(appUploadUrl(apiUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`
      },
      body: form,
      signal: AbortSignal.timeout(3e4)
    });
  } catch (error) {
    logError("dpip_report_upload_request_failed", {
      ...commonLogFields,
      duration_ms: Date.now() - uploadStartedAt,
      ...errorLogFields(error)
    });
    throw error;
  }
  let responseText;
  try {
    responseText = await response.text();
  } catch (error) {
    logError("dpip_report_upload_response_read_failed", {
      ...commonLogFields,
      http_status: response.status,
      duration_ms: Date.now() - uploadStartedAt,
      ...errorLogFields(error)
    });
    throw error;
  }
  let responseBody;
  let responseIsJson = true;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    responseBody = void 0;
    responseIsJson = false;
  }
  const body = responseObject(responseBody);
  if (!response.ok || body?.ok !== true) {
    const appError = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    logError("dpip_report_upload_failed", {
      ...contextLogFields(logContext),
      http_status: response.status,
      app_error: appError,
      response_content_type: response.headers.get("content-type") ?? "unknown",
      response_is_json: responseIsJson,
      response_bytes: Buffer.byteLength(responseText, "utf8"),
      duration_ms: Date.now() - uploadStartedAt
    });
    throw new Error(`Xyne Spaces report upload failed: ${appError}`);
  }
  const file = responseObject(body.file);
  const shares = responseObject(file?.shares);
  const publicShares = responseObject(shares?.public);
  const firstChannelShares = Array.isArray(publicShares?.[channelId]) ? publicShares[channelId] : void 0;
  const firstShare = Array.isArray(firstChannelShares) && firstChannelShares.length > 0 ? responseObject(firstChannelShares[0]) : void 0;
  const conversationId = typeof firstShare?.ts === "string" ? firstShare.ts : "";
  const messageId = conversationId;
  const attachmentId = typeof file?.id === "string" ? file.id : void 0;
  logInfo("dpip_report_upload_completed", {
    ...contextLogFields(logContext),
    http_status: response.status,
    duration_ms: Date.now() - uploadStartedAt,
    ...attachmentId === void 0 ? {} : { attachment_id: attachmentId },
    ...messageId.length === 0 ? {} : { message_id: messageId }
  });
  return {
    conversationId,
    messageId,
    ...attachmentId === void 0 ? {} : { attachmentId }
  };
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
  const logContext = id === void 0 ? void 0 : { requestId: id };
  const requestLogFields = contextLogFields(logContext);
  logInfo("dpip_ingestion_request_received", {
    ...requestLogFields,
    method: req.method,
    content_type: req.get("content-type") ?? "unknown",
    content_length: req.get("content-length") ?? "unknown"
  });
  if (req.method !== "POST") {
    logWarning("dpip_ingestion_request_rejected", {
      ...requestLogFields,
      reason: "method_not_allowed",
      method: req.method,
      duration_ms: Date.now() - startedAt
    });
    res.set("Allow", "POST");
    res.status(405).json({ status: "error", message: "Method not allowed" });
    return;
  }
  const expectedSecret = process.env.DPIP_BEARER_SECRET;
  if (expectedSecret === void 0 || expectedSecret.length === 0) {
    logError("dpip_ingestion_configuration_failed", {
      ...requestLogFields,
      missing_environment_variable: "DPIP_BEARER_SECRET",
      duration_ms: Date.now() - startedAt
    });
    res.status(500).json({ status: "error", message: "Internal server error" });
    return;
  }
  if (!secretsMatch(bearerToken(req.get("authorization")), expectedSecret)) {
    logWarning("dpip_ingestion_request_rejected", {
      ...requestLogFields,
      reason: "unauthorized",
      duration_ms: Date.now() - startedAt
    });
    res.status(401).json({ status: "error", message: "Unauthorized" });
    return;
  }
  const body = rawBody(req.rawBody, req.body);
  if (body.byteLength > MAX_BODY_BYTES) {
    logWarning("dpip_ingestion_request_rejected", {
      ...requestLogFields,
      reason: "payload_too_large",
      body_bytes: body.byteLength,
      maximum_body_bytes: MAX_BODY_BYTES,
      duration_ms: Date.now() - startedAt
    });
    res.status(413).json({ status: "error", message: "Payload too large" });
    return;
  }
  let stage = "payload_parsing";
  let stageStartedAt = Date.now();
  try {
    const parsed = parseDpipPayloadDetailed(body.toString("utf8"));
    logInfo("dpip_payload_parsed", {
      ...requestLogFields,
      body_bytes: body.byteLength,
      duration_ms: Date.now() - stageStartedAt,
      row_errors: parsed.errors.length,
      tables: DPIP_TABLE_NAMES.map((table) => ({
        table,
        received: parsed.parseStats[table].received,
        duplicates: parsed.parseStats[table].duplicates,
        invalid: parsed.parseStats[table].invalid
      }))
    });
    stage = "database_write";
    stageStartedAt = Date.now();
    const writeStats = await writeDpipTables(parsed.tables, logContext);
    logInfo("dpip_database_write_completed", {
      ...requestLogFields,
      duration_ms: Date.now() - stageStartedAt,
      tables: DPIP_TABLE_NAMES.map((table) => ({
        table,
        inserted: writeStats[table].inserted,
        updated: writeStats[table].updated,
        conflicts: writeStats[table].conflicts
      }))
    });
    stage = "report_source_loading";
    stageStartedAt = Date.now();
    const snapshotStartedAt = Date.now();
    const templateStartedAt = Date.now();
    const [reportTables, reportTemplate, overviewTemplate] = await Promise.all([
      readAllDpipTables(logContext).then(
        (tables) => {
          logInfo("dpip_report_snapshot_loaded", {
            ...requestLogFields,
            duration_ms: Date.now() - snapshotStartedAt,
            tables: DPIP_TABLE_NAMES.map((table) => ({
              table,
              rows: tables[table].length
            }))
          });
          return tables;
        },
        (error) => {
          logError("dpip_report_snapshot_load_failed", {
            ...requestLogFields,
            duration_ms: Date.now() - snapshotStartedAt,
            ...errorLogFields(error)
          });
          throw error;
        }
      ),
      loadDpipReportTemplate().then(
        (template) => {
          logInfo("dpip_report_template_loaded", {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            template_bytes: Buffer.byteLength(template, "utf8")
          });
          return template;
        },
        (error) => {
          logError("dpip_report_template_load_failed", {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            ...errorLogFields(error)
          });
          throw error;
        }
      ),
      loadDpipOverviewTemplate().then(
        (template) => {
          logInfo("dpip_overview_template_loaded", {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            template_bytes: Buffer.byteLength(template, "utf8")
          });
          return template;
        },
        (error) => {
          logError("dpip_overview_template_load_failed", {
            ...requestLogFields,
            duration_ms: Date.now() - templateStartedAt,
            ...errorLogFields(error)
          });
          throw error;
        }
      )
    ]);
    stage = "report_generation";
    stageStartedAt = Date.now();
    const reportHtml = generateDpipReportHtml(
      reportTemplate,
      reportTables
    );
    const overviewHtml = generateDpipOverviewHtml(
      overviewTemplate,
      reportTables
    );
    logInfo("dpip_report_generated", {
      ...requestLogFields,
      duration_ms: Date.now() - stageStartedAt,
      report_bytes: Buffer.byteLength(reportHtml, "utf8"),
      overview_bytes: Buffer.byteLength(overviewHtml, "utf8")
    });
    stage = "xyne_report_upload";
    stageStartedAt = Date.now();
    const reportDelivery = await sendDpipReportsToXyne(
      reportHtml,
      overviewHtml,
      fetch,
      logContext
    );
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
    logInfo("dpip_ingestion_completed", {
      ...requestLogFields,
      status: partial ? "partial" : "success",
      duration_ms: Date.now() - startedAt,
      report_attachment_id: reportDelivery.attachmentId,
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
    });
    res.status(partial ? 207 : 200).json({
      status: partial ? "partial" : "success",
      tables: summaries,
      report: {
        sent: true,
        attachment_id: reportDelivery.attachmentId
      },
      ...responseErrors
    });
  } catch (error) {
    if (error instanceof DpipPayloadError) {
      logWarning("dpip_payload_rejected", {
        ...requestLogFields,
        reason: "invalid_payload_structure",
        duration_ms: Date.now() - startedAt,
        ...errorLogFields(error)
      });
      res.status(400).json({ status: "error", message: error.message });
      return;
    }
    logError("dpip_ingestion_failed", {
      ...requestLogFields,
      pipeline_stage: stage,
      stage_duration_ms: Date.now() - stageStartedAt,
      duration_ms: Date.now() - startedAt,
      ...errorLogFields(error)
    });
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});
export {
  parseDpipPayload
};
