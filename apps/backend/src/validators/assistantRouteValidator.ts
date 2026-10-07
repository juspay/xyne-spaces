import Joi from 'joi';

const ASSISTANT_ROUTE_MAX_TEXT_CHARS = 2000;
// Jev takes up to 255 options per choice question, and the service adds `none`.
const ASSISTANT_ROUTE_MAX_ACTIONS = 250;

// Reserved choice for "not one of the options"; callers may not use it as an id.
export const ASSISTANT_ROUTE_NONE_ID = 'none';

// Mirrors `FieldKind` in apps/dashboard/src/components/Assistant/actions/action.ts; keep the two
// in step until the list moves to @xyne/shared.
export const ASSISTANT_ROUTE_FIELD_KINDS = [
  'text',
  'longtext',
  'choice',
  'boolean',
  'person',
  'people',
  'channel',
  'date',
] as const;
export type AssistantRouteFieldKind = (typeof ASSISTANT_ROUTE_FIELD_KINDS)[number];

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

const fieldSchema = Joi.object({
  describe: Joi.string().trim().min(1).max(500).required(),
  kind: Joi.string()
    .valid(...ASSISTANT_ROUTE_FIELD_KINDS)
    .required(),
  options: Joi.when('kind', {
    is: 'choice',
    then: Joi.array()
      .items(Joi.string().trim().min(1).max(200))
      .min(1)
      .max(100)
      .unique()
      .required(),
    otherwise: Joi.forbidden(),
  }),
});

export const assistantRouteBodySchema = Joi.object({
  text: Joi.string()
    .trim()
    .min(1)
    .max(ASSISTANT_ROUTE_MAX_TEXT_CHARS)
    .required()
    .messages({
      'string.empty': '"text" cannot be empty',
      'string.max': `Text cannot exceed ${ASSISTANT_ROUTE_MAX_TEXT_CHARS} characters`,
      'any.required': '"text" is required',
    }),
  actions: Joi.array()
    .items(
      Joi.object({
        id: Joi.string()
          .min(1)
          .max(100)
          .pattern(ID_PATTERN)
          .invalid(ASSISTANT_ROUTE_NONE_ID)
          .required(),
        description: Joi.string().trim().min(1).max(2000).required(),
        fields: Joi.object().pattern(ID_PATTERN, fieldSchema).max(20),
        // Hidden from this user by their role: it may be chosen, to say so, but never acted on.
        unavailable: Joi.boolean(),
      })
    )
    .min(1)
    .max(ASSISTANT_ROUTE_MAX_ACTIONS)
    .unique('id')
    .required()
    .messages({
      'array.unique': 'Action ids must be unique',
    }),
  // A question the assistant just asked, which `text` may answer; no field when it is about the
  // whole request.
  pending: Joi.object({
    action: Joi.string().max(100).pattern(ID_PATTERN).required(),
    field: Joi.string().pattern(ID_PATTERN),
    prompt: Joi.string().trim().min(1).max(500).required(),
  }),
});
