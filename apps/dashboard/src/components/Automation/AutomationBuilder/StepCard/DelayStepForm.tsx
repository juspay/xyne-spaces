import { SchemaForm } from '../SchemaForm/SchemaForm';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';
import { BusinessHoursFields } from '../BusinessHoursFields/BusinessHoursFields';
import type { SchemaFormProps } from '../SchemaForm/SchemaForm.types';
import type { BusinessHours } from '../../../../api/automationsApi';

export function DelayStepForm(props: SchemaFormProps): React.ReactElement {
  const root = resolveSchema(props.schema);
  const properties = Object.fromEntries(
    Object.entries(root.properties ?? {}).filter(([key]) => key !== 'businessHours'),
  );

  return (
    <div className='flex flex-col gap-4'>
      <SchemaForm {...props} schema={{ ...root, properties }} />
      {props.value['businessHoursOnly'] === true && (
        <BusinessHoursFields
          value={props.value['businessHours'] as BusinessHours | undefined}
          onChange={businessHours => props.onChange({ ...props.value, businessHours })}
        />
      )}
    </div>
  );
}
