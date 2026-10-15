import { useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { Check } from 'lucide-react-native';

import { SearchBar } from '@/src/components/ui/search-bar';
import {
  ListRow,
  ListRowDivider,
  SectionCard,
  SectionLabel,
} from '@/src/components/ui/settings-list';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

const SEARCH_MIN_OPTIONS = 7;
const PLAIN_ROW_DIVIDER_INSET = 16;

export interface Option<T extends string> {
  /** `undefined` is the "use the default" choice. */
  value: T | undefined;
  label: string;
  description?: string;
  leading?: ReactElement;
}

export function OptionList<T extends string>({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: Option<T>[];
  selected: T | undefined;
  onSelect: (value: T | undefined) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const { accentText } = useBubbleAccent();
  const needle = query.trim().toLowerCase();
  const visible = options.filter(option => option.label.toLowerCase().includes(needle));

  return (
    <View>
      <SectionLabel>{title}</SectionLabel>
      {options.length > SEARCH_MIN_OPTIONS ? (
        <SearchBar value={query} onChangeText={setQuery} containerClassName='mb-3' />
      ) : null}
      <SectionCard>
        {visible.map((option, index) => (
          <View key={option.value ?? 'default'}>
            {index > 0 ? (
              <ListRowDivider {...(option.leading ? {} : { inset: PLAIN_ROW_DIVIDER_INSET })} />
            ) : null}
            <ListRow
              label={option.label}
              description={option.description}
              leading={option.leading}
              trailing={
                option.value === selected ? <Check size={20} color={accentText} /> : undefined
              }
              onPress={(): void => onSelect(option.value)}
            />
          </View>
        ))}
      </SectionCard>
    </View>
  );
}
