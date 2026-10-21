import { SchemaForm } from '../SchemaForm/SchemaForm';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';
import {
  BusinessHoursFields,
  type BusinessHoursValue,
} from '../BusinessHoursFields/BusinessHoursFields';
import type { SchemaFormProps } from '../SchemaForm/SchemaForm.types';

const BUSINESS_HOURS_KEYS = ['businessHoursOnly', 'businessHours'];

/** Used by DELAY (with the "Business hours only" toggle) and IS_OUTSIDE_BUSINESS_HOURS (without). */
export function DelayStepForm(props: SchemaFormProps): React.ReactElement {
  const root = resolveSchema(props.schema);
  const properties = Object.fromEntries(
    Object.entries(root.properties ?? {}).filter(([key]) => !BUSINESS_HOURS_KEYS.includes(key)),
  );

  return (
    <div className='flex flex-col gap-4'>
      <SchemaForm {...props} schema={{ ...root, properties }} />
      <BusinessHoursFields
        value={props.value as BusinessHoursValue}
        onChange={patch => props.onChange({ ...props.value, ...patch })}
        toggleable={'businessHoursOnly' in (root.properties ?? {})}
      />
    </div>
  );
}
