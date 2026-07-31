import type { VideoScene, Theme } from "./storyboard.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function colorizeCode(value: string): string {
  const keywords = new Set([
    "const", "let", "var", "function", "class", "interface", "type", "return", "if", "else",
    "async", "await", "import", "from", "export", "new", "throw", "try", "catch",
  ]);
  return value
    .split(/(".*?"|'.*?'|`.*?`|\b(?:const|let|var|function|class|interface|type|return|if|else|async|await|import|from|export|new|throw|try|catch)\b)/g)
    .map((token) => {
      const escaped = escapeHtml(token);
      if (/^["'`]/.test(token)) return `<span class="syntax-string">${escaped}</span>`;
      if (keywords.has(token)) return `<span class="syntax-keyword">${escaped}</span>`;
      return escaped;
    })
    .join("");
}

function codeLines(code: string, highlight?: [number, number]): string {
  return code
    .split("\n")
    .map((line, index) => {
      const lineNumber = index + 1;
      const selected = highlight
        ? lineNumber >= highlight[0] && lineNumber <= highlight[1]
        : false;
      return `<div class="code-line${selected ? " selected" : ""}"><span class="line-number">${lineNumber}</span><span>${colorizeCode(line) || " "}</span></div>`;
    })
    .join("");
}

function sceneBody(scene: VideoScene, title: string, code?: string, mermaidLive?: boolean): string {
  switch (scene.kind) {
    case "title":
      return `<section class="title-scene"><div class="eyebrow">VIDEO EXPLAINER</div><h1>${escapeHtml(title)}</h1><div class="rule"></div></section>`;
    case "diagram":
      // mermaidLive: the sandbox chromium runs mermaid.min.js (shipped next to
      // this HTML) during the screenshot pass — works for flowcharts, sequence
      // diagrams (data flow), state diagrams; anything mermaid parses.
      return mermaidLive
        ? `<section><div class="eyebrow">ARCHITECTURE</div><div class="diagram"><pre class="mermaid">${escapeHtml(scene.mermaid)}</pre></div></section>`
        : `<section><div class="eyebrow">ARCHITECTURE</div><pre class="mermaid-fallback">${escapeHtml(scene.mermaid)}</pre><div class="degraded">Diagram preview unavailable — showing Mermaid source</div></section>`;
    case "code":
      return `<section><div class="eyebrow">LOAD-BEARING CHANGE</div><h2>${escapeHtml(scene.file)}</h2><pre class="code">${codeLines(code ?? `Unable to read ${scene.file}`, scene.highlight)}</pre></section>`;
    case "diff":
      return `<section><div class="eyebrow">BEFORE → AFTER</div><div class="diff-grid"><div><h2 class="before">Before</h2><pre class="code compact">${codeLines(scene.before)}</pre></div><div><h2 class="after">After</h2><pre class="code compact">${codeLines(scene.after)}</pre></div></div></section>`;
    case "bullets":
      return `<section><div class="eyebrow">WHAT THIS MEANS FOR YOU</div><h2>${escapeHtml(title)}</h2><ul>${scene.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
  }
}

interface Palette {
  bg: string;
  text: string;
  glow: string; // CSS background for the ambient body:before layer, or "" for none (minimal)
  eyebrow: string;
  accent: string;
  codeBg: string;
  codeBorder: string;
  codeShadow: string;
  lineNum: string;
  selBg: string;
  kw: string;
  str: string;
  before: string;
  after: string;
  diagramBg: string;
  diagramBorder: string;
  mermaidText: string;
  degraded: string;
  bulletBg: string;
  bulletBorder: string;
  bulletDot: string;
  bulletDotShadow: string;
  footer: string;
  brand: string;
}

// "light" is the default: a minimal, mostly-white background with soft borders
// and no ambient glow — the clean look product/launch videos want.
// "dark" preserves the original high-contrast technical palette.
function palette(theme: Theme): Palette {
  if (theme === "dark") {
    return {
      bg: "#07111f",
      text: "#edf4ff",
      glow:
        "radial-gradient(circle at 78% 12%,rgba(48,190,180,.18),transparent 34%)," +
        "radial-gradient(circle at 12% 88%,rgba(91,104,255,.18),transparent 38%)",
      eyebrow: "#58d6ca",
      accent: "#58d6ca",
      codeBg: "rgba(8,20,36,.94)",
      codeBorder: "#233853",
      codeShadow: "0 25px 70px rgba(0,0,0,.28)",
      lineNum: "#60758f",
      selBg: "rgba(88,214,202,.13)",
      kw: "#c7a0ff",
      str: "#a6e38d",
      before: "#ff8f9d",
      after: "#77e6bc",
      diagramBg: "rgba(255,255,255,.96)",
      diagramBorder: "none",
      mermaidText: "#0b1524",
      degraded: "#91a2b8",
      bulletBg: "rgba(18,36,58,.82)",
      bulletBorder: "#29425f",
      bulletDot: "#58d6ca",
      bulletDotShadow: "0 0 22px rgba(88,214,202,.65)",
      footer: "#71849b",
      brand: "#9eb0c5",
    };
  }
  return {
    bg: "#ffffff",
    text: "#0f172a",
    glow: "", // minimal: clean, flat background — no ambient gradient
    eyebrow: "#0d9488",
    accent: "#0d9488",
    codeBg: "#f6f8fb",
    codeBorder: "#e2e8f0",
    codeShadow: "0 12px 40px rgba(15,23,42,.08)",
    lineNum: "#94a3b8",
    selBg: "rgba(13,148,136,.10)",
    kw: "#7c3aed",
    str: "#067d4e",
    before: "#dc2626",
    after: "#059669",
    diagramBg: "#ffffff",
    diagramBorder: "1px solid #e2e8f0",
    mermaidText: "#0b1524",
    degraded: "#64748b",
    bulletBg: "#f7f9fc",
    bulletBorder: "#e6ebf2",
    bulletDot: "#0d9488",
    bulletDotShadow: "none",
    footer: "#94a3b8",
    brand: "#64748b",
  };
}

function styles(p: Palette): string {
  return `*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${p.bg};color:${p.text};font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
${p.glow ? `body:before{content:"";position:absolute;inset:0;background:${p.glow};pointer-events:none}` : ""}
main{position:relative;height:100%;padding:86px 116px 120px;display:flex;align-items:center}section{width:100%;max-height:820px}.eyebrow{color:${p.eyebrow};font-weight:800;letter-spacing:.22em;font-size:25px;margin-bottom:26px}h1{font-size:82px;line-height:1.04;max-width:1500px;margin:0;font-weight:780;letter-spacing:-.035em}h2{font-size:39px;margin:0 0 28px;letter-spacing:-.02em}.rule{height:8px;width:180px;background:${p.accent};border-radius:99px;margin-top:46px}.title-scene{padding-left:36px}
.code,.mermaid-fallback{margin:0;background:${p.codeBg};border:1px solid ${p.codeBorder};border-radius:22px;padding:25px 0;font:25px/1.38 "SFMono-Regular",Consolas,"Liberation Mono",monospace;box-shadow:${p.codeShadow};max-height:700px;overflow:hidden}.code-line{display:grid;grid-template-columns:72px 1fr;padding:1px 28px;border-left:5px solid transparent;white-space:pre}.code-line.selected{background:${p.selBg};border-left-color:${p.accent}}.line-number{color:${p.lineNum};text-align:right;padding-right:24px;user-select:none}.syntax-keyword{color:${p.kw}}.syntax-string{color:${p.str}}.compact{font-size:20px;max-height:625px}.diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}.before{color:${p.before}}.after{color:${p.after}}
.diagram{height:700px;display:flex;align-items:center;justify-content:center;background:${p.diagramBg};border:${p.diagramBorder};border-radius:28px;padding:40px}.diagram svg{max-width:100%;max-height:620px}.diagram .mermaid{color:${p.mermaidText};font:24px/1.4 "SFMono-Regular",Consolas,monospace;display:flex;align-items:center;justify-content:center;width:100%;height:100%}.mermaid-fallback{padding:44px;font-size:31px;line-height:1.55;white-space:pre-wrap}.degraded{color:${p.degraded};font-size:20px;margin-top:18px}
ul{list-style:none;padding:0;margin:40px 0 0;display:grid;gap:24px;max-width:1500px}li{font-size:39px;line-height:1.25;padding:22px 30px 22px 74px;background:${p.bulletBg};border:1px solid ${p.bulletBorder};border-radius:18px;position:relative}li:before{content:"";position:absolute;left:28px;top:36px;width:17px;height:17px;border-radius:50%;background:${p.bulletDot};box-shadow:${p.bulletDotShadow}}
footer{position:absolute;left:116px;right:116px;bottom:48px;display:flex;justify-content:space-between;color:${p.footer};font-size:20px}.brand{color:${p.brand};font-weight:700;letter-spacing:.08em}`;
}

export function generateSceneHtml(
  title: string,
  scene: VideoScene,
  sceneNumber: number,
  totalScenes: number,
  options: { code?: string; mermaidLive?: boolean; theme?: Theme } = {},
): string {
  const theme: Theme = options.theme ?? "light";
  const mermaidTheme = theme === "dark" ? "dark" : "default";
  const mermaidScripts = options.mermaidLive
    ? `<script src="./mermaid.min.js"></script>` +
      `<script>mermaid.initialize({ startOnLoad: true, theme: "${mermaidTheme}", securityLevel: "loose" });</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920,height=1080">
<style>
${styles(palette(theme))}
</style>
</head>
<body><main>${sceneBody(scene, title, options.code, options.mermaidLive)}</main>
<footer><span class="brand">XYNE · EXPLAINER</span><span>${sceneNumber} / ${totalScenes}</span></footer>
${mermaidScripts}</body></html>`;
}
