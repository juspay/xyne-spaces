import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import groovy from 'highlight.js/lib/languages/groovy';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { extensionOf } from '../../registry';

// Only the languages a preview shows, not highlight.js's hundred and ninety: this is
// the whole of what the code view adds to the bundle. A new one is an import, a
// registration and its extensions below.
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('groovy', groovy);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('java', java);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  md: 'markdown',
  markdown: 'markdown',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  py: 'python',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  jsonl: 'json',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  java: 'java',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  diff: 'diff',
  patch: 'diff',
  gradle: 'groovy',
};

/** A language's own name, for saying what a file is: "TypeScript", "Go". */
export function languageName(language: string): string {
  return hljs.getLanguage(language)?.name ?? language;
}

/** The language a file is written in, by its name; null for plain text. */
export function languageFor(fileName: string): string | null {
  return LANGUAGE_BY_EXTENSION[extensionOf(fileName)] ?? null;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * highlight.js colours a whole text at once, and a token — a comment, a string — can
 * run over several lines. Cut into lines, each line reopens the spans still open at
 * its start and closes them at its end, so every line is whole on its own.
 */
function splitIntoLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  for (const line of html.split('\n')) {
    const carried = open.join('');
    let at = 0;
    for (;;) {
      const opening = line.indexOf('<span', at);
      const closing = line.indexOf('</span>', at);
      if (opening === -1 && closing === -1) break;
      if (opening !== -1 && (closing === -1 || opening < closing)) {
        const end = line.indexOf('>', opening) + 1;
        if (end === 0) break;
        open.push(line.slice(opening, end));
        at = end;
      } else {
        open.pop();
        at = closing + '</span>'.length;
      }
    }
    lines.push(carried + line + '</span>'.repeat(open.length));
  }
  return lines;
}

/** Past this, colouring would hold the page up longer than it is worth. */
const HIGHLIGHT_LIMIT = 1_000_000;

/**
 * A text as lines of HTML, coloured for its language when it has one. highlight.js
 * escapes what it colours, and plain text is escaped here, so a line is markup made
 * only of the text and highlight.js's own spans.
 */
export function highlightLines(text: string, language: string | null): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (language && text.length <= HIGHLIGHT_LIMIT && hljs.getLanguage(language)) {
    const html = hljs.highlight(normalized, { language, ignoreIllegals: true }).value;
    // The app sets its sans font on every element directly, so each coloured span
    // carries the monospace itself rather than inheriting it.
    return splitIntoLines(html.replace(/<span class="/g, '<span class="font-code '));
  }
  return escapeHtml(normalized).split('\n');
}
