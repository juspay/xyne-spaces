import { z } from 'zod';

// ============================================================================
// VALIDATION RULES
// ============================================================================

export const validationRuleSchema = z.object({
  type: z.enum(['required', 'minLength', 'maxLength', 'pattern', 'email', 'min', 'max', 'custom']),
  value: z.union([z.number(), z.string()]).optional(),
  message: z.string(),
});

// ============================================================================
// SELECT OPTION
// ============================================================================

export const selectOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  icon: z.string().optional(),
  disabled: z.boolean().optional(),
  description: z.string().optional(),
});

// ============================================================================
// FLOW ACTION (v2 — no endpoint/method/headers)
// ============================================================================

export const flowActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('submit'),
    actionId: z.string(),
    successMessage: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('inputChange'),
    actionId: z.string(),
    debounceMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('update_state'),
    stateUpdates: z.record(z.unknown()),
    successMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('close_screen'),
    finalMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('navigate'),
    target: z.string(),
  }),
]);

// ============================================================================
// COMPONENT STYLE
// ============================================================================

export const flowComponentStyleSchema = z.object({
  padding: z.string().optional(),
  margin: z.string().optional(),
  gap: z.string().optional(),
  align: z.enum(['left', 'center', 'right', 'stretch']).optional(),
  width: z.string().optional(),
  maxWidth: z.string().optional(),
  minWidth: z.string().optional(),
  backgroundColor: z.string().optional(),
  borderRadius: z.string().optional(),
  border: z.string().optional(),
  borderLeft: z.string().optional(),
});

// ============================================================================
// BASE COMPONENT (shared fields)
// ============================================================================

const baseComponentSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  props: z.record(z.unknown()).optional(),
  style: flowComponentStyleSchema.optional(),
  hidden: z.union([z.boolean(), z.string()]).optional(),
  disabled: z.union([z.boolean(), z.string()]).optional(),
}) ;

// ============================================================================
// COMPONENT SCHEMAS (typed — props are well-typed for validation)
// ============================================================================

export const textComponentSchema = baseComponentSchema.extend({
  type: z.literal('text'),
  props: z.object({
    content: z.string(),
    variant: z.enum(['default', 'muted', 'success', 'warning', 'danger']).optional(),
    size: z.enum(['xs', 'sm', 'base', 'lg', 'xl']).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    codeBlock: z.boolean().optional(),
  }).strict().optional(),
});

export const headingComponentSchema = baseComponentSchema.extend({
  type: z.literal('heading'),
  props: z.object({
    content: z.string(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  }).strict().optional(),
});

export const inputComponentSchema = baseComponentSchema.extend({
  type: z.literal('input'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    type: z.enum(['text', 'email', 'password', 'number', 'tel', 'url']).optional(),
    required: z.boolean().optional(),
    validation: z.array(validationRuleSchema).optional(),
    defaultValue: z.string().optional(),
    helperText: z.string().optional(),
    action: flowActionSchema.optional(),
  }).strict(),
});

export const textareaComponentSchema = baseComponentSchema.extend({
  type: z.literal('textarea'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
    required: z.boolean().optional(),
    validation: z.array(validationRuleSchema).optional(),
    defaultValue: z.string().optional(),
  }).strict(),
});

// options can be a static array or "$<key>" dynamic reference
const selectOptionsField = z.union([
  z.array(selectOptionSchema),
  z.string().refine((s) => s.startsWith('$'), {
    message: 'String options must be a "$<key>" reference (e.g. "$myOptions")',
  }),
]);

export const dropdownComponentSchema = baseComponentSchema.extend({
  type: z.literal('dropdown'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    options: selectOptionsField,
    required: z.boolean().optional(),
    action: flowActionSchema.optional(),
  }).strict(),
});

export const selectComponentSchema = baseComponentSchema.extend({
  type: z.literal('select'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    options: selectOptionsField,
    required: z.boolean().optional(),
    defaultValue: z.string().optional(),
    orientation: z.enum(['horizontal', 'vertical']).optional(),
  }).strict(),
});

export const multiselectComponentSchema = baseComponentSchema.extend({
  type: z.literal('multiselect'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    options: selectOptionsField,
    required: z.boolean().optional(),
    defaultValue: z.array(z.string()).optional(),
    orientation: z.enum(['horizontal', 'vertical']).optional(),
  }).strict(),
});

export const dateComponentSchema = baseComponentSchema.extend({
  type: z.literal('date'),
  props: z.object({
    name: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    min: z.string().optional(),
    max: z.string().optional(),
  }).strict().optional(),
});

export const buttonComponentSchema = baseComponentSchema.extend({
  type: z.literal('button'),
  props: z.object({
    label: z.string(),
    variant: z.enum(['primary', 'secondary', 'destructive', 'ghost', 'outline']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    icon: z.string().optional(),
    action: flowActionSchema.optional(),
  }).strict(),
});

export const dividerComponentSchema = baseComponentSchema.extend({
  type: z.literal('divider'),
});

export const imageComponentSchema = baseComponentSchema.extend({
  type: z.literal('image'),
  props: z.object({
    src: z.string().url(),
    alt: z.string().optional(),
    width: z.union([z.string(), z.number()]).optional(),
    height: z.union([z.string(), z.number()]).optional(),
    objectFit: z.enum(['cover', 'contain', 'fill']).optional(),
  }).strict().optional(),
});

export const linkComponentSchema = baseComponentSchema.extend({
  type: z.literal('link'),
  props: z.object({
    href: z.string().url(),
    label: z.string(),
    external: z.boolean().optional(),
    underline: z.boolean().optional(),
  }).strict(),
});

// Recursive container schemas need z.lazy
export const flowComponentSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion('type', [
    textComponentSchema,
    headingComponentSchema,
    inputComponentSchema,
    textareaComponentSchema,
    dropdownComponentSchema,
    selectComponentSchema,
    multiselectComponentSchema,
    dateComponentSchema,
    buttonComponentSchema,
    dividerComponentSchema,
    imageComponentSchema,
    linkComponentSchema,
    // Container types — inline here so they can reference flowComponentSchema
    baseComponentSchema.extend({
      type: z.literal('row'),
      children: z.array(z.lazy(() => flowComponentSchema)).optional(),
    }),
    baseComponentSchema.extend({
      type: z.literal('column'),
      children: z.array(z.lazy(() => flowComponentSchema)).optional(),
    }),
    baseComponentSchema.extend({
      type: z.literal('card'),
      children: z.array(z.lazy(() => flowComponentSchema)).optional(),
    }),
  ]),
);

// ============================================================================
// FLOW STATE
// ============================================================================

export const flowStateSchema = z.object({
  values: z.record(z.unknown()),
  touched: z.record(z.boolean()),
  errors: z.record(z.string()),
  submitting: z.boolean(),
  submitted: z.boolean(),
  history: z.array(z.string()),
  loadingComponentIds: z.array(z.string()),
});

// ============================================================================
// FLOW DEFINITION (v2)
// ============================================================================

export const flowDefinitionSchema = z.object({
  version: z.literal('2.0'),
  screenId: z.string().min(1),
  title: z.string().optional(),
  components: z.array(flowComponentSchema).min(1),
  data: z.record(z.unknown()).optional(),
  state: flowStateSchema,
});

// ============================================================================
// ACTION REQUEST (frontend → Xyne backend)
// ============================================================================

export const actionRequestSchema = z.object({
  actionId: z.string().min(1),
  type: z.enum(['submit', 'inputChange']),
  values: z.record(z.unknown()),
  context: z.object({
    flowJSON: flowDefinitionSchema,
    messageId: z.string().min(1),
    conversationId: z.string().min(1),
  }),
});

// ============================================================================
// APP ACTION RESPONSE (app backend → Xyne backend → frontend)
// ============================================================================

export const appActionResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('open_screen'),
    flowJSON: flowDefinitionSchema,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('next_screen'),
    flowJSON: flowDefinitionSchema,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('close_screen'),
    finalMessage: z.string().optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('update_screen_data'),
    data: z.record(z.unknown()),
    componentUpdates: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('ack'),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
  }),
]);

// ============================================================================
// FLOW UI METADATA (stored in DB message)
// ============================================================================

export const flowUIMetadataSchema = z.object({
  hasFlowUI: z.literal(true),
  flowVersion: z.literal('2.0'),
  flowId: z.string().min(1),
  appId: z.string().min(1),
  flowJSON: flowDefinitionSchema,
});

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type ValidatedFlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type ValidatedFlowComponent = z.infer<typeof flowComponentSchema>;
export type ValidatedActionRequest = z.infer<typeof actionRequestSchema>;
export type ValidatedAppActionResponse = z.infer<typeof appActionResponseSchema>;
export type ValidatedFlowUIMetadata = z.infer<typeof flowUIMetadataSchema>;
export type ValidatedFlowAction = z.infer<typeof flowActionSchema>;

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function validateFlowDefinition(data: unknown) {
  return flowDefinitionSchema.safeParse(data);
}

export function validateFlowComponent(data: unknown) {
  return flowComponentSchema.safeParse(data);
}

export function validateActionRequest(data: unknown) {
  return actionRequestSchema.safeParse(data);
}

export function validateAppActionResponse(data: unknown) {
  return appActionResponseSchema.safeParse(data);
}

export function validateFlowUIMetadata(data: unknown) {
  return flowUIMetadataSchema.safeParse(data);
}

export function formatValidationErrors(result: { success: false; error: z.ZodError }): string[] {
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

// ============================================================================
// DEPRECATED — kept for backward compatibility
// ============================================================================

/** @deprecated Use validateFlowDefinition */
export function validateFlowJSON(data: unknown) {
  return flowDefinitionSchema.safeParse(data);
}

/** @deprecated Use validateFlowComponent */
export function validateComponent(data: unknown) {
  return flowComponentSchema.safeParse(data);
}

/** @deprecated Use validateAppActionResponse */
export function validateFlowWebhookResponse(data: unknown) {
  return appActionResponseSchema.safeParse(data);
}

// Old type aliases for compat
/** @deprecated */
export const flowJSONSchema = flowDefinitionSchema;
/** @deprecated */
export const componentSchema = flowComponentSchema;
/** @deprecated */
export const flowWebhookResponseSchema = appActionResponseSchema;
/** @deprecated */
export type ValidatedFlowJSON = ValidatedFlowDefinition;
