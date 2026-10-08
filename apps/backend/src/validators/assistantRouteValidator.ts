import Joi from 'joi';

const ASSISTANT_ROUTE_MAX_TEXT_CHARS = 2000;
// Jev takes up to 255 options per choice question, and the service adds `none`.
const ASSISTANT_ROUTE_MAX_ACTIONS = 250;

// Reserved choice for "not one of the options"; callers may not use it as an id.
export const ASSISTANT_ROUTE_NONE_ID = 'none';

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
          .pattern(/^[a-z][a-z0-9_]*$/)
          .invalid(ASSISTANT_ROUTE_NONE_ID)
          .required(),
        description: Joi.string().trim().min(1).max(2000).required(),
      })
    )
    .min(1)
    .max(ASSISTANT_ROUTE_MAX_ACTIONS)
    .unique('id')
    .required()
    .messages({
      'array.unique': 'Action ids must be unique',
    }),
  // `screen`: the options are the controls on the user's screen.
  mode: Joi.string().valid('actions', 'screen'),
});
