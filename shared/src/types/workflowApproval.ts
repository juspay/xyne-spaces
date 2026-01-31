interface BaseField {
  name: string
  label: string
  description?: string
  required?: boolean
}

export interface StringField extends BaseField {
  type: 'string'
  placeholder?: string
  default?: string
}

export interface NumberField extends BaseField {
  type: 'number'
  placeholder?: string
  default?: number
}

export interface BooleanField extends BaseField {
  type: 'boolean'
  default?: boolean
}

export interface TextareaField extends BaseField {
  type: 'textarea'
  placeholder?: string
  default?: string
  rows?: number
}

export interface SelectField extends BaseField {
  type: 'select'
  options: Array<{ value: string; label: string }>
  default?: string
  placeholder?: string
  allowCustomValue?: boolean
}

/** Discriminated union of all field types */
export type ResponseSchemaField =
  | StringField
  | NumberField
  | BooleanField
  | TextareaField
  | SelectField

export interface ResponseSchema {
  fields: ResponseSchemaField[]
  description?: string
  submitLabel?: string
  cancelLabel?: string
}

export interface PendingHumanInterventionStep {
  id: string
  stepName: string
  title: string
  responseSchema: ResponseSchema | null
  workflowExecutionId: string
  createdAt: string
}

export interface PendingHumanInterventionResponse {
  requiresIntervention: boolean
  step: PendingHumanInterventionStep | null
}

export function isStringField(field: ResponseSchemaField): field is StringField {
  return field.type === 'string'
}

export function isNumberField(field: ResponseSchemaField): field is NumberField {
  return field.type === 'number'
}

export function isBooleanField(field: ResponseSchemaField): field is BooleanField {
  return field.type === 'boolean'
}

export function isTextareaField(field: ResponseSchemaField): field is TextareaField {
  return field.type === 'textarea'
}

export function isSelectField(field: ResponseSchemaField): field is SelectField {
  return field.type === 'select'
}
