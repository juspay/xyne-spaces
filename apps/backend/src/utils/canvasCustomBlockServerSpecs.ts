/**
 * Server-side BlockNote specs for the canvas blocks that have no default
 * equivalent: diagram, math (block and inline) and embed.
 *
 * WHY THIS EXISTS: `ServerBlockNoteEditor.yDocToBlocks` / `blocksToYDoc`
 * (ysweetUtils) only know the types in the editor's schema. A type missing there
 * is dropped reading out of Y-Sweet — so a canvas holding a diagram reached the
 * agent with the diagram silently gone — and throws going in, which fails the
 * whole write. This is the block-level counterpart of what mentionServerSpec and
 * citationServerSpec already do for inline content.
 *
 * Only the config matters: type, propSchema and content are what the Yjs
 * conversion reads. The renders are React-free fallbacks the Yjs path never
 * calls (it serializes props and type, not HTML), kept minimal for the same
 * reason as citationServerSpec.
 *
 * The configs MUST match the frontend specs: diagram and math come from
 * @blocknote/diagram-block and @blocknote/math-block (both keep their source as
 * plain content and declare no props), embed from CanvasEmbedSpec.
 */
import { createBlockSpec, createInlineContentSpec } from '@blocknote/core';

/**
 * The bit of the DOM these renders touch.
 *
 * lib is ES2020 (no DOM) on the server, so HTMLElement resolves to a name with
 * no members; `document` arrives from JSDOM at runtime. Describing what is
 * actually used keeps the renders typed without pulling the DOM lib in.
 */
interface ServerElement {
  setAttribute(name: string, value: string): void;
  appendChild(child: ServerElement): void;
  textContent: string;
}

interface ServerDocument {
  createElement(tagName: string): ServerElement;
}

function serverDocument(specName: string): ServerDocument {
  const doc = (globalThis as { document?: ServerDocument }).document;
  if (!doc) {
    throw new Error(
      `${specName}.render requires a \`document\` (e.g. via JSDOM). Set \`globalThis.document\` before rendering on the server.`
    );
  }
  return doc;
}

/** BlockNote wants the DOM types it was compiled against; JSDOM supplies them. */
const asDomElement = (element: ServerElement): HTMLElement => element as unknown as HTMLElement;

/**
 * A block whose content is plain source text — the Mermaid of a diagram, the
 * LaTeX of an equation. contentDOM is what carries that text through.
 */
function renderSourceBlock(type: string): { dom: HTMLElement; contentDOM: HTMLElement } {
  const doc = serverDocument(`${type}ServerSpec`);
  const dom = doc.createElement('pre');
  dom.setAttribute('data-block-type', type);
  const contentDOM = doc.createElement('code');
  dom.appendChild(contentDOM);
  return { dom: asDomElement(dom), contentDOM: asDomElement(contentDOM) };
}

export const diagramServerSpec = createBlockSpec(
  { type: 'diagram', propSchema: {}, content: 'plain' },
  { render: () => renderSourceBlock('diagram') }
)();

export const mathBlockServerSpec = createBlockSpec(
  { type: 'mathBlock', propSchema: {}, content: 'plain' },
  { render: () => renderSourceBlock('mathBlock') }
)();

export const embedServerSpec = createBlockSpec(
  { type: 'embed', propSchema: { url: { default: '' } }, content: 'none' },
  {
    render: (block) => {
      const doc = serverDocument('embedServerSpec');
      const dom = doc.createElement('div');
      dom.setAttribute('data-block-type', 'embed');
      dom.textContent = String(block.props.url ?? '');
      return { dom: asDomElement(dom) };
    },
  }
)();

/** Inline math, whose LaTeX is plain content just like the block form. */
export const mathInlineServerSpec = createInlineContentSpec(
  { type: 'math', propSchema: {}, content: 'plain' },
  {
    render: () => {
      const doc = serverDocument('mathInlineServerSpec');
      const dom = doc.createElement('span');
      dom.setAttribute('data-inline-content-type', 'math');
      const contentDOM = doc.createElement('span');
      dom.appendChild(contentDOM);
      return { dom: asDomElement(dom), contentDOM: asDomElement(contentDOM) };
    },
  }
);
