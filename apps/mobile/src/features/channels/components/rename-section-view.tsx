import { useMemo, useState, type ReactElement } from 'react';
import { View } from 'react-native';

import { sectionNameError } from '@/src/components/chat/channel-list/section-sheet-parts';
import { useTray } from '@/src/ui/tray';
import { haptics } from '@/src/utils/haptics';

import { useChannelActions } from '../hooks/use-channel-actions';
import { useManagedSection } from './section-options-view';
import { BackHeader, NameInput, PillButton } from './section-tray-parts';

export function RenameSectionView(): ReactElement {
  const { close, goBack } = useTray();
  const { renameSection, existingSectionNames } = useChannelActions();
  const section = useManagedSection();

  const [name, setName] = useState(section?.name ?? '');
  const trimmed = name.trim();

  // The section's own name is excluded from the duplicate check, so keeping it
  // is not reported as a clash — it is reported as "nothing to change".
  const error = useMemo(
    () => sectionNameError(name, [...existingSectionNames], section?.name ?? null),
    [existingSectionNames, name, section?.name],
  );
  const isUnchanged = trimmed === section?.name;
  const canRename = section !== null && error === null && !isUnchanged;

  const rename = (): void => {
    if (!canRename || section === null) return;
    void haptics.success();
    renameSection(section.id, trimmed);
    close();
  };

  return (
    <View className='px-3 pt-4 pb-3' style={{ flexShrink: 1 }}>
      <BackHeader title={`Rename ${section?.name ?? ''} section`} onBack={goBack} />
      <NameInput
        value={name}
        onChangeText={setName}
        onSubmitEditing={rename}
        placeholder='Section name'
        focusOnArrive
        // Silent while untouched or emptied; the button already says it.
        error={trimmed.length === 0 || isUnchanged ? null : error}
      />
      <View className='mt-4'>
        <PillButton label='Rename' disabled={!canRename} onPress={rename} />
      </View>
    </View>
  );
}
