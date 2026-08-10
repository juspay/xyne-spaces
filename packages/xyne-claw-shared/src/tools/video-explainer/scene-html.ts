import type { VideoScene } from "./storyboard.js";

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
    default:
      // Animated scenes (manim, d2) are rendered by the composer directly and
      // never reach this HTML rasterizer; this keeps the switch exhaustive and
      // degrades to a title card if one is ever routed here by mistake.
      return `<section class="title-scene"><div class="eyebrow">VIDEO EXPLAINER</div><h1>${escapeHtml(title)}</h1><div class="rule"></div></section>`;
  }
}

export function generateSceneHtml(
  title: string,
  scene: VideoScene,
  sceneNumber: number,
  totalScenes: number,
  options: { code?: string; mermaidLive?: boolean } = {},
): string {
  const mermaidScripts = options.mermaidLive
    ? `<script src="./mermaid.min.js"></script>` +
      `<script>mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920,height=1080">
<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#07111f;color:#edf4ff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 78% 12%,rgba(48,190,180,.18),transparent 34%),radial-gradient(circle at 12% 88%,rgba(91,104,255,.18),transparent 38%);pointer-events:none}
main{position:relative;height:100%;padding:86px 116px 120px;display:flex;align-items:center}section{width:100%;max-height:820px}.eyebrow{color:#58d6ca;font-weight:800;letter-spacing:.22em;font-size:25px;margin-bottom:26px}h1{font-size:82px;line-height:1.04;max-width:1500px;margin:0;font-weight:780;letter-spacing:-.035em}h2{font-size:39px;margin:0 0 28px;letter-spacing:-.02em}.rule{height:8px;width:180px;background:#58d6ca;border-radius:99px;margin-top:46px}.title-scene{padding-left:36px}
.code,.mermaid-fallback{margin:0;background:rgba(8,20,36,.94);border:1px solid #233853;border-radius:22px;padding:25px 0;font:25px/1.38 "SFMono-Regular",Consolas,"Liberation Mono",monospace;box-shadow:0 25px 70px rgba(0,0,0,.28);max-height:700px;overflow:hidden}.code-line{display:grid;grid-template-columns:72px 1fr;padding:1px 28px;border-left:5px solid transparent;white-space:pre}.code-line.selected{background:rgba(88,214,202,.13);border-left-color:#58d6ca}.line-number{color:#60758f;text-align:right;padding-right:24px;user-select:none}.syntax-keyword{color:#c7a0ff}.syntax-string{color:#a6e38d}.compact{font-size:20px;max-height:625px}.diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}.before{color:#ff8f9d}.after{color:#77e6bc}
.diagram{height:700px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.96);border-radius:28px;padding:40px}.diagram svg{max-width:100%;max-height:620px}.diagram .mermaid{color:#0b1524;font:24px/1.4 "SFMono-Regular",Consolas,monospace;display:flex;align-items:center;justify-content:center;width:100%;height:100%}.mermaid-fallback{padding:44px;font-size:31px;line-height:1.55;white-space:pre-wrap}.degraded{color:#91a2b8;font-size:20px;margin-top:18px}
ul{list-style:none;padding:0;margin:40px 0 0;display:grid;gap:24px;max-width:1500px}li{font-size:39px;line-height:1.25;padding:22px 30px 22px 74px;background:rgba(18,36,58,.82);border:1px solid #29425f;border-radius:18px;position:relative}li:before{content:"";position:absolute;left:28px;top:36px;width:17px;height:17px;border-radius:50%;background:#58d6ca;box-shadow:0 0 22px rgba(88,214,202,.65)}
footer{position:absolute;left:116px;right:116px;bottom:48px;display:flex;justify-content:space-between;color:#71849b;font-size:20px}.brand{color:#9eb0c5;font-weight:700;letter-spacing:.08em}
</style>
</head>
<body><main>${sceneBody(scene, title, options.code, options.mermaidLive)}</main>
<footer><span class="brand">XYNE · EXPLAINER</span><span>${sceneNumber} / ${totalScenes}</span></footer>
${mermaidScripts}</body></html>`;
}
