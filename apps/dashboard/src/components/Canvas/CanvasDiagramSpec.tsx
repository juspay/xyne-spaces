import { plainContentToString } from '@blocknote/core';
import {
  createDiagramBlockConfig,
  parseDiagramCodeContent,
  parseDiagramCodeElement,
} from '@blocknote/diagram-block';
import { createReactBlockSpec } from '@blocknote/react';
import type { Ref } from 'react';
import { CanvasMermaidWithSource } from './CanvasMermaidWithSource';

/**
 * Renders the diagram block through the same component as the mermaid code
 * block. The package's own render shows a source popup instead and re-renders
 * only when the source changes, so its diagrams keep the old palette after a
 * theme switch — which is why this replaces it rather than restyling it.
 */
export const canvasDiagramBlockSpec = createReactBlockSpec(createDiagramBlockConfig, {
  meta: {
    code: true,
    defining: true,
    isolating: false,
    highlight: () => 'mermaid',
    hardBreakShortcut: 'enter',
  },
  parse: parseDiagramCodeElement,
  parseContent: parseDiagramCodeContent,
  // The code block also claims <pre><code>, so this rule must be tried first.
  runsBefore: ['codeBlock'],
  render: ({ block, editor, contentRef }) => (
    <CanvasMermaidWithSource
      source={plainContentToString(block.content).trim()}
      cacheKey={`canvas-diagram-${block.id}`}
      contentRef={contentRef as Ref<HTMLElement>}
      onRemove={() => editor.removeBlocks([block.id])}
      editable={editor.isEditable}
    />
  ),
  toExternalHTML: ({ contentRef }) => (
    <pre>
      <code className='language-mermaid' data-language='mermaid' ref={contentRef} />
    </pre>
  ),
})();
