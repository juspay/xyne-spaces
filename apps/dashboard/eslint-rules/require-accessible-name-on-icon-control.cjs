/**
 * ESLint rule to require an accessible name on controls that render only an icon.
 *
 * jsx-a11y/control-has-associated-label assumes any component child (such as an
 * icon) may render text, so it never reports icon-only buttons. This rule closes
 * that gap: a control whose children are all icons (lucide-react, @xyne/icons,
 * react-icons or any component named `*Icon`) must carry aria-label or
 * aria-labelledby (title as well, unless nameAttributes narrows it). Screen
 * readers and the in-app assistant both read controls by role and accessible name.
 *
 * Controls checked:
 * - native button, a, summary
 * - any element with an onClick handler or an interactive role
 * - components named *Button, *Trigger, *Toggle, *Link (a Trigger with asChild is
 *   skipped, its child carries the name)
 *
 * Elements with a spread attribute are skipped, the spread may carry the name.
 *
 * Options:
 * - nameAttributes: attributes that give a name (default aria-label, aria-labelledby, title)
 * - componentNameProps: extra props that count as a name on components only,
 *   for wrappers that turn them into an aria-label (for example `label`, `title`)
 *
 * @example
 * // Invalid
 * <button onClick={close}><X /></button>
 *
 * // Valid
 * <button onClick={close} aria-label="Close dialog"><X /></button>
 */

const NATIVE_CONTROLS = new Set(['button', 'a', 'summary']);
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
const NAME_ATTRIBUTES = ['aria-label', 'aria-labelledby', 'title'];
const ICON_SOURCES = ['lucide-react', '@xyne/icons', 'react-icons/*', '*/icons/*', '*/icons'];
const CONTROL_COMPONENT_PATTERN = /(Button|Trigger|Toggle|Link)$/;

function sourceMatches(source, patterns) {
  return patterns.some((pattern) => {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    return regex.test(source);
  });
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require an accessible name on controls whose only content is an icon',
      category: 'Accessibility',
    },
    fixable: null,
    messages: {
      missingName:
        'Icon-only control needs an accessible name: add an aria-label that says what it does (or aria-labelledby).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          nameAttributes: { type: 'array', items: { type: 'string' } },
          componentNameProps: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const nameAttributes = new Set(options.nameAttributes || NAME_ATTRIBUTES);
    const componentNameProps = new Set(options.componentNameProps || []);
    const importedIcons = new Set();

    function tagName(openingElement) {
      const name = openingElement.name;
      if (name.type === 'JSXIdentifier') {
        return name.name;
      }
      if (name.type === 'JSXMemberExpression') {
        return name.property.name;
      }
      return null;
    }

    function isNative(openingElement) {
      return openingElement.name.type === 'JSXIdentifier' && /^[a-z]/.test(openingElement.name.name);
    }

    function findAttribute(openingElement, attrName) {
      return openingElement.attributes.find(
        (attr) => attr.type === 'JSXAttribute' && attr.name && attr.name.name === attrName,
      );
    }

    function literalValue(attr) {
      if (!attr || !attr.value) {
        return undefined;
      }
      if (attr.value.type === 'Literal') {
        return attr.value.value;
      }
      if (
        attr.value.type === 'JSXExpressionContainer' &&
        attr.value.expression.type === 'Literal'
      ) {
        return attr.value.expression.value;
      }
      return undefined;
    }

    function hasSpread(openingElement) {
      return openingElement.attributes.some((attr) => attr.type === 'JSXSpreadAttribute');
    }

    function hasName(openingElement) {
      const native = isNative(openingElement);
      return openingElement.attributes.some((attr) => {
        if (attr.type !== 'JSXAttribute' || !attr.name) {
          return false;
        }
        const attrName = attr.name.name;
        if (!nameAttributes.has(attrName) && (native || !componentNameProps.has(attrName))) {
          return false;
        }
        const value = literalValue(attr);
        return !(value === '' || (typeof value === 'string' && value.trim() === ''));
      });
    }

    function isHidden(openingElement) {
      const hidden = findAttribute(openingElement, 'aria-hidden');
      const value = literalValue(hidden);
      return hidden !== undefined && (value === true || value === 'true' || value === undefined);
    }

    function isIconElement(openingElement) {
      if (isNative(openingElement)) {
        return openingElement.name.name === 'svg';
      }
      const name = tagName(openingElement);
      if (!name) {
        return false;
      }
      if (openingElement.name.type === 'JSXIdentifier' && importedIcons.has(name)) {
        return true;
      }
      return /Icon$/.test(name);
    }

    // 'icon' | 'empty' | 'other'. 'other' means it may render text or is unknown.
    function classifyExpression(expression) {
      switch (expression.type) {
        case 'JSXEmptyExpression':
          return 'empty';
        case 'Literal':
          if (expression.value === null || expression.value === false || expression.value === true) {
            return 'empty';
          }
          return 'other';
        case 'Identifier':
          return expression.name === 'undefined' ? 'empty' : 'other';
        case 'JSXElement':
        case 'JSXFragment':
          return classifyNode(expression);
        case 'ConditionalExpression':
          return combine([classifyExpression(expression.consequent), classifyExpression(expression.alternate)]);
        case 'LogicalExpression':
          if (expression.operator === '&&') {
            return combine([classifyExpression(expression.right)]);
          }
          return combine([classifyExpression(expression.left), classifyExpression(expression.right)]);
        default:
          return 'other';
      }
    }

    function combine(kinds) {
      if (kinds.includes('other')) {
        return 'other';
      }
      return kinds.includes('icon') ? 'icon' : 'empty';
    }

    function classifyChildren(children) {
      return combine(children.map(classifyNode));
    }

    function classifyNode(node) {
      switch (node.type) {
        case 'JSXText':
          return node.value.trim() === '' ? 'empty' : 'other';
        case 'JSXExpressionContainer':
          return classifyExpression(node.expression);
        case 'JSXFragment':
          return classifyChildren(node.children);
        case 'JSXElement': {
          const opening = node.openingElement;
          if (isHidden(opening)) {
            return 'empty';
          }
          if (isIconElement(opening)) {
            return hasName(opening) ? 'other' : 'icon';
          }
          if (isNative(opening) && !hasName(opening) && !hasSpread(opening) && opening.name.name !== 'img') {
            return classifyChildren(node.children);
          }
          return 'other';
        }
        default:
          return 'other';
      }
    }

    function isControl(openingElement) {
      const attributes = openingElement.attributes;
      if (isNative(openingElement)) {
        const name = openingElement.name.name;
        if (NATIVE_CONTROLS.has(name)) {
          return true;
        }
        if (findAttribute(openingElement, 'onClick')) {
          return true;
        }
        const role = literalValue(findAttribute(openingElement, 'role'));
        return typeof role === 'string' && INTERACTIVE_ROLES.has(role);
      }
      const name = tagName(openingElement);
      if (!name) {
        return false;
      }
      if (attributes.some((attr) => attr.type === 'JSXAttribute' && attr.name && attr.name.name === 'onClick')) {
        return true;
      }
      return CONTROL_COMPONENT_PATTERN.test(name);
    }

    return {
      ImportDeclaration(node) {
        if (!sourceMatches(String(node.source.value), ICON_SOURCES)) {
          return;
        }
        for (const specifier of node.specifiers) {
          importedIcons.add(specifier.local.name);
        }
      },

      JSXElement(node) {
        const opening = node.openingElement;
        if (node.children.length === 0) {
          return;
        }
        if (isHidden(opening) || hasSpread(opening) || hasName(opening)) {
          return;
        }
        if (!isNative(opening) && findAttribute(opening, 'asChild')) {
          return;
        }
        if (isIconElement(opening) || !isControl(opening)) {
          return;
        }
        if (classifyChildren(node.children) !== 'icon') {
          return;
        }
        context.report({ node: opening, messageId: 'missingName' });
      },
    };
  },
};
