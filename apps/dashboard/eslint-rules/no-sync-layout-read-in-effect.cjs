/**
 * Flags geometry reads made directly inside a `useEffect` / `useLayoutEffect` body.
 *
 * Reading layout (`scrollHeight`, `offsetWidth`, `getBoundingClientRect()`, ...)
 * right after React commits forces a synchronous style recalc + layout. In a
 * component rendered once per row, every mounted row pays it, interleaved with the
 * DOM writes of the rows around it, so a list mount turns into dozens of
 * full-document recalcs.
 *
 * Measure inside a `ResizeObserver` callback instead: it runs after layout, and
 * `observe()` always delivers an initial entry. Reads inside nested callbacks
 * (observers, rAF, event handlers) are not flagged.
 *
 * A layout effect that must measure before paint (popover positioning, scroll
 * restoration) is legitimate: disable the rule on that line with a reason.
 *
 * @example
 * // ❌
 * useEffect(() => { setOverflowing(ref.current.scrollHeight > max); }, [max]);
 * // ✅
 * useEffect(() => {
 *   const ro = new ResizeObserver(() => setOverflowing(el.scrollHeight > max));
 *   ro.observe(el);
 *   return () => ro.disconnect();
 * }, [max]);
 */

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
const LAYOUT_PROPS = new Set([
  'offsetWidth',
  'offsetHeight',
  'offsetTop',
  'offsetLeft',
  'clientWidth',
  'clientHeight',
  'scrollWidth',
  'scrollHeight',
  'innerText',
]);
const LAYOUT_METHODS = new Set(['getBoundingClientRect', 'getClientRects', 'getComputedStyle']);

const hookName = callee => {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
};

const propName = member =>
  !member.computed && member.property.type === 'Identifier' ? member.property.name : null;

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow synchronous layout reads directly inside effect bodies',
      category: 'Performance',
      recommended: true,
    },
    messages: {
      syncRead:
        'Reading `{{name}}` in an effect body forces a synchronous style recalc + layout on every mount. Measure in a ResizeObserver callback (it runs after layout) instead.',
    },
    schema: [],
  },

  create(context) {
    const effectBodies = new Set();

    const isDirectlyInEffect = node => {
      let current = node.parent;
      while (current) {
        if (
          current.type === 'FunctionExpression' ||
          current.type === 'ArrowFunctionExpression' ||
          current.type === 'FunctionDeclaration'
        ) {
          return effectBodies.has(current);
        }
        current = current.parent;
      }
      return false;
    };

    return {
      CallExpression(node) {
        const name = hookName(node.callee);
        if (name && EFFECT_HOOKS.has(name)) {
          const [fn] = node.arguments;
          if (fn && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression')) {
            effectBodies.add(fn);
          }
          return;
        }

        const method =
          node.callee.type === 'Identifier'
            ? node.callee.name
            : node.callee.type === 'MemberExpression'
              ? propName(node.callee)
              : null;
        if (method && LAYOUT_METHODS.has(method) && isDirectlyInEffect(node)) {
          context.report({ node, messageId: 'syncRead', data: { name: `${method}()` } });
        }
      },

      MemberExpression(node) {
        const name = propName(node);
        if (!name || !LAYOUT_PROPS.has(name)) return;
        const { parent } = node;
        if (parent.type === 'AssignmentExpression' && parent.left === node) return;
        if (isDirectlyInEffect(node)) {
          context.report({ node, messageId: 'syncRead', data: { name } });
        }
      },
    };
  },
};
