import Joi from 'joi';

export const ticketDuplicateCheckSchema = Joi.object({
  title: Joi.string().trim().min(3).max(200).required().messages({
    'string.base': 'Title must be a string',
    'string.empty': 'Title is required',
    'string.min': 'Title must be at least 3 characters',
    'string.max': 'Title must be 200 characters or less',
    'any.required': 'Title is required',
  }),
  description: Joi.string().trim().min(5).max(5000).required().messages({
    'string.base': 'Description must be a string',
    'string.empty': 'Description is required',
    'string.min': 'Description must be at least 5 characters',
    'string.max': 'Description must be 5000 characters or less',
    'any.required': 'Description is required',
  }),
  projectId: Joi.string().trim().required().messages({
    'string.base': 'Project ID must be a string',
    'string.empty': 'Project ID is required',
    'any.required': 'Project ID is required',
  }),
  limit: Joi.number().integer().min(1).max(10).default(10).messages({
    'number.base': 'Limit must be a number',
    'number.integer': 'Limit must be an integer',
    'number.min': 'Limit must be at least 1',
    'number.max': 'Limit cannot exceed 10',
  }),
});
