import { useContext, type ComponentType } from 'react';
import { WorkflowUIContext } from './workflow-ui-context.js';
import type { SlotName } from '../../types/slots.js';

/**
 * Resolve a slot component: component `slots` → provider `slots` → default.
 *
 * Usage inside a component:
 * ```tsx
 * const StepNodeComp = useSlot('StepNode', props.slots?.StepNode, DefaultStepNode);
 * return <StepNodeComp {...stepNodeProps} />;
 * ```
 */
export function useSlot<P>(
  name: SlotName,
  localOverride: ComponentType<P> | undefined,
  defaultComponent: ComponentType<P>,
): ComponentType<P> {
  const ctx = useContext(WorkflowUIContext);
  if (localOverride) return localOverride;
  const globalOverride = ctx?.slots[name] as ComponentType<P> | undefined;
  if (globalOverride) return globalOverride;
  return defaultComponent;
}

/**
 * Resolve an *optional* slot that has no default (e.g. product attribute
 * fields). Returns `undefined` when the consumer hasn't provided one, so the
 * caller can render nothing.
 */
export function useOptionalSlot<P>(
  name: SlotName,
  localOverride?: ComponentType<P>,
): ComponentType<P> | undefined {
  const ctx = useContext(WorkflowUIContext);
  return localOverride ?? (ctx?.slots[name] as ComponentType<P> | undefined);
}
