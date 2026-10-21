import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { useRouter } from 'expo-router';
import Animated, { Easing, SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useCSSVariable, useUniwind } from 'uniwind';

import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import { logCallAction } from '@/src/services/Call/callActionLog';
import { callKitService } from '@/src/services/CallKitService';
import { getCallTalkStart } from '@/src/components/call/callTalkClock';
import { formatCallDuration } from '@/src/components/call/callStage.utils';
import { MicIcon, MicOffIcon, PhoneOffIcon } from '@/src/components/call/CallControls/icons';
import { GlassButton, NATIVE_GLASS } from '@/src/components/ui/glass-button';
import { CALL_BAR_HEIGHT, useCallBarVisibility } from '@/src/hooks/useIsCallBarVisible';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { isDarkSurface, parseHexColor, readableTextOn } from '@/src/theme/accent-contrast';
import { cn } from '@/src/utils/cn';
import { CallType } from '@xyne/shared';

const ANIMATION_MS = 250;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const CORNER_R = 28;

interface ActiveCallInfo {
  callId: string;
  callType: CallType;
  startedAt: number;
}

export function OngoingCallBanner(): React.ReactElement | null {
  const insets = useRawSafeAreaInsets();
  const router = useRouter();
  const { isVisible, isCallActive } = useCallBarVisibility();
  const foreground = useCSSVariable('--color-foreground') as string;
  const accentForeground = useCSSVariable('--color-accent-foreground') as string;
  const dangerFill = useCSSVariable('--color-button-danger-bg') as string;
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg } = useBubbleAccent();

  const { barColor, textColor } = useMemo(() => {
    const scrimOpacity = isDark ? 0.5 : 0.4;
    const scrimRgb = parseHexColor(accentBg);
    // Scrim baked into the fill so the corner pieces below match the bar exactly.
    const fill = scrimRgb
      ? `#${[scrimRgb.r, scrimRgb.g, scrimRgb.b]
          .map(c =>
            Math.round(isDark ? c * (1 - scrimOpacity) : c + (255 - c) * scrimOpacity)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`
      : accentBg;
    return { barColor: fill, textColor: scrimRgb ? readableTextOn(fill) : '#ffffff' };
  }, [accentBg, isDark]);

  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [duration, setDuration] = useState('00:00');
  const [isMicEnabled, setIsMicEnabled] = useState(true);

  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Subscribe to call runtime service
  useEffect(() => {
    const initialState = callRuntimeNativeService.getActiveCall();
    setActiveCall(
      initialState
        ? {
            callId: initialState.callId,
            callType: initialState.callType,
            startedAt: initialState.startedAt,
          }
        : null,
    );
    setParticipantCount(callRuntimeNativeService.getParticipantCount());

    const room = callRuntimeNativeService.getRoom();
    if (room) {
      setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);
    }

    return callRuntimeNativeService.subscribe(state => {
      setActiveCall(state.activeCall);
      setParticipantCount(state.participantCount);

      const currentRoom = callRuntimeNativeService.getRoom();
      if (currentRoom) {
        setIsMicEnabled(currentRoom.localParticipant.isMicrophoneEnabled);
      }
    });
  }, []);

  // Handle duration timer
  useEffect(() => {
    if (isCallActive && activeCall) {
      startTimeRef.current = activeCall.startedAt;

      durationIntervalRef.current = setInterval(() => {
        // Same clock as the call screen: since the other person joined, not since we connected.
        const start =
          getCallTalkStart(activeCall.callId, activeCall.startedAt) ?? startTimeRef.current;
        setDuration(formatCallDuration(Date.now() - start));
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }

    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [isCallActive, activeCall]);

  // Poll mic state more frequently for better sync — only while the bar is on screen; the
  // first poll on showing it picks up whatever the call screen changed meanwhile.
  useEffect(() => {
    if (!isVisible) return;

    const updateMicState = () => {
      const room = callRuntimeNativeService.getRoom();
      if (room) {
        setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);
      }
    };

    updateMicState();
    const interval = setInterval(updateMicState, 250);

    return () => clearInterval(interval);
  }, [isVisible]);

  const handleToggleMic = useCallback(async () => {
    const newState = !isMicEnabled;
    logCallAction('mic_pressed', {
      callId: callRuntimeNativeService.getActiveCall()?.callId,
      source: 'ongoing_banner',
      enable: newState,
    });
    try {
      await callRuntimeNativeService.toggleMic(newState);
      setIsMicEnabled(newState);
    } catch (error) {
      console.error('[OngoingCallBanner] Failed to toggle mic:', error);
    }
  }, [isMicEnabled]);

  const handleEndCall = useCallback(
    async (e?: { stopPropagation: () => void }) => {
      e?.stopPropagation();
      logCallAction('end_call_pressed', {
        callId: callRuntimeNativeService.getActiveCall()?.callId,
        source: 'ongoing_banner',
      });
      try {
        await callRuntimeNativeService.disconnect();
      } catch (error) {
        console.error('[OngoingCallBanner] Failed to end call:', error);
      }
      // Always release CallKit, even if the LiveKit disconnect threw.
      if (activeCall?.callId) {
        callKitService.endCall(activeCall.callId);
      }
    },
    [activeCall?.callId],
  );

  const handlePressBanner = useCallback(() => {
    if (activeCall?.callId) {
      // navigate, not push: a second tap that lands before the call screen has covered the bar
      // must reuse that screen. Two stacked call screens look identical, so minimising the top
      // one would seem to do nothing.
      router.navigate({
        pathname: '/(protected)/native-call',
        params: {
          channelId: activeCall.callId,
          callType: activeCall.callType,
        },
      });
    }
  }, [activeCall, router]);

  // Unmounted, not just hidden, whenever it isn't shown: it sits at the top of the window,
  // over the call screen's back / add-people buttons. On iOS its buttons are interactive
  // native glass (UIKit handles their touches), and once tapped, an invisible bar left in
  // place kept swallowing touches there despite pointerEvents='none'. `exiting` still
  // animates the bar out.
  if (!isCallActive || !isVisible) {
    return null;
  }

  const participantText = participantCount <= 1 ? 'Just you' : `${participantCount} participants`;
  const micIcon = isMicEnabled ? (
    <MicIcon size={18} color={foreground} />
  ) : (
    <MicOffIcon size={18} color={accentForeground} />
  );

  return (
    <>
      <StatusBar barStyle={isDarkSurface(accentBg) ? 'light-content' : 'dark-content'} />
      <Animated.View
        entering={SlideInUp.duration(ANIMATION_MS).easing(EASE_OUT)}
        exiting={SlideOutUp.duration(ANIMATION_MS).easing(EASE_OUT)}
        style={{
          paddingTop: insets.top,
          zIndex: 9999,
          backgroundColor: barColor,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
        }}
      >
        <View>
          <TouchableOpacity
            onPress={handlePressBanner}
            activeOpacity={0.85}
            accessibilityRole='button'
            accessibilityHint='Tap to return to the call'
            style={{ height: CALL_BAR_HEIGHT }}
            className='flex-row items-center gap-3 px-3'
          >
            {NATIVE_GLASS ? (
              <GlassButton
                onPress={handleToggleMic}
                isDark={isDark}
                size={36}
                height={36}
                borderRadius={18}
                {...(isMicEnabled
                  ? { className: 'bg-foreground/15 border-transparent' }
                  : { fillColor: dangerFill })}
              >
                {micIcon}
              </GlassButton>
            ) : (
              <TouchableOpacity
                onPress={handleToggleMic}
                hitSlop={10}
                accessibilityRole='button'
                accessibilityLabel={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                className={cn(
                  'h-9 w-9 items-center justify-center rounded-full',
                  isMicEnabled ? 'bg-foreground/15' : 'bg-button-danger-bg',
                )}
              >
                {micIcon}
              </TouchableOpacity>
            )}

            <Text
              numberOfLines={1}
              style={{ color: textColor }}
              className='flex-1 text-center text-sm font-semibold'
            >
              {participantText} · {duration}
            </Text>

            {NATIVE_GLASS ? (
              <GlassButton
                onPress={handleEndCall}
                isDark={isDark}
                size={36}
                height={36}
                borderRadius={18}
                fillColor={dangerFill}
              >
                <PhoneOffIcon size={18} color={accentForeground} />
              </GlassButton>
            ) : (
              <TouchableOpacity
                onPress={handleEndCall}
                hitSlop={10}
                accessibilityRole='button'
                accessibilityLabel='End call'
                className='h-9 w-9 items-center justify-center rounded-full bg-button-danger-bg'
              >
                <PhoneOffIcon size={18} color={accentForeground} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </View>
        {([0, 1] as const).map(side => (
          <View
            key={side}
            pointerEvents='none'
            style={{
              position: 'absolute',
              top: insets.top + CALL_BAR_HEIGHT,
              [side ? 'right' : 'left']: 0,
              width: CORNER_R,
              height: CORNER_R,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                position: 'absolute',
                top: -CORNER_R,
                left: side ? -2 * CORNER_R : -CORNER_R,
                width: 4 * CORNER_R,
                height: 4 * CORNER_R,
                borderRadius: 2 * CORNER_R,
                borderWidth: CORNER_R,
                borderColor: barColor,
              }}
            />
          </View>
        ))}
      </Animated.View>
    </>
  );
}
