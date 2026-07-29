import { FormSchema, FormSchemaProvider } from ".";

export type ChangeRequest<TType extends string, TData = unknown> = {
	type: TType;
	data: TData;
};

export type BaseChangeOutput<TType extends string, TFormValues, TPayload = Record<string, unknown>> = {
	type: TType;
	formFields: FormSchema["fields"];
	formValues: TFormValues;
	payload?: TPayload;
	message?: string;
};

export abstract class ReleaseBase<
	TChangeOutput extends BaseChangeOutput<string, any>,
	TChangeRequest extends ChangeRequest<string, any>
> {
	abstract getChange(request: TChangeRequest): TChangeOutput;

	abstract getReleaseFormSchema(): FormSchemaProvider<string>;

	protected getFormValues(schema: FormSchema, providedValues?: Record<string, unknown>): Record<string, unknown> {
		const values: Record<string, unknown> = {};

		for (const field of schema.fields) {
			if (providedValues?.[field.name] !== undefined) {
				values[field.name] = providedValues[field.name];
			}
		}
		return values;
	}
}

