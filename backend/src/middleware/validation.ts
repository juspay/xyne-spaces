import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ZodSchema } from 'zod';
import { AppError } from './errorHandler';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body);

    if (error) {
      const errorMessage = error.details
        .map((detail) => detail.message)
        .join(', ');

      throw new AppError(`Validation error: ${errorMessage}`, 400);
    }

    next();
  };
};

export const validateParams = (schema: Joi.ObjectSchema) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.params);

    if (error) {
      const errorMessage = error.details
        .map((detail) => detail.message)
        .join(', ');

      throw new AppError(`Parameter validation error: ${errorMessage}`, 400);
    }

    next();
  };
};

export const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.query, {
      stripUnknown: true,
      convert: true
    });

    if (error) {
      const errorMessage = error.details
        .map((detail) => detail.message)
        .join(', ');

      throw new AppError(`Query validation error: ${errorMessage}`, 400);
    }

    // Assign validated and transformed values back to req.query
    req.query = value;

    next();
  };
};

/**
 * Zod validation middleware for request body
 * Use this for routes that use Zod schemas instead of Joi
 */
export const validateZod = <T>(schema: ZodSchema<T>) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errorMessage = result.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');

      throw new AppError(`Validation error: ${errorMessage}`, 400);
    }

    // Replace body with validated data (strips unknown fields if schema is strict)
    req.body = result.data;

    next();
  };
};