import type { PrEvidence } from "./pr-evidence.js";
import type { ReviewFinding } from "./pr-review-findings.js";

const STYLE = `
:root{
 --bg:#0d1117; --panel:#141b24; --panel2:#1b232e; --line:#26313d;
 --fg:#e6edf3; --dim:#8b98a5; --dimmer:#5f6b78;
 --hi:#ff6b6b; --med:#e3a008; --low:#3fb950; --acc:#58a6ff; --warn:#d29922;
 --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;}
.wrap{max-width:1180px;margin:0 auto;padding:32px 28px 96px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);
   margin:64px 0 18px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.sub{color:var(--dim);font-size:14px;margin:0 0 28px}
code,pre,.mono{font-family:var(--mono)}
a{color:var(--acc)}

.three{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0 8px}
.q{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
.q .lbl{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dimmer);margin-bottom:8px}
.q .big{font-size:19px;font-weight:600;line-height:1.35}
.q .note{color:var(--dim);font-size:13px;margin-top:8px}

.shape{display:flex;gap:10px;margin-top:18px;font-size:13px;flex-wrap:wrap}
.pill{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:5px 13px;color:var(--dim)}
.pill b{color:var(--fg);font-weight:600}

.bar{display:flex;height:34px;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin-top:16px}
.bar div{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600}
.bar .new{background:#1d2b1f;color:#7ee787}
.bar .int{background:#3a1d1d;color:#ff9c9c}

.filter{display:flex;gap:8px;margin:22px 0 0}
.filter button{background:var(--panel2);border:1px solid var(--line);color:var(--dim);
 padding:7px 14px;border-radius:7px;font-size:13px;cursor:pointer;font-family:inherit}
.filter button.on{background:#1f6feb22;border-color:var(--acc);color:var(--fg)}

.card{background:var(--panel);border:1px solid var(--line);border-left-width:4px;
 border-radius:10px;padding:20px 22px;margin-bottom:16px}
.card.hi{border-left-color:var(--hi)}
.card.med{border-left-color:var(--med)}
.card.low{border-left-color:var(--low);opacity:.86}
.card.weight{box-shadow:0 0 0 1px #ff6b6b22, 0 8px 30px -12px #ff6b6b33}
.chead{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-bottom:12px}
.chip{font-size:11px;font-weight:700;letter-spacing:.08em;padding:3px 9px;border-radius:5px}
.chip.hi{background:var(--hi);color:#2b0000}
.chip.med{background:var(--med);color:#2b1d00}
.chip.low{background:var(--low);color:#04260f}
.ctitle{font-size:16px;font-weight:600}
.floc{font-family:var(--mono);font-size:12.5px;color:var(--acc)}
.row{display:grid;grid-template-columns:132px 1fr;gap:10px;padding:7px 0;border-top:1px solid #1e2732;font-size:14px}
.row:first-of-type{border-top:0}
.row .k{color:var(--dimmer);font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding-top:3px}
.ask{background:#1f6feb14;border:1px solid #1f6feb44;border-radius:8px;padding:11px 14px;margin-top:13px;font-size:14px}
.ask b{color:var(--acc);font-size:11px;letter-spacing:.09em;text-transform:uppercase;display:block;margin-bottom:5px}
.tests{display:inline-block;background:#3a1d1d;color:#ff9c9c;border:1px solid #5a2b2b;
 border-radius:5px;padding:2px 9px;font-size:11.5px;font-family:var(--mono)}
.jump{background:none;border:1px solid var(--line);color:var(--dim);border-radius:6px;
 padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;margin-top:13px}
.jump:hover{color:var(--fg);border-color:var(--acc)}

.map{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px}
.mapnote{color:var(--dim);font-size:13.5px;margin-top:16px;line-height:1.65}

.unknown{background:#2a1f08;border:1px solid #5c4611;border-radius:10px;padding:20px 22px}
.unknown h3{margin:0 0 14px;font-size:14px;color:var(--warn);letter-spacing:.05em}
.unknown ul{margin:0;padding-left:20px}
.unknown li{margin-bottom:11px;font-size:14px;line-height:1.6}
.nv{display:inline-block;background:#5c4611;color:#ffd479;border-radius:4px;
 padding:1px 7px;font-size:10.5px;font-weight:700;letter-spacing:.07em;font-family:var(--mono);margin-right:7px}

ol.path{counter-reset:s;list-style:none;padding:0;margin:0}
ol.path li{background:var(--panel);border:1px solid var(--line);border-radius:9px;
 padding:14px 18px;margin-bottom:10px;display:flex;gap:14px;align-items:flex-start;cursor:pointer}
ol.path li:hover{border-color:var(--acc)}
ol.path li.done{opacity:.5}
ol.path li.done .txt{text-decoration:line-through}
.box{width:19px;height:19px;border:1.5px solid var(--dimmer);border-radius:5px;flex:none;margin-top:2px;
 display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--low)}
li.done .box{border-color:var(--low)}
.txt{font-size:14.5px}
.txt small{display:block;color:var(--dim);font-size:12.5px;margin-top:3px}

details.f{background:var(--panel);border:1px solid var(--line);border-radius:9px;margin-bottom:10px;overflow:hidden}
details.f>summary{cursor:pointer;padding:13px 18px;font-family:var(--mono);font-size:13px;
 display:flex;justify-content:space-between;gap:12px;align-items:center;list-style:none}
details.f>summary::-webkit-details-marker{display:none}
details.f[open]>summary{border-bottom:1px solid var(--line);background:var(--panel2)}
.tag{font-size:10.5px;letter-spacing:.07em;padding:2px 8px;border-radius:4px;background:#26313d;color:var(--dim)}
.tag.hi{background:#3a1d1d;color:#ff9c9c}
.tag.med{background:#3a2f14;color:#e8c46a}
pre.d{margin:0;padding:15px 18px;overflow-x:auto;font-size:12.3px;line-height:1.62;background:#0b1017}
pre.d .a{color:#7ee787;display:block}
pre.d .r{color:#ff9c9c;display:block}
pre.d .h{color:#8b949e;display:block;margin-top:6px}
pre.d .c{color:#6e7d8c;display:block}
.newlist{color:var(--dim);font-size:13.5px;line-height:2}
.newlist code{color:var(--fg);font-size:12.5px}
.foot{margin-top:60px;padding-top:18px;border-top:1px solid var(--line);color:var(--dimmer);font-size:12.5px;line-height:1.8}
`;

const LOGIC = `const SEVLABEL = {hi:"HIGH", med:"MED", low:"LOW"};

function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function diffHtml(text){
  return text.split("\\n").map(function(l){
    var c = l.indexOf("@@") === 0 ? "h" : l.charAt(0) === "+" ? "a" : l.charAt(0) === "-" ? "r" : "c";
    return '<span class="'+c+'">'+esc(l || " ")+'</span>';
  }).join("");
}

var cards = document.getElementById("cards");
cards.innerHTML = FINDINGS.map(function(f, i){
  return '<div class="card '+f.sev+(f.weight?" weight":"")+'" data-int="'+(f.integration?1:0)+'" id="'+f.id+'">'
    + '<div class="chead"><span class="chip '+f.sev+'">'+SEVLABEL[f.sev]+'</span>'
    + '<span class="ctitle">'+(i+1)+'. '+f.title+'</span></div>'
    + '<div class="floc">'+esc(f.file)+'  '+f.loc+'</div>'
    + '<div style="height:12px"></div>'
    + '<div class="row"><div class="k">Changed</div><div>'+f.what+'</div></div>'
    + '<div class="row"><div class="k">Why it matters</div><div>'+f.why+'</div></div>'
    + '<div class="row"><div class="k">Blast radius</div><div>'+f.blast+'</div></div>'
    + (f.history ? '<div class="row"><div class="k">History</div><div>'+f.history+'</div></div>' : '')
    + (f.note ? '<div class="row"><div class="k">Author says</div><div>'+f.note+'</div></div>' : '')
    + '<div class="row"><div class="k">Tests</div><div>'+testsHtml(f.file)+'</div></div>'
    + '<div class="ask"><b>Reviewer question</b>'+f.ask+'</div>'
    + (HUNKS[f.file] ? '<button class="jump" data-file="'+esc(f.file)+'">Open this diff ↓</button>' : '')
    + '</div>';
}).join("");

var ORDER = [];
FINDINGS.forEach(function(f){ if (HUNKS[f.file] && ORDER.indexOf(f.file) === -1) ORDER.push(f.file); });
Object.keys(HUNKS).forEach(function(f){ if (ORDER.indexOf(f) === -1) ORDER.push(f); });

var TAG = __TAG__;

document.getElementById("diffs").innerHTML = ORDER.map(function(f){
  var t = TAG[f] || "";
  return '<details class="f" data-diff="'+esc(f)+'"><summary><span>'+esc(f)+'</span>'
   + '<span class="tag '+t+'">'+(t?SEVLABEL[t]:"integration")+'</span></summary>'
   + '<pre class="d">'+diffHtml(HUNKS[f])+'</pre></details>';
}).join("");

cards.addEventListener("click", function(e){
  var b = e.target.closest(".jump"); if (!b) return;
  var d = document.querySelector('details.f[data-diff="'+b.getAttribute("data-file")+'"]');
  if (!d) return;
  d.open = true;
  d.scrollIntoView({behavior:"smooth", block:"center"});
});

var fAll = document.getElementById("fAll"), fInt = document.getElementById("fInt");
function applyFilter(intOnly){
  fAll.classList.toggle("on", !intOnly);
  fInt.classList.toggle("on", intOnly);
  Array.prototype.forEach.call(cards.children, function(c){
    c.style.display = (!intOnly || c.getAttribute("data-int") === "1") ? "" : "none";
  });
}
fAll.onclick = function(){ applyFilter(false); };
fInt.onclick = function(){ applyFilter(true); };

var KEY = "xyne-review-room-" + ROOM_KEY;
var done = {};
try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { done = {}; }
var path = document.getElementById("path");
Array.prototype.forEach.call(path.children, function(li){
  var i = li.getAttribute("data-i");
  if (done[i]) li.classList.add("done");
  li.addEventListener("click", function(){
    li.classList.toggle("done");
    done[i] = li.classList.contains("done");
    try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {}
  });
});
`;

export interface ReviewRoomMeta {
  title: string;
  prUrl: string | undefined;
  prNumber: string | undefined;
  repo: string | undefined;
  author: string | undefined;
  baseRef: string;
  headSha: string;
  roomKey: string;
  shapeAnswer: string;
  shapeNote: string;
  hurtAnswer: string;
  hurtNote: string;
  unknownAnswer: string;
  unknownNote: string;
  unknowns: string[];
  reviewPath: Array<{ title: string; note: string }>;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderReviewRoom(params: {
  meta: ReviewRoomMeta;
  evidence: PrEvidence;
  findings: ReviewFinding[];
}): string {
  const { meta, evidence, findings } = params;

  const hunks: Record<string, string> = {};
  for (const f of [...evidence.editedFiles, ...evidence.newFiles]) {
    if (f.hunks) hunks[f.path] = f.hunks;
  }
  const tests: Record<string, string[]> = {};
  for (const f of [...evidence.editedFiles, ...evidence.newFiles]) {
    tests[f.path] = f.testFiles;
  }
  const tag: Record<string, string> = {};
  for (const f of findings) {
    if (f.sev !== "low" && !tag[f.file]) tag[f.file] = f.sev;
  }

  const heading = meta.prNumber ? `PR #${escHtml(meta.prNumber)} — Review Room` : "Review Room";
  const prLink = meta.prUrl
    ? `<a href="${escHtml(meta.prUrl)}">${escHtml(meta.repo ?? meta.prUrl)}${meta.prNumber ? `#${escHtml(meta.prNumber)}` : ""}</a> · `
    : "";

  const newPct = evidence.newFileLines || 1;
  const intPct = evidence.editedFileLines || 1;

  const newFileList = evidence.newFiles
    .map((f) => `<code>${escHtml(f.path)}</code> +${f.insertions}<br>`)
    .join("\n");

  const unknownItems = meta.unknowns
    .map((u) => `<li><span class="nv">NOT VERIFIED</span>${u}</li>`)
    .join("\n");

  const pathItems = meta.reviewPath
    .map(
      (p, i) =>
        `<li data-i="${i}"><span class="box">✓</span><span class="txt">${p.title}<small>${p.note}</small></span></li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(heading)}</title>
<style>${STYLE}</style></head><body><div class="wrap">
<h1>${escHtml(heading)}</h1>
<p class="sub">${prLink}${escHtml(meta.title)}${meta.author ? ` · ${escHtml(meta.author)}` : ""} · targets <code>${escHtml(meta.baseRef)}</code>
 <br>This room teaches the <b>territory</b>, not the change. Read it before the diff.</p>

<div class="three">
 <div class="q"><div class="lbl">1 · What shape is this change?</div>
  <div class="big">${meta.shapeAnswer}</div>
  <div class="note">${meta.shapeNote}</div></div>
 <div class="q"><div class="lbl">2 · What here can hurt me?</div>
  <div class="big">${meta.hurtAnswer}</div>
  <div class="note">${meta.hurtNote}</div></div>
 <div class="q"><div class="lbl">3 · What does nobody know yet?</div>
  <div class="big">${meta.unknownAnswer}</div>
  <div class="note">${meta.unknownNote}</div></div>
</div>

<div class="shape">
 <span class="pill"><b>+${evidence.insertions}</b> / −${evidence.deletions}</span>
 <span class="pill"><b>${evidence.filesChanged}</b> files</span>
 <span class="pill"><b>${evidence.newFileCount}</b> new, self-contained</span>
 <span class="pill"><b>${evidence.editedFileCount}</b> integration edits</span>
 <span class="pill">head <code>${escHtml(evidence.headSha.slice(0, 10))}</code></span>
</div>
<div class="bar">
 <div class="new" style="flex:${newPct}">${evidence.newFileLines} lines · new files · low review risk</div>
 <div class="int" style="flex:${intPct}">${evidence.editedFileLines} lines · integration · the risk</div>
</div>
<p class="sub" style="margin-top:12px">The ${evidence.newFileLines} lines are not the job. <b>${evidence.editedFileLines} lines across ${evidence.editedFileCount} existing files</b> are.</p>

<h2>Risk-ranked findings</h2>
<div class="filter">
 <button id="fAll" class="on">Everything</button>
 <button id="fInt">Integration edits only</button>
</div>
<div style="height:18px"></div>
<div id="cards"></div>

<h2>Unknowns — not verified</h2>
<div class="unknown">
<h3>These are open questions, not findings. Nobody has established them either way.</h3>
<ul>
${unknownItems}
</ul>
</div>

<h2>Review path</h2>
<ol class="path" id="path">
${pathItems}
</ol>

<h2>Diff — drill down</h2>
<p class="sub">Integration edits first: these are the ${evidence.editedFileLines} lines that carry the risk. Expanded on demand.</p>
<div id="diffs"></div>
<div style="height:22px"></div>
<details class="f"><summary><span>${evidence.newFileCount} new files · ${evidence.newFileLines} lines · low review risk</span><span class="tag">collapsed</span></summary>
<div style="padding:16px 18px" class="newlist">
${newFileList}
<span style="color:var(--dimmer)">New files are reachable only through the ${evidence.editedFileCount} integration edits above.</span>
</div></details>

<div class="foot">
Generated from the PR diff at <code>${escHtml(evidence.baseSha.slice(0, 10))}...${escHtml(evidence.headSha.slice(0, 10))}</code> on ${escHtml(evidence.collectedAt)}.
Diff stats, per-file history and test coverage are computed from git, not written by a model; anything not established is labelled NOT VERIFIED.
This room deliberately renders <b>no verdict</b> — no score, no approve button. It is here to get you to your own judgement faster.
</div>
</div>
<script>
const HUNKS = ${jsonForScript(hunks)};
const TESTS = ${jsonForScript(tests)};
const FINDINGS = ${jsonForScript(findings)};
const ROOM_KEY = ${jsonForScript(meta.roomKey)};
function testsHtml(file){
  var t = TESTS[file] || [];
  if (!t.length) return '<span class="tests">no tests found</span>';
  return t.map(function(x){ return '<code>' + esc(x) + '</code>'; }).join("<br>");
}
${LOGIC.replace("__TAG__", () => jsonForScript(tag))}
</script>
</body></html>`;
}
