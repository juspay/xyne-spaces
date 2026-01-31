/**
 * ESLint plugin loader for local custom rules
 * This file is referenced by .eslintrc.cjs to load custom workflow validation rules
 *
 * eslint-plugin-local-rules expects rules to be exported directly,
 * not wrapped in a 'rules' property
 */

module.exports = {
  'no-duplicate-workflow-steps': require('./eslint-rules/no-duplicate-workflow-steps.cjs'),
  'no-rocicorp-define-query': require('../shared/eslint-rules/no-rocicorp-define-query.cjs'),
}
