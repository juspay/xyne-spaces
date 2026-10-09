import { formService, type CreateFormRequest } from '../../../../services/Form/formService';
import { toRestPayload } from '../../../../utils/form/formBuilderMapper';
import type {
  FormBuilderData,
  FormBuilderRequestContext,
  FormPersistenceAdapter,
} from '../FormBuilder.types';

// One request body for POST /forms and PUT /forms/:id, so create and update can never
// diverge in how fields and options are shaped.
const buildRequest = (data: FormBuilderData, ctx: FormBuilderRequestContext): CreateFormRequest => {
  const formDescription = data.formDescription.trim();
  return {
    formName: data.formName.trim(),
    ...(formDescription ? { formDescription } : {}),
    contextType: ctx.contextType,
    entityType: ctx.entityType,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    fields: toRestPayload(data),
  };
};

export const restFormAdapter: FormPersistenceAdapter = {
  create: async (data, ctx) => {
    const created = await formService.createForm(buildRequest(data, ctx));
    return { formId: created.id };
  },
  update: async (formId, data, ctx) => {
    await formService.updateForm({ formId, ...buildRequest(data, ctx) });
  },
};
