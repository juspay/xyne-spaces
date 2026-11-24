/**
 * ESLint rule: custom-field values are only written and read through their repository.
 *
 * form_entity_values stores a value across typed columns (textValue, textHash, numberValue,
 * dateValue, boolValue, plainValue) plus one form_entity_value_items row per MULTI_SELECT
 * option or USER id. Writing or reading those tables directly makes it easy to miss the
 * hash, the items, or the item rows on read. So outside the allowed files this rule reports:
 * - Prisma calls on `formEntityValues` / `formEntityValueItems` (reads and writes), and
 * - Zero writes through `tx.mutate.form_entity_values` / `tx.mutate.form_entity_value_items`.
 *
 * Use instead:
 * - backend Prisma: @/database/repositories/formEntityValueRepository
 * - Zero mutators: insertFormEntityValue / updateFormEntityValue / moveFormEntityValue /
 *   deleteFormEntityValue from formsMutatorHelpers
 *
 * Options: [{ allowedFiles: string[] }] — path suffixes of the files that own the tables.
 */

const PRISMA_DELEGATES = new Set(['formEntityValues', 'formEntityValueItems']);
const PRISMA_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'groupBy',
  'aggregate',
  'count',
]);
const ZERO_TABLES = new Set(['form_entity_values', 'form_entity_value_items']);
const ZERO_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);

const propertyName = node =>
  node && node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : null;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Write and read form_entity_values only through its repository / mutator helpers',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: { allowedFiles: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      prisma:
        'Use @/database/repositories/formEntityValueRepository instead of calling {{delegate}}.{{method}} directly.',
      zero:
        'Use insertFormEntityValue / updateFormEntityValue / moveFormEntityValue / deleteFormEntityValue from formsMutatorHelpers instead of tx.mutate.{{table}}.{{method}}.',
    },
  },

  create(context) {
    const filename = context.getFilename().split('\\').join('/');
    const allowedFiles = (context.options[0] && context.options[0].allowedFiles) || [];
    if (allowedFiles.some(suffix => filename.endsWith(suffix))) return {};

    return {
      CallExpression(node) {
        const method = propertyName(node.callee);
        if (!method) return;
        const owner = node.callee.object;
        const ownerName = propertyName(owner);
        if (!ownerName) return;

        if (PRISMA_DELEGATES.has(ownerName) && PRISMA_METHODS.has(method)) {
          context.report({ node, messageId: 'prisma', data: { delegate: ownerName, method } });
          return;
        }
        if (ZERO_TABLES.has(ownerName) && ZERO_WRITES.has(method) && propertyName(owner.object) === 'mutate') {
          context.report({ node, messageId: 'zero', data: { table: ownerName, method } });
        }
      },
    };
  },
};
