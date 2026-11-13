import { useEffect, useState } from 'react';
import type { TriggerDescriptor } from '@xyne/workflow-sdk';
import { useWorkflowClient } from './use-workflow-client.js';
import { useSchemaForm, type UseSchemaFormReturn } from './use-schema-form.js';

export interface UseTriggerConfigOptions {
  triggerType: string;
  initialValues: Record<string, unknown>;
  onValuesChange: (values: Record<string, unknown>) => void;
}

export interface UseTriggerConfigReturn extends UseSchemaFormReturn {
  descriptor: TriggerDescriptor | undefined;
  isLoading: boolean;
}

export function useTriggerConfig(opts: UseTriggerConfigOptions): UseTriggerConfigReturn {
  const { triggerType, initialValues, onValuesChange } = opts;
  const client = useWorkflowClient();

  const [descriptor, setDescriptor] = useState<TriggerDescriptor | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const desc = await client.schema.trigger(triggerType);
        if (!cancelled) setDescriptor(desc);
      } catch {
        // Trigger type might not exist
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [client, triggerType]);

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
