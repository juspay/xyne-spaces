/**
 * Custom ESLint rules for workflow validation
 */

module.exports = {
  rules: {
    'no-duplicate-workflow-steps': require('./no-duplicate-workflow-steps.cjs'),
  },
}
