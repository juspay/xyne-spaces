import { FormFieldType } from "@xyne/shared";
// Import from the specific file rather than the `../core` barrel — the barrel
// re-exports releaseService which transitively pulls in the repository
// container, and that container's circular self-import crashes at module-init
// time when this file is loaded by `tsx` scripts (vs. server boot, where Node's
// import order tolerates it). Direct file import keeps scripts working.
import { FormSchema, FormSchemaProvider, StrictFormValues } from "../core/releaseForm";
export enum XyneChangeType {
    MIGRATION = "MIGRATION",
    ENV = "ENV",
    DEPLOYEDMENT_SPECS = "DEPLOYMENT_SPECS",
    VERSION_SPECS = "VERSION_SPECS",
}

export class XyneFormSchemaProvider extends FormSchemaProvider<XyneChangeType> {
    static readonly MIGRATION_FIELDS = [
        {
            name: "description",
            label: "description",
            type: FormFieldType.STRING,
            required: true,
            description: "Name of the migration file",
        },
        {
            name: "filePath",
            label: "File Path",
            type: FormFieldType.STRING,
            required: true,
            description: "Full path to the migration file",
        },
        {
            name: "changeLog",
            label: "Change Log",
            type: FormFieldType.STRING,
            required: true,
            description: "Description of what this migration does",
        },
        {
            name: "query",
            label: "SQL Query",
            type: FormFieldType.STRING,
            required: true,
            description: "The SQL query to execute",
        },
    ] as const;

    static readonly ENV_CHANGE_FIELDS = [
        {
            name: "fileName",
            label: "Environment File",
            type: FormFieldType.STRING,
            required: true,
            description: "Name of the environment file (e.g., .env.production)",
        },
        {
            name: "filePath",
            label: "Specific Path",
            type: FormFieldType.STRING,
            required: true,
            description: "Optional: specific path if different from default",
        },
        {
            name: "fileSlug",
            label: "File Slug",
            type: FormFieldType.STRING,
            required: true,
            // File-derived slug (e.g. `ENV_TS` from env.ts), NOT an env var name.
            // Actual changed var names are derived from oldValue/newValue at read
            // time (see dashboard envVars.ts). Renamed from the misleading "envKey".
            description: "File-derived slug (e.g. ENV_TS); not an env variable name",
        },
        {
            name: "changeType",
            label: "Change Type",
            type: FormFieldType.SINGLE_SELECT,
            required: true,
            options: [
                { value: "ADD", label: "Add" },
                { value: "UPDATE", label: "Update" },
                { value: "DELETE", label: "Delete" },
            ],
        },
        {
            name: "oldValue",
            label: "Old Value",
            type: FormFieldType.STRING,
            required: false,
            description: "Previous value (for UPDATE/DELETE)",
        },
        {
            name: "newValue",
            label: "New Value",
            type: FormFieldType.STRING,
            required: false,
            description: "New value (for ADD/UPDATE)",
        },
        {
            name: "description",
            label: "Description",
            type: FormFieldType.STRING,
            required: false,
            description: "Additional context about this change",
        },
    ] as const;

    static readonly DEPLOYMENT_SPECS_FIELDS = [
        {
            name: "branch",
            label: "Branch name",
            type: FormFieldType.STRING,
            required: true,
            description: "Branch name to be deployed",
        },
        {
            name: "deployedCommitId",
            label: "Deployed commit Id",
            type: FormFieldType.STRING,
            required: true,
            description: "current deployed commit id",
        },
        {
            name: "newCommitId",
            label: "New commit id",
            type: FormFieldType.STRING,
            required: true,
            description: "new commit id to be deployed",
        },
    ] as const;

    static readonly VERSION_SPECS_FIELDS = [
        {
            name: "releaseVersion",
            label: "Release version",
            type: FormFieldType.STRING,
            required: true,
            description: "Version identifier for this release",
        },
    ] as const;

    private static readonly SCHEMAS: Record<XyneChangeType, FormSchema> = {
        [XyneChangeType.MIGRATION]: {
            changeType: XyneChangeType.MIGRATION,
            fields: XyneFormSchemaProvider.MIGRATION_FIELDS,
        },
        [XyneChangeType.ENV]: {
            changeType: XyneChangeType.ENV,
            fields: XyneFormSchemaProvider.ENV_CHANGE_FIELDS,
        },
        [XyneChangeType.DEPLOYEDMENT_SPECS]: {
            changeType: XyneChangeType.DEPLOYEDMENT_SPECS,
            fields: XyneFormSchemaProvider.DEPLOYMENT_SPECS_FIELDS,
        },
        [XyneChangeType.VERSION_SPECS]: {
            changeType: XyneChangeType.VERSION_SPECS,
            fields: XyneFormSchemaProvider.VERSION_SPECS_FIELDS,
        },
    };

    getFormSchema(changeType: string): FormSchema | null {
        return XyneFormSchemaProvider.SCHEMAS[changeType as XyneChangeType] ?? null;
    }

    getAvailableChangeTypes(): XyneChangeType[] {
        return Object.values(XyneChangeType);
    }
}


export type MigrationFormValues = StrictFormValues<typeof XyneFormSchemaProvider.MIGRATION_FIELDS>;
export type EnvFormValues = StrictFormValues<typeof XyneFormSchemaProvider.ENV_CHANGE_FIELDS>;
