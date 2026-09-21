#!/usr/bin/env node
// Self-contained HTML summary of a run, built from Gauge's json-report. Failures
// (step, error, screenshot) up front; passing scenarios collapsed. No external assets,
// so it can be posted anywhere as a single .html.
//
// Usage: node build-summary-report.mjs <artifactDir> [out.html]   (default: <artifactDir>/report.html)
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = process.argv[2];
if (!artifactDir) {
  console.error('usage: build-summary-report.mjs <artifactDir> [out.html]');
  process.exit(2);
}
const outFile = process.argv[3] ?? path.join(artifactDir, 'report.html');
const result = JSON.parse(
  fs.readFileSync(path.join(artifactDir, 'json-report', 'result.json'), 'utf8')
);
const meta = readJson(path.join(artifactDir, 'run-metadata.json')) ?? {};
// Written by run-gauge.ts: scenarios re-run after the main pass, as "<spec>:<line>". Anything
// in retriedAtEnd but not stillFailing recovered, and result.json still says "failed" for it.
const recovery = readJson(path.join(artifactDir, 'retry-recovery.json')) ?? {
  retriedAtEnd: [],
  stillFailing: [],
};
const specOf = (item) => item.replace(/:\d+$/, '');
const inList = (list, spec) => list.map(specOf).some((p) => spec.fileName.endsWith(p));
const recoveredAtEnd = (spec, sc) =>
  sc.executionStatus === 'failed' &&
  inList(recovery.retriedAtEnd, spec) &&
  !inList(recovery.stillFailing, spec);

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const ms = (n) =>
  n >= 60000
    ? `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}s`
      : `${n}ms`;
const specName = (s) => s.specHeading || path.basename(s.fileName);

// Gauge stores screenshots as files (ScreenshotFile) in html-report/images, or inline base64 (screenshot).
function screenshotDataUri(r) {
  if (r.screenshot) return `data:image/png;base64,${r.screenshot}`;
  if (!r.ScreenshotFile) return null;
  for (const dir of ['html-report/images', 'screenshots', '.gauge/screenshots']) {
    const p = path.join(artifactDir, dir, r.ScreenshotFile);
    if (fs.existsSync(p)) return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  }
  return null;
}

function failuresOf(scenario) {
  const out = [];
  for (const it of [
    ...(scenario.contexts ?? []),
    ...(scenario.items ?? []),
    ...(scenario.teardowns ?? []),
  ]) {
    if (it.itemType === 'step' && it.result?.status === 'failed')
      out.push({ step: it.stepText, ...it.result });
    if (it.itemType === 'concept')
      for (const s of it.steps ?? [])
        if (s.result?.status === 'failed') out.push({ step: s.stepText, ...s.result });
  }
  for (const k of ['beforeScenarioHookFailure', 'afterScenarioHookFailure'])
    if (scenario[k]) out.push({ step: k, ...scenario[k] });
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
const hookFailures = ['beforeSuiteHookFailure', 'afterSuiteHookFailure']
  .filter((k) => result[k])
  .map((k) => ({ where: k, ...result[k] }));

const failureBlock = (spec, sc) =>
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

const scenarioRow = (spec, sc) => {
  const st = recoveredAtEnd(spec, sc) ? 'passed' : sc.executionStatus;
  const attempts = (sc.retriesCount ?? 1) - 1 + (recoveredAtEnd(spec, sc) ? 1 : 0);
  return `<li class="${st}">${st === 'passed' ? '✓' : st === 'failed' ? '✗' : '–'} ${esc(sc.scenarioHeading)}<span class="t">${ms(sc.executionTime)}</span>${attempts > 0 ? `<span class="badge warn">retried ×${attempts}</span>` : ''}</li>`;
};

const specBlock = (spec) => {
  const scs = spec.scenarios ?? [],
    total = scs.length;
  const failing = scs.filter((sc) => sc.executionStatus === 'failed' && !recoveredAtEnd(spec, sc));
  const fails = failing.length,
    st = fails > 0 ? 'failed' : spec.executionStatus === 'skipped' ? 'skipped' : 'passed';
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
</style></head><body>
<div class="hdr"><h1>Automation report</h1><span class="badge ${status}">${status.toUpperCase()}</span></div>
<div class="muted">commit <code>${esc(meta.commitHash ?? '')}</code> · ${esc(result.timestamp)} · ${esc(meta.mode ?? '')} · tags <code>${esc(result.tags || '—')}</code></div>
<div class="chips">
  <div class="chip"><b>${passedCount}</b> / ${allScenarios.length} scenarios passed</div>
  <div class="chip"><b>${failed.length}</b> failed</div>
  <div class="chip"><b>${result.skippedScenariosCount}</b> skipped</div>
  <div class="chip"><b>${specs.length - new Set(failed.map(({ spec }) => spec.fileName)).size}</b> / ${specs.length} specs passed</div>
  <div class="chip"><b>${retried.length}</b> retried</div>
  <div class="chip"><b>${ms(result.executionTime)}</b> total</div>
</div>
${hookFailures.length ? `<h2>Suite hook failures</h2>${hookFailures.map((h) => `<div class="fail"><div class="step">${esc(h.where)}</div><pre class="err">${esc(h.errorMessage ?? '')}</pre>${h.stackTrace ? `<details><summary>stack trace</summary><pre class="stack">${esc(h.stackTrace)}</pre></details>` : ''}</div>`).join('')}` : ''}
${failed.length ? `<h2>Failures (${failed.length})</h2>${failed.map(({ spec, sc }) => failureBlock(spec, sc)).join('')}` : ''}
${retried.length ? `<h2>Passed only after retry (${retried.length})</h2><p class="muted">These flaked — they failed at least once and passed on a later attempt.</p><ul>${retried.map(({ spec, sc }) => scenarioRow(spec, sc)).join('')}</ul>` : ''}
<h2>Specs (${specs.length})</h2>
${specs.map(specBlock).join('')}
</body></html>`;

fs.writeFileSync(outFile, html);
