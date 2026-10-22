import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useRouter, useSegments } from 'expo-router';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Mic, Sparkles, Square, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useSpacesTabBarHeight } from '@/src/features/bottom-navigation';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import { useGuideReturnTarget } from '@/src/features/user-guide/guide-return-store';
import { useSetting } from '@/src/machines/settingsMachine';
import { FAB_RIGHT, FAB_SIZE } from '@/src/components/chat/channel-list/channel-list-layout';
import { SPACES_SHELL_SEGMENT, isOnTabShell } from '@/src/navigation/routes';
import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';
import { haptics } from '@/src/utils/haptics';

import { useDictation } from '../hooks/useDictation';
import { traceNavigation } from '../navigation/trace';
import { useXyneAINavigation } from '../hooks/useXyneAINavigation';
import { DictationWaveform } from './DictationWaveform';
import { NavigationChoices } from './NavigationChoices';

const EDGE_MARGIN = 16;
const BOTTOM_GAP = 12;
const ANIMATION_MS = 220;
// Tab-screen FABs sit at the right edge, so the bar stops short of them while the keyboard is closed.
const FAB_CLEARANCE = FAB_RIGHT + FAB_SIZE + 12;
const BAR_HEIGHT = 44;
const BUTTON_SIZE = 36;

const BarButton = ({
  label,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: ReactElement;
}): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={label}
    disabled={disabled}
    onPress={(): void => {
      void haptics.buttonTap();
      onPress();
    }}
    hitSlop={4}
    style={({ pressed }) => [styles.button, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
  >
    {children}
  </Pressable>
);

const Navigator = (): ReactElement => {
  const router = useRouter();
  const segments = useSegments() as string[];
  // The protected layout sits above both shells, so its measured height is only a fallback.
  const { tabBarHeight: fallbackBarHeight } = useTabBarHeight();
  const spacesBarHeight = useSpacesTabBarHeight();
  const tabBarHeight = segments.includes(SPACES_SHELL_SEGMENT)
    ? spacesBarHeight
    : fallbackBarHeight;
  const openUrl = useMentionPress();
  const navigation = useXyneAINavigation(openUrl);
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const isMounted = useRef(true);
  const editedWhileStopping = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return (): void => {
      isMounted.current = false;
    };
  }, []);
  const dictation = useDictation(text, setText);
  const surface = useCSSVariable('--color-card') as string;
  const border = useCSSVariable('--color-border') as string;
  const ink = useCSSVariable('--color-foreground') as string;
  const hint = useCSSVariable('--color-secondary-foreground') as string;

  const { choices, routing } = navigation;
  const isListening = dictation.status === 'listening';

  const askAI = (query: string): void => {
    traceNavigation('fallback to Xyne AI', { text: query });
    router.push({ pathname: '/xyne-ai', params: { query } });
  };

  // Everything typed here is meant as navigation, so it always goes to the router first.
  // The text clears up front, like the chat composer, so cancelling can hand it back.
  const submit = (value: string): void => {
    const query = value.trim();
    if (query === '' || routing !== undefined) return;
    setText('');
    void navigation.route(query).then(handled => {
      if (!isMounted.current) return;
      if (handled) Keyboard.dismiss();
      else askAI(query);
    });
  };

  const cancelNavigation = (): void => {
    setText(routing ?? '');
    navigation.cancel();
  };

  const stopDictation = (): void => {
    editedWhileStopping.current = false;
    void dictation.stop().then(spoken => {
      traceNavigation('dictation', { text: spoken });
      if (isMounted.current && !editedWhileStopping.current && spoken.trim() !== '') submit(spoken);
    });
  };

  let trailing: ReactElement;
  if (isListening) {
    trailing = (
      <BarButton label='Stop dictation' onPress={stopDictation}>
        <Square size={14} color={ink} fill={ink} />
      </BarButton>
    );
  } else if (routing !== undefined) {
    trailing = (
      <>
        <ActivityIndicator size='small' color={hint} />
        <BarButton label='Cancel navigation' onPress={cancelNavigation}>
          <X size={18} color={ink} />
        </BarButton>
      </>
    );
  } else {
    trailing = (
      <BarButton
        label='Dictate'
        disabled={dictation.status === 'stopping'}
        onPress={(): void => {
          Keyboard.dismiss();
          void dictation.start();
        }}
      >
        <Mic size={20} color={ink} />
      </BarButton>
    );
  }

  return (
    // Closed, the bar rests above the tab bar; open, it rides the keyboard in place of it.
    <KeyboardStickyView
      // Follows every keyboard otherwise, such as the one for the tab bar's search.
      enabled={isFocused}
      offset={{ closed: 0, opened: tabBarHeight }}
      pointerEvents='box-none'
      style={[
        styles.host,
        {
          bottom: tabBarHeight + BOTTOM_GAP,
          paddingRight: isFocused ? EDGE_MARGIN : FAB_CLEARANCE,
        },
      ]}
    >
      {choices ? (
        <NavigationChoices
          choices={choices}
          onPick={(id): void => {
            void navigation.pick(id).then(handled => {
              if (!handled) askAI(choices.text);
            });
          }}
          onAskAI={(query): void => {
            navigation.dismiss();
            askAI(query);
          }}
        />
      ) : null}
      <Animated.View
        entering={FadeInDown.duration(ANIMATION_MS)}
        exiting={FadeOutDown.duration(ANIMATION_MS)}
        style={[styles.bar, { backgroundColor: surface, borderColor: border }]}
      >
        <Sparkles size={18} color={hint} />
        {isListening ? (
          <DictationWaveform height={BUTTON_SIZE} />
        ) : (
          <TextInput
            value={text}
            onChangeText={(next): void => {
              dictation.interrupt();
              if (dictation.status === 'stopping') editedWhileStopping.current = true;
              if (choices) navigation.dismiss();
              setText(next);
            }}
            onFocus={(): void => setIsFocused(true)}
            onBlur={(): void => setIsFocused(false)}
            onSubmitEditing={(): void => submit(text)}
            placeholder='Go to…'
            placeholderTextColor={hint}
            returnKeyType='go'
            autoCorrect={false}
            editable={routing === undefined}
            accessibilityLabel='Go to'
            style={[styles.input, { color: ink }]}
          />
        )}
        {trailing}
      </Animated.View>
    </KeyboardStickyView>
  );
};

/**
 * Floating "Go to…" input above the tab bar for Xyne AI navigation. Mounted
 * once in the protected layout; the hooks that listen and route live in an
 * inner component so nothing runs while it is hidden.
 */
export function FloatingNavigator(): ReactElement | null {
  const enabled = useSetting('ai.navigation');
  const segments = useSegments() as string[];
  const guideTarget = useGuideReturnTarget();

  if (!enabled || !isOnTabShell(segments) || guideTarget) return null;
  return <Navigator />;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingLeft: EDGE_MARGIN,
    zIndex: 900,
    elevation: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 14,
    paddingRight: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BUTTON_SIZE / 2,
  },
});
