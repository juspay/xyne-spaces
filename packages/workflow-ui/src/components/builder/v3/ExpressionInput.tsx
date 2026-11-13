/**
 * The expression editor, wired to the step builder's variable tree.
 *
 * Everything an expression *is* lives in {@link ExpressionEditor}; this says
 * where this surface's values come from. The screens editor has its own, much
 * shorter, wiring — which is the whole reason the two are separate files.
 */
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { extractRefPath } from '@xyne/workflow-sdk/builder';
import { useMemo } from 'react';
import { useVariablePicker } from '../../../hooks/use-variable-picker.js';
import { VariablePickerPopover } from './VariablePickerPopover.js';
import { ExpressionEditor, type ExpressionPath } from '../../shared/ExpressionEditor.js';

export interface ExpressionInputProps {
  /** The stored field value — `{% … %}` when already an expression. */
  value: unknown;
  onChange: (value: unknown) => void;
  config: WorkflowConfig;
  atStepId: string;
  /** The field's JSON-schema type, which decides which functions are offered. */
  fieldType?: string | undefined;
  disabled?: boolean | undefined;
}

export function ExpressionInput({
  value,
  onChange,
  config,
  atStepId,
  fieldType,
  disabled,
}: ExpressionInputProps) {
  // Unfiltered on purpose: inside `$sum` on a number field, the thing you want
  // is a list.
  const { variables } = useVariablePicker({ config, atStepId, enabled: true });
  const paths = useMemo(() => flattenPaths(variables), [variables]);

  return (
    <ExpressionEditor
      value={value}
      onChange={onChange}
      paths={paths}
      fieldType={fieldType}
      disabled={disabled}
      renderPicker={({ insert, close }) => (
        <VariablePickerPopover
          config={config}
          atStepId={atStepId}
          onSelect={(ref) => {
            // Bare: inside `{% … %}` a path carries no braces.
            insert(extractRefPath(ref) ?? ref);
            close();
          }}
          onClose={close}
        />
      )}
    />
  );
}

/** Every leaf and branch path in the picker tree, flattened for completion. */
function flattenPaths(
  nodes: Array<{ path: string; schemaType: string; children: unknown[] }>,
): ExpressionPath[] {
  const out: ExpressionPath[] = [];
  const walk = (list: typeof nodes): void => {
    for (const node of list) {
      out.push({ path: node.path, schemaType: node.schemaType });
      walk(node.children as typeof nodes);
    }
  };
  walk(nodes);
  return out;
}
