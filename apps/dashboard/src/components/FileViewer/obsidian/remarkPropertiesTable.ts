/* Obsidian "Properties" (YAML frontmatter) → a rendered key/value table.
 * remark-frontmatter parses the leading `---` fence into a `yaml` node; this
 * plugin turns that node into an inert <table>.
 *
 * SECURITY: we do NOT use a YAML library here — a deliberately tiny line parser
 * that only ever produces strings. This removes any chance of YAML code-exec
 * (e.g. `!!js/function`) and any dependency risk. Values are plain text only. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function remarkPropertiesTable() {
  return (tree: any): void => {
    if (!Array.isArray(tree.children)) return;
    for (let i = 0; i < tree.children.length; i++) {
      const n = tree.children[i];
      if (n && n.type === 'yaml' && typeof n.value === 'string') {
        const rows = parseProps(n.value);
        if (rows.length) tree.children[i] = buildTable(rows);
      }
    }
  };
}

function parseProps(src: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  let curKey: string | null = null;
  let listBuf: string[] = [];
  const flush = (): void => {
    if (curKey !== null) {
      rows.push([curKey, listBuf.join(', ')]);
      curKey = null;
      listBuf = [];
    }
  };
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li && curKey !== null) {
      listBuf.push(strip(li[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_.\- ]+):\s*(.*)$/.exec(line);
    if (kv) {
      flush();
      const key = kv[1].trim();
      const val = strip(kv[2]);
      if (val === '') {
        curKey = key;
        listBuf = [];
      } else {
        rows.push([key, val]);
      }
    }
  }
  flush();
  return rows;
}

function strip(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

function cell(hName: string, value: string, className: string) {
  return {
    type: 'obsidianCell',
    data: { hName, hProperties: { className: [className] } },
    children: [{ type: 'text', value }],
  };
}

function buildTable(rows: Array<[string, string]>) {
  const body = rows.map(([k, v]) => ({
    type: 'obsidianRow',
    data: { hName: 'tr' },
    children: [cell('th', k, 'obsidian-prop-key'), cell('td', v, 'obsidian-prop-val')],
  }));
  return {
    type: 'obsidianTable',
    data: { hName: 'table', hProperties: { className: ['obsidian-properties'] } },
    children: [
      {
        type: 'obsidianCaption',
        data: { hName: 'caption', hProperties: { className: ['obsidian-properties-caption'] } },
        children: [{ type: 'text', value: 'Properties' }],
      },
      { type: 'obsidianBody', data: { hName: 'tbody' }, children: body },
    ],
  };
}
