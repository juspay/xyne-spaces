/**
 * Visualize Tool
 */
import type { ToolDefinition } from "../types.js";

/** Returns null when `data` is valid, else a model-facing reason. */
type Validator = (data: unknown) => string | null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/** Labels/x-values may be categorical or numeric; both render. */
function isLabelLike(v: unknown): boolean {
  return typeof v === "string" || isFiniteNumber(v);
}

function checkRows(
  data: unknown,
  rowCheck: (row: Record<string, unknown>, i: number) => string | null,
): string | null {
  if (!Array.isArray(data)) return "expected an array of rows";
  if (data.length === 0) return "expected at least one row; got an empty array";
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!isPlainObject(row)) return `row ${i}: expected an object`;
    const err = rowCheck(row, i);
    if (err) return err;
  }
  return null;
}

const labelValueRows: Validator = (data) =>
  checkRows(data, (row, i) => {
    if (!isLabelLike(row["label"])) return `row ${i}: "label" must be a string or number`;
    if (!isFiniteNumber(row["value"])) return `row ${i}: "value" must be a finite number`;
    return null;
  });

const xyRows: Validator = (data) =>
  checkRows(data, (row, i) => {
    if (!isLabelLike(row["x"])) return `row ${i}: "x" must be a string or number`;
    if (!isFiniteNumber(row["y"])) return `row ${i}: "y" must be a finite number`;
    if (row["series"] !== undefined && typeof row["series"] !== "string") {
      return `row ${i}: "series" must be a string when present`;
    }
    return null;
  });

const kpiObject: Validator = (data) => {
  if (!isPlainObject(data)) return 'expected an object like {"value": 42, "label": "Open tickets"}';
  if (!isFiniteNumber(data["value"])) return '"value" must be a finite number';
  if (data["label"] !== undefined && typeof data["label"] !== "string") {
    return '"label" must be a string when present';
  }
  return null;
};

const kpiCompareObject: Validator = (data) => {
  if (!isPlainObject(data)) {
    return 'expected an object like {"current": 42, "previous": 37, "label": "Open tickets"}';
  }
  if (!isFiniteNumber(data["current"])) return '"current" must be a finite number';
  if (!isFiniteNumber(data["previous"])) return '"previous" must be a finite number';
  if (data["label"] !== undefined && typeof data["label"] !== "string") {
    return '"label" must be a string when present';
  }
  if (data["deltaPct"] !== undefined && !isFiniteNumber(data["deltaPct"])) {
    return '"deltaPct" must be a finite number when present';
  }
  return null;
};

const COLUMN_TYPES = new Set(["number", "string", "date", "boolean"]);

const tableObject: Validator = (data) => {
  if (!isPlainObject(data)) return 'expected an object with "columns" and "rows"';
  const { columns, rows } = data;
  if (!Array.isArray(columns)) return '"columns" must be an array';
  if (columns.length === 0) return '"columns" must list at least one column';
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (!isPlainObject(col)) return `columns[${i}]: expected an object`;
    if (typeof col["key"] !== "string" || col["key"] === "") {
      return `columns[${i}]: "key" must be a non-empty string`;
    }
    if (typeof col["label"] !== "string" || col["label"] === "") {
      return `columns[${i}]: "label" must be a non-empty string`;
    }
    const type = col["type"];
    if (type !== undefined && (typeof type !== "string" || !COLUMN_TYPES.has(type))) {
      return `columns[${i}]: "type" must be one of ${[...COLUMN_TYPES].join(", ")}`;
    }
  }
  if (!Array.isArray(rows)) return '"rows" must be an array';
  if (rows.some((r) => !isPlainObject(r))) return '"rows" must contain only objects';
  return null;
};

// Mirrors the renderer registry in
// dashboard/src/components/DynamicDashboard/ComponentGrid/renderers/index.ts.
// DONUT_CHART shares the pie renderer and its data shape. FUNNEL/HEATMAP are
// intentionally absent — no renderer, no contract.
const VALIDATOR_BY_VISUAL_TYPE: Record<string, Validator> = {
  BAR_CHART: labelValueRows,
  PIE_CHART: labelValueRows,
  DONUT_CHART: labelValueRows,
  LINE_CHART: xyRows,
  AREA_CHART: xyRows,
  SCATTER_CHART: xyRows,
  KPI: kpiObject,
  KPI_COMPARE: kpiCompareObject,
  DATA_TABLE: tableObject,
};

const SUPPORTED_VISUAL_TYPES = Object.keys(VALIDATOR_BY_VISUAL_TYPE);

export const visualizeTool: ToolDefinition = {
  slug: "visualize",
  name: "Visualize",
  description:
    "Render a chart from metrics you already have (from another tool call, or derived from the conversation) using Xyne's Analytics chart components. " +
    "USE THIS whenever your answer contains metrics that would read better visually — counts or totals broken down by category, " +
    "trends over time, proportions of a whole, before/after comparisons, or a headline number. This applies to ANY question, not just " +
    "analytics ones: if you found numbers worth stating, they are usually worth charting. Prefer one clear chart alongside your prose " +
    "over a wall of figures; skip it for a single incidental number that reads fine in a sentence. " +
    "Does NOT fetch or compute data itself — pass in numbers you've already obtained; never invent data. " +
    "Choose visualType based on what best communicates the data: BAR_CHART for comparing categories, LINE_CHART/AREA_CHART for trends over time, " +
    "PIE_CHART/DONUT_CHART for proportions of a whole, KPI for a single headline number, KPI_COMPARE for a current-vs-previous-period number, " +
    "SCATTER_CHART for two-variable correlations, DATA_TABLE for tabular detail. " +
    "The `data` shape required depends on visualType: " +
    "BAR_CHART/PIE_CHART/DONUT_CHART = array of {label: string|number, value: number}; " +
    "LINE_CHART/AREA_CHART/SCATTER_CHART = array of {x: string|number, y: number, series?: string}; " +
    "KPI = {value: number, label?: string}; " +
    "KPI_COMPARE = {current: number, previous: number, label?: string, deltaPct?: number}; " +
    "DATA_TABLE = {columns: [{key, label, type?: 'number'|'string'|'date'|'boolean'}], rows: [{...}]}. " +
    "On success this returns a fenced ```chart block — copy it into your reply EXACTLY as returned, character for character. " +
    "It only renders if reproduced verbatim; do not reword, reformat, summarize, or truncate it. " +
    "On a validation error, fix `data` to match the required shape and retry.",
  source: "custom:visualize",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short chart title shown above the chart.",
      },
      visualType: {
        type: "string",
        enum: SUPPORTED_VISUAL_TYPES,
        description:
          "Chart type to render — see the tool description for guidance and the required `data` shape for each.",
      },
      data: {
        description:
          "Chart data matching the shape required for the chosen visualType (see tool description).",
      },
    },
    required: ["title", "visualType", "data"],
  },

  async execute(params) {
    const title = (params["title"] as string | undefined)?.trim();
    const visualType = params["visualType"] as string | undefined;
    let data = params["data"];

    if (!title) return "Error: title is required.";
    if (!visualType) return "Error: visualType is required.";
    if (data === undefined) return "Error: data is required.";

    // Handle stringified data.
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        // leave as-is; validator below reports it
      }
    }

    const validate = VALIDATOR_BY_VISUAL_TYPE[visualType];
    if (!validate) {
      return `Error: unsupported visualType "${visualType}". Supported types: ${SUPPORTED_VISUAL_TYPES.join(", ")}.`;
    }

    const problem = validate(data);
    if (problem) {
      return `Error: \`data\` does not match the required shape for ${visualType} — ${problem}. See the tool description for the expected shape, then retry.`;
    }

    return "```chart\n" + JSON.stringify({ title, visualType, data }) + "\n```";
  },
};
