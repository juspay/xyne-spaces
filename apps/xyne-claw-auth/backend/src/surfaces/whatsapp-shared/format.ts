/**
 * Markdown → WhatsApp dialect, shared by both WhatsApp transports — which is
 * why it lives here rather than in either one's folder: the Cloud plugin
 * reaching into the Baileys plugin for it coupled two transports that have
 * nothing else in common. WhatsApp
 * renders *bold*, _italic_, ~strike~, `mono` and ```fenced``` blocks, nothing
 * else; headings, links and list markers must become plain text that still
 * reads well on a phone.
 */
export function formatForWhatsApp(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const rawLine of lines) {
    let line = rawLine;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line.replace(/^(\s*)(```|~~~)\s*\w*/, "$1```"));
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    line = line.replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/, (_m, indent: string, mark: string) => `${indent}${mark.trim() ? "☑" : "☐"} `);
    line = line.replace(/^(\s*)[-*+]\s+/, "$1• ");
    // Italics BEFORE bold: a single * pair never matches inside ** **, but once
    // bold has become *x* it would be re-read as italics.
    line = line.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1_$2_");
    line = line.replace(/\*\*(.+?)\*\*/g, "*$1*");
    line = line.replace(/__(.+?)__/g, "*$1*");
    // Headings AFTER the emphasis pass so the bold they produce is not re-read.
    line = line.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, (_m, title: string) => `*${title.trim()}*`);
    line = line.replace(/~~(.+?)~~/g, "~$1~");
    line = line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)");
    line = line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => (text.trim() === url ? url : `${text} (${url})`));
    line = line.replace(/^\s*>\s?/, "› ");
    line = line.replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/, "──────────");
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
