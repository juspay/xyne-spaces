import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ZodSchema } from 'zod';
import { AppError } from './errorHandler';
import { validateProjectIds, validateChannelIds, validateUserIds, validateBoardIds, validateTicketIds, validateDocTypes, parseIds } from '@/utils/idValidator';
import { parseDateToTimestamp, parseTimeKeyword } from '@/vespa/src/utils/dateParser';

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
 * Middleware to validate search filters and return empty results for invalid values
 */
export const validateSearchFilters = () => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { priority, offset = 0, limit = 20, projectId, in: inChannel, from, on, after, before, range, board, ticketId, assignee, type } = req.query;

    // Validate 'on' filter (specific date)
    if (on) {
      const isValid = parseDateToTimestamp(on as string, 'start') !== null;
      if (!isValid) {
        res.json({ success: true, data: { grouped: false, results: [], totalCount: 0, offset: Number(offset), limit: Number(limit) } });
        return;
      }
    }

    // Validate 'after' filter (created after date)
    if (after) {
      const isValid = parseDateToTimestamp(after as string, 'start') !== null;
      if (!isValid) {
        res.json({ success: true, data: { grouped: false, results: [], totalCount: 0, offset: Number(offset), limit: Number(limit) } });
        return;
      }
    }

    // Validate 'before' filter (created before date)
    if (before) {
      const isValid = parseDateToTimestamp(before as string, 'end') !== null;
      if (!isValid) {
        res.json({ success: true, data: { grouped: false, results: [], totalCount: 0, offset: Number(offset), limit: Number(limit) } });
        return;
      }
    }

    // Validate 'range' filter (time keyword)
    if (range) {
      const isValid = parseTimeKeyword(range as string) !== null;
      if (!isValid) {
        res.json({ success: true, data: { grouped: false, results: [], totalCount: 0, offset: Number(offset), limit: Number(limit) } });
        return;
      }
    }

    // Validate priority filter (supports comma-separated values)
    if (priority) {
      const validPriorities = ['HIGH', 'MEDIUM', 'LOW', 'CRITICAL'];
      const priorityValues = (priority as string).split(',').map(p => p.trim().toUpperCase());
      const allValid = priorityValues.every(p => validPriorities.includes(p));
      if (!allValid) {
        res.json({ success: true, data: { grouped: false, results: [], totalCount: 0, offset: Number(offset), limit: Number(limit) } });
        return;
      }
    }

    try {
      // Validate projectId
      if (projectId) {
        const projectIds = parseIds(projectId as string);
        const validation = await validateProjectIds(projectIds);
        if (validation.invalid.length > 0) {
          throw new AppError(`Invalid project IDs: ${validation.invalid.join(', ')}`, 400);
        }
      }

      // Validate channel IDs (from 'in' parameter)
      if (inChannel) {
        const channelIds = parseIds(inChannel as string);
        const validation = await validateChannelIds(channelIds);
        if (validation.invalid.length > 0) {
          throw new AppError(`Invalid channel IDs: ${validation.invalid.join(', ')}`, 400);
        }
      }

      // Validate user IDs (from 'from' parameter)
      if (from) {
        const userIds = parseIds(from as string);
        const validation = await validateUserIds(userIds);
        if (validation.invalid.length > 0) {
          throw new AppError(`Invalid user IDs: ${validation.invalid.join(', ')}`, 400);
        }
      }

      // Validate docType (type parameter)
      if (type) {
        const docTypes = parseIds(type as string);
        const validation = validateDocTypes(docTypes);
        if (validation.invalid.length > 0) {
          throw new AppError(`Invalid document types: ${validation.invalid.join(', ')}`, 400);
        }
      }

      // Validate board IDs
      if (board) {
        const boardIds = parseIds(board as string);
        const validation = await validateBoardIds(boardIds);
        if (validation.invalid.length > 0) {
          throw new AppError(`Invalid board IDs: ${validation.invalid.join(', ')}`, 400);
        }
      }

      // Validate ticket IDs (docId)
      if (ticketId) {
        const ticketIds = parseIds(ticketId as string);
        const validation = await validateTicketIds(ticketIds);
        if (validation.invalid.length > 0) {
          throw new AppError(`Invalid ticket IDs: ${validation.invalid.join(', ')}`, 400);
        }
      }

      // Validate assignee user IDs
      if (assignee) {
        const userIds = parseIds(assignee as string);
        const validation = await validateUserIds(userIds);
        if (validation.invalid.length > 0) {
          throw new AppError(`Invalid assignee IDs: ${validation.invalid.join(', ')}`, 400);
        }
      }
    } catch (error) {
      // If it's already an AppError, re-throw it
      if (error instanceof AppError) {
        throw error;
      }
      // Otherwise, wrap in AppError
      throw new AppError('ID validation failed', 500);
    }

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