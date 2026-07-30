/**
 * Minimal JSON Schema validator — only the subset the framework's schemas use
 * (object, array, string, integer, number, boolean, enum, required,
 * additionalProperties: false).
 *
 * This exists so the LlmClient contract is real rather than aspirational: the
 * framework requires that an out-of-schema type is *rejected and retried*,
 * not leniently parsed. A provider that ignores `response_format` will happily
 * return a plausible wrong shape, and without this it would flow straight into
 * the registry.
 */

export interface ValidationError {
  path: string
  message: string
}

export function validate(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$',
): ValidationError[] {
  const errors: ValidationError[] = []
  const type = schema['type'] as string | undefined

  const enumValues = schema['enum'] as unknown[] | undefined
  if (enumValues) {
    if (!enumValues.includes(value)) {
      errors.push({
        path,
        message: `expected one of ${JSON.stringify(enumValues)}, got ${JSON.stringify(value)}`,
      })
    }
    return errors
  }

  switch (type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({ path, message: `expected object, got ${describe(value)}` })
        return errors
      }
      const obj = value as Record<string, unknown>
      const properties =
        (schema['properties'] as Record<string, Record<string, unknown>>) ?? {}
      const required = (schema['required'] as string[]) ?? []

      for (const key of required) {
        if (!(key in obj)) {
          errors.push({ path, message: `missing required property "${key}"` })
        }
      }
      if (schema['additionalProperties'] === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in properties)) {
            errors.push({ path, message: `unexpected property "${key}"` })
          }
        }
      }
      for (const [key, sub] of Object.entries(properties)) {
        if (key in obj) {
          errors.push(...validate(obj[key], sub, `${path}.${key}`))
        }
      }
      return errors
    }

    case 'array': {
      if (!Array.isArray(value)) {
        errors.push({ path, message: `expected array, got ${describe(value)}` })
        return errors
      }
      const items = schema['items'] as Record<string, unknown> | undefined
      if (items) {
        value.forEach((item, i) => {
          errors.push(...validate(item, items, `${path}[${i}]`))
        })
      }
      return errors
    }

    case 'string':
      if (typeof value !== 'string') {
        errors.push({ path, message: `expected string, got ${describe(value)}` })
      }
      return errors

    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push({ path, message: `expected integer, got ${describe(value)}` })
      }
      return errors

    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ path, message: `expected number, got ${describe(value)}` })
      }
      return errors

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({ path, message: `expected boolean, got ${describe(value)}` })
      }
      return errors

    default:
      return errors
  }
}

export function formatErrors(errors: ValidationError[], limit = 10): string {
  return errors
    .slice(0, limit)
    .map((e) => `${e.path}: ${e.message}`)
    .join('\n')
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
