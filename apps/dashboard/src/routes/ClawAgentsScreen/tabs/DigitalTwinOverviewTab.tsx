import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { RefreshCw } from '@/components/ClawAgents/digitalTwin/icons';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/classNames';
import { useClawAgentDetail, clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { CAPABILITY_LABEL_CLASS } from '@/routes/AIScreen/library/shared/primitives/CapabilityChips';
import {
  DETAIL_TEXT_VALUE_CLASS,
  TWIN_STROKE_CLASS,
} from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { useAgentDetailActions } from '@/routes/AIScreen/library/agents/detail/useAgentDetailActions';
import { AgentKnowledgeChips } from '@/routes/AIScreen/library/agents/detail/knowledge/AgentKnowledgeChips';
import { useAgentKnowledge } from '@/routes/AIScreen/library/agents/detail/knowledge/useAgentKnowledge';
import { AgentToolChips } from '@/routes/AIScreen/library/agents/detail/tools/AgentToolChips';
import { useAgentToolSelection } from '@/routes/AIScreen/library/agents/detail/tools/useAgentToolSelection';

const TWIN_SLUG = 'digital-twin';

const INSTRUCTIONS_IDLE_MAX_PX = 250;
const INSTRUCTIONS_FOCUS_MAX_PX = 400;

const OVERVIEW_FIELD_PAD = 'px-3 pt-3 pb-5';

const OVERVIEW_FIELD_CHROME = cn(
  'w-full rounded-2xl bg-muted',
  TWIN_STROKE_CLASS,
  OVERVIEW_FIELD_PAD,
  'placeholder:text-foreground/40 focus:outline-none',
);

const DESCRIPTION_FIELD_CLASS = `${OVERVIEW_FIELD_CHROME} min-h-[44px] resize-none overflow-y-auto`;

const INSTRUCTIONS_FIELD_CLASS = `block w-full ${OVERVIEW_FIELD_PAD} bg-transparent placeholder:text-foreground/40`;

const INSTRUCTIONS_EDIT_CLASS = `${INSTRUCTIONS_FIELD_CLASS} max-h-[250px] resize-none overflow-hidden [field-sizing:content] transition-[height,max-height] duration-200 ease-out focus:h-[400px] focus:max-h-[400px] focus:overflow-y-auto focus:outline-none`;

const INSTRUCTIONS_READ_CLASS = `${INSTRUCTIONS_FIELD_CLASS} max-h-[250px] overflow-hidden`;

const SUPPORTS_FIELD_SIZING =
  typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content') === true;

const isClipped = (el: HTMLElement): boolean => el.scrollHeight > el.clientHeight + 1;

const useInstructionsClip = <T extends HTMLElement>(
  ref: RefObject<T | null>,
  clipKey: string,
  focused: boolean,
): boolean => {
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const sync = (): void => {
      if (!SUPPORTS_FIELD_SIZING && el instanceof HTMLTextAreaElement) {
        if (focused) {
          el.style.height = `${INSTRUCTIONS_FOCUS_MAX_PX}px`;
          el.style.overflowY = 'auto';
        } else {
          el.style.height = 'auto';
          el.style.height = `${Math.min(el.scrollHeight, INSTRUCTIONS_IDLE_MAX_PX)}px`;
          el.style.overflowY = 'hidden';
        }
      }
      setClipped(!focused && isClipped(el));
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    el.addEventListener('input', sync);
    return () => {
      observer.disconnect();
      el.removeEventListener('input', sync);
    };
  }, [clipKey, focused, ref]);

  return clipped;
};

const OverviewInstructionsChrome = ({
  children,
  clipped,
}: {
  children: ReactNode;
  clipped: boolean;
}): ReactElement => (
  <div className={cn('group relative overflow-hidden rounded-2xl bg-muted', TWIN_STROKE_CLASS)}>
    {children}
    <span
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-muted to-transparent transition-opacity duration-200 ease-out group-focus-within:opacity-0',
        clipped ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden
    />
  </div>
);

const OverviewInstructionsEditor = ({
  inputRef,
  value,
  saving,
  onChange,
  onBlur,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}): ReactElement => {
  const [focused, setFocused] = useState(false);
  const clipped = useInstructionsClip(inputRef, value, focused);

  return (
    <OverviewInstructionsChrome clipped={clipped}>
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur();
        }}
        aria-label='Instructions'
        aria-busy={saving}
        placeholder='Add instructions'
        data-track-category='Claw Agents'
        data-track-name='Digital Twin overview: edit instructions'
        className={cn(INSTRUCTIONS_EDIT_CLASS, DETAIL_TEXT_VALUE_CLASS)}
      />
    </OverviewInstructionsChrome>
  );
};

const OverviewInstructionsRead = ({ text }: { text: string }): ReactElement => {
  const ref = useRef<HTMLDivElement>(null);
  const clipped = useInstructionsClip(ref, text, false);

  return (
    <OverviewInstructionsChrome clipped={clipped}>
      <div ref={ref} className={cn(INSTRUCTIONS_READ_CLASS, DETAIL_TEXT_VALUE_CLASS)}>
        {text || 'No instructions set'}
      </div>
    </OverviewInstructionsChrome>
  );
};

const DigitalTwinOverviewBody = ({
  agent,
  canEdit,
}: {
  agent: Agent;
  canEdit: boolean;
}): ReactElement => {
  const queryClient = useQueryClient();
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState(agent.description ?? '');
  const [instructions, setInstructions] = useState(agent.systemPrompt ?? '');
  const [savingDescription, setSavingDescription] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);

  const tools = useAgentToolSelection(agent);
  const knowledge = useAgentKnowledge(agent);

  useEffect(() => {
    if (document.activeElement !== descriptionRef.current) {
      setDescription(agent.description ?? '');
    }
  }, [agent.description]);

  useEffect(() => {
    if (document.activeElement !== instructionsRef.current) {
      setInstructions(agent.systemPrompt ?? '');
    }
  }, [agent.systemPrompt]);

  const persistDescription = async (): Promise<void> => {
    if (savingDescription || description === (agent.description ?? '')) return;
    setSavingDescription(true);
    try {
      const updated = await updateClawAgent(agent.slug, { description });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      toast.success('Description saved');
    } catch (error) {
      toast.error(clawErrorText(error, 'Could not save the description'));
    } finally {
      setSavingDescription(false);
    }
  };

  const persistInstructions = async (): Promise<void> => {
    if (savingInstructions || instructions === (agent.systemPrompt ?? '')) return;
    setSavingInstructions(true);
    try {
      const updated = await updateClawAgent(agent.slug, { systemPrompt: instructions });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      toast.success('Instructions saved');
    } catch (error) {
      toast.error(clawErrorText(error, 'Could not save the instructions'));
    } finally {
      setSavingInstructions(false);
    }
  };

  const savingCopy = savingDescription || savingInstructions;

  return (
    <div className='flex w-full flex-col gap-10 pt-4'>
      <div className='flex w-full flex-col gap-3'>
        <span className={CAPABILITY_LABEL_CLASS}>Description</span>
        {canEdit ? (
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={event => setDescription(event.target.value)}
            onBlur={() => void persistDescription()}
            aria-label='Description'
            aria-busy={savingDescription}
            placeholder='Add a description'
            data-track-category='Claw Agents'
            data-track-name='Digital Twin overview: edit description'
            className={cn(DESCRIPTION_FIELD_CLASS, DETAIL_TEXT_VALUE_CLASS)}
          />
        ) : (
          <div className={cn(DESCRIPTION_FIELD_CLASS, DETAIL_TEXT_VALUE_CLASS)}>
            {agent.description || 'No description added'}
          </div>
        )}
      </div>

      <div className='flex w-full flex-col gap-3'>
        <span className={CAPABILITY_LABEL_CLASS}>Instructions</span>
        {canEdit ? (
          <OverviewInstructionsEditor
            inputRef={instructionsRef}
            value={instructions}
            saving={savingInstructions}
            onChange={setInstructions}
            onBlur={() => void persistInstructions()}
          />
        ) : (
          <OverviewInstructionsRead text={agent.systemPrompt ?? ''} />
        )}
      </div>

      <AgentToolChips
        canEdit={false}
        tools={tools}
        trackName='Digital Twin overview'
        showAdd={false}
      />

      <AgentKnowledgeChips
        canEdit={false}
        knowledge={knowledge}
        trackName='Digital Twin overview'
        showAdd={false}
      />

      {savingCopy && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}
    </div>
  );
};

const DigitalTwinOverviewTab = (): ReactElement => {
  const { data: agent, isLoading, isError, error, refetch } = useClawAgentDetail(TWIN_SLUG);
  const actions = useAgentDetailActions(agent);
  const canEdit = actions.permissions?.canEdit ?? true;

  if (isLoading) {
    return (
      <div className='flex flex-col gap-10 pt-4'>
        <Skeleton className='h-16 w-full rounded-[10px]' />
        <Skeleton className='h-20 w-full rounded-2xl' />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className='h-9 w-48 rounded-[10px]' />
        ))}
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div role='alert' className='rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
        <p className='text-sm font-semibold text-destructive'>Overview did not load.</p>
        <p className='mt-1 text-sm text-muted-foreground'>
          {error?.message ?? 'The Digital Twin agent could not be loaded.'}
        </p>
        <Button variant='outline' size='sm' className='mt-3' onClick={() => void refetch()}>
          <RefreshCw className='size-4' />
          Try again
        </Button>
      </div>
    );
  }

  return <DigitalTwinOverviewBody agent={agent} canEdit={canEdit} />;
};

export default DigitalTwinOverviewTab;
