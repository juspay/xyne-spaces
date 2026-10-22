import { type ReactElement } from 'react';

import { isFlowNetworkAction, type FlowActionButton } from '@/src/utils/flowAction';

import { FlowJsonSubmitButton } from './FlowJsonSubmitButton';
import { stripMarkdownSyntax } from './flowState';
import type { FlowActionContext } from './FlowRendererTypes';

export const renderFlowActionButton = (
  button: FlowActionButton,
  context: FlowActionContext,
): ReactElement => {
  const label = stripMarkdownSyntax(context.normalizeText(button.label));
  const live = context.canPressButtons && isFlowNetworkAction(button.action);
  return (
    <FlowJsonSubmitButton
      key={button.key}
      label={label}
      variant={button.variant}
      live={live}
      disabled={context.isSubmitting}
      submitting={context.isSubmitting}
      bodyTextColor={context.bodyTextColor}
      {...(live ? { onPress: () => void context.executeAction(button.action) } : {})}
    />
  );
};
