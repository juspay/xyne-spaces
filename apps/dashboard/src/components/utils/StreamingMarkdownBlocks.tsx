import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import { Lexer } from 'marked';
import type { Root, ElementContent } from 'hast';

/**
 * Streaming markdown, rendered block-by-block so already-shown content can
 * never blink.
 *
 * THE PROBLEM: a single `<ReactMarkdown>{growingString}</ReactMarkdown>`
 * re-parses the whole message on every delta. While the tail is incomplete
 * markdown, its structure flaps between parses (paragraph → list, paragraph →
 * heading, rows joining a table…), which can shift or re-key earlier siblings
 * in the one shared element tree — React then re-mounts them, and any
 * mount-fired CSS animation re-fires: the whole answer blinks.
 *
 * THE FIX (same technique as Vercel's Streamdown / Claude's own UI): split the
 * source into top-level markdown blocks with marked's lexer and render each
 * block through its OWN markdown parse, memoized on the block's raw text.
 *
 * Why this provably cannot blink:
 *  1. Markdown block boundaries are append-only: with a growing source, raw
 *     text changes are confined to the last TWO blocks — the still-growing
 *     tail construct (paragraph continuation, list growth, an unclosed fence
 *     swallowing lines) plus the transient one-delta case where e.g. `\n\n2`
 *     lexes as a paragraph before `2.` merges it back into the list above.
 *     Every earlier block's raw is byte-frozen. (Verified empirically by
 *     char-by-char streaming simulation over adversarial corpora: 0 changes
 *     outside the last 2 blocks, 0 content loss, at every prefix.)
 *  2. `MarkdownBlock` is memoized on that raw string, so a settled block is a
 *     React bail-out: its subtree is skipped entirely — the DOM is never
 *     reconciled again, let alone re-mounted. Whatever the tail does, it is
 *     structurally isolated from everything already on screen. A tail block
 *     whose raw does change (list merge) re-renders in place — its root
 *     element type is stable, so React reuses the DOM node and no mount
 *     animation re-fires.
 *  3. Blocks are keyed by index, and (1) means frozen-zone indexes never
 *     shift — so the block components themselves never re-mount either.
 * Only the live tail re-renders per delta (cheaper than today's
 * whole-message re-parse), and a mount animation on block elements fires once
 * per block — the "materialize" fade — instead of once per delta.
 *
 * CRITICAL companion requirement (learned the hard way — see the consumers):
 * the `render` prop and everything inside it, especially react-markdown
 * `components` overrides, MUST be referentially stable across deltas. React
 * matches elements by component-type REFERENCE; a fresh inline `p:` arrow per
 * render is a new type every delta and forces a full DOM rebuild of every
 * paragraph regardless of the memoization here.
 */
export function splitMarkdownBlocks(source: string): string[] {
  if (!source) return [];
  let tokens: ReturnType<typeof Lexer.lex>;
  try {
    tokens = Lexer.lex(source, { gfm: true });
  } catch {
    // Lexer choked (shouldn't happen — marked is designed not to throw):
    // degrade to a single live block, i.e. exactly today's behavior.
    return [source];
  }
  const blocks: string[] = [];
  for (const token of tokens) {
    const raw = token.raw ?? '';
    if (!raw) continue;
    if (token.type === 'space' && blocks.length > 0) {
      // Fold inter-block blank lines into the preceding block so the block
      // list only ever APPENDS as text streams in — keeping `key={index}`
      // stable for every settled block.
      blocks[blocks.length - 1] += raw;
    } else {
      blocks.push(raw);
    }
  }
  return blocks;
}

export type MarkdownBlockRenderer = (markdown: string) => ReactNode;

/** Memo bail-out: a block whose raw text (and renderer) is unchanged is never
 *  re-rendered — React skips the subtree, guaranteeing its DOM stays put. */
const MarkdownBlock = memo(function MarkdownBlock({
  raw,
  render,
}: {
  raw: string;
  render: MarkdownBlockRenderer;
}): ReactElement {
  return <>{render(raw)}</>;
});

export function StreamingMarkdownBlocks({
  content,
  render,
}: {
  content: string;
  /** Renders one block's markdown — pass the SAME (useCallback-stable)
   *  function used for the completed message so both paths render
   *  identically. Its identity must stay stable across text deltas. */
  render: MarkdownBlockRenderer;
}): ReactElement | null {
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map((raw, i) => (
        <MarkdownBlock key={i} raw={raw} render={render} />
      ))}
    </>
  );
}

// ─── Per-word fade rehype plugin ─────────────────────────────────────────────
/**
 * Wraps each visible WORD of a streamed answer in a
 * `<span class="stream-word">` so newly-arrived words fade in on mount — the
 * Claude-style per-chunk type-in effect.
 *
 * WHY THIS IS SAFE (it blinked when first tried): the blink's real root cause
 * was the react-markdown `components` overrides being fresh inline arrows per
 * render — a new element TYPE each delta, forcing React to rebuild every
 * node, spans included, re-firing their mount fade. With the overrides now
 * memoized (stable types) and StreamingMarkdownBlocks memoizing settled
 * blocks, only the live tail block re-parses per delta; its text is
 * append-only, so existing spans keep their position (and position-derived
 * keys) and reconcile in place — only the genuinely NEW words at the writing
 * edge mount and animate. `processNodeForUserTags` recursion is also
 * position-stable: it cloneElement()s spans and keys array children by index.
 *
 * SCOPING: the fade CSS is `.streaming-answer-fade .stream-word`, so spans
 * only animate inside a container carrying the streaming class. Messages that
 * never streamed render without this plugin and carry no spans.
 *
 * Skips `code`/`pre` (verbatim formatting must not be word-split) and `a`
 * (links + citation chips render their own content; they fade as single
 * units via `.streaming-answer-fade a`).
 *
 * KNOWN EDGE (accepted): inline markdown materializing mid-stream
 * (`**bo` → `**bold**` becoming <strong>) restructures the immediate writing
 * edge, so a few words there re-fade once — localized to the newest text,
 * where a fade reads as natural.
 */
const SKIP_TAGS = new Set(['code', 'pre', 'a']);

function splitTextToNodes(value: string): ElementContent[] {
  // Keep whitespace runs as plain text nodes (spacing/wrapping unchanged);
  // wrap each visible word in a fade span.
  //
  // @-mentions (`<Pradeep J>`) need NO special-casing here: react-markdown
  // runs remark-rehype with allowDangerousHtml, so a completed mention is a
  // hast `raw` node — processChildren passes it through untouched (never
  // split, never wrapped) and react-markdown later converts it to a bare
  // text node for processNodeForUserTags. (Verified empirically. An earlier
  // `<[^<>]*>`-atomic variant of this split was REMOVED because it made
  // ordinary prose like `5 < 10 … x > 3` collapse into one span when the
  // later `>` streamed in, re-fading settled words far from the writing
  // edge.)
  const parts = value.split(/(\s+)/);
  const out: ElementContent[] = [];
  for (const part of parts) {
    if (part === '') continue;
    if (/^\s+$/.test(part)) {
      out.push({ type: 'text', value: part });
    } else {
      out.push({
        type: 'element',
        tagName: 'span',
        properties: { className: ['stream-word'] },
        children: [{ type: 'text', value: part }],
      });
    }
  }
  return out;
}

function processChildren(children: ElementContent[]): ElementContent[] {
  const out: ElementContent[] = [];
  for (const child of children) {
    if (child.type === 'text') {
      out.push(...splitTextToNodes(child.value));
    } else if (child.type === 'element') {
      if (!SKIP_TAGS.has(child.tagName)) {
        child.children = processChildren(child.children);
      }
      out.push(child);
    } else {
      out.push(child);
    }
  }
  return out;
}

export function rehypeStreamWordFade() {
  return (tree: Root): void => {
    tree.children = processChildren(
      tree.children as unknown as ElementContent[],
    ) as unknown as Root['children'];
  };
}
