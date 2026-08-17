/**
 * Server-side BlockNote inline-content spec for the "citation" chip used in
 * call-summary canvases.
 *
 * WHY THIS EXISTS: `ServerBlockNoteEditor.blocksToYDoc` / `blocksToYXmlFragment`
 * (ysweetUtils) DROP any inline-content type not present in the editor's schema
 * during the BlockNote→Yjs conversion. So for citation inline nodes to survive
 * the write into Y-Sweet (the canvas source of truth), the server schema must
 * register a `citation` spec — exactly like it registers `mention`
 * (mentionServerSpec from blocknote-layout-mentions/server).
 *
 * The `render` is a React-free DOM fallback that mirrors mentionServerSpec; it is
 * NOT invoked on the Yjs write path (that serializes props/type, not HTML), so
 * the JSDOM requirement never triggers here. The propSchema MUST match the
 * frontend CanvasCitationSpec and the BlockNoteCitationInline type.
 */
import { createInlineContentSpec } from '@blocknote/core';

export const CITATION_INLINE_TYPE = 'citation' as const;

export const citationInlineConfig = {
  type: CITATION_INLINE_TYPE,
  propSchema: {
    callId: { default: '' },
    segment: { default: '' },
    timestamp: { default: '' },
    speaker: { default: '' },
    speakerId: { default: '' },
    snippet: { default: '' },
    segments: { default: '' },
  },
  content: 'none',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const citationServerSpec = createInlineContentSpec(citationInlineConfig as any, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (inlineContent: any) => {
    // lib is ES2020 (no DOM) on the server; `document` is injected via JSDOM at
    // runtime, so reach it through an `any` cast rather than the DOM typings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document;
    if (!doc) {
      throw new Error(
        'citationServerSpec.render requires a `document` (e.g. via JSDOM). Set `globalThis.document` before rendering on the server.',
      );
    }
    const el = doc.createElement('sup');
    el.setAttribute('data-inline-content-type', 'citation');
    el.textContent = `[${inlineContent.props.segment}]`;
    return { dom: el };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;
