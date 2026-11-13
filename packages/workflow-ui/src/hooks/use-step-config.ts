import { useEffect, useState } from 'react';
import type { StepDescriptor } from '@xyne/workflow-sdk';
import { useWorkflowClient } from './use-workflow-client.js';
import { useSchemaForm, type UseSchemaFormReturn } from './use-schema-form.js';

export interface UseStepConfigOptions {
  stepType: string;
  initialValues: Record<string, unknown>;
  onValuesChange: (values: Record<string, unknown>) => void;
}

export interface UseStepConfigReturn extends UseSchemaFormReturn {
  descriptor: StepDescriptor | undefined;
  isLoading: boolean;
}

export function useStepConfig(opts: UseStepConfigOptions): UseStepConfigReturn {
  const { stepType, initialValues, onValuesChange } = opts;
  const client = useWorkflowClient();

  const [descriptor, setDescriptor] = useState<StepDescriptor | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const desc = await client.schema.step(stepType);
        if (!cancelled) setDescriptor(desc);
      } catch {
        // Step type might not exist — descriptor stays undefined
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [client, stepType]);

  const schema = (descriptor as Record<string, unknown> | undefined)?.['configSchema'] as Record<string, unknown> | undefined;

  const form = useSchemaForm({
    schema: schema ?? { type: 'object', properties: {} },
    initialValues,
    onChange: onValuesChange,
  });

  return {
    ...form,
    descriptor,
    isLoading,
  };
}
