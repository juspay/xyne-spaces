#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistFile = join(repoRoot, "scripts", "tailwind-v4-allowlist.txt");
const defaultTargets = ["apps/dashboard/src", "apps/dashboard-external/src"];
const scriptExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const scannedExtensions = new Set([...scriptExtensions, ".css", ".html"]);
const skippedDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".vite",
]);
const regexStartAfter = new Set([..."(,=:[!&|?{};+-*%~^"]);
const classHelperCall =
  /(?<![\w$.])(?:cn|clsx|cva|twMerge|twJoin|classNames|classnames)\s*\(/g;
const classProp =
  /(?<![\w$])(?:[A-Za-z_$][\w$]*?)?[cC]lass(?:Name)?(?:es|s)?\s*([=:])(?![=>])\s*/g;
const configImport =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`\n]*(?:tailwind\.config|tailwindcss\/resolveConfig)[^"'`\n]*)["'`]/g;
const cssConfigImport =
  /@config\b[^;\n]*|@import\s+[^;\n]*tailwind\.config[^;\n]*/g;
const cssThemeCall = /(?<![\w-])theme\(/g;
const cssApply = /@apply\s+([^;{}]+)/g;
const themeAdvice =
  "theme lives in @theme in global.css; read the CSS variable instead";

const renames = [
  [/^flex-(shrink|grow)(-.+)?$/, (m) => `${m[1]}${m[2] ?? ""}`],
  [/^overflow-ellipsis$/, () => "text-ellipsis"],
  [/^decoration-(slice|clone)$/, (m) => `box-decoration-${m[1]}`],
  [/^outline-none$/, () => "outline-hidden"],
  [/^bg-gradient-to-(.+)$/, (m) => `bg-linear-to-${m[1]}`],
  [/^ring$/, () => "ring-3"],
  [
    /^(.+?)-\[(--[A-Za-z0-9_-]+)\](\/.+)?$/,
    (m) => `${m[1]}-(${m[2]})${m[3] ?? ""}`,
  ],
];
const opacityUtility =
  /^(bg|text|border|ring|divide|placeholder)-opacity-(.+)$/;
const bareSizes = new Map([
  ["blur", "blur-sm"],
  ["drop-shadow", "drop-shadow-sm"],
  ["backdrop-blur", "backdrop-blur-sm"],
]);

function toPosix(path) {
  return path.split(sep).join("/");
}

function loadAllowlist() {
  if (!existsSync(allowlistFile)) return new Set();
  return new Set(
    readFileSync(allowlistFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => toPosix(line).replace(/^\.\//, "")),
  );
}

function collectFiles(target, files) {
  if (!existsSync(target)) return;
  const stats = statSync(target);
  if (stats.isFile()) {
    if (scannedExtensions.has(extname(target))) files.push(target);
    return;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name))
        collectFiles(join(target, entry.name), files);
    } else if (entry.isFile() && scannedExtensions.has(extname(entry.name))) {
      files.push(join(target, entry.name));
    }
  }
}

function skipQuoted(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") i += 2;
    else if (char === quote) return i + 1;
    else if (char === "\n") return i;
    else i += 1;
  }
  return source.length;
}

function skipTemplate(source, start) {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") i += 2;
    else if (char === "`") return i + 1;
    else if (char === "$" && source[i + 1] === "{")
      i = skipBalanced(source, i + 1, "{", "}");
    else i += 1;
  }
  return source.length;
}

function skipBalanced(source, start, open, close) {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'") {
      i = skipQuoted(source, i);
      continue;
    }
    if (char === "`") {
      i = skipTemplate(source, i);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return source.length;
}

function skipRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") i += 2;
    else if (char === "\n") return i;
    else {
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) return i + 1;
      i += 1;
    }
  }
  return source.length;
}

function blankComments(source, kind) {
  const parts = [];
  let last = 0;
  const blank = (from, to) => {
    parts.push(
      source.slice(last, from),
      source.slice(from, to).replace(/[^\n]/g, " "),
    );
    last = to;
  };
  if (kind === "html") {
    for (const match of source.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
      blank(match.index, match.index + match[0].length);
    }
    parts.push(source.slice(last));
    return parts.join("");
  }
  let previous = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const to = end === -1 ? source.length : end + 2;
      blank(i, to);
      i = to;
    } else if (kind === "script" && char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const to = end === -1 ? source.length : end;
      blank(i, to);
      i = to;
    } else if (char === '"' || char === "'") {
      i = skipQuoted(source, i);
      previous = char;
    } else if (kind === "script" && char === "`") {
      i = skipTemplate(source, i);
      previous = char;
    } else if (
      kind === "script" &&
      char === "/" &&
      (previous === "" || regexStartAfter.has(previous))
    ) {
      i = skipRegex(source, i);
      previous = "/";
    } else {
      if (!/\s/.test(char)) previous = char;
      i += 1;
    }
  }
  parts.push(source.slice(last));
  return parts.join("");
}

function isNonClassLiteral(source, start, end) {
  let before = start - 1;
  while (before >= 0 && /\s/.test(source[before])) before -= 1;
  const precededBy = source.slice(Math.max(0, before - 3), before + 1);
  if (
    /[=!]=$/.test(precededBy) ||
    /\bcase$/.test(source.slice(Math.max(0, before - 4), before + 1))
  )
    return true;
  if (source[before] === "[" && /[\w$)\]]/.test(source[before - 1] ?? ""))
    return true;
  let after = end;
  while (after < source.length && /\s/.test(source[after])) after += 1;
  return /^[=!]=/.test(source.slice(after, after + 2));
}

function extractLiterals(source, start, end, literals) {
  let i = start;
  while (i < end) {
    const char = source[i];
    if (char === '"' || char === "'") {
      const close = skipQuoted(source, i);
      if (
        source[close - 1] === char &&
        close - 1 > i &&
        !isNonClassLiteral(source, i, close)
      ) {
        literals.push({
          start: i + 1,
          end: close - 1,
          partialStart: false,
          partialEnd: false,
        });
      }
      i = close;
    } else if (char === "`") {
      const close = skipTemplate(source, i);
      const usable = !isNonClassLiteral(source, i, close);
      let chunkStart = i + 1;
      let j = i + 1;
      while (j < close - 1) {
        if (source[j] === "\\") {
          j += 2;
        } else if (source[j] === "$" && source[j + 1] === "{") {
          const exprEnd = skipBalanced(source, j + 1, "{", "}");
          if (usable) {
            literals.push({
              start: chunkStart,
              end: j,
              partialStart: chunkStart !== i + 1,
              partialEnd: true,
            });
          }
          extractLiterals(source, j + 2, exprEnd - 1, literals);
          chunkStart = exprEnd;
          j = exprEnd;
        } else {
          j += 1;
        }
      }
      if (usable) {
        literals.push({
          start: chunkStart,
          end: close - 1,
          partialStart: chunkStart !== i + 1,
          partialEnd: false,
        });
      }
      i = close;
    } else {
      i += 1;
    }
  }
}

function expressionEnd(source, start) {
  const char = source[start];
  if (char === '"' || char === "'") return skipQuoted(source, start);
  if (char === "`") return skipTemplate(source, start);
  if (char === "{") return skipBalanced(source, start, "{", "}");
  const closers = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  let i = start;
  const limit = Math.min(source.length, start + 4000);
  while (i < limit) {
    const current = source[i];
    if (current === '"' || current === "'") {
      i = skipQuoted(source, i);
      continue;
    }
    if (current === "`") {
      i = skipTemplate(source, i);
      continue;
    }
    if (current === "(" || current === "[" || current === "{")
      stack.push(current);
    else if (current in closers) {
      if (stack.length === 0) return i;
      stack.pop();
    } else if ((current === "," || current === ";") && stack.length === 0)
      return i;
    i += 1;
  }
  return i;
}

function classRegions(source, kind) {
  const regions = [];
  if (kind === "css") {
    for (const match of source.matchAll(cssApply)) {
      const offset = match.index + match[0].indexOf(match[1]);
      regions.push({
        start: offset,
        end: offset + match[1].length,
        partialStart: false,
        partialEnd: false,
      });
    }
    return regions;
  }
  for (const match of source.matchAll(classProp)) {
    const start = match.index + match[0].length;
    if (kind === "html" && match[1] !== "=") continue;
    extractLiterals(source, start, expressionEnd(source, start), regions);
  }
  if (kind === "script") {
    for (const match of source.matchAll(classHelperCall)) {
      const open = match.index + match[0].length - 1;
      extractLiterals(
        source,
        open + 1,
        skipBalanced(source, open, "(", ")") - 1,
        regions,
      );
    }
  }
  return regions;
}

function splitVariants(token) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth = Math.max(0, depth - 1);
    else if (char === ":" && depth === 0) cut = i + 1;
  }
  return { variants: token.slice(0, cut), utility: token.slice(cut) };
}

function inspectToken(token) {
  const { variants, utility } = splitVariants(token);
  const leadingImportant = /^![-a-z[(@*]/i.test(utility);
  const core = leadingImportant ? utility.slice(1) : utility;
  const trailingImportant = core.endsWith("!");
  const base = trailingImportant ? core.slice(0, -1) : core;
  const important = leadingImportant || trailingImportant ? "!" : "";

  if (bareSizes.has(base)) {
    return `found ${token}, v3 default size; v4 equivalent is ${variants}${bareSizes.get(base)}${important}`;
  }
  const opacity = base.match(opacityUtility);
  if (opacity) {
    return `found ${token}, use slash opacity on the color instead (${variants}${opacity[1]}-<color>/${opacity[2]}${important})`;
  }
  let renamed = base;
  for (const [pattern, replace] of renames) {
    const match = base.match(pattern);
    if (match) {
      renamed = replace(match);
      break;
    }
  }
  if (renamed === base && !leadingImportant) return null;
  return `found ${token}, use ${variants}${renamed}${important}`;
}

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1)
    if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function scanFile(file) {
  const extension = extname(file);
  const kind = scriptExtensions.has(extension)
    ? "script"
    : extension === ".css"
      ? "css"
      : "html";
  const raw = readFileSync(file, "utf8");
  const source = blankComments(raw, kind);
  const findings = new Map();

  for (const region of classRegions(source, kind)) {
    const text = source.slice(region.start, region.end);
    for (const match of text.matchAll(/\S+/g)) {
      const tokenStart = match.index;
      const tokenEnd = tokenStart + match[0].length;
      if (region.partialStart && tokenStart === 0) continue;
      if (region.partialEnd && tokenEnd === text.length) continue;
      const message = inspectToken(match[0]);
      if (message) findings.set(region.start + tokenStart, message);
    }
  }

  if (kind === "css") {
    for (const match of source.matchAll(cssThemeCall))
      findings.set(match.index, `found theme(), ${themeAdvice}`);
    for (const match of source.matchAll(cssConfigImport)) {
      findings.set(match.index, `found ${match[0].trim()}, ${themeAdvice}`);
    }
  } else if (kind === "script") {
    for (const match of source.matchAll(configImport)) {
      findings.set(match.index, `found import of ${match[1]}, ${themeAdvice}`);
    }
  }

  if (findings.size === 0) return [];
  const starts = lineStarts(source);
  return [...findings.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, message]) => ({ line: lineAt(starts, offset), message }));
}

function main() {
  const startedAt = performance.now();
  const args = process.argv.slice(2);
  const targets =
    args.length > 0
      ? args.map((arg) => resolve(arg))
      : defaultTargets.map((target) => join(repoRoot, target));
  const files = [];
  for (const target of targets) collectFiles(target, files);
  files.sort();

  const allowlist = loadAllowlist();
  const reports = [];
  for (const file of files) {
    const path = toPosix(relative(repoRoot, file));
    if (allowlist.has(path)) continue;
    for (const { line, message } of scanFile(file)) {
      if (!allowlist.has(`${path}:${line}`))
        reports.push(`${path}:${line}: ${message}`);
    }
  }

  const seconds = ((performance.now() - startedAt) / 1000).toFixed(2);
  if (reports.length === 0) {
    console.log(
      `Tailwind v4 class check passed: ${files.length} files in ${seconds}s.`,
    );
    return;
  }
  console.error(reports.join("\n"));
  console.error(
    `\n${reports.length} Tailwind v3-only class usage(s) in ${files.length} files (${seconds}s).` +
      `\nRename them to the v4 form shown, or add "path" or "path:line" to ${toPosix(relative(repoRoot, allowlistFile))} for an intentional exception.`,
  );
  process.exitCode = 1;
}

main();
