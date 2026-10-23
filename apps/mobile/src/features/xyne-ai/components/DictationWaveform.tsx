import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCSSVariable } from 'uniwind';

const BAR_WIDTH = 3;
// The recogniser reports levels from -2 to 10; anything up to 0 is silence.
const MAX_LEVEL = 10;

/** Recent input levels, newest on the right. Listens itself so the composer does not re-render. */
export const DictationWaveform = ({ height }: { height: number }): ReactElement => {
  const color = useCSSVariable('--color-conversation-input-toolbar-icon') as string;
  const [capacity, setCapacity] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  useSpeechRecognitionEvent('volumechange', ({ value }) =>
    setLevels(current => [...current, value].slice(Math.max(0, current.length + 1 - capacity))),
  );

  return (
    <View
      className='flex-1 flex-row items-center justify-end overflow-hidden'
      style={{ height, gap: BAR_WIDTH }}
      onLayout={({ nativeEvent }): void =>
        setCapacity(Math.floor(nativeEvent.layout.width / (BAR_WIDTH * 2)))
      }
    >
      {levels.map((level, index) => (
        <View
          key={index}
          style={{
            width: BAR_WIDTH,
            height: Math.max(BAR_WIDTH, (Math.min(level, MAX_LEVEL) / MAX_LEVEL) * height),
            borderRadius: BAR_WIDTH / 2,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
};
