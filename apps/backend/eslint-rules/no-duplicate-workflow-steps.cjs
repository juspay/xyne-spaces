/**
 * ESLint rule to enforce unique workflow step IDs within execute functions
 *
 * This rule prevents duplicate usage of enum step IDs in workflow engine method calls:
 * - engine.createCheckpoint()
 * - engine.createAgenticCheckpoint()
 * - engine.createWhileLoop()
 * - engine.createParallelWorkflows()
 * - engine.createExternalStep()
 * - engine.createConditionalStep()
 *
 * @example
 * // ❌ Invalid - duplicate step ID
 * async execute(engine) {
 *   await engine.createCheckpoint(MySteps.SEND_EMAIL, handler1)
 *   await engine.createCheckpoint(MySteps.SEND_EMAIL, handler2) // Error!
 * }
 *
 * // ✅ Valid - unique step IDs
 * async execute(engine) {
 *   await engine.createCheckpoint(MySteps.SEND_EMAIL, handler1)
 *   await engine.createCheckpoint(MySteps.NOTIFY_SLACK, handler2)
 * }
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce unique workflow step IDs within execute functions',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      duplicateStepId: 'Duplicate workflow step ID "{{stepId}}" detected. First used at line {{firstLine}}, column {{firstColumn}}.',
    },
    schema: [], // no options
  },

  create(context) {
    // Track step IDs used in each execute function
    const executeScopes = []

    // Engine method names to track
    const engineMethods = [
      'createCheckpoint',
      'createAgenticCheckpoint',
      'createWhileLoop',
      'createParallelWorkflows',
      'createExternalStep',
      'createConditionalStep',
    ]

    /**
     * Extract step ID from a node (handles MemberExpression like MySteps.SEND_EMAIL)
     */
    function getStepId(node) {
      if (!node) return null

      // Handle: MySteps.SEND_EMAIL (MemberExpression)
      if (node.type === 'MemberExpression') {
        const object = node.object.name
        const property = node.property.name
        return `${object}.${property}`
      }

      // Handle: 'string_literal' (fallback for old code)
      if (node.type === 'Literal' && typeof node.value === 'string') {
        return node.value
      }

      return null
    }

    /**
     * Check if a function is a workflow execute function
     */
    function isExecuteFunction(node) {
      // Check if function is named 'execute'
      if (node.parent && node.parent.type === 'Property' && node.parent.key.name === 'execute') {
        return true
      }

      // Check if it's a method named 'execute'
      if (node.parent && node.parent.type === 'MethodDefinition' && node.parent.key.name === 'execute') {
        return true
      }

      return false
    }

    /**
     * Check if we're in a scoped engine context (loop body)
     */
    function isInScopedEngine(node) {
      let current = node

      while (current) {
        // Check if current node is a function parameter named 'scopedEngine'
        if (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') {
          const params = current.params
          if (params && params.some(param => param.name === 'scopedEngine')) {
            return true
          }
        }
        current = current.parent
      }

      return false
    }

    return {
      // Enter execute function
      'FunctionExpression, ArrowFunctionExpression'(node) {
        if (isExecuteFunction(node)) {
          // Start tracking step IDs for this execute function
          executeScopes.push({
            node,
            stepIds: new Map(), // Map<stepId, {line, column}>
          })
        }
      },

      // Exit execute function - FunctionExpression
      'FunctionExpression:exit'(node) {
        if (isExecuteFunction(node) && executeScopes.length > 0) {
          // Clean up when exiting execute function
          executeScopes.pop()
        }
      },

      // Exit execute function - ArrowFunctionExpression
      'ArrowFunctionExpression:exit'(node) {
        if (isExecuteFunction(node) && executeScopes.length > 0) {
          // Clean up when exiting execute function
          executeScopes.pop()
        }
      },

      // Track engine method calls
      CallExpression(node) {
        // Only check if we're inside an execute function
        if (executeScopes.length === 0) return

        const currentScope = executeScopes[executeScopes.length - 1]

        // Check if this is an engine method call
        const isEngineMethod =
          node.callee.type === 'MemberExpression' &&
          (node.callee.object.name === 'engine' || node.callee.object.name === 'workflow') &&
          engineMethods.includes(node.callee.property.name)

        if (!isEngineMethod) return

        // Skip if we're in a scoped engine context (loop body with scopedEngine parameter)
        // This allows reusing step IDs in nested scopes
        if (isInScopedEngine(node)) return

        // Get the first argument (step ID)
        const firstArg = node.arguments[0]
        if (!firstArg) return

        const stepId = getStepId(firstArg)
        if (!stepId) return

        // Check if this step ID was already used
        if (currentScope.stepIds.has(stepId)) {
          const firstUsage = currentScope.stepIds.get(stepId)

          context.report({
            node: firstArg,
            messageId: 'duplicateStepId',
            data: {
              stepId,
              firstLine: firstUsage.line,
              firstColumn: firstUsage.column,
            },
          })
        } else {
          // Track this step ID
          currentScope.stepIds.set(stepId, {
            line: firstArg.loc.start.line,
            column: firstArg.loc.start.column,
          })
        }
      },
    }
  },
}
