import { Check } from 'lucide-react';
import mermaid from 'mermaid';
import { useCallback, useEffect, useRef, useState, type ReactElement, type Ref } from 'react';
import { MermaidBlock } from '../Markdown/MermaidBlock';
import { isValidMermaidSyntax } from '../Markdown/MermaidBlock/MermaidBlock.utils';
import { useCollapseWhenLeft, useRemoveWhenAbandoned } from './useRemoveWhenAbandoned';

/**
 * Whether Mermaid can actually draw this source, not just whether it opens with
 * a diagram keyword. MermaidBlock shows a permanent spinner for a diagram that
 * fails to parse in two lines or fewer — it only reports an error for longer
 * ones, to stay quiet while a chat message is still streaming — and its toolbar
 * lives inside that unrendered state, so a canvas block with a typo would have
 * no way back to its own text.
 */
interface MermaidStatus {
  renders: boolean;
  error: string | null;
}

function useMermaidRenders(source: string): MermaidStatus {
  const [status, setStatus] = useState<MermaidStatus>({ renders: true, error: null });

  useEffect(() => {
    if (!isValidMermaidSyntax(source)) {
      setStatus({
        renders: false,
        error: source.trim().length === 0 ? null : 'Not a Mermaid diagram yet.',
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await mermaid.parse(source);
        if (!cancelled) setStatus({ renders: true, error: null });
      } catch (cause) {
        if (!cancelled) {
          setStatus({
            renders: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return status;
}

/**
 * Preview and editable source for a Mermaid diagram, shared by the diagram
 * block and the mermaid code block so the two are one UI rather than two that
 * have to be kept looking alike.
 *
 * MermaidBlock supplies the card, the Diagram/Code toggle, copy, PNG download,
 * an enlarge action and theme following. Edit reveals the source below the
 * preview rather than replacing it, so both are visible at once.
 */
export function CanvasMermaidWithSource(props: {
  source: string;
  cacheKey: string;
  contentRef: Ref<HTMLElement>;
  onRemove: () => void;
  editable: boolean;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  // A block inserted from the slash menu starts empty, so it opens straight
  // into its source. Held in state rather than derived from emptiness, or the
  // panel would snap shut on the first keystroke that makes the diagram valid.
  const [editing, setEditing] = useState(() => props.source.length === 0);
  const toggleEditing = useCallback(() => setEditing(open => !open), []);
  const stopEditing = useCallback(() => setEditing(false), []);

  // The hook must run every render, so it is called before the empty check.
  const { renders: rendersOk, error } = useMermaidRenders(props.source);
  const empty = props.source.length === 0;

  // A diagram is invalid for most of the time it takes to type one, and losing
  // the preview on every keystroke made the block collapse and expand under the
  // cursor. Once a block has drawn something, it keeps showing it while the
  // source is being corrected — MermaidBlock itself holds the last good render.
  const hasRendered = useRef(false);
  if (rendersOk && !empty) hasRendered.current = true;
  if (empty) hasRendered.current = false;
  const renderable = !empty && (rendersOk || hasRendered.current);
  const showSource = editing || !renderable;
  // Only for someone who could have created it: removeBlocks writes through
  // the API, which ProseMirror's editable gate does not cover.
  useRemoveWhenAbandoned(root, empty && props.editable, props.onRemove);
  useCollapseWhenLeft(root, editing, stopEditing);

  return (
    <div className='relative w-full' data-canvas-mermaid='true' ref={root}>
      {/* The preview is decoration inside an editable block: without this a click
          on the diagram drops a caret onto it. Only the source below is text. */}
      {renderable && (
        <div contentEditable={false} suppressContentEditableWarning>
          <MermaidBlock
            chart={props.source}
            messageId={props.cacheKey}
            controlsOnHover
            // In a canvas a click selects the block, as it does on an image, so
            // the enlarged preview moves onto its own toolbar button.
            previewOnClick={false}
            {...(props.editable && { onEdit: toggleEditing, onDelete: props.onRemove })}
          />
        </div>
      )}
      {/* contentRef is what BlockNote edits, so it stays mounted when hidden. */}
      <div
        className={
          showSource
            ? 'canvas-mermaid-source relative mt-2'
            : 'canvas-mermaid-source canvas-source-collapsed'
        }
      >
        {renderable && (
          <button
            type='button'
            onClick={() => setEditing(false)}
            className='absolute right-2 top-2 z-10 flex items-center rounded border border-border bg-background/90 p-1 text-muted-foreground shadow-sm transition-colors hover:bg-accent'
            title='Done editing'
            aria-label='Done editing'
            data-track-category='Mermaid'
            data-track-name='DONE_EDITING_DIAGRAM'
          >
            <Check className='h-3 w-3' />
          </button>
        )}
        <pre className='bn-code-block m-0 rounded-lg border border-border bg-background p-4'>
          <code ref={props.contentRef} className='canvas-code-editor block' spellCheck={false} />
        </pre>
        {empty && (
          <span className='pointer-events-none absolute left-4 top-4 font-mono text-[15px] leading-[1.55] text-muted-foreground'>
            flowchart LR
          </span>
        )}
        {/* Keeping the last good preview up would otherwise hide the fact that
            what is written now does not parse. */}
        {error !== null && !empty && (
          <p className='mt-2 whitespace-pre-wrap text-xs text-destructive'>{error}</p>
        )}
      </div>
    </div>
  );
}
