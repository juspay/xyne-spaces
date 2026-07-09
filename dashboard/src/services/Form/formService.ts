import { apiInstance } from '../clients/apiClient';
import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';

export interface CreateFormField {
  fieldId?: string;
  fieldName?: string;
  fieldType?: FormFieldType;
  fieldEnum?: string[];
  isOptional?: boolean | undefined;
}

export interface CreateFormRequest {
  formName: string;
  formDescription?: string;
  contextType: FormContextType;
  entityType: FormEntityType;
  projectId?: string;
  fields: CreateFormField[];
}

export interface UpdateFormRequest extends CreateFormRequest {
  formId: string;
}

export interface GlobalFieldListResult {
  id: string;
  projectId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: string[] | null;
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

export interface FormFieldResponse {
  id: string;
  formId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: string[] | null;
  isOptional: boolean;
  sequenceNumber: number;
  membershipId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FormDetailResponse {
  id: string;
  formName: string;
  formDescription: string | null;
  entityType: FormEntityType;
  contextType: FormContextType;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  fields: FormFieldResponse[];
}

export class FormService {
  async createForm(data: CreateFormRequest): Promise<CreateFormResponse> {
    const response = await apiInstance.post<CreateFormResponse>('/forms', data);
    return response.data;
  }

  async getFormById(formId: string): Promise<FormDetailResponse> {
    const response = await apiInstance.get<FormDetailResponse>(`/forms/${formId}`);
    return response.data;
  }

  async getGlobalFields(params: { projectId: string }): Promise<GlobalFieldListResult[]> {
    const response = await apiInstance.get<GlobalFieldListResult[]>('/forms/global-fields', {
      params: {
        projectId: params.projectId,
      },
    });
    return response.data;
  }

  async updateForm(data: UpdateFormRequest): Promise<CreateFormResponse> {
    const { formId, ...updateData } = data;
    const response = await apiInstance.put<CreateFormResponse>(`/forms/${formId}`, updateData);
    return response.data;
  }
}

export const formService = new FormService();
