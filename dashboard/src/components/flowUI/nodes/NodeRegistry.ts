import type { FlowComponentType, FlowComponent } from '@xyne/shared';
import type { ComponentType, ReactNode } from 'react';

// Base props interface that all node components extend
export interface NodeComponentBaseProps {
  node: FlowComponent;
  children?: ReactNode;
}

const registry = new Map<FlowComponentType, ComponentType<NodeComponentBaseProps>>();

export const NodeRegistry = {
  register: (type: FlowComponentType, component: ComponentType<NodeComponentBaseProps>): void => {
    registry.set(type, component);
  },
  get: (type: FlowComponentType): ComponentType<NodeComponentBaseProps> | undefined => {
    return registry.get(type);
  },
};

// Lazy imports to avoid circular dependencies
export const initializeRegistry = async (): Promise<void> => {
  const [
    { TextNode },
    { HeadingNode },
    { ButtonNode },
    { InputNode },
    { TextareaNode },
    { SelectNode },
    { CheckboxNode },
    { RadioNode },
    { RowNode },
    { ColumnNode },
    { CardNode },
    { DividerNode },
    { ImageNode },
    { TableNode },
  ] = await Promise.all([
    import('./TextNode'),
    import('./HeadingNode'),
    import('./ButtonNode'),
    import('./InputNode'),
    import('./TextareaNode'),
    import('./SelectNode'),
    import('./CheckboxNode'),
    import('./RadioNode'),
    import('./ContainerNodes'),
    import('./ContainerNodes'),
    import('./ContainerNodes'),
    import('./DividerNode'),
    import('./ImageNode'),
    import('./TableNode'),
  ]);

  NodeRegistry.register('text', TextNode);
  NodeRegistry.register('heading', HeadingNode);
  NodeRegistry.register('button', ButtonNode);
  NodeRegistry.register('input', InputNode);
  NodeRegistry.register('textarea', TextareaNode);
  NodeRegistry.register('dropdown', SelectNode); // single-option dropdown
  NodeRegistry.register('select', RadioNode); // single-option radio group
  NodeRegistry.register('multiselect', CheckboxNode); // multi-option checkbox group
  NodeRegistry.register('row', RowNode);
  NodeRegistry.register('column', ColumnNode);
  NodeRegistry.register('card', CardNode);
  NodeRegistry.register('divider', DividerNode);
  NodeRegistry.register('image', ImageNode);
  NodeRegistry.register('table', TableNode);
};
