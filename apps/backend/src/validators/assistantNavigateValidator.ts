import Joi from 'joi';

const MAX_GOAL_CHARS = 500;
// Jev takes up to 255 options per choice question, and the service adds `none`.
const MAX_CANDIDATES = 250;
const MAX_HISTORY = 20;

// Reserved choice for "nothing here leads toward the goal"; callers may not use it as an id.
export const ASSISTANT_NAVIGATE_NONE_ID = 'none';

const shortText = (max: number) => Joi.string().trim().allow('').max(max);

export const assistantNavigateStepBodySchema = Joi.object({
  goal: Joi.string().trim().min(1).max(MAX_GOAL_CHARS).required(),
  page: Joi.object({
    url: Joi.string().trim().min(1).max(2000).required(),
    title: shortText(300).default(''),
    headings: Joi.array().items(shortText(200)).max(20).default([]),
  }).required(),
  history: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().trim().min(1).max(2000).required(),
        clicked: Joi.string().trim().min(1).max(500).required(),
        urlAfter: Joi.string().trim().min(1).max(2000).required(),
        // False when the click changed nothing on screen: a dead end Jev should not pick again.
        changed: Joi.boolean().default(true),
      })
    )
    .max(MAX_HISTORY)
    .default([]),
  candidates: Joi.array()
    .items(
      Joi.object({
        id: Joi.string()
          .min(1)
          .max(20)
          .pattern(/^c[0-9]+$/)
          .invalid(ASSISTANT_NAVIGATE_NONE_ID)
          .required(),
        description: Joi.string().trim().min(1).max(500).required(),
      })
    )
    .max(MAX_CANDIDATES)
    .unique('id')
    .default([])
    .messages({ 'array.unique': 'Candidate ids must be unique' }),
});

/**
 * One pick from a list the dashboard built: either which destination in the app the user means,
 * or which named item (a canvas, a DM, a channel…) of one kind.
 */
export const assistantNavigateChooseBodySchema = Joi.object({
  goal: Joi.string().trim().min(1).max(MAX_GOAL_CHARS).required(),
  kind: Joi.string().valid('destination', 'item').required(),
  // What the options are, in words, for `item`: "canvas", "direct message", "channel"…
  itemType: Joi.string().trim().min(1).max(40).when('kind', {
    is: 'item',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  currentPage: Joi.object({
    url: Joi.string().trim().min(1).max(2000).required(),
    title: shortText(300).default(''),
  }),
  options: Joi.array()
    .items(
      Joi.object({
        id: Joi.string()
          .min(1)
          .max(100)
          .pattern(/^[a-z][a-z0-9_]*$/)
          .invalid(ASSISTANT_NAVIGATE_NONE_ID)
          .required(),
        description: Joi.string().trim().min(1).max(500).required(),
      })
    )
    .min(1)
    .max(MAX_CANDIDATES)
    .unique('id')
    .required()
    .messages({ 'array.unique': 'Option ids must be unique' }),
});
