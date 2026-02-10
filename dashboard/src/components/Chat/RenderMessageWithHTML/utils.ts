/**
 * Optimized syntax highlighting for <pre><code> blocks
 * - Single DOMParser usage
 * - Safer injection of highlighted HTML
 * - No double parsing
 * - Faster language detection
 * - Avoids unnecessary work
 */

import { toHtml } from 'hast-util-to-html';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

// Regex to detect language-xxxxx class quickly
const LANG_CLASS_REGEX = /language-([\w-]+)/;

/**
 * Highlight code blocks within an HTML string.
 */
export const highlightCodeBlocks = (html: string): string => {
  if (!html || html.indexOf('<code') === -1) return html; // cheap fast-path

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Query only <pre><code> (fast + correct)
  const codeBlocks = doc.querySelectorAll('pre code');

  codeBlocks.forEach(codeEl => {
    // Skip empty or already-highlighted blocks
    const raw = codeEl.textContent || '';
    if (!raw.trim()) return;
    if (codeEl.querySelector('.hljs-comment, .hljs-keyword, [class*="hljs-"]')) return;

    let tree;

    try {
      // Fast language extraction
      const className = codeEl.className || '';
      const match = LANG_CLASS_REGEX.exec(className);
      const lang = match?.[1];

      if (lang) {
        // Specific language highlight
        try {
          tree = lowlight.highlight(lang, raw);
        } catch {
          // Fallback to auto-language
          tree = lowlight.highlightAuto(raw);
        }
      } else {
        // Auto-detect
        tree = lowlight.highlightAuto(raw);
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
