import { useMemo } from 'react';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';
import {
  BusinessHoursFields,
  DEFAULT_BUSINESS_HOURS,
} from '../BusinessHoursFields/BusinessHoursFields';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { BusinessHours, JsonSchema, ValidationIssue } from '../../Automation.types';

interface DelayStepFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
  readOnly?: boolean;
}

export function DelayStepForm({
  schema,
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
  readOnly = false,
}: DelayStepFormProps): React.ReactElement {
  const baseSchema = useMemo(() => {
    const root = resolveSchema(schema);
    if (!root.properties?.['businessHours']) return root;
    const properties = Object.fromEntries(
      Object.entries(root.properties).filter(([key]) => key !== 'businessHours'),
    );
    return { ...root, properties };
  }, [schema]);

  const businessHoursOnly = value['businessHoursOnly'] === true;
  const businessHours = value['businessHours'] as BusinessHours | undefined;

  const handleChange = (next: Record<string, unknown>): void => {
    const turnedOn = next['businessHoursOnly'] === true && !businessHoursOnly;
    onChange(
      turnedOn && !next['businessHours'] ? { ...next, businessHours: DEFAULT_BUSINESS_HOURS } : next,
    );
  };

  return (
    <div className='flex flex-col gap-4'>
      <SchemaForm
        schema={baseSchema}
        value={value}
        onChange={handleChange}
        issues={issues}
        pathPrefix={pathPrefix}
        variableSources={variableSources}
      />
      {businessHoursOnly && (
        <BusinessHoursFields
          value={businessHours}
          onChange={next => onChange({ ...value, businessHours: next })}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
