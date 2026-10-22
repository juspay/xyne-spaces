import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecideQuestion } from "../xor/questions.js";
import { UI_TESTER_PROMPT } from "./ui-tester-prompt.js";

export const UI_TESTER_EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../evals/ui-tester");

export const UI_TESTER_STANDARD_CHECKS = [
  { id: "cut_off", question: "Is any text, button or control cut off at the right edge of the screen?", type: "yesno" },
  {
    id: "overlap",
    question: "Does any text or element overlap another element so that it is hard to read?",
    type: "choice",
    options: { no: "No overlapping content", yes: "Yes, some content overlaps other content" },
  },
  {
    id: "errors",
    question: "Which error indications are visible on the page?",
    type: "choice",
    options: {
      none: "No error message anywhere",
      banner: "An inline error message or banner only",
      toast: "Error toast notifications only",
      both: "Both an inline error message and error toast notifications",
    },
  },
  {
    id: "placeholders",
    question: "Does any visible text contain programming placeholder values such as NaN, undefined, null or [object Object]?",
    type: "choice",
    options: { no: "No such placeholder values are visible", yes: "At least one such placeholder value is visible" },
  },
  {
    id: "toasts",
    question: "How many toast notifications are visible?",
    type: "choice",
    options: { none: "No toast notifications", one: "Exactly one toast notification", several: "Several toast notifications, repeating the same message" },
  },
  {
    id: "content",
    question: "What does the main content area show?",
    type: "choice",
    options: {
      data: "Real content or data (a list, table, form, cards or text)",
      empty: "An empty state saying there is nothing to show yet",
      error: "An error message instead of the content",
      loading: "Loading placeholders (skeleton rows or a spinner)",
      blank: "Nothing: the main area is blank",
    },
  },
  {
    id: "background",
    question: "Which colour theme is the page using?",
    type: "choice",
    options: { light: "Light theme (light background)", dark: "Dark theme (dark background)" },
  },
] as const satisfies readonly DecideQuestion[];

export type UiTesterStandardKey = (typeof UI_TESTER_STANDARD_CHECKS)[number]["id"];

export const UI_TESTER_HARNESS_TOOLS = ["ui-test-variations", "visual-check"] as const;

export const UI_TESTER_SANDBOX_TOOLS = [
  "sandbox-create",
  "sandbox-run",
  "sandbox-run-detached",
  "sandbox-poll-job",
  "sandbox-read-file",
  "sandbox-write-file",
  "sandbox-deliver-files",
] as const;

export type TemplateSampleValue = string | number | boolean | null;

export interface TemplateSample {
  input: string;
  image?: string;
  expected: Record<string, TemplateSampleValue>;
  label?: string;
}

export interface SubagentTemplate {
  id: string;
  title: string;
  summary: string;
  requires: string[];
  defaults: {
    name: string;
    description: string;
    progressLabels: string[];
    systemPrompt: string;
    paramName: string;
    paramDescription: string;
    tools: { custom: string[] };
    fast: true;
    checks: DecideQuestion[];
    budget?: { maxToolCalls: number };
  };
  textSamples?: TemplateSample[];
  imageSamples?: { suite: "ui-tester" };
}

const LOG_TRIAGE_CHECKS: DecideQuestion[] = [
  { id: "failure", question: "Is this log line a real failure that needs attention (not a retry that later succeeded, a debug line or expected noise)?", type: "yesno" },
  {
    id: "cause",
    question: "What is the most likely cause of this log line?",
    type: "choice",
    options: {
      database: "Database or storage error (connection refused, deadlock, query failed)",
      network: "Network error (timeout, DNS, connection reset, socket hang up)",
      auth: "Authentication or permission error (401, 403, expired or invalid token)",
      provider: "Upstream model or API provider error (rate limit, 429, 5xx from a provider)",
      config: "Configuration or deployment error (missing env var, bad config, not found)",
      code: "A bug in the code (TypeError, undefined, unhandled exception)",
      none: "Not an error",
    },
  },
  { id: "severity", question: "How severe is the impact on users?", type: "score", options: ["none", "low", "medium", "high"] },
];

const LOG_TRIAGE_SAMPLES: TemplateSample[] = [
  { input: "2026-10-21T10:02:11Z ERROR [orders-api] prisma: Can't reach database server at db:5432 (ECONNREFUSED)", expected: { failure: true, cause: "database", severity: "high" } },
  { input: "2026-10-21T10:02:13Z WARN [orders-api] retrying query attempt=1/3 after deadlock detected", expected: { failure: false, cause: "database" } },
  { input: "2026-10-21T10:05:40Z ERROR [gateway] upstream request failed: ETIMEDOUT after 30000ms host=payments.internal", expected: { failure: true, cause: "network", severity: "high" } },
  { input: "2026-10-21T10:06:02Z ERROR [agent] provider returned 429 Too Many Requests: rate limit exceeded, retry in 20s", expected: { failure: true, cause: "provider" } },
  { input: "2026-10-21T10:07:19Z ERROR [auth] token verification failed: jwt expired (sub=user-123)", expected: { failure: true, cause: "auth", severity: "low" } },
  { input: "2026-10-21T10:08:00Z INFO [worker] job 8812 completed in 412ms", expected: { failure: false, cause: "none", severity: "none" } },
  { input: "2026-10-21T10:08:31Z ERROR [worker] TypeError: Cannot read properties of undefined (reading 'items') at buildInvoice (invoice.ts:88)", expected: { failure: true, cause: "code", severity: "medium" } },
  { input: "2026-10-21T10:09:12Z ERROR [api] startup failed: missing required environment variable STRIPE_SECRET_KEY", expected: { failure: true, cause: "config", severity: "high" } },
  { input: "2026-10-21T10:10:45Z DEBUG [cache] miss key=user:42:prefs ttl=300", expected: { failure: false, cause: "none", severity: "none" } },
  { input: "2026-10-21T10:11:30Z ERROR [api] 403 Forbidden: user u-77 lacks permission orders:write", expected: { failure: true, cause: "auth" } },
  { input: "2026-10-21T10:12:02Z WARN [agent] upstream 503 from model provider, falling back to secondary model (succeeded)", expected: { failure: false, cause: "provider" } },
  { input: "2026-10-21T10:13:17Z ERROR [sync] socket hang up while streaming export to storage (ECONNRESET), 0 of 3 retries left", expected: { failure: true, cause: "network" } },
];

export const SUBAGENT_TEMPLATES: SubagentTemplate[] = [
  {
    id: "ui-tester",
    title: "UI tester",
    summary: "Tests a web UI change across its variations (data states, widths, themes) in the sandbox with mocked APIs, and judges each screenshot with xor. Comes with ui-tester's 7 visual checks and 9 labelled Runs-page screenshots as its eval set.",
    requires: ["Sandbox tools on the parent agent"],
    defaults: {
      name: "my-ui-tester",
      description:
        "Test a web UI change across every variation that matters (data states, phone and desktop widths, light and dark theme) inside the sandbox with mocked API responses. Runs on a cheap model and a visual classifier, so delegate UI verification here instead of taking screenshots yourself. Give it what changed, which routes show it, how to start the app, and what correct looks like.",
      progressLabels: ["🧪 Planning UI variations...", "📸 Rendering variations...", "🔎 Checking screenshots...", "📝 Writing the test report..."],
      systemPrompt: UI_TESTER_PROMPT,
      paramName: "request",
      paramDescription:
        "What changed (files/components/PR), the screens or routes that show it, how to run the app in the sandbox (directory, dev command, base URL) if not obvious, what correct looks like, and any variations or interactions that must be covered.",
      tools: { custom: [...UI_TESTER_HARNESS_TOOLS, ...UI_TESTER_SANDBOX_TOOLS] },
      fast: true,
      checks: UI_TESTER_STANDARD_CHECKS.map((c) => ({ ...c, ...("options" in c ? { options: { ...c.options } } : {}) })) as DecideQuestion[],
      budget: { maxToolCalls: 40 },
    },
    imageSamples: { suite: "ui-tester" },
  },
  {
    id: "log-triage",
    title: "Log triage",
    summary: "Classifies log lines in bulk with xor: real failure or noise, likely cause and severity, and returns a table with the unsure lines flagged. Text only; comes with 12 labelled sample lines.",
    requires: [],
    defaults: {
      name: "log-triage",
      description:
        "Triage many log lines at once: which are real failures, the likely cause (database, network, auth, provider, config, code) and how severe. Runs on a cheap model with xor, so delegate bulk log classification here instead of reading lines yourself. Pass the raw log lines.",
      progressLabels: ["🪵 Reading log lines...", "🧮 Classifying with xor...", "📝 Writing the triage table..."],
      systemPrompt: `You triage log lines. You never fix anything; you classify and summarise.

1. Split the input into one item per log line (drop blank lines; keep the original text). Give each a short id like l1, l2.
2. Call xor-decide ONCE with all lines as items and the checks below as questions. For more than 200 lines, split into calls of up to 200.
3. Report:
   - A summary: how many lines are real failures, by cause, and the highest severity seen.
   - A table of the real failures: id, cause, severity, and the line shortened to 120 characters.
   - The unsure lines listed separately as "needs a human look". Never guess for them.
Do not add causes that xor did not return, and do not re-read lines yourself unless asked.`,
      paramName: "lines",
      paramDescription: "The raw log lines to triage, one per line. Include timestamps and service names if you have them.",
      tools: { custom: ["xor-decide"] },
      fast: true,
      checks: LOG_TRIAGE_CHECKS,
      budget: { maxToolCalls: 8 },
    },
    textSamples: LOG_TRIAGE_SAMPLES,
  },
];

export function getSubagentTemplate(id: string): SubagentTemplate | undefined {
  return SUBAGENT_TEMPLATES.find((t) => t.id === id);
}

export async function loadTemplateSamples(template: SubagentTemplate): Promise<TemplateSample[]> {
  if (!template.imageSamples) return template.textSamples ?? [];
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(await readFile(join(UI_TESTER_EVAL_DIR, "cases.json"), "utf8")) as {
    cases: Array<{ id: string; image: string; expected: Record<string, TemplateSampleValue>; checks?: unknown }>;
  };
  const standard = fixture.cases.filter((c) => !c.checks);
  return Promise.all(
    standard.map(async (c) => {
      const bytes = await readFile(join(UI_TESTER_EVAL_DIR, c.image));
      return { input: "", image: `data:image/jpeg;base64,${bytes.toString("base64")}`, expected: c.expected, label: c.id };
    }),
  );
}
