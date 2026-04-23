import JSZip from 'jszip';
import type { FSNode } from './FilesystemBlock.types';

// ─── JSON validation ──────────────────────────────────────────────────────────

export function isValidFilesystemJSON(source: string): boolean {
  try {
    const parsed = JSON.parse(source) as unknown;
    return typeof parsed === 'object' && parsed !== null && 'name' in parsed && 'type' in parsed;
  } catch {
    return false;
  }
}

export function parseFilesystemJSON(source: string): FSNode | null {
  try {
    const parsed = JSON.parse(source) as FSNode;
    if (!parsed.name || !parsed.type) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── D2 helpers ───────────────────────────────────────────────────────────────

function safeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, '_').replace(/^_+|_+$/g, '') || 'node';
}

function d2Label(name: string): string {
  const id = safeId(name);
  return id === name ? name : `"${name.replace(/"/g, '\\"')}"`;
}

export const PALETTE = [
  { fill: '#DBEAFE', stroke: '#3B82F6', text: '#1E40AF' },
  { fill: '#FCE7F3', stroke: '#EC4899', text: '#9D174D' },
  { fill: '#D1FAE5', stroke: '#10B981', text: '#065F46' },
  { fill: '#EDE9FE', stroke: '#8B5CF6', text: '#4C1D95' },
  { fill: '#FEF3C7', stroke: '#F59E0B', text: '#92400E' },
  { fill: '#CFFAFE', stroke: '#06B6D4', text: '#164E63' },
  { fill: '#FFE4E6', stroke: '#F43F5E', text: '#881337' },
] as const;

export function getPaletteEntry(i: number) {
  return PALETTE[i % PALETTE.length]!;
}

function color(i: number) {
  return getPaletteEntry(i);
}

// ─── Build D2 with nested layers for click-through navigation ─────────────────
//
// D2 layers are sub-diagrams within the SAME file. `link: layers.<id>` on a node
// navigates into that layer when clicked — this is D2 Studio's only supported
// click-through navigation mechanism.
//
// Each index.d2 is self-contained: clicking a container drills into its layer,
// which in turn has its own layers for deeper navigation.

function buildD2WithLayers(node: FSNode, depth = 0): string {
  const pad = '  '.repeat(depth);
  const children = node.children ?? [];
  const containers = children.filter(c => (c.children?.length ?? 0) > 0);
  const leaves = children.filter(c => !c.children?.length);

  const lines: string[] = [];
  lines.push(`${pad}direction: down`);
  lines.push('');

  let ci = 0;
  for (const child of containers) {
    const id = safeId(child.name);
    const label = d2Label(child.name);
    const c = color(ci++);
    lines.push(`${pad}${id}: ${label} {`);
    lines.push(`${pad}  style.fill: "${c.fill}"`);
    lines.push(`${pad}  style.stroke: "${c.stroke}"`);
    lines.push(`${pad}  style.border-radius: 8`);
    lines.push(`${pad}  link: layers.${id}`);
    lines.push(`${pad}}`);
    lines.push('');
  }

  for (const leaf of leaves) {
    const id = safeId(leaf.name);
    lines.push(`${pad}${id}: ${d2Label(leaf.name)} { shape: document }`);
  }

  if (containers.length > 0) {
    lines.push('');
    lines.push(`${pad}layers: {`);
    for (const child of containers) {
      const id = safeId(child.name);
      lines.push(`${pad}  ${id}: {`);
      // Recurse: each layer is itself a full layered diagram
      lines.push(buildD2WithLayers(child, depth + 2));
      lines.push(`${pad}  }`);
    }
    lines.push(`${pad}}`);
  }

  return lines.join('\n');
}

// ─── Recursively add all levels into the ZIP ──────────────────────────────────
//
// Each folder gets its own index.d2 that is fully self-contained with layers.
// Opening any index.d2 in D2 Studio gives full click-through navigation for
// that subtree. The ZIP sidebar lets you jump to any level directly.

function addToZip(zip: JSZip, node: FSNode, zipPath: string): void {
  const children = node.children ?? [];

  const d2Content = `# ${node.name}\n${buildD2WithLayers(node)}`;
  zip.file(`${zipPath}index.d2`, d2Content);

  for (const child of children) {
    const id = safeId(child.name);
    if ((child.children?.length ?? 0) > 0) {
      addToZip(zip, child, `${zipPath}${id}/`);
    }
  }
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function downloadAsD2Project(root: FSNode): Promise<void> {
  const zip = new JSZip();
  addToZip(zip, root, '');

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${root.name}.d2project.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}
