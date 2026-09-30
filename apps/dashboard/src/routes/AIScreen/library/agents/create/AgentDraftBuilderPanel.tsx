import { useCallback, useMemo, useRef, type ReactElement } from 'react';
import { toast } from 'sonner';
import XyneAISidebar from '@/components/Chat/XyneAISidebar/XyneAISidebar';
import type { PendingAction } from '@/components/Chat/XyneAISidebar/utils/XyneAITypes';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import type { WizardState } from '../../../../ClawAgentsScreen/create/wizardState';
import { buildHiddenContext, buildSeedQuery } from './agentBuilderPrompt';
import { bareToolSlug, paramsToDraftPatch } from './agentDraftPatch';
import { BUILDER_DRIVER_SLUG } from '../detail/AgentBuilderPanel';

const DRAFT_TOOLS = new Set(['create-agent', 'update-agent']);

interface AgentDraftBuilderPanelProps {
  draft: WizardState;
  onApplyPatch: (patch: Partial<WizardState>) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function AgentDraftBuilderPanel({
  draft,
  onApplyPatch,
  onBusyChange,
}: AgentDraftBuilderPanelProps): ReactElement {
  const { data: catalog } = useClawAvailableTools();

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const seed = useMemo(
    () => ({ query: buildSeedQuery(draft), nonce: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const hiddenContext = useCallback(() => buildHiddenContext(draftRef.current), []);

  const onInterceptPendingAction = useCallback(
    (action: PendingAction, approved: boolean): boolean => {
      if (!DRAFT_TOOLS.has(bareToolSlug(action.tool))) return false;
      if (!approved) return true;

      const { patch, problems } = paramsToDraftPatch(
        action.params,
        draftRef.current,
        catalogRef.current,
      );

      problems.forEach(problem => toast.warning(problem));

      if (Object.keys(patch).length === 0) {
        if (problems.length === 0) toast.info('Nothing in that proposal applied to the draft');
        return true;
      }

      onApplyPatch(patch);
      toast.success('Draft updated');
      return true;
    },
    [onApplyPatch],
  );

  return (
    <div className='agent-builder-pane flex h-full min-h-0 flex-col border-l border-border bg-background'>
      <div className='flex shrink-0 flex-col gap-0.5 px-6 pb-4 pt-5'>
        <h2 className='text-sm font-medium text-foreground'>Build with Xyne AI</h2>
        <p className='text-xs leading-5 text-muted-foreground'>
          Describe the agent you want. Xyne AI will help configure it.
        </p>
      </div>

      <div className='min-h-0 flex-1'>
        <XyneAISidebar
          channelId={null}
          variant='sidebar'
          forcedAgentSlug={BUILDER_DRIVER_SLUG}
          startFreshChat
          initialQuery={seed.query}
          autoSendNonce={seed.nonce}
          hiddenContext={hiddenContext}
          onInterceptPendingAction={onInterceptPendingAction}
          {...(onBusyChange ? { onStreamingChange: onBusyChange } : {})}
          composerPlaceholder='Ask Xyne AI to update this agent…'
          showAgentHeader
          hideAgentName
          roomyContent
          hideEmptyStateSuggestions
          hideHeader
          hideHeaderClose
          hideBackgroundStreamNotice
        />
      </div>
    </div>
  );
}
