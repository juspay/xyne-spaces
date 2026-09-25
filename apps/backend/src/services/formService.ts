import { FormsRepository, CreateFormWithFieldsInput } from '../database/repositories/formsRepository';
import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';
import { Prisma } from '@prisma/client';
import { DatabaseClient } from '../database/client';
import { resolveBoardTicketFormId, resolveFormFieldDefinitionsForForm } from '../utils/fieldDefinition';

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
      contextId?: string | null;
      fieldValue?: string;
      actualFieldValue: Prisma.InputJsonValue;
    }>,
    tx?: Prisma.TransactionClient
  ) {
    return await this.formsRepository.createManyFormEntityValues(data, tx);
  }

  async findFormByContextAndEntity(context: FormContextType, entity: FormEntityType) {
    return await this.formsRepository.findFormByContextAndEntity(context, entity);
  }

  /**
   * Get form with fields by ID
   */
  async findFormWithFields(formId: string) {
    return await this.formsRepository.findFormWithFields(formId);
  }

  async getGlobalFields(input: {
    projectId: string;
    workspaceId: string;
  }) {
    return await this.formsRepository.getGlobalFields(input);
  }

  /**
   * Fields on a board's ticket form, keyed by the canonical id (`globalFieldId ?? id`)
   * that the ticket write path and form_entity_values both use.
   *
   * This is the id space duplicate-scope config must be expressed in: a board whose
   * form is legacy (no GlobalField backing) has no global field ids at all, so a
   * project-GlobalFields list would offer keys its tickets can never supply.
   */
  async getBoardTicketFormFields(input: {
    boardId: string;
    workspaceId: string;
  }): Promise<Array<{
    id: string;
    fieldName: string;
    fieldType: FormFieldType;
    isOptional: boolean;
  }> | null> {
    const { boardId, workspaceId } = input;
    const db = DatabaseClient.getInstance();

    const board = await this.formsRepository.findBoardForWorkspace(boardId, workspaceId);
    if (!board) {
      return null;
    }

    const formId = await resolveBoardTicketFormId(db, boardId);
    if (!formId) {
      return [];
    }

    const fields = await resolveFormFieldDefinitionsForForm(
      db,
      formId,
    );
    return fields.map(({ id, fieldName, fieldType, isOptional }) => ({
      id,
      fieldName,
      fieldType,
      isOptional,
    }));
  }

  /**
   * Update form with fields
   */
  async updateFormWithFields(
    formId: string,
    data: {
      formName: string;
      formDescription?: string;
      projectId?: string;
      fields: Array<{
        fieldId?: string;
        fieldName?: string;
        fieldType?: FormFieldType;
        fieldEnum?: Prisma.InputJsonValue;
        isOptional?: boolean;
        parentOptionId?: string | null;
      }>;
    }
  ) {
    return await this.formsRepository.updateWithFields(formId, data);
  }

  async resolveFormFieldsForFormId(formId: string) {
    return await this.formsRepository.resolveFormFieldsForFormId(formId);
  }

}

// Export a singleton instance
export const formService = new FormService();
