/**
 * Custom TypeScript Transformer for Auto-Generating JSON Schemas
 *
 * This transformer automatically extracts JSON schemas from TypeScript types
 * in createExternalStep<R, Args>() calls and injects them at compile time.
 *
 * Supports:
 * - Primitive types (string, number, boolean)
 * - Nested objects
 * - Arrays with item types
 * - Optional fields
 * - Union types and enums
 * - JSDoc descriptions
 */

const ts = require('typescript')

/**
 * Main transformer factory function
 * @param {import('typescript').Program} program
 * @returns {import('typescript').TransformerFactory<import('typescript').SourceFile>}
 */
function createTransformer(program) {
  const typeChecker = program.getTypeChecker()

  return (context) => {
    return (sourceFile) => {

      // Visitor function - called for every AST node
      function visit(node) {

        // Check if this is a call expression
        if (ts.isCallExpression(node)) {

          // Check if it's calling createExternalStep
          if (isCreateExternalStepCall(node, typeChecker)) {

            // Extract type R from generic parameters
            const typeR = extractTypeR(node, typeChecker)

            if (typeR) {
              // Generate JSON schema from type R
              const jsonSchema = generateSchemaFromType(typeR, typeChecker, 0)

              // Inject schema into the metadata argument
              return injectSchemaIntoCall(node, jsonSchema, context)
            }
          }
        }

        // Recursively visit child nodes
        return ts.visitEachChild(node, visit, context)
      }

      return ts.visitNode(sourceFile, visit)
    }
  }
}

/**
 * Detects if a call expression is calling createExternalStep
 */
function isCreateExternalStepCall(node, _typeChecker) {
  const expression = node.expression

  // Check for: engine.createExternalStep(...) or this.createExternalStep(...)
  if (ts.isPropertyAccessExpression(expression)) {
    const methodName = expression.name.text
    return methodName === 'createExternalStep'
  }

  return false
}

/**
 * Extracts type R from generic type arguments: <R, Args>
 */
function extractTypeR(node, typeChecker) {

  // Get type arguments: <R, Args>
  const typeArguments = node.typeArguments

  if (!typeArguments || typeArguments.length === 0) {
    return null
  }

  // First type argument is R
  const typeR = typeArguments[0]

  // Get the actual Type object
  return typeChecker.getTypeFromTypeNode(typeR)
}

/**
 * Enhanced schema generation from TypeScript types
 * Handles primitives, objects, arrays, unions, enums, and optional fields
 */
function generateSchemaFromType(type, typeChecker, depth) {

  // Prevent infinite recursion for circular types
  if (depth > 10) {
    return { type: 'unknown' }
  }

  const typeString = typeChecker.typeToString(type)

  // Handle primitive types
  if (typeString === 'boolean') {
    return { type: 'boolean', required: true }
  }

  if (typeString === 'string') {
    return { type: 'string', required: true }
  }

  if (typeString === 'number') {
    return { type: 'number', required: true }
  }

  if (typeString === 'null' || typeString === 'undefined') {
    return { type: 'null', required: false }
  }

  // Handle array types
  if (typeChecker.isArrayType && typeChecker.isArrayType(type)) {
    const typeArgs = type.typeArguments
    const itemType = typeArgs && typeArgs.length > 0
      ? typeArgs[0]
      : typeChecker.getAnyType()

    return {
      type: 'array',
      required: true,
      items: generateSchemaFromType(itemType, typeChecker, depth + 1)
    }
  }

  // Handle union types (e.g., string | number, or T | undefined for optional)
  if (type.isUnion && type.isUnion()) {
    const unionTypes = type.types

    // Handle optional types (T | undefined)
    const nonUndefinedTypes = unionTypes.filter(t =>
      typeChecker.typeToString(t) !== 'undefined'
    )

    if (nonUndefinedTypes.length === 1) {
      const schema = generateSchemaFromType(nonUndefinedTypes[0], typeChecker, depth + 1)
      schema.required = false  // Mark as optional
      return schema
    }

    // Handle enum-like unions (e.g., 'approved' | 'rejected')
    if (unionTypes.every(t => (t.isStringLiteral && t.isStringLiteral()) || (t.isNumberLiteral && t.isNumberLiteral()))) {
      const enumValues = unionTypes.map(t => {
        if (t.isStringLiteral && t.isStringLiteral()) {
          return t.value
        }
        if (t.isNumberLiteral && t.isNumberLiteral()) {
          return t.value
        }
        return null
      }).filter(v => v !== null)

      const baseType = unionTypes[0].isStringLiteral && unionTypes[0].isStringLiteral() ? 'string' : 'number'

      return {
        type: baseType,
        required: true,
        enum: enumValues
      }
    }

    // Complex union - use first non-undefined type
    return generateSchemaFromType(nonUndefinedTypes[0], typeChecker, depth + 1)
  }

  // Handle literal types
  if (type.isStringLiteral && type.isStringLiteral()) {
    return {
      type: 'string',
      required: true,
      enum: [type.value]
    }
  }

  if (type.isNumberLiteral && type.isNumberLiteral()) {
    return {
      type: 'number',
      required: true,
      enum: [type.value]
    }
  }

  // Handle object types
  const properties = typeChecker.getPropertiesOfType(type)

  if (properties.length > 0) {
    const objectSchema = {
      type: 'object',
      required: true,
      properties: {}
    }

    for (const prop of properties) {
      const propName = prop.getName()

      // Get property type
      const propType = typeChecker.getTypeOfSymbolAtLocation(
        prop,
        prop.valueDeclaration
      )

      // Check if property is optional
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0

      // Generate schema for property
      const propSchema = generateSchemaFromType(propType, typeChecker, depth + 1)

      // Override required based on optional flag
      if (isOptional) {
        propSchema.required = false
      }

      // Add JSDoc description if available
      const jsDocTags = prop.getJsDocTags && prop.getJsDocTags()
      if (jsDocTags) {
        const descriptionTag = jsDocTags.find(tag => tag.name === 'description')
        if (descriptionTag && descriptionTag.text) {
          const textParts = Array.isArray(descriptionTag.text)
            ? descriptionTag.text
            : [descriptionTag.text]
          propSchema.description = textParts.map(t =>
            typeof t === 'string' ? t : t.text
          ).join('')
        }
      }

      objectSchema.properties[propName] = propSchema
    }

    return objectSchema
  }

  // Fallback for unknown types
  return { type: 'unknown', required: true }
}

/**
 * Injects the generated schema into the metadata argument of createExternalStep call
 */
function injectSchemaIntoCall(node, schema, _context) {

  // Get the metadata argument (2nd argument, index 1)
  const args = [...node.arguments]
  const metadataArg = args[1]

  if (!metadataArg || !ts.isObjectLiteralExpression(metadataArg)) {
    // If metadata is not an object literal, we can't inject
    return node
  }

  // Check if user already provided a responseSchema property
  const hasUserProvidedSchema = metadataArg.properties.some(prop => {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      return prop.name.text === 'responseSchema'
    }
    return false
  })

  // If user provided their own schema, respect it and don't override
  if (hasUserProvidedSchema) {
    return node
  }

  // User didn't provide schema - inject auto-generated one
  const schemaProperty = ts.factory.createPropertyAssignment(
    ts.factory.createIdentifier('responseSchema'),
    createObjectLiteral(schema)
  )

  // Create new metadata object with injected schema
  const newMetadata = ts.factory.createObjectLiteralExpression(
    [...metadataArg.properties, schemaProperty],
    true  // multiLine
  )

  // Replace the metadata argument
  args[1] = newMetadata

  // Create new call expression with updated arguments
  return ts.factory.updateCallExpression(
    node,
    node.expression,
    node.typeArguments,
    args
  )
}

/**
 * Creates an AST ObjectLiteralExpression from a schema object
 */
function createObjectLiteral(obj) {
  const properties = []

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue

    let valueExpr

    if (value === null) {
      valueExpr = ts.factory.createNull()
    } else if (typeof value === 'string') {
      valueExpr = ts.factory.createStringLiteral(value)
    } else if (typeof value === 'number') {
      valueExpr = ts.factory.createNumericLiteral(value)
    } else if (typeof value === 'boolean') {
      valueExpr = value ? ts.factory.createTrue() : ts.factory.createFalse()
    } else if (Array.isArray(value)) {
      valueExpr = ts.factory.createArrayLiteralExpression(
        value.map(item => {
          if (typeof item === 'string') return ts.factory.createStringLiteral(item)
          if (typeof item === 'number') return ts.factory.createNumericLiteral(item)
          if (typeof item === 'object') return createObjectLiteral(item)
          return ts.factory.createNull()
        })
      )
    } else if (typeof value === 'object') {
      valueExpr = createObjectLiteral(value)
    } else {
      continue
    }

    properties.push(
      ts.factory.createPropertyAssignment(
        ts.factory.createIdentifier(key),
        valueExpr
      )
    )
  }

  return ts.factory.createObjectLiteralExpression(properties, true)
}

// CommonJS export for ts-patch compatibility
module.exports = createTransformer
module.exports.default = createTransformer
