import { BaseChangeOutput, ChangeRequest, ReleaseBase } from "../core";
import { EnvFormValues, MigrationFormValues, XyneChangeType, XyneFormSchemaProvider } from "../xyne/xyneReleaseForm";

type MigrationRequest = ChangeRequest<XyneChangeType.MIGRATION, MigrationFormValues>;
type EnvRequest = ChangeRequest<XyneChangeType.ENV, EnvFormValues>;
type XyneChangeRequest = MigrationRequest | EnvRequest;

type MigrationChange = BaseChangeOutput<XyneChangeType.MIGRATION, MigrationFormValues>;
type EnvChange = BaseChangeOutput<XyneChangeType.ENV, EnvFormValues>;

type XyneChangeOutput = MigrationChange | EnvChange;

// Helper type to map request to output
type OutputByRequest<T extends XyneChangeRequest> =
	T extends { type: XyneChangeType.MIGRATION } ? MigrationChange :
	T extends { type: XyneChangeType.ENV } ? EnvChange :
	never;


export class XyneRelease extends ReleaseBase<XyneChangeOutput, XyneChangeRequest> {
	getReleaseFormSchema() {
		return new XyneFormSchemaProvider();
	}

	getChange<T extends XyneChangeRequest>(request: T): OutputByRequest<T> {
		const { type, data } = request;
		const schema = this.getReleaseFormSchema().getFormSchema(type);
		if (!schema) {
			throw new Error(`Unsupported change type: ${type}`);
		}

		return {
			type: type,
			formFields: schema.fields,
			formValues: this.getFormValues(schema, data),
		} as OutputByRequest<T>;
	}

}
