/**
 * Optimized syntax highlighting for <pre><code> blocks
 * - Single DOMParser usage
 * - Safer injection of highlighted HTML
 * - No double parsing
 * - Curated, commonly-used language set
 * - No auto-detection (avoid main-thread stalls)
 */

import { toHtml } from 'hast-util-to-html';
import { createLowlight } from 'lowlight';

import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

const lowlight = createLowlight({
  javascript,
  js: javascript,
  typescript,
  ts: typescript,
  python,
  py: python,
  bash,
  sh: bash,
  shell: bash,
  json,
  sql,
  html: xml,
  xml,
  css,
  go,
  golang: go,
  rust,
  rs: rust,
});

// Regex to detect language-xxxxx class quickly
const LANG_CLASS_REGEX = /language-([\w-]+)/;

/**
 * Highlight code blocks within an HTML string.
 *
 * Only code blocks with a language class in the curated registry above
 * are highlighted. Unknown or missing language hints are left as plain
 * text; auto-detection is intentionally disabled because it scans every
 * registered grammar and blocks the main thread.
 */
export const highlightCodeBlocks = (html: string): string => {
  if (!html || html.indexOf('<code') === -1) return html; // cheap fast-path

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Query only <pre><code> (fast + correct)
  const codeBlocks = doc.querySelectorAll('pre code');

  codeBlocks.forEach(codeEl => {
    // Skip empty, already-highlighted, or explicitly opted-out blocks
    const raw = codeEl.textContent || '';
    if (!raw.trim()) return;
    if (codeEl.closest('.no-highlight')) return;
    if (codeEl.querySelector('.hljs-comment, .hljs-keyword, [class*="hljs-"]')) return;

    let tree;

    try {
      // Fast language extraction
      const className = codeEl.className || '';
      const match = LANG_CLASS_REGEX.exec(className);
      const lang = match?.[1];

      if (!lang) {
        // No language hint: leave as plain text (no auto-detect).
        return;
      }

      // Specific language highlight. If the language is not in our
      // curated registry, `lowlight.highlight` throws; leave the block
      // as plain text instead of falling back to expensive auto-detection.
      try {
        tree = lowlight.highlight(lang, raw);
      } catch {
        return;
      }

      // Convert to HTML string (safe)
      const highlightedHtml = toHtml(tree);

      if (!highlightedHtml || !highlightedHtml.trim()) {
        codeEl.textContent = raw;
        return;
      }

      // Replace code content safely
      codeEl.innerHTML = highlightedHtml;
    } catch {
      return;
      // Leave raw content untouched on failure
    }
  });

  return doc.body.innerHTML;
};
