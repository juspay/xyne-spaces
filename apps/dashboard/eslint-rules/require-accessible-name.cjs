/**
 * require-accessible-name
 *
 * Every interactive control must expose an accessible name, so a screen reader
 * announces something other than "button".
 *
 * WCAG 4.1.2 (Name, Role, Value — Level A). This product is icon-dense: most
 * toolbars, message hover actions, sidebar rails and dialog headers are
 * icon-only buttons. An icon-only button with no `aria-label` is announced as
 * just "button" — the user cannot tell reply from delete.
 *
 * `eslint-plugin-jsx-a11y` does not cover this in its `recommended` set, and
 * its `control-has-associated-label` treats ANY nested component as a possible
 * label — which in a codebase where every button's only child is <Trash /> or
 * <Close /> means it sees almost nothing. This rule closes that specific hole:
 * it resolves each child component back to its import, and a component
 * imported from an icon package cannot name its parent.
 *
 * A control passes if ANY of these is true:
 *  - `aria-label`, `aria-labelledby` or `title` is present and non-empty,
 *  - it contains literal text, or a `{expression}` child that is not solely an icon,
 *  - it contains an <img> with non-empty `alt`,
 *  - it contains a non-icon custom component (which may render its own text),
 *  - it is `aria-hidden` (not exposed to assistive tech at all).
 *
 * Kept deliberately conservative — a rule that cries wolf gets switched off.
 */

const INTERACTIVE_TAGS = new Set(['button', 'a']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'checkbox',
  'radio',
  'option',
]);

const NAME_ATTRS = ['aria-label', 'aria-labelledby', 'title'];

/** Import sources whose exports are icons and therefore never a name. */
const ICON_SOURCE_RE = /(^|\/)icons?($|\/)|^lucide-react$|^@xyne\/icons$|react-icons/;
/** Local component names that are icons regardless of where they came from. */
const ICON_NAME_RE = /Icon$|^Icon[A-Z]|Svg$/;

const getAttr = (node, name) =>
  node.attributes.find(
    attr => attr.type === 'JSXAttribute' && attr.name && attr.name.name === name,
  );

const attrHasValue = attr => {
  if (!attr || !attr.value) {
    return false;
  }
  if (attr.value.type === 'Literal') {
    return typeof attr.value.value === 'string' && attr.value.value.trim().length > 0;
  }
  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;
    if (expr.type === 'Literal') {
      return typeof expr.value === 'string' && expr.value.trim().length > 0;
    }
    return expr.type !== 'JSXEmptyExpression';
  }
  return false;
};

const getRole = node => {
  const roleAttr = getAttr(node, 'role');
  if (!roleAttr || !roleAttr.value || roleAttr.value.type !== 'Literal') {
    return null;
  }
  return roleAttr.value.value;
};

const elementName = node => {
  if (!node.name) {
    return null;
  }
  if (node.name.type === 'JSXIdentifier') {
    return node.name.name;
  }
  // <Icons.Trash /> — use the property, e.g. "Trash".
  if (node.name.type === 'JSXMemberExpression' && node.name.property) {
    return node.name.property.name;
  }
  return null;
};

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Interactive controls must have an accessible name (WCAG 4.1.2). See apps/dashboard/docs/accessibility.md.',
    },
    schema: [],
    messages: {
      missingName:
        'This {{control}} has no accessible name — a screen reader announces it as just "{{role}}". Add aria-label (or visible text, or aria-labelledby).',
    },
  },

  create(context) {
    /** Local names imported from an icon module. */
    const iconLocals = new Set();

    const isIconComponent = name => {
      if (!name) {
        return false;
      }
      return iconLocals.has(name) || ICON_NAME_RE.test(name);
    };

    /** Can this element contribute an accessible name to its parent? */
    const contributesName = element => {
      const opening = element.openingElement;
      if (!opening) {
        return false;
      }
      if (getAttr(opening, 'aria-hidden')) {
        return false;
      }

      const name = elementName(opening);

      if (name === 'img') {
        return attrHasValue(getAttr(opening, 'alt'));
      }
      if (NAME_ATTRS.some(attr => attrHasValue(getAttr(opening, attr)))) {
        return true;
      }
      if (isIconComponent(name)) {
        return false;
      }
      // Any other custom component may render its own text — stay conservative.
      if (name && /^[A-Z]/.test(name)) {
        return true;
      }
      return hasTextContent(element.children || []);
    };

    function hasTextContent(children) {
      return children.some(child => {
        if (child.type === 'JSXText') {
          return child.value.trim().length > 0;
        }
        if (child.type === 'JSXExpressionContainer') {
          const expr = child.expression;
          if (expr.type === 'JSXEmptyExpression') {
            return false;
          }
          if (expr.type === 'JSXElement') {
            return contributesName(expr);
          }
          // {isOpen && <Chevron />} — look through the branches rather than
          // assuming any expression is a name.
          if (expr.type === 'LogicalExpression' && expr.right.type === 'JSXElement') {
            return contributesName(expr.right);
          }
          if (expr.type === 'ConditionalExpression') {
            const branch = other =>
              other.type === 'JSXElement' ? contributesName(other) : true;
            return branch(expr.consequent) || branch(expr.alternate);
          }
          // {label}, {t('close')}, {`${count} more`} — a real name.
          return true;
        }
        if (child.type === 'JSXElement') {
          return contributesName(child);
        }
        if (child.type === 'JSXFragment') {
          return hasTextContent(child.children);
        }
        return false;
      });
    }

    return {
      ImportDeclaration(node) {
        const source = node.source && node.source.value;
        if (typeof source !== 'string' || !ICON_SOURCE_RE.test(source)) {
          return;
        }
        for (const spec of node.specifiers) {
          if (spec.local && spec.local.name) {
            iconLocals.add(spec.local.name);
          }
        }
      },

      JSXOpeningElement(node) {
        const tag = elementName(node);
        const role = getRole(node);

        const isInteractive =
          (tag && INTERACTIVE_TAGS.has(tag)) || (role && INTERACTIVE_ROLES.has(role));
        if (!isInteractive) {
          return;
        }
        if (getAttr(node, 'aria-hidden')) {
          return;
        }
        // An <a> with neither href nor a router `to` is not a link.
        if (tag === 'a' && !getAttr(node, 'href') && !getAttr(node, 'to')) {
          return;
        }
        if (NAME_ATTRS.some(attr => attrHasValue(getAttr(node, attr)))) {
          return;
        }
        // Spread props may carry aria-label from a wrapper — do not guess.
        if (node.attributes.some(attr => attr.type === 'JSXSpreadAttribute')) {
          return;
        }

        const element = node.parent;
        const children = element && element.children ? element.children : [];
        if (hasTextContent(children)) {
          return;
        }

        context.report({
          node,
          messageId: 'missingName',
          data: {
            control: tag ? `<${tag}>` : `role="${role}"`,
            role: role || (tag === 'a' ? 'link' : 'button'),
          },
        });
      },
    };
  },
};
