import { plainContentToString } from '@blocknote/core';
import {
  BlockMathMLElement,
  createMathBlockConfig,
  MathBlockInputRulesExtension,
  parseBlockMathMLContent,
  parseBlockMathMLElement,
  useLatexToMathMLString,
} from '@blocknote/math-block';
import { createReactBlockSpec } from '@blocknote/react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState, type ReactElement, type Ref } from 'react';
import { useCollapseWhenLeft, useRemoveWhenAbandoned } from './useRemoveWhenAbandoned';

/**
 * The packaged math block edits through a floating source popup with its own
 * OK button, which looks nothing like the diagram block beside it. This keeps
 * the package's parsing and export and replaces only the render, so equations
 * get the same icon-only Edit and the same source panel underneath the preview
 * rather than over it. The equation itself stays unboxed — a border would put
 * a card around what is often a single inline-sized formula.
 */
function CanvasMathBlock(props: {
  source: string;
  contentRef: Ref<HTMLElement>;
  onRemove: () => void;
  editable: boolean;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  // A block inserted from the slash menu starts empty, so it opens straight
  // into its source. Held in state rather than derived from emptiness, or the
  // panel would snap shut on the first keystroke that makes the equation valid.
  const [editing, setEditing] = useState(() => props.source.length === 0);
  const toggleEditing = useCallback(() => setEditing(open => !open), []);
  const stopEditing = useCallback(() => setEditing(false), []);
  const { mathMLString, error } = useLatexToMathMLString(props.source);

  // Half-typed LaTeX is invalid LaTeX, so the preview vanished and reappeared on
  // almost every keystroke and the source panel jumped up and down under the
  // cursor. Holding the last good render keeps the block a stable size while it
  // is being edited; it is replaced the moment the new source parses.
  const lastRendered = useRef('');
  if (mathMLString && !error) lastRendered.current = mathMLString;
  const shownMathML = mathMLString && !error ? mathMLString : lastRendered.current;

  // An empty block has nothing to draw, and useLatexToMathMLString reports no
  // error for empty input — so without the length check a freshly inserted
  // equation counted as renderable and the block came up completely blank.
  const empty = props.source.length === 0;
  const renderable = !empty && Boolean(shownMathML);
  const showSource = editing || !renderable;
  // Only for someone who could have created it: removeBlocks writes through
  // the API, which ProseMirror's editable gate does not cover.
  useRemoveWhenAbandoned(root, empty && props.editable, props.onRemove);
  useCollapseWhenLeft(root, editing, stopEditing);

  return (
    <div className='group/math relative w-full' data-canvas-math='true' ref={root}>
      {/* Decoration, not text: a click on the equation must not place a caret. */}
      {renderable && (
        <div className='relative' contentEditable={false} suppressContentEditableWarning>
          {/* Every action in this bar writes, so a reader gets none of it. The
              equation itself is what they came to read. */}
          {props.editable && (
            <div className='absolute right-2 top-2 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover/math:opacity-100'>
              {/* One bar of icon actions, shaped like the diagram block's, so an
                  equation and a diagram are operated the same way. */}
              <div className='flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur-sm'>
                <button
                  type='button'
                  onClick={toggleEditing}
                  className='flex items-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent'
                  title='Edit source'
                  aria-label='Edit source'
                  data-track-category='CANVAS'
                  data-track-name='Edit_Math_Block'
                >
                  <Pencil className='h-3 w-3' />
                </button>
                <button
                  type='button'
                  onClick={props.onRemove}
                  className='flex items-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent'
                  title='Delete'
                  aria-label='Delete'
                  data-track-category='CANVAS'
                  data-track-name='Delete_Math_Block'
                >
                  <Trash2 className='h-3 w-3' />
                </button>
              </div>
            </div>
          )}
          <div
            className='flex justify-center py-2'
            /* eslint-disable-next-line react/no-danger, @typescript-eslint/naming-convention */
            dangerouslySetInnerHTML={{ __html: shownMathML }}
          />
        </div>
      )}
      {/* contentRef is what BlockNote edits, so it stays mounted when hidden. */}
      <div
        className={
          showSource
            ? 'canvas-math-source relative mt-2'
            : 'canvas-math-source canvas-source-collapsed'
        }
      >
        {renderable && (
          <button
            type='button'
            onClick={() => setEditing(false)}
            className='absolute right-2 top-2 z-10 flex items-center rounded border border-border bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-accent'
            title='Done editing'
            aria-label='Done editing'
            data-track-category='CANVAS'
            data-track-name='Done_Editing_Math_Block'
          >
            <Check className='h-3 w-3' />
          </button>
        )}
        <pre className='bn-code-block m-0 rounded-lg border border-border bg-background p-4'>
          <code ref={props.contentRef} className='canvas-code-editor block' spellCheck={false} />
        </pre>
        {empty && (
          <span className='pointer-events-none absolute left-4 top-4 font-mono text-[15px] leading-[1.55] text-muted-foreground'>
            E = mc^2
          </span>
        )}
        {/* The last good render stays on screen so the block does not jump, so
            this is the only sign that the current LaTeX does not parse. */}
        {error !== undefined && !empty && (
          <p className='mt-2 whitespace-pre-wrap text-xs text-destructive'>{error}</p>
        )}
      </div>
    </div>
  );
}

export const canvasMathBlockSpec = createReactBlockSpec(
  createMathBlockConfig,
  {
    meta: {
      code: true,
      defining: true,
      isolating: false,
      highlight: () => 'latex',
      hardBreakShortcut: 'shift+enter',
    },
    parse: parseBlockMathMLElement,
    parseContent: parseBlockMathMLContent,
    render: ({ block, editor, contentRef }) => (
      <CanvasMathBlock
        source={plainContentToString(block.content).trim()}
        contentRef={contentRef as Ref<HTMLElement>}
        onRemove={() => editor.removeBlocks([block.id])}
        editable={editor.isEditable}
      />
    ),
    toExternalHTML: BlockMathMLElement,
  },
  [MathBlockInputRulesExtension],
)();
