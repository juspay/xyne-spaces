/**
 * Flags Tailwind classes that make style recalculation expensive.
 *
 * - `transition-all` transitions every animatable property, including inherited
 *   ones such as `scrollbar-color`. Those run on the main thread, and an inherited
 *   value animating on an ancestor restyles its whole subtree every frame.
 *   Use `transition` (colors, opacity, shadow, transform) or `transition-[...]`.
 *
 * - `[&_*]:` (descendant universal) makes `*` the key selector, so the rule is
 *   matched against every element under the node on every recalc. Put the class
 *   on the elements that need it, or use the direct-child `*:` variant.
 *
 * Only string literals and template literal chunks are inspected, so this covers
 * `className`, `cn(...)`, `cva(...)` and class constants alike.
 *
 * @example
 * // ❌ className='rounded transition-all hover:bg-accent'
 * // ✅ className='rounded transition hover:bg-accent'
 * // ❌ className='[&_*]:truncate'
 * // ✅ className='*:truncate'
 */

const TRANSITION_ALL = /(^|[\s:'"`])transition-all(?=$|[\s'"`])/;
const DESCENDANT_UNIVERSAL = /\[&_\*[\]:]/;

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow Tailwind classes that make style recalculation expensive',
      category: 'Performance',
      recommended: true,
    },
    messages: {
      transitionAll:
        '`transition-all` also animates inherited properties (e.g. scrollbar-color) on the main thread, restyling whole subtrees every frame. Use `transition` or `transition-[<properties>]`.',
      descendantUniversal:
        '`[&_*]:` makes `*` the key selector for every descendant. Put the class on the elements that need it, or use the direct-child `*:` variant.',
    },
    schema: [],
  },

  create(context) {
    const check = (node, text) => {
      if (typeof text !== 'string' || text.length < 5) return;
      if (TRANSITION_ALL.test(text)) {
        context.report({ node, messageId: 'transitionAll' });
      }
      if (DESCENDANT_UNIVERSAL.test(text)) {
        context.report({ node, messageId: 'descendantUniversal' });
      }
    };

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
