---
name: react-artifact
description: Author app-like designs in React/JSX and bundle them in-sandbox into the same single self-contained HTML artifact Design Studio delivers. Use when the design needs real state, complex interactivity, or component reuse beyond what vanilla JS comfortably handles.
---

# React artifacts — author in JSX, deliver HTML + source project

The primary artifact remains ONE self-contained `.html` file. React designs
also deliver a small source archive so the user can continue in an editor.

## When to choose React over plain HTML+JS

- Real client state: multi-step forms, filters over data, undo, optimistic UI
- Many repeated components with varying props (cards, rows, chart panels)
- The user names React explicitly

For static or lightly-interactive pages, plain HTML with a small inline script
is smaller, faster to iterate, and easier to revise — prefer it.

## Recipe (bun is preinstalled; npm registry works in-sandbox via the
in-cluster mirror — the sandbox `.npmrc` already points at it)

```bash
mkdir -p /workspace/design && cd /workspace/design
bun init -y
bun add react@18 react-dom@18
```

Author the app as a normal small project. Keep source under `src/`, with the
entry at `src/app.jsx`:

```jsx
// src/app.jsx
import { createRoot } from "react-dom/client";
import { useState } from "react";

function App() { /* ... */ }

createRoot(document.getElementById("root")).render(<App />);
```

Bundle to a single minified script, then inline it into the HTML shell:

```bash
bun build src/app.jsx --minify --outfile dist/bundle.js
```

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>…</title>
  <style>/* all CSS inline here */</style>
</head>
<body>
  <div id="root"></div>
  <script>/* paste bundle.js contents here verbatim */</script>
</body>
</html>
```

Write the final file by concatenating — do NOT reference `bundle.js` by path;
the artifact must open from a single file with no siblings:

```bash
node -e '
const fs = require("fs");
const bundle = fs.readFileSync("dist/bundle.js", "utf8");
const shell = fs.readFileSync("shell.html", "utf8");
fs.writeFileSync("index.html", shell.replace("/*__BUNDLE__*/", () => bundle));
'
```

(Use a placeholder comment in the shell and `replace` with a function arg so
`$` sequences in the bundle are not mangled.)

Add a short README with `bun install` and run/build instructions, then archive
source without dependencies or generated output:

```bash
tar -czf "design-react-project.tar.gz" src package.json bun.lock README.md shell.html
```

## Rules

- **Self-contained or it does not ship**: no CDN `<script src>`, no external
  CSS, no fetches to the internet at runtime. Charts: prefer hand-rolled SVG
  or inline a small library through the same bundle.
- **Check the bundle went inline**: `grep -c "createRoot\|react" index.html`
  must be ≥1 and the file size should reflect the bundle (React ~140KB min).
  A 2KB index.html means you shipped the shell without the bundle.
- **QA exactly like any other artifact**: open `index.html` in the sandbox
  browser, exercise the interactions you built (click through state changes),
  check desktop + mobile widths and the console.
- Deliver BOTH `index.html` and `design-react-project.tar.gz` in one
  `sandbox-deliver-files` call. The attachment is canonical; do not repeat a
  large inlined React bundle in the final chat response.
- Keep dependencies minimal: react + react-dom only unless the design truly
  needs more. Every dependency inflates the artifact the user downloads.
