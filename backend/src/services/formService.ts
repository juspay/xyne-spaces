import { FormsRepository, CreateFormWithFieldsInput } from '../database/repositories/formsRepository';

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
}

// Export a singleton instance
export const formService = new FormService();
