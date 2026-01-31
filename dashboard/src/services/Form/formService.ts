import { apiInstance } from '../clients/apiClient';
import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';

export interface CreateFormField {
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: string[];
  isOptional?: boolean | undefined;
}

export interface CreateFormRequest {
  formName: string;
  formDescription?: string;
  contextType: FormContextType;
  entityType: FormEntityType;
  fields: CreateFormField[];
}

export interface CreateFormResponse {
  id: string;
  formName: string;
  formDescription: string | null;
  entityType: FormEntityType;
  contextType: FormContextType;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export class FormService {
  async createForm(data: CreateFormRequest): Promise<CreateFormResponse> {
    const response = await apiInstance.post<CreateFormResponse>('/forms', data);
    return response.data;
  }
}

export const formService = new FormService();
