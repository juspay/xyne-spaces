import Joi from 'joi';

export const ticketBoardSuggestionSchema = Joi.object({
    title: Joi.string().trim().min(3).max(500).required().messages({
        'string.base': 'Title must be a string',
        'string.empty': 'Title is required',
        'string.min': 'Title must be at least 3 characters',
        'string.max': 'Title must be 500 characters or less',
        'any.required': 'Title is required',
    }),
    description: Joi.string().trim().allow('').max(4000).optional().messages({
        'string.base': 'Description must be a string',
        'string.max': 'Description must be 4000 characters or less',
    }),
    projectId: Joi.string().trim().required().messages({
        'string.base': 'Project ID must be a string',
        'string.empty': 'Project ID is required',
        'any.required': 'Project ID is required',
    }),
});