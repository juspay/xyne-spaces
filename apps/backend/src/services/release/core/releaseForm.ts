import { FormFieldType } from "@xyne/shared";

type FieldTypeToValue<T extends FormFieldType> =
    T extends FormFieldType.STRING ? string :
    T extends FormFieldType.NUMBER ? number :
    T extends FormFieldType.BOOLEAN ? boolean :
    T extends FormFieldType.DATE ? string :
    T extends FormFieldType.SINGLE_SELECT ? string :
    T extends FormFieldType.MULTI_SELECT ? string[] :
    T extends FormFieldType.USER ? string :
    string;

type InferFormValue<T extends FormField> = T['required'] extends true ? FieldTypeToValue<T['type']> : FieldTypeToValue<T['type']> | undefined;

export type InferFormValues<T extends readonly FormField[]> = {
    [K in T[number]['name']]: InferFormValue<Extract<T[number], { name: K }>>
};

export type FormValues<T extends readonly FormField[]> = InferFormValues<T>;

type NoExcessProperties<T, U extends T> = U & Record<Exclude<keyof U, keyof T>, never>;

/**
 * Strict form values type that rejects excess properties
 * Use this instead of z.infer for compile-time excess property checking
 */
export type StrictFormValues<T extends readonly FormField[]> = NoExcessProperties<
    InferFormValues<T>,
    InferFormValues<T>
>;

export type FormField = {
    /** Field name as it appears in formValue */
    name: string;
    /** Human-readable label */
    label: string;
    /** Data type for the field */
    type: FormFieldType;
    /** Whether this field is required */
    required?: boolean;
    /** Default value when not provided */
    defaultValue?: unknown;
    /** Helper text for the form */
    description?: string;
    /** Options for select type */
    options?: readonly { readonly value: string; readonly label: string }[];
    /** Placeholder text */
    placeholder?: string;
};

export type FormSchema = {
    /** Change type identifier */
    changeType: string;
    /** Array of field definitions */
    fields: readonly FormField[];
};

export abstract class FormSchemaProvider<TChangeType extends string = string> {

    abstract getFormSchema(changeType: TChangeType): FormSchema | null;

    abstract getAvailableChangeTypes(): TChangeType[];

    hasChangeType(changeType: TChangeType): boolean {
        return this.getAvailableChangeTypes().includes(changeType);
    }
}
