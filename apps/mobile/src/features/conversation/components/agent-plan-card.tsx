import { memo, useCallback, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react-native';

import {
  PLAN_CARD_RADIUS,
  PLAN_FOLD_ICON_SIZE,
  PLAN_FOLDED_PADDING_BOTTOM,
  PLAN_MARK_DOT_SIZE,
  PLAN_MARK_ICON_SIZE,
  PLAN_MARK_RING,
  PLAN_MARK_SIZE,
  PLAN_MARK_TOP,
  PLAN_NOTE_PADDING_BOTTOM,
  PLAN_NOTE_PADDING_TOP,
  PLAN_NOTE_PADDING_X,
  PLAN_PADDING_X,
  PLAN_PANEL_RADIUS,
  PLAN_STEP_GAP,
  PLAN_STEP_MARK_GAP,
  PLAN_STEP_PADDING_Y,
  PLAN_STEPS_PADDING_BOTTOM,
  PLAN_STEPS_PADDING_TOP,
  PLAN_TAG_PADDING_X,
  PLAN_TAG_PADDING_Y,
  PLAN_TAG_RADIUS,
  PLAN_TOP_GAP,
  PLAN_TOP_PADDING_BOTTOM,
  PLAN_TOP_PADDING_TOP,
} from '../constants';
import {
  planNote,
  planStartsFolded,
  planTagLabel,
  type AgentPlan,
  type AgentPlanState,
  type AgentPlanStep,
  type AgentPlanStepState,
} from '../model/agent-plan';
import { useConversationPalette } from './conversation-palette';
import { MessageCardFrame } from './message-card-frame';

const MARK_STYLE = {
  width: PLAN_MARK_SIZE,
  height: PLAN_MARK_SIZE,
  borderRadius: PLAN_MARK_SIZE / 2,
} as const;
const RING_STYLE = { ...MARK_STYLE, borderWidth: PLAN_MARK_RING } as const;
const DOT_STYLE = {
  width: PLAN_MARK_DOT_SIZE,
  height: PLAN_MARK_DOT_SIZE,
  borderRadius: PLAN_MARK_DOT_SIZE / 2,
} as const;
const STEP_STYLE = { paddingVertical: PLAN_STEP_PADDING_Y, columnGap: PLAN_STEP_MARK_GAP } as const;
const NOTE_STYLE = {
  paddingTop: PLAN_NOTE_PADDING_TOP,
  paddingBottom: PLAN_NOTE_PADDING_BOTTOM,
  paddingHorizontal: PLAN_NOTE_PADDING_X,
} as const;

/** Done is the only state Figma colours; the rest stay on the quiet surface. */
const TAG_CLASS: Readonly<Record<AgentPlanState, { box: string; text: string }>> = {
  done: { box: 'bg-spaces-positive-surface', text: 'text-spaces-positive' },
  running: { box: 'bg-spaces-surface', text: 'text-spaces-foreground' },
  pending: { box: 'bg-spaces-surface', text: 'text-spaces-muted' },
  failed: { box: 'bg-spaces-surface', text: 'text-spaces-negative' },
};

/** Finished steps recede (Figma: Text/Low); the running one reads at full strength. */
const STEP_TEXT_CLASS: Readonly<Record<AgentPlanStepState, string>> = {
  done: 'text-spaces-muted',
  running: 'text-spaces-foreground',
  queued: 'text-spaces-muted',
  failed: 'text-spaces-muted',
};

const STEP_STATE_LABEL: Readonly<Record<AgentPlanStepState, string>> = {
  done: 'done',
  running: 'in progress',
  queued: 'not started',
  failed: 'failed',
};

type AgentPlanCardProps = {
  plan: AgentPlan;
};

/**
 * An agent's plan in the room: a grey rim round a panel holding the title,
 * its state tag and the steps, with a note under the panel. The note folds
 * the steps away; long finished plans open folded (see `planStartsFolded`).
 * The row that holds it keys it by message, so a recycled row starts fresh.
 */
export const AgentPlanCard = memo(function AgentPlanCard({
  plan,
}: AgentPlanCardProps): ReactElement {
  // The tick is cut out of its disc in the panel's colour; read once for every step.
  const { subtle, background: tickColor } = useConversationPalette();
  const [folded, setFolded] = useState(() => planStartsFolded(plan));
  const canFold = plan.steps.length > 0;
  const showSteps = canFold && !folded;
  const toggle = useCallback((): void => setFolded(value => !value), []);
  const tag = TAG_CLASS[plan.state];
  const note = planNote(plan);
  const FoldIcon = folded ? ChevronDown : ChevronUp;

  return (
    <MessageCardFrame
      radius={PLAN_CARD_RADIUS}
      innerRadius={PLAN_PANEL_RADIUS}
      footer={
        canFold ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={note}
            accessibilityHint={folded ? 'Shows the steps' : 'Hides the steps'}
            accessibilityState={{ expanded: !folded }}
            onPress={toggle}
            className='flex-row items-center'
            style={NOTE_STYLE}
          >
            <PlanNote note={note} />
            <FoldIcon size={PLAN_FOLD_ICON_SIZE} color={subtle} />
          </Pressable>
        ) : (
          <View className='flex-row items-center' style={NOTE_STYLE}>
            <PlanNote note={note} />
          </View>
        )
      }
    >
      <View
        className='flex-row items-start'
        style={{
          paddingTop: PLAN_TOP_PADDING_TOP,
          paddingBottom: showSteps ? PLAN_TOP_PADDING_BOTTOM : PLAN_FOLDED_PADDING_BOTTOM,
          paddingHorizontal: PLAN_PADDING_X,
          columnGap: PLAN_TOP_GAP,
        }}
      >
        <View className='min-w-0 flex-1'>
          <Text
            accessibilityRole='header'
            className='text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground'
          >
            {plan.title}
          </Text>
          {plan.description ? (
            <Text className='mt-0.5 text-[14px] leading-5 tracking-[-0.14px] text-spaces-muted'>
              {plan.description}
            </Text>
          ) : null}
        </View>
        <View
          className={tag.box}
          style={{
            borderRadius: PLAN_TAG_RADIUS,
            paddingHorizontal: PLAN_TAG_PADDING_X,
            paddingVertical: PLAN_TAG_PADDING_Y,
          }}
        >
          <Text className={`text-[12px] font-medium leading-4 ${tag.text}`}>
            {planTagLabel(plan)}
          </Text>
        </View>
      </View>

      {showSteps ? (
        <View
          style={{
            paddingTop: PLAN_STEPS_PADDING_TOP,
            paddingBottom: PLAN_STEPS_PADDING_BOTTOM,
            paddingHorizontal: PLAN_PADDING_X,
            rowGap: PLAN_STEP_GAP,
          }}
        >
          {plan.steps.map(step => (
            <PlanStep key={step.id} step={step} tickColor={tickColor} />
          ))}
        </View>
      ) : null}
    </MessageCardFrame>
  );
});

function PlanNote({ note }: { note: string }): ReactElement {
  return (
    <Text className='min-w-0 flex-1 text-[12px] leading-4 text-spaces-muted' numberOfLines={1}>
      {note}
    </Text>
  );
}

/** One step: its mark (Figma's ticked disc when done), then the words. */
function PlanStep({ step, tickColor }: { step: AgentPlanStep; tickColor: string }): ReactElement {
  return (
    <View
      className='flex-row items-start'
      style={STEP_STYLE}
      accessible
      accessibilityLabel={`${step.text}, ${STEP_STATE_LABEL[step.state]}`}
    >
      <View style={{ paddingTop: PLAN_MARK_TOP }}>
        <StepMark state={step.state} tickColor={tickColor} />
      </View>
      <Text
        className={`min-w-0 flex-1 text-[14px] leading-5 tracking-[-0.14px] ${STEP_TEXT_CLASS[step.state]}`}
      >
        {step.text}
      </Text>
    </View>
  );
}

function StepMark({
  state,
  tickColor,
}: {
  state: AgentPlanStepState;
  tickColor: string;
}): ReactElement {
  if (state === 'done' || state === 'failed') {
    const Icon = state === 'done' ? Check : X;
    return (
      <View
        className={`items-center justify-center ${state === 'done' ? 'bg-spaces-muted' : 'bg-spaces-negative'}`}
        style={MARK_STYLE}
      >
        <Icon size={PLAN_MARK_ICON_SIZE} color={tickColor} strokeWidth={2.5} />
      </View>
    );
  }

  if (state === 'running') {
    return (
      <View className='items-center justify-center border-spaces-foreground' style={RING_STYLE}>
        <View className='bg-spaces-foreground' style={DOT_STYLE} />
      </View>
    );
  }

  return <View className='border-spaces-subtle' style={RING_STYLE} />;
}
