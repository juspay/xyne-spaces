/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
// Self-contained HTML summary of a run, built from Gauge's json-report. Failures
// (step, error, screenshot) up front; passing scenarios collapsed. No external assets,
// so it can be posted anywhere as a single .html.
//
// Usage: ts-node --project tsconfig.json scripts/build-summary-report.ts <artifactDir> [out.html]
//        (default out: <artifactDir>/report.html)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { moduleLabelForSpec, RELEASE_MODULES } from '@/scripts/release/modules';

interface StepResult {
  status?: string;
  errorMessage?: string;
  stackTrace?: string;
  screenshot?: string;
  ScreenshotFile?: string;
}

interface ReportItem {
  itemType?: string;
  stepText?: string;
  result?: StepResult;
  // Concepts: their own step text, and their children (steps or nested concepts) under `items`.
  conceptStep?: { stepText?: string };
  items?: ReportItem[];
}

interface Scenario {
  scenarioHeading: string;
  executionStatus: string;
  executionTime: number;
  retriesCount?: number;
  contexts?: ReportItem[];
  items?: ReportItem[];
  teardowns?: ReportItem[];
  beforeScenarioHookFailure?: StepResult;
  afterScenarioHookFailure?: StepResult;
}

interface Spec {
  fileName: string;
  specHeading?: string;
  executionStatus?: string;
  executionTime: number;
  scenarios?: Scenario[];
}

interface GaugeResult {
  specResults?: Spec[];
  beforeSuiteHookFailure?: StepResult;
  afterSuiteHookFailure?: StepResult;
  timestamp?: string;
  tags?: string;
  executionTime: number;
  skippedScenariosCount?: number;
}

interface RunMetadata {
  commitHash?: string;
  mode?: string;
}

interface RetryRecovery {
  retriedAtEnd: string[];
  stillFailing: string[];
}

type Failure = StepResult & { step?: string };

// Written by release-check.ts next to the Gauge results; absent for plain CI/local runs.
interface ReleaseCheckInfo {
  branch: string;
  commit: string;
  runBy: string;
  startedAt: string;
  finishedAt: string;
  modules: string[];
  uncommittedFiles: string[];
  // Optional: absent in release-check.json files written before it was recorded.
  untrackedFiles?: string[];
}

const artifactDir = process.argv[2];
if (!artifactDir) {
  console.error('usage: build-summary-report.ts <artifactDir> [out.html]');
  process.exit(2);
}
const outFile = process.argv[3] ?? path.join(artifactDir, 'report.html');

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

const result = JSON.parse(
  fs.readFileSync(path.join(artifactDir, 'json-report', 'result.json'), 'utf8')
) as GaugeResult;
const meta = readJson<RunMetadata>(path.join(artifactDir, 'run-metadata.json')) ?? {};
const releaseInfo = readJson<ReleaseCheckInfo>(path.join(artifactDir, 'release-check.json'));
// Written by run-gauge.ts: scenarios re-run after the main pass, as "<spec>:<line>". Anything
// in retriedAtEnd but not stillFailing recovered, and result.json still says "failed" for it.
const recovery = readJson<RetryRecovery>(path.join(artifactDir, 'retry-recovery.json')) ?? {
  retriedAtEnd: [],
  stillFailing: [],
};
const specOf = (item: string): string => item.replace(/:\d+$/, '');
const inList = (list: string[], spec: Spec): boolean =>
  list.map(specOf).some((p) => spec.fileName.endsWith(p));
const recoveredAtEnd = (spec: Spec, sc: Scenario): boolean =>
  sc.executionStatus === 'failed' &&
  inList(recovery.retriedAtEnd, spec) &&
  !inList(recovery.stillFailing, spec);

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
const ms = (n: number): string =>
  n >= 60000
    ? `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}s`
      : `${n}ms`;
const specName = (s: Spec): string => s.specHeading || path.basename(s.fileName);

// Gauge stores screenshots as files (ScreenshotFile) in html-report/images, or inline base64 (screenshot).
function screenshotDataUri(r: StepResult): string | null {
  if (r.screenshot) return `data:image/png;base64,${r.screenshot}`;
  if (!r.ScreenshotFile) return null;
  for (const dir of ['html-report/images', 'screenshots', '.gauge/screenshots']) {
    const p = path.join(artifactDir, dir, r.ScreenshotFile);
    if (fs.existsSync(p)) return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  }
  return null;
}

// Failed steps anywhere in the scenario. Concepts nest steps (and other concepts) under `items`,
// so walk the whole tree; the label keeps the concept path, e.g. "Logging in › clicking on …".
function failuresOf(scenario: Scenario): Failure[] {
  const out: Failure[] = [];
  const walk = (items: ReportItem[], trail: string[]): void => {
    for (const it of items) {
      if (it.itemType === 'concept') {
        walk(it.items ?? [], [...trail, it.conceptStep?.stepText ?? 'concept']);
      } else if (it.itemType === 'step' && it.result?.status === 'failed') {
        out.push({ step: [...trail, it.stepText ?? 'step'].join(' › '), ...it.result });
      }
    }
  };
  walk(
    [...(scenario.contexts ?? []), ...(scenario.items ?? []), ...(scenario.teardowns ?? [])],
    []
  );
  for (const k of ['beforeScenarioHookFailure', 'afterScenarioHookFailure'] as const) {
    const hookFailure = scenario[k];
    if (hookFailure) out.push({ step: k, ...hookFailure });
  }
  return out;
}

const specs = result.specResults ?? [];
const allScenarios = specs.flatMap((s) => (s.scenarios ?? []).map((sc) => ({ spec: s, sc })));
// retriesCount counts attempts: 1 = passed first time.
const failed = allScenarios.filter(
  ({ spec, sc }) => sc.executionStatus === 'failed' && !recoveredAtEnd(spec, sc)
);
const retried = allScenarios.filter(
  ({ spec, sc }) => (sc.retriesCount ?? 1) > 1 || recoveredAtEnd(spec, sc)
);
const status =
  failed.length === 0 && !result.beforeSuiteHookFailure && !result.afterSuiteHookFailure
    ? 'passed'
    : 'failed';
const passedCount =
  allScenarios.length -
  failed.length -
  allScenarios.filter(({ sc }) => sc.executionStatus === 'skipped').length;
const hookFailures = (['beforeSuiteHookFailure', 'afterSuiteHookFailure'] as const)
  .filter((k) => result[k])
  .map((k) => ({ where: k, ...result[k] }));

// Per-module totals, in the order modules are declared; folders no module lists come last.
const moduleOrder = RELEASE_MODULES.map((m) => m.label);
const moduleStats = new Map<string, { total: number; failed: number; skipped: number }>();
for (const { spec, sc } of allScenarios) {
  const label = moduleLabelForSpec(spec.fileName);
  const stats = moduleStats.get(label) ?? { total: 0, failed: 0, skipped: 0 };
  stats.total++;
  if (sc.executionStatus === 'failed' && !recoveredAtEnd(spec, sc)) stats.failed++;
  else if (sc.executionStatus === 'skipped') stats.skipped++;
  moduleStats.set(label, stats);
}
const rank = (label: string): number => {
  const i = moduleOrder.indexOf(label);
  return i === -1 ? moduleOrder.length : i;
};
const moduleRows = [...moduleStats.entries()]
  .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
  .map(([label, st]) => {
    const passed = st.total - st.failed - st.skipped;
    const icon = st.failed > 0 ? '❌' : passed === st.total ? '✅' : '⚠️';
    return `<tr><td>${icon}</td><td>${esc(label)}</td><td>${passed}/${st.total}</td><td>${st.failed || ''}</td><td>${st.skipped || ''}</td></tr>`;
  })
  .join('');
const moduleTable = moduleRows
  ? `<h2>Modules</h2><table class="mods"><thead><tr><th></th><th>Module</th><th>Passed</th><th>Failed</th><th>Skipped</th></tr></thead><tbody>${moduleRows}</tbody></table>`
  : '';

const releaseBlock = releaseInfo
  ? `<div class="release">
  <div><b>Release check</b> · branch <code>${esc(releaseInfo.branch)}</code> · commit <code>${esc(releaseInfo.commit)}</code></div>
  <div class="muted">Run by ${esc(releaseInfo.runBy)} · ${esc(releaseInfo.startedAt)} → ${esc(releaseInfo.finishedAt)} · modules: ${esc(releaseInfo.modules.length ? releaseInfo.modules.join(', ') : 'all')}</div>
  ${
    releaseInfo.uncommittedFiles.length
      ? `<div class="warnline">⚠️ Run with uncommitted changes (results may not match the commit): ${esc(releaseInfo.uncommittedFiles.join(', '))}</div>`
      : '<div class="muted">No uncommitted changes to tracked files: results match the commit above.</div>'
  }
  ${
    releaseInfo.untrackedFiles?.length
      ? `<details class="muted"><summary>${releaseInfo.untrackedFiles.length} untracked file(s) present (not in the commit)</summary>${esc(releaseInfo.untrackedFiles.join(', '))}</details>`
      : ''
  }
</div>`
  : '';

const failureBlock = (spec: Spec, sc: Scenario): string =>
  failuresOf(sc)
    .map((f) => {
      const shot = screenshotDataUri(f);
      return `<div class="fail">
    <div class="crumb">${esc(specName(spec))} › <b>${esc(sc.scenarioHeading)}</b></div>
    <div class="step">✗ ${esc(f.step)}</div>
    ${f.errorMessage ? `<pre class="err">${esc(f.errorMessage.trim())}</pre>` : ''}
    ${shot ? `<a href="${shot}" target="_blank"><img class="shot" src="${shot}" alt="screenshot"></a>` : ''}
    ${f.stackTrace ? `<details><summary>stack trace</summary><pre class="stack">${esc(f.stackTrace.trim())}</pre></details>` : ''}
  </div>`;
    })
    .join('');

const scenarioRow = (spec: Spec, sc: Scenario): string => {
  const st = recoveredAtEnd(spec, sc) ? 'passed' : sc.executionStatus;
  const attempts = (sc.retriesCount ?? 1) - 1 + (recoveredAtEnd(spec, sc) ? 1 : 0);
  return `<li class="${st}">${st === 'passed' ? '✓' : st === 'failed' ? '✗' : '–'} ${esc(sc.scenarioHeading)}<span class="t">${ms(sc.executionTime)}</span>${attempts > 0 ? `<span class="badge warn">retried ×${attempts}</span>` : ''}</li>`;
};

const specBlock = (spec: Spec): string => {
  const scs = spec.scenarios ?? [];
  const total = scs.length;
  const failing = scs.filter((sc) => sc.executionStatus === 'failed' && !recoveredAtEnd(spec, sc));
  const fails = failing.length;
  const st = fails > 0 ? 'failed' : spec.executionStatus === 'skipped' ? 'skipped' : 'passed';
  return `<details class="spec ${st}"${fails > 0 ? ' open' : ''}><summary><span class="dot"></span>${esc(specName(spec))}<span class="counts">${total - fails}/${total} passed</span><span class="t">${ms(spec.executionTime)}</span></summary>
    <ul>${scs.map((sc) => scenarioRow(spec, sc)).join('')}</ul>
    ${failing.map((sc) => failureBlock(spec, sc)).join('')}
  </details>`;
};
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Automation report — ${esc(meta.commitHash ?? '')}</title>
<style>
  body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2328;background:#fff;margin:0;padding:24px;max-width:1100px}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}
  .muted{color:#656d76}.hdr{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;margin-left:8px}
  .badge.passed{background:#dafbe1;color:#116329}.badge.failed{background:#ffebe9;color:#a40e26}.badge.warn{background:#fff8c5;color:#7d4e00}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}.chip{border:1px solid #d0d7de;border-radius:6px;padding:6px 10px}.chip b{font-size:16px}
  .spec{border:1px solid #d0d7de;border-radius:6px;margin:8px 0;padding:0 12px}.spec summary{cursor:pointer;padding:10px 0;list-style:none;display:flex;align-items:center;gap:8px}
  .spec summary::-webkit-details-marker{display:none}.dot{width:10px;height:10px;border-radius:50%;background:#1a7f37;flex:none}.spec.failed .dot{background:#cf222e}.spec.skipped .dot{background:#9a6700}
  .counts{color:#656d76;margin-left:auto}.t{color:#8c959f;font-size:12px;margin-left:10px;font-variant-numeric:tabular-nums}
  ul{list-style:none;margin:0 0 10px;padding:0 0 0 18px}li{padding:3px 0}li.failed{color:#a40e26}li.skipped{color:#9a6700}
  .fail{background:#fff8f8;border:1px solid #ffcecb;border-radius:6px;padding:12px;margin:8px 0}.crumb{color:#656d76;margin-bottom:6px}.step{font-weight:600;color:#a40e26}
  pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;border-radius:6px;padding:10px;margin:8px 0;font-size:12px}.stack{max-height:280px;overflow:auto}
  .shot{max-width:100%;border:1px solid #d0d7de;border-radius:6px;margin-top:6px}
  details>summary{cursor:pointer}
  .release{border:1px solid #d0d7de;border-radius:6px;padding:10px 12px;margin:12px 0}.warnline{color:#9a6700;margin-top:4px}
  table.mods{border-collapse:collapse;margin:4px 0 8px}table.mods th,table.mods td{border:1px solid #d0d7de;padding:4px 10px;text-align:left}table.mods th{background:#f6f8fa}
</style></head><body>
<div class="hdr"><h1>${releaseInfo ? `Release check — ${esc(releaseInfo.branch)}` : 'Automation report'}</h1><span class="badge ${status}">${status.toUpperCase()}</span></div>
<div class="muted">commit <code>${esc(meta.commitHash ?? '')}</code> · ${esc(result.timestamp)} · ${esc(meta.mode ?? '')} · tags <code>${esc(result.tags || '—')}</code></div>
<div class="chips">
  <div class="chip"><b>${passedCount}</b> / ${allScenarios.length} scenarios passed</div>
  <div class="chip"><b>${failed.length}</b> failed</div>
  <div class="chip"><b>${result.skippedScenariosCount}</b> skipped</div>
  <div class="chip"><b>${specs.length - new Set(failed.map(({ spec }) => spec.fileName)).size}</b> / ${specs.length} specs passed</div>
  <div class="chip"><b>${retried.length}</b> retried</div>
  <div class="chip"><b>${ms(result.executionTime)}</b> total</div>
</div>
${releaseBlock}
${moduleTable}
${hookFailures.length ? `<h2>Suite hook failures</h2>${hookFailures.map((h) => `<div class="fail"><div class="step">${esc(h.where)}</div><pre class="err">${esc(h.errorMessage ?? '')}</pre>${h.stackTrace ? `<details><summary>stack trace</summary><pre class="stack">${esc(h.stackTrace)}</pre></details>` : ''}</div>`).join('')}` : ''}
${failed.length ? `<h2>Failures (${failed.length})</h2>${failed.map(({ spec, sc }) => failureBlock(spec, sc)).join('')}` : ''}
${retried.length ? `<h2>Passed only after retry (${retried.length})</h2><p class="muted">These flaked — they failed at least once and passed on a later attempt.</p><ul>${retried.map(({ spec, sc }) => scenarioRow(spec, sc)).join('')}</ul>` : ''}
<h2>Specs (${specs.length})</h2>
${specs.map(specBlock).join('')}
</body></html>`;

fs.writeFileSync(outFile, html);
console.log(
  `${outFile} (${(html.length / 1024).toFixed(0)} KB, ${failed.length} failed, ${retried.length} retried)`
);
