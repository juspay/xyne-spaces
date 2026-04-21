import { FormsRepository, CreateFormWithFieldsInput } from '../database/repositories/formsRepository';
import { FormContextType, FormEntityType } from '@xyne/shared';
import { Prisma } from '@prisma/client';

export class FormService {
  private formsRepository: FormsRepository;

  constructor() {
    this.formsRepository = new FormsRepository();
  }

  /**
   * Create a form with fields
   * This method handles the business logic for form creation
   * @param data - The form data including fields
   * @returns The created form
   */
  async createFormWithFields(data: CreateFormWithFieldsInput) {
    return await this.formsRepository.createWithFields(data);
  }

  /**
   * Get form fields by form ID
   */
  async findFormFields(formId: string) {
    return await this.formsRepository.findFormFields(formId);
  }

  /**
   * Save multiple form entity values at once
   */
  async createManyFormEntityValues(
    data: Array<{
      formId: string;
      entityId: string;
      entityType: string;
      fieldId: string;
      fieldValue?: string;
      actualFieldValue: Prisma.InputJsonValue;
    }>
  ) {
    return await this.formsRepository.createManyFormEntityValues(data);
  }

  async findFormByContextAndEntity(context: FormContextType, entity: FormEntityType) {
    return await this.formsRepository.findFormByContextAndEntity(context, entity);
  }

}

// Export a singleton instance
export const formService = new FormService();
