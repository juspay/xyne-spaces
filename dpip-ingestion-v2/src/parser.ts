import { DPIP_TABLE_SPECS, type DpipFieldType } from './schema';
import {
  DPIP_TABLE_NAMES,
  type DpipDetailedParseResult,
  type DpipParseResult,
  type DpipRow,
  type DpipRowError,
  type DpipTableName,
  type DpipTableParseStats,
  type DpipValue,
} from './types';

const TABLE_NAME_SET = new Set<string>(DPIP_TABLE_NAMES);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const REPORT_METRIC_TYPES = new Set([
  'reports_count',
  'identifiers_count',
  'external_entities_count',
  'clusters_count',
]);
const CUSTOMER_TYPES = new Set(['INDIVIDUAL', 'MERCHANT', 'ALL']);
const DEEP_DISCOVERY_FOOTER_PATTERN =
  /^[ \t]*=+[ \t]*(?:\r?\n[\s\S]*|$)/m;
const HTML_EMAIL_FOOTER_PATTERN =
  /^(\s*\[[\s\S]*\])(?:\r\n?|\n)?<br\b[^>]*>[ \t]*=+[ \t]*(?:(?:\r\n?|\n)?<br\b[^>]*>[\s\S]*|$)/i;
const HTML_LINE_BREAK_PATTERN = /(?:\r\n?|\n)?<br\b[^>]*>/gi;

export class DpipPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DpipPayloadError';
  }
}

function emptyTables(): Record<DpipTableName, DpipRow[]> {
  const tables = {} as Record<DpipTableName, DpipRow[]>;
  for (const table of DPIP_TABLE_NAMES) {
    tables[table] = [];
  }
  return tables;
}

function emptyParseStats(): Record<DpipTableName, DpipTableParseStats> {
  const stats = {} as Record<DpipTableName, DpipTableParseStats>;
  for (const table of DPIP_TABLE_NAMES) {
    stats[table] = { received: 0, duplicates: 0, invalid: 0 };
  }
  return stats;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&#(\d+);/g, (entity, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function htmlEmailToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(
        /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        '',
      )
      .replace(HTML_LINE_BREAK_PATTERN, ' ')
      .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\u00a0/g, ' ');
}

function stripKnownEmailFooters(value: string): string {
  return value
    .replace(HTML_EMAIL_FOOTER_PATTERN, '$1')
    .replace(DEEP_DISCOVERY_FOOTER_PATTERN, '')
    .trim();
}

function normalizeInput(input: unknown): unknown {
  if (typeof input !== 'string') {
    return input;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new DpipPayloadError('Request body is empty');
  }

  const withoutFooter = stripKnownEmailFooters(trimmed);
  const candidates = [withoutFooter.replace(HTML_LINE_BREAK_PATTERN, ' ')];
  if (/<\/?[a-z][^>]*>|&(?:nbsp|quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/i.test(trimmed)) {
    candidates.push(stripKnownEmailFooters(htmlEmailToText(withoutFooter)));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next supported email-body representation.
    }
  }

  throw new DpipPayloadError('Invalid JSON');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTableName(value: unknown): DpipTableName {
  if (typeof value !== 'string' || !TABLE_NAME_SET.has(value)) {
    throw new DpipPayloadError(
      typeof value === 'string'
        ? `Unknown table: ${value}`
        : 'Table name must be a string',
    );
  }

  return value as DpipTableName;
}

function validateHeaders(table: DpipTableName, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DpipPayloadError(`Invalid headers for table: ${table}`);
  }

  if (!value.every((header) => typeof header === 'string')) {
    throw new DpipPayloadError(`Invalid headers for table: ${table}`);
  }

  const headers = value as string[];
  const expected = Object.keys(DPIP_TABLE_SPECS[table].fields);
  const uniqueHeaders = new Set(headers);

  if (
    uniqueHeaders.size !== headers.length ||
    headers.length !== expected.length ||
    expected.some((header) => !uniqueHeaders.has(header))
  ) {
    throw new DpipPayloadError(`Invalid headers for table: ${table}`);
  }

  return headers;
}

function parseDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return undefined;
  }

  return value;
}

function parseBigInt(value: unknown): bigint | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0
      ? BigInt(value)
      : undefined;
  }

  if (
    typeof value === 'string' &&
    NON_NEGATIVE_INTEGER_PATTERN.test(value)
  ) {
    return BigInt(value);
  }

  return undefined;
}

function parseField(
  value: unknown,
  type: DpipFieldType,
  field: string,
): DpipValue | undefined {
  switch (type) {
    case 'text': {
      if (value !== null && typeof value !== 'string') {
        return undefined;
      }

      const textValue = value === null ? 'null' : value.trim();
      if (field === 'metrics_type') {
        const metricType = textValue.toLowerCase();
        return REPORT_METRIC_TYPES.has(metricType)
          ? metricType
          : undefined;
      }

      if (field === 'customer_type') {
        const customerType = textValue.toUpperCase();
        return CUSTOMER_TYPES.has(customerType) ? customerType : undefined;
      }

      if (textValue.toLowerCase() === 'null') {
        return 'null';
      }

      if (field === 'party_id') {
        const partyId = textValue.toLowerCase();
        return partyId.length > 0 ? partyId : undefined;
      }

      if (field === 'party_ids') {
        const partyIds = [
          ...new Set(
            textValue
              .split(',')
              .map((partyId) => partyId.trim().toLowerCase())
              .filter((partyId) => partyId.length > 0),
          ),
        ].sort();
        return partyIds.length > 0 ? partyIds.join(', ') : undefined;
      }

      return textValue.length > 0 ? textValue : undefined;
    }
    case 'date':
      return parseDate(value);
    case 'bigint':
      return parseBigInt(value);
  }
}

function invalidMessage(type: DpipFieldType, field: string): string {
  switch (type) {
    case 'text':
      if (field === 'metrics_type') {
        return `Must be one of: ${[...REPORT_METRIC_TYPES].join(', ')}`;
      }
      if (field === 'customer_type') {
        return `Must be one of: ${[...CUSTOMER_TYPES].join(', ')}`;
      }
      return 'Must be a non-empty string';
    case 'date':
      return 'Invalid date';
    case 'bigint':
      return 'Must be a non-negative integer';
  }
}

function serializeKey(row: DpipRow, fields: readonly string[]): string {
  return fields
    .map((field) => {
      const value = row[field];
      if (value === undefined) {
        throw new Error(`Missing parsed key field: ${field}`);
      }
      const encoded = value.toString();
      return `${typeof value}:${encoded.length}:${encoded}`;
    })
    .join('|');
}

interface ParsedRow {
  row: DpipRow;
  rowNumber: number;
}

export function parseDpipPayloadDetailed(
  input: unknown,
): DpipDetailedParseResult {
  const payload = normalizeInput(input);
  if (!Array.isArray(payload)) {
    throw new DpipPayloadError('Payload must be an array');
  }

  const tables = emptyTables();
  const parseStats = emptyParseStats();
  const errors: DpipRowError[] = [];
  const seenTables = new Set<DpipTableName>();

  for (const block of payload) {
    if (!isRecord(block)) {
      throw new DpipPayloadError('Every table block must be an object');
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
    const deduplicated = new Map<string, ParsedRow>();
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
          message: 'Wrong column count',
        });
        continue;
      }

      const row: DpipRow = {};
      let valid = true;

      for (
        let columnIndex = 0;
        columnIndex < headers.length;
        columnIndex += 1
      ) {
        const field = headers[columnIndex];
        if (field === undefined) {
          throw new Error('Validated header missing');
        }
        const fieldType = spec.fields[field];
        if (fieldType === undefined) {
          throw new Error(`Validated field missing from spec: ${field}`);
        }

        const parsed = parseField(inputRow[columnIndex], fieldType, field);
        if (parsed === undefined) {
          valid = false;
          errors.push({
            table,
            row: rowNumber,
            field,
            message: invalidMessage(fieldType, field),
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
      if (previous !== undefined) {
        stats.duplicates += 1;
        errors.push({
          table,
          row: previous.rowNumber,
          message: 'Duplicate key superseded by a later row',
        });
      }
      deduplicated.set(key, { row, rowNumber });
    }

    tables[table] = [...deduplicated.values()].map(({ row }) => row);
  }

  const missing = DPIP_TABLE_NAMES.filter((table) => !seenTables.has(table));
  if (missing.length > 0) {
    throw new DpipPayloadError(`Missing tables: ${missing.join(', ')}`);
  }

  if (payload.length !== DPIP_TABLE_NAMES.length) {
    throw new DpipPayloadError(
      'Payload must contain exactly seven table blocks',
    );
  }

  return { tables, errors, parseStats };
}

export function parseDpipPayload(input: unknown): DpipParseResult {
  const { tables, errors } = parseDpipPayloadDetailed(input);
  return { tables, errors };
}
