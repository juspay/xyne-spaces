export const CHAT_BUBBLE_COLOR_VARS = [
  '--color-chat-message-bubble-1',
  '--color-chat-message-bubble-2',
  '--color-chat-message-bubble-3',
  '--color-chat-message-bubble-4',
  '--color-chat-message-bubble-5',
  '--color-chat-message-bubble-6',
  '--color-chat-message-bubble-7',
  '--color-chat-message-bubble-8',
  '--color-chat-message-bubble-9',
  '--color-chat-message-bubble-10',
  '--color-chat-message-bubble-11',
  '--color-chat-message-bubble-12',
  '--color-chat-message-bubble-13',
  '--color-chat-message-bubble-14',
  '--color-chat-message-bubble-15',
  '--color-chat-message-bubble-16',
  '--color-chat-message-bubble-17',
  '--color-chat-message-bubble-18',
  '--color-chat-message-bubble-19',
  '--color-chat-message-bubble-20',
  '--color-chat-message-bubble-21',
  '--color-chat-message-bubble-22',
  '--color-chat-message-bubble-23',
  '--color-chat-message-bubble-24',
  '--color-chat-message-bubble-25',
  '--color-chat-message-bubble-26',
  '--color-chat-message-bubble-27',
  '--color-chat-message-bubble-28',
  '--color-chat-message-bubble-29',
  '--color-chat-message-bubble-30',
  '--color-chat-message-bubble-31',
  '--color-chat-message-bubble-32',
  '--color-chat-message-bubble-33',
  '--color-chat-message-bubble-34',
  '--color-chat-message-bubble-35',
  '--color-chat-message-bubble-36',
  '--color-chat-message-bubble-37',
  '--color-chat-message-bubble-38',
] as const;

export type ChatBubbleColorVar = (typeof CHAT_BUBBLE_COLOR_VARS)[number];

export const DEFAULT_CHAT_BUBBLE_COLOR_VAR: ChatBubbleColorVar = '--color-chat-message-bubble-1';

export const CHAT_BUBBLE_LIGHT_COLORS = [
  '#d8fdd2',
  '#d8fdd2',
  '#2d68ea',
  '#d2e8ff',
  '#5e47df',
  '#e7e0ff',
  '#0b4b79',
  '#d2e3ed',
  '#c15add',
  '#f2d9f8',
  '#333333',
  '#dadcdb',
  '#e56d53',
  '#fee2d7',
  '#3d503a',
  '#dee8df',
  '#028377',
  '#cbf2ef',
  '#731a2e',
  '#fdcdd9',
  '#9e6947',
  '#f4ded1',
  '#c1a987',
  '#f0e9df',
  '#01a884',
  '#d4fded',
  '#e6cb00',
  '#fcf8af',
  '#72a431',
  '#e2ffbd',
  '#e53472',
  '#ffdbe7',
  '#e90038',
  '#fbd8dc',
  '#e5391d',
  '#ffdbcb',
  '#f87916',
  '#ffe4c7',
] as const satisfies readonly string[];

export const CHAT_BUBBLE_DARK_COLORS = [
  '#134d37',
  '#134d37',
  '#04488f',
  '#082f5a',
  '#433597',
  '#2c2a5b',
  '#0b4b79',
  '#08344d',
  '#713082',
  '#4a2159',
  '#4c4c4c',
  '#333333',
  '#853b23',
  '#4d2c25',
  '#3d503a',
  '#293328',
  '#045d57',
  '#0a3d3e',
  '#7e112e',
  '#531323',
  '#5b3c28',
  '#35271e',
  '#7b654d',
  '#3b342a',
  '#0c7360',
  '#0d493d',
  '#b39a00',
  '#5c5101',
  '#577d26',
  '#2f4214',
  '#bc285e',
  '#581e36',
  '#a71136',
  '#61172e',
  '#8a1f0f',
  '#57140b',
  '#8a3b0b',
  '#5b2607',
] as const satisfies readonly string[];

export type ChatBubbleOption = {
  index: number;
  varName: ChatBubbleColorVar;
  lightColor: string;
  darkColor: string;
};

export const CHAT_BUBBLE_OPTIONS: readonly ChatBubbleOption[] = CHAT_BUBBLE_COLOR_VARS.map(
  (varName, index) => ({
    index,
    varName,
    lightColor: CHAT_BUBBLE_LIGHT_COLORS[index] ?? CHAT_BUBBLE_LIGHT_COLORS[0],
    darkColor: CHAT_BUBBLE_DARK_COLORS[index] ?? CHAT_BUBBLE_DARK_COLORS[0],
  }),
);

export const CHAT_BUBBLE_PICKER_OPTIONS: readonly ChatBubbleOption[] = CHAT_BUBBLE_OPTIONS.filter(
  option => option.index % 4 === 0 || option.index % 4 === 2,
);

export const DEFAULT_CHAT_BUBBLE_OPTION: ChatBubbleOption = {
  index: 0,
  varName: DEFAULT_CHAT_BUBBLE_COLOR_VAR,
  lightColor: '#d8fdd2',
  darkColor: '#134d37',
};

const DEFAULT_CHAT_BACKGROUND_PATTERN_COLORS = {
  light: '#7a766d',
  dark: '#6f7780',
} as const;

export const getChatBubblePatternColor = ({
  bubbleColor,
  colorVar,
  theme,
}: {
  bubbleColor: string;
  colorVar: ChatBubbleColorVar;
  theme: string;
}): string => {
  if (colorVar !== DEFAULT_CHAT_BUBBLE_COLOR_VAR) return bubbleColor;
  return theme === 'dark'
    ? DEFAULT_CHAT_BACKGROUND_PATTERN_COLORS.dark
    : DEFAULT_CHAT_BACKGROUND_PATTERN_COLORS.light;
};

export const getChatBubblePatternOpacity = ({
  colorVar,
  theme,
}: {
  colorVar: ChatBubbleColorVar;
  theme: string;
}): number => {
  if (theme === 'dark') {
    return colorVar === DEFAULT_CHAT_BUBBLE_COLOR_VAR ? 0.44 : 0.6;
  }

  return colorVar === DEFAULT_CHAT_BUBBLE_COLOR_VAR ? 0.34 : 0.34;
};

export const isChatBubbleColorVar = (value: unknown): value is ChatBubbleColorVar =>
  typeof value === 'string' && (CHAT_BUBBLE_COLOR_VARS as readonly string[]).includes(value);
