/**
 * ESLint plugin loader for local custom rules
 * This file is referenced by .eslintrc.cjs to load custom rules
 *
 * eslint-plugin-local-rules expects rules to be exported directly,
 * not wrapped in a 'rules' property
 */

module.exports = {
  'no-rocicorp-define-query': require('../../packages/shared/eslint-rules/no-rocicorp-define-query.cjs'),
  'require-is-deleted-filter': require('../../packages/shared/eslint-rules/require-is-deleted-filter.cjs')
}
