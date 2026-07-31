/* Minimal mdast helpers — deliberately dependency-free (no unist-util-visit).
 * Splits `text` nodes by a regex into a mix of text + custom inline nodes.
 * Never descends into code / inlineCode or already-produced obsidian nodes,
 * so Obsidian syntax inside a fenced code block stays literal. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const SKIP = new Set(['code', 'inlineCode', 'obsidianEmbed', 'obsidianInline']);

/** build() may return a single node, an array of nodes, or null (= keep literal match text). */
export function replaceInText(
  tree: Node,
  regex: RegExp,
  build: (m: RegExpExecArray) => Node | Node[] | null,
): void {
  const recurse = (node: Node): void => {
    if (!node || SKIP.has(node.type) || !Array.isArray(node.children)) return;
    const next: Node[] = [];
    for (const child of node.children) {
      if (child && child.type === 'text' && typeof child.value === 'string') {
        next.push(...splitText(child.value, regex, build));
      } else {
        recurse(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  recurse(tree);
}

function splitText(
  value: string,
  regex: RegExp,
  build: (m: RegExpExecArray) => Node | Node[] | null,
): Node[] {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const re = new RegExp(regex.source, flags);
  const out: Node[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    const built = build(m);
    if (Array.isArray(built)) out.push(...built);
    else out.push(built ?? { type: 'text', value: m[0] });
    last = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex++; // guard against zero-length loops
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out.length ? out : [{ type: 'text', value }];
}
