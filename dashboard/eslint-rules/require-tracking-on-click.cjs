/**
 * ESLint rule to enforce activity tracking attributes on interactive elements
 *
 * This rule ensures that any JSX element with an onClick handler OR form elements
 * includes the required activity tracking data attributes for analytics and monitoring.
 *
 * Required attributes:
 * - data-track-category: The feature category (e.g., 'CALLS', 'TICKETS', 'CANVAS')
 * - data-track-name: Specific action name (e.g., 'START_CALL', 'SEARCH_TICKETS')
 *
 * Optional attributes:
 * - data-track-label: Additional context label
 * - data-track-metadata: JSON stringified metadata
 *
 * @example
 * // ❌ Invalid - onClick without tracking attributes
 * <button onClick={handleClick}>Click me</button>
 *
 * // ✅ Valid - onClick with required tracking attributes
 * <button
 *   onClick={handleClick}
 *   data-track-category="TICKETS"
 *   data-track-name="CREATE_TICKET"
 * >
 *   Click me
 * </button>
 *
 * // ❌ Invalid - input without tracking attributes
 * <input type="text" placeholder="Search..." />
 *
 * // ✅ Valid - input with tracking attributes
 * <input
 *   type="text"
 *   placeholder="Search..."
 *   data-track-category="TICKETS"
 *   data-track-name="SearchTickets"
 * />
 *
 * // ✅ Valid - hidden inputs don't need tracking
 * <input type="hidden" name="id" value="123" />
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require activity tracking attributes on interactive elements (onClick, inputs, selects, textareas)',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    messages: {
      missingTrackingAttributes: 'Element must have data-track-category and data-track-name attributes for activity tracking',
      missingTrackCategory: 'Element must have data-track-category attribute for activity tracking',
      missingTrackName: 'Element must have data-track-name attribute for activity tracking',
    },
    schema: [
      {
        type: 'object',
        properties: {
          exemptDataTestIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of data-testid values that are exempt from this rule',
          },
          exemptComponents: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of component names that are exempt from this rule',
          },
          exemptInputTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of input types that are exempt from this rule',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const exemptDataTestIds = new Set(options.exemptDataTestIds || []);
    const exemptComponents = new Set(options.exemptComponents || []);
    const exemptInputTypes = new Set(options.exemptInputTypes || ['hidden', 'submit', 'reset', 'button', 'image', 'file']);

    const FORM_ELEMENTS = new Set(['input', 'select', 'textarea']);

    const TRACKABLE_INPUT_TYPES = new Set([
      'text', 'search', 'url', 'number', 'email', 'tel', 'password',
      'checkbox', 'radio', 'date', 'datetime-local', 'month', 'week',
      'time', 'color', 'range'
    ]);

    function isExempt(node) {
      if (node.name && node.name.name) {
        const componentName = node.name.name;
        if (exemptComponents.has(componentName)) {
          return true;
        }
      }

      if (node.attributes) {
        const dataTestIdAttr = node.attributes.find(
          attr =>
            attr.type === 'JSXAttribute' &&
            attr.name &&
            attr.name.name === 'data-testid' &&
            attr.value &&
            attr.value.type === 'Literal'
        );

        if (dataTestIdAttr && exemptDataTestIds.has(dataTestIdAttr.value.value)) {
          return true;
        }
      }

      return false;
    }

    function hasAttribute(attributes, attrName) {
      return attributes.some(
        attr =>
          attr.type === 'JSXAttribute' &&
          attr.name &&
          attr.name.name === attrName
      );
    }

    function hasOnClick(attributes) {
      return attributes.some(
        attr =>
          attr.type === 'JSXAttribute' &&
          attr.name &&
          attr.name.name === 'onClick'
      );
    }

    function isNativeElement(node) {
      return node.name && typeof node.name.name === 'string' && node.name.name === node.name.name.toLowerCase();
    }

    function getElementType(node, attributes) {
      if (node.name.name === 'input') {
        const typeAttr = attributes.find(
          attr =>
            attr.type === 'JSXAttribute' &&
            attr.name &&
            attr.name.name === 'type' &&
            attr.value &&
            attr.value.type === 'Literal'
        );
        return typeAttr ? typeAttr.value.value : 'text';
      }
      return node.name.name;
    }

    function shouldRequireTracking(node) {
      const attributes = node.attributes || [];

      // Only check native elements (lowercase tag names)
      if (!isNativeElement(node)) {
        return false;
      }

      const elementName = node.name.name;

      // Require tracking for elements with onClick
      if (hasOnClick(attributes)) {
        return true;
      }

      // Require tracking for form elements without onClick
      if (!FORM_ELEMENTS.has(elementName)) {
        return false;
      }

      const inputType = getElementType(node, attributes);

      if (exemptInputTypes.has(inputType)) {
        return false;
      }

      if (elementName === 'input' && !TRACKABLE_INPUT_TYPES.has(inputType)) {
        return false;
      }

      return true;
    }

    return {
      JSXOpeningElement(node) {
        if (isExempt(node)) {
          return;
        }

        if (!shouldRequireTracking(node)) {
          return;
        }

        const attributes = node.attributes || [];

        const hasTrackCategory = hasAttribute(attributes, 'data-track-category');
        const hasTrackName = hasAttribute(attributes, 'data-track-name');

        const missingAttributes = [];
        if (!hasTrackCategory) missingAttributes.push('data-track-category');
        if (!hasTrackName) missingAttributes.push('data-track-name');

        if (missingAttributes.length > 0) {
          if (missingAttributes.length === 1) {
            const attr = missingAttributes[0];
            const messageMap = {
              'data-track-category': 'missingTrackCategory',
              'data-track-name': 'missingTrackName',
            };
            context.report({
              node,
              messageId: messageMap[attr],
            });
          } else {
            context.report({
              node,
              messageId: 'missingTrackingAttributes',
              data: {
                missing: missingAttributes.join(', '),
              },
            });
          }
        }
      },
    };
  },
};
