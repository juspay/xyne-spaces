import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadUiTesterEvalSet } from "../src/ui-tester/eval-set.js";
import { CURRENT_MODEL, findRegressions, formatEvalReport, runChecksEval } from "../src/xor-eval.js";
import { xorEnabled } from "../src/xor.js";

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    compare: { type: "string" },
    variants: { type: "string" },
    out: { type: "string" },
    json: { type: "string" },
    "fail-on-regression": { type: "boolean", default: false },
  },
});

if (!xorEnabled()) {
  console.error("xor is not configured: set XOR_URL and XOR_API_KEY (and XOR_MODEL).");
  process.exit(2);
}

const list = (v: string | undefined) => (v ? v.split(",").map((m) => m.trim()).filter(Boolean) : []);
const models = values.models ? list(values.models) : [...new Set([CURRENT_MODEL, ...list(values.compare)])];
const variants = values.variants ? (JSON.parse(await readFile(values.variants, "utf8")) as Record<string, string[]>) : undefined;
const set = await loadUiTesterEvalSet();
const report = await runChecksEval({ ...set, models, ...(variants ? { variants } : {}) });
const md = formatEvalReport(report, "ui-tester visual eval");
console.log(md);
if (values.out) await writeFile(values.out, md + "\n");
if (values.json) await writeFile(values.json, JSON.stringify(report, null, 2) + "\n");
const [base, ...rest] = report.models;
const regressed = base ? rest.some((m) => findRegressions(base, m).length > 0) : false;
if (values["fail-on-regression"] && regressed) process.exit(1);
