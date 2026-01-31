import { Request, Response } from 'express';
import { formService } from '@/services/formService';
import { FormFieldType } from '@xyne/shared';
import {logger} from '@/utils/logger';

export class FormController {
  /**
   * Create form
   */
  createForm = async (req: Request, res: Response): Promise<void> => {
    try {
      const { formName, formDescription, contextType, entityType, fields } = req.body;

      if (!req.user?.id) {
        res.status(403).json({ error: 'Authentication required' });
        return;
      }

      // Validate required fields
      if (!formName) {
        res.status(400).json({ error: 'Form name is required' });
        return;
      }

      if (!contextType) {
        res.status(400).json({ error: 'Context type is required' });
        return;
      }

      if (!entityType) {
        res.status(400).json({ error: 'Entity type is required' });
        return;
      }

      if (!fields || !Array.isArray(fields) || fields.length === 0) {
        res.status(400).json({ error: 'At least one field is required' });
        return;
      }

      // Validate all fields have names and types
      const invalidFields = fields.filter(field => !field.fieldName || !field.fieldType);
      if (invalidFields.length > 0) {
        res.status(400).json({ error: 'All fields must have a name and type' });
        return;
      }

      // Validate SELECT fields have at least one option
      fields.forEach((field) => {
        if (field.fieldType === FormFieldType.SINGLE_SELECT || field.fieldType === FormFieldType.MULTI_SELECT) {
          if (!field.fieldEnum || field.fieldEnum.length === 0) {
            throw new Error(`Field "${field.fieldName}" must have at least one option`);
          }
        }
      });

      const form = await formService.createFormWithFields(
        {
          formName,
          formDescription,
          contextType,
          entityType,
          fields,
          createdBy: req.user?.id || '',
        },
      );

      res.status(201).json(form);
    } catch (error: any) {
      logger.error('Error creating form:', error);

      // Handle validation errors from repository
      if (error.message.includes('field')) {
        res.status(400).json({ error: error.message });
        return;
      }

      // Handle Prisma unique constraint error
      if (error.code === 'P2002') {
        const constraint = error.meta?.target;
        if (constraint?.includes('formName')) {
          res.status(400).json({ error: 'A form with this name already exists' });
        }
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

}
