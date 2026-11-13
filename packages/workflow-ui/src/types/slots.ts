import type { ComponentType } from 'react';

/**
 * Named slots that consumers can replace globally (via provider)
 * or per-component (via `slots` prop).
 */
export type SlotName =
  | 'StepNode'
  | 'TriggerNode'
  | 'BranchEdge'
  | 'AddStepButton'
  | 'StepPalette'
  | 'BuilderToolbar'
  | 'StepConfigDrawer'
  | 'ExecutionStepNode'
  | 'ExecutionEdge'
  | 'PauseInteractionPanel'
  | 'StepDetailPanel'
  // Product-provided attribute fields rendered in the create dialogs. The
  // component collects the resource's typed `attributes`; the value rides
  // `client.folders.create({ attributes })` / `workflows.create(...)`.
  | 'folderAttributes'
  | 'workflowAttributes'
  | 'credentialAttributesDisplay'
  // Product-provided share/access UI. The framework gates the Share affordance
  // by `permittedActions` and renders this slot when opened; the host owns the
  // principal model (email/username/group), roles, and transport. See
  // {@link ShareSlotProps}.
  | 'shareResource'
  | 'assigneePicker';

/**
 * Map of slot name → component type for global overrides.
 * Each value is typed as `ComponentType<any>` at the provider level;
 * individual components narrow the props via their own `slots` prop type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotOverrides = Partial<Record<SlotName, ComponentType<any>>>;

/**
 * Props for the `folderAttributes` / `workflowAttributes` slots. The product
 * types `TAttrs` with its `ResourceAttributes<'folder' | 'workflow'>`; its
 * component renders the (possibly complex) construct picker and emits the value.
 */
export interface AttributeFieldsProps<TAttrs = unknown> {
  value: Partial<TAttrs>;
  onChange: (patch: Partial<TAttrs>) => void;
}

/**
 * Props passed to the optional host-defined credential table columns slot.
 * The host renders matching `<th>` elements in header mode and `<td>` elements
 * in row mode. The generic vault never needs to know the host's field names.
 */
export type CredentialAttributesDisplayProps<TAttrs = unknown> =
  | { mode: 'header' }
  | {
      mode: 'row';
      summary: import('@xyne/workflow-sdk/common').CredentialSummary;
      attributes?: TAttrs;
    };

/**
 * Props the framework passes to the `shareResource` slot. The framework decides
 * *whether* to open it (gated by `permittedActions`) and identifies the target;
 * the host-provided component owns everything else — the principal model
 * (email/username/group), roles, and transport.
 */
export interface ShareSlotProps {
  resourceType: 'workflow' | 'folder';
  resourceId: string;
  resourceName?: string;
  onClose: () => void;
}


export interface AssigneePickerProps {
  /** Current field value, as stored in the step's config. `undefined` when unset. */
  value: unknown;
  /** Emit the new value. Pass `undefined` to clear the field. */
  onChange: (next: unknown) => void;
  readOnly?: boolean | undefined;
}

/**
 * ClassNames override map — consumers pass Tailwind classes to override
 * default styles on named inner elements.
 */
export type ClassNamesOverrides = Record<string, string>;
