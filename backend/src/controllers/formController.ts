import { Request, Response } from 'express';
import { formService } from '@/services/formService';
import { FormFieldType } from '@xyne/shared';
import { AccessType } from '@prisma/client';
import { repositories } from '@/database/repositories';
import {logger} from '@/utils/logger';

const isElevatedFormEditor = (user: NonNullable<Request['user']>): boolean => {
  return (
    user.orgRole === 'OWNER' ||
    user.orgRole === 'ADMIN' ||
    user.role === 'OWNER' ||
    user.role === 'ADMIN'
  );
};

const hasFormsAccess = async (userId: string, requiredAccess: AccessType): Promise<boolean> => {
  const formsResource = await repositories.resources.findByName('FORMS');
  if (!formsResource) {
    return false;
  }

  return repositories.resourceAccess.hasAccess(userId, formsResource.id, requiredAccess);
};

const isFormAccessibleToUser = async (
  form: { workspaceId: string; createdBy: string },
  user: NonNullable<Request['user']>,
  requiredAccess: AccessType
): Promise<boolean> => {
  if (!user.workspaceId || form.workspaceId !== user.workspaceId) {
    return false;
  }

  if (isElevatedFormEditor(user) || form.createdBy === user.id) {
    return true;
  }

  return hasFormsAccess(user.id, requiredAccess);
};

const isExpectedFormInputError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) {
    return false;
  }

  const { message } = error;
  return (
    message === 'At least one field is required' ||
    message === 'All fields must have a name' ||
    message === 'Fields must include fieldName and fieldType' ||
    message === 'Duplicate field IDs are not allowed' ||
    message === 'Duplicate field names are not allowed' ||
    message === 'Field names must be unique within a form' ||
    message.includes('must have at least one option') ||
    message.includes('Invalid field type') ||
    message.includes('does not belong to this form') ||
    message.includes('does not belong to this workspace') ||
    message.includes('Cannot resolve project for form fields') ||
    message.includes('A field with this name and type already exists')
  );
};

export class FormController {
  /**
   * Get project reusable/global fields for autocomplete.
   */
  getGlobalFields = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user?.id || !req.user.workspaceId) {
        res.status(403).json({ error: 'Authentication required' });
        return;
      }

      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      const fields = await formService.getGlobalFields({
        projectId,
        workspaceId: req.user.workspaceId,
      });

      res.status(200).json(fields);
    } catch (error: any) {
      logger.error('Error getting global fields:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Create form
   */
  createForm = async (req: Request, res: Response): Promise<void> => {
    try {
      const { formName, formDescription, contextType, entityType, fields, projectId } = req.body;

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
          ...(projectId ? { projectId } : {}),
          workspaceId: req.user!.workspaceId!,
          fields,
          createdBy: req.user?.id || '',
        },
      );

      res.status(201).json(form);
    } catch (error: any) {
      logger.error('Error creating form:', error);

      if (isExpectedFormInputError(error)) {
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

  /**
   * Get form by ID with fields
   */
  getFormById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!req.user?.id) {
        res.status(403).json({ error: 'Authentication required' });
        return;
      }

      const form = await formService.findFormWithFields(id);

      if (!form) {
        res.status(404).json({ error: 'Form not found' });
        return;
      }

      if (!(await isFormAccessibleToUser(form, req.user, AccessType.READ))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.status(200).json(form);
    } catch (error: any) {
      logger.error('Error getting form:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Update form by ID with fields
   */
  updateForm = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { formName, formDescription, fields, projectId } = req.body;

      if (!req.user?.id) {
        res.status(403).json({ error: 'Authentication required' });
        return;
      }

      // Validate required fields
      if (!formName) {
        res.status(400).json({ error: 'Form name is required' });
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

      const existingForm = await formService.findFormWithFields(id);

      if (!existingForm) {
        res.status(404).json({ error: 'Form not found' });
        return;
      }

      if (!(await isFormAccessibleToUser(existingForm, req.user, AccessType.WRITE))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const form = await formService.updateFormWithFields(id, {
        formName,
        formDescription,
        ...(projectId ? { projectId } : {}),
        fields: fields.map((field: {
          fieldId?: string;
          fieldName?: string;
          fieldType?: FormFieldType;
          fieldEnum?: string[];
          isOptional?: boolean;
        }) => ({
          ...(field.fieldId !== undefined ? { fieldId: field.fieldId } : {}),
          ...(field.fieldName !== undefined ? { fieldName: field.fieldName } : {}),
          ...(field.fieldType !== undefined ? { fieldType: field.fieldType } : {}),
          ...(field.fieldEnum !== undefined ? { fieldEnum: field.fieldEnum } : {}),
          ...(field.isOptional !== undefined ? { isOptional: field.isOptional } : {}),
        })),
      });

      res.status(200).json(form);
    } catch (error: any) {
      logger.error('Error updating form:', error);

      if (isExpectedFormInputError(error)) {
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
