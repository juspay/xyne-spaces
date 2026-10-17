import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { ToolInvocation, TurnPart } from '../api/xyneAIEvents';
import type { AssistantTurn } from '../model/assistantTurn';
import {
  clipDetail,
  formatArgs,
  formatSeconds,
  groupTurnParts,
  humanizeToolName,
  liveActivity,
  previewOf,
  readableResult,
  summarizeSteps,
  thinkingMs,
  type StepPart,
  type ToolLookup,
} from '../model/turnTimeline';

const ShimmerText = ({ children }: { children: string }): ReactElement => {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.Text
      numberOfLines={1}
      style={style}
      className='shrink text-[14px] text-secondary-foreground'
    >
      {children}
    </Animated.Text>
  );
};

const LINES = 4;
const LINE_HEIGHT = 18;

const LiveReasoning = ({ reasoning }: { reasoning: string }): ReactElement => (
  <View className='justify-end overflow-hidden pl-1' style={{ maxHeight: LINES * LINE_HEIGHT }}>
    <Text
      className='text-[12px] italic text-secondary-foreground'
      style={{ lineHeight: LINE_HEIGHT }}
    >
      {reasoning.trim()}
    </Text>
  </View>
);

const RESULT_MAX_HEIGHT = 240;

const RowChevron = ({ open }: { open: boolean }): ReactElement => {
  const color = useCSSVariable('--color-secondary-foreground') as string;
  const Chevron = open ? ChevronDown : ChevronRight;
  return <Chevron size={14} color={color} />;
};

const ThinkingStep = ({
  part,
}: {
  part: Extract<TurnPart, { type: 'reasoning' }>;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const [firstLine = '', ...rest] = part.text.trim().split('\n');
  const body = rest.join('\n').trim();
  const ran = thinkingMs(part);

  return (
    <View>
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        disabled={body === ''}
        onPress={(): void => setOpen(value => !value)}
        className='flex-row items-center gap-2 px-3 py-2'
      >
        <Text
          numberOfLines={open ? undefined : 1}
          className='min-w-0 flex-1 text-[13px] text-secondary-foreground'
        >
          {firstLine || 'Thinking…'}
        </Text>
        {ran !== undefined && ran >= 1000 ? (
          <Text className='text-[11px] text-secondary-foreground'>{formatSeconds(ran)}</Text>
        ) : null}
        {body !== '' ? <RowChevron open={open} /> : null}
      </Pressable>
      {open && body !== '' ? (
        <Text className='px-3 pb-2 text-[12px] leading-5 text-secondary-foreground'>{body}</Text>
      ) : null}
    </View>
  );
};

const ToolDetail = ({
  label,
  text,
  failed = false,
}: {
  label: string;
  text: string;
  failed?: boolean;
}): ReactElement => (
  <View className='mb-2'>
    <Text className='mb-0.5 text-[10px] uppercase text-secondary-foreground'>{label}</Text>
    <Text
      selectable
      className={`font-mono text-[11px] leading-[18px] ${failed ? 'text-settings-icon-red' : 'text-secondary-foreground'}`}
    >
      {text}
    </Text>
  </View>
);

const ToolStep = ({ call }: { call: ToolInvocation }): ReactElement => {
  const [open, setOpen] = useState(false);
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const danger = useCSSVariable('--color-settings-icon-red') as string;
  const preview = previewOf(call.args);
  const failed = call.isError === true || call.status === 'error';

  return (
    <View>
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        onPress={(): void => setOpen(value => !value)}
        className='flex-row items-center gap-2 px-3 py-2'
      >
        <Text numberOfLines={1} className='shrink-0 text-[13px] text-secondary-foreground'>
          {humanizeToolName(call.toolName) || 'Tool'}
        </Text>
        {preview ? (
          <Text numberOfLines={1} className='min-w-0 flex-1 text-[13px] text-secondary-foreground'>
            {preview.text}
          </Text>
        ) : (
          <View className='flex-1' />
        )}
        {call.status === 'running' ? <ActivityIndicator size='small' color={muted} /> : null}
        {call.status === 'stopped' ? (
          <Text className='text-[11px] text-secondary-foreground'>stopped</Text>
        ) : null}
        {failed ? <AlertCircle size={14} color={danger} /> : null}
        <RowChevron open={open} />
      </Pressable>
      {open ? (
        <ScrollView
          nestedScrollEnabled
          className='mx-3 mb-2'
          style={{ maxHeight: RESULT_MAX_HEIGHT }}
        >
          {Object.keys(call.args).length > 0 ? (
            <ToolDetail label='Arguments' text={formatArgs(call.args)} />
          ) : null}
          {call.status === 'running' ? null : call.status === 'stopped' ? (
            <Text className='text-[11px] italic text-secondary-foreground'>
              Stopped before completion
            </Text>
          ) : (
            <ToolDetail
              label='Result'
              text={clipDetail((call.result && readableResult(call.result)) || 'No output')}
              failed={failed}
            />
          )}
        </ScrollView>
      ) : null}
    </View>
  );
};

const StepGroup = ({
  steps,
  calls,
  live,
}: {
  steps: StepPart[];
  calls: ToolLookup;
  live: boolean;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeSteps(steps, calls), [steps, calls]);
  const current = steps.at(-1);
  const liveThinking = live && current?.type === 'reasoning' ? current.text : '';

  return (
    <View>
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        disabled={steps.length === 0}
        onPress={(): void => setOpen(value => !value)}
        className='flex-row items-center gap-1 self-start py-1'
      >
        {live ? (
          <ShimmerText>{`${liveActivity(steps, calls)}…`}</ShimmerText>
        ) : (
          <Text numberOfLines={1} className='shrink text-[14px] text-secondary-foreground'>
            {summary.label}
          </Text>
        )}
        {!live && summary.failed > 0 ? (
          <Text className='text-[14px] text-secondary-foreground'>({summary.failed} failed)</Text>
        ) : null}
        {steps.length > 0 ? <RowChevron open={open} /> : null}
      </Pressable>
      {!open && liveThinking.trim() !== '' ? <LiveReasoning reasoning={liveThinking} /> : null}
      {open ? (
        <View className='mt-1 overflow-hidden rounded-lg border border-border'>
          {steps.map((step, index) => {
            const call = step.type === 'tool' ? calls.get(step.id) : undefined;
            return (
              <View
                key={`${step.type}-${step.id}`}
                className={index > 0 ? 'border-t border-border' : ''}
              >
                {step.type === 'reasoning' ? (
                  <ThinkingStep part={step} />
                ) : call ? (
                  <ToolStep call={call} />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
};

export const TurnTimeline = ({
  turn,
  renderText,
}: {
  turn: AssistantTurn;
  renderText: (text: string, isStreaming: boolean) => ReactNode;
}): ReactElement => {
  const calls = useMemo(
    () =>
      new Map(
        turn.tools.flatMap(tool => (tool.toolCallId ? [[tool.toolCallId, tool] as const] : [])),
      ),
    [turn.tools],
  );
  const segments = useMemo(
    () => groupTurnParts(turn.parts, id => calls.has(id)),
    [turn.parts, calls],
  );
  const isStreaming = turn.status === 'streaming';

  return (
    <View className='gap-2'>
      {isStreaming && segments.length === 0 ? <StepGroup steps={[]} calls={calls} live /> : null}
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return segment.kind === 'text' ? (
          <View key={segment.part.id}>{renderText(segment.part.text, isStreaming && isLast)}</View>
        ) : (
          <StepGroup
            key={segment.id}
            steps={segment.parts}
            calls={calls}
            live={isStreaming && isLast}
          />
        );
      })}
    </View>
  );
};
