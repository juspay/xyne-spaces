import { FormFieldType } from '@xyne/shared';
import { format, parseISO, isValid } from 'date-fns';
import { Lock } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import { useUsers } from '@/src/hooks/useUsers';

import { DatePickerSheet } from '@/src/screens/ticket-details/date-picker-sheet';
import { MultiSelectPickerSheet } from '@/src/screens/ticket-details/multi-select-picker-sheet';
import { SingleSelectPickerSheet } from '@/src/screens/ticket-details/single-select-picker-sheet';

import {
  formatBooleanDisplay,
  jsonToDisplayString,
  jsonToStringArray,
  normalizeBooleanSaveValue,
  stripUserPrefix,
} from './form-field-helpers';

type EditableFormFieldProps = {
  fieldName: string;
  fieldValue: unknown;
  fieldType: FormFieldType;
  fieldEnum?: string[] | undefined;
  readOnly?: boolean | undefined;
  onSave: (newValue: string[]) => void;
};

type EditorKind =
  | 'none'
  | 'text'
  | 'boolean'
  | 'single'
  | 'multi'
  | 'date'
  | 'user'
  | 'ticket';

function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = parseISO(value.trim());
  return isValid(parsed) ? parsed.getTime() : null;
}

function toDateSaveValue(ms: number | null): string[] {
  if (ms == null) return [];
  return [format(new Date(ms), 'yyyy-MM-dd')];
}

export const EditableFormField = memo(function EditableFormField({
  fieldName,
  fieldValue,
  fieldType,
  fieldEnum,
  readOnly = false,
  onSave,
}: EditableFormFieldProps): ReactElement {
  const mutedColor = (useCSSVariable('--color-ticket-meta-left-text') as string) || '#6B7280';
  const iconColor = (useCSSVariable('--color-ticket-meta-right-text') as string) || '#9CA3AF';
  const { accentText } = useBubbleAccent();
  const users = useUsers();

  const [editor, setEditor] = useState<EditorKind>('none');
  const [draftText, setDraftText] = useState('');

  const effectiveValue = fieldValue;

  const displayValue = useMemo(() => {
    if (fieldType === FormFieldType.BOOLEAN) {
      return formatBooleanDisplay(effectiveValue);
    }
    if (fieldType === FormFieldType.USER) {
      const ids = jsonToStringArray(effectiveValue).map(stripUserPrefix);
      if (ids.length === 0) return '';
      return ids
        .map(id => {
          const user = users.find(u => u.id === id);
          return user ? getUserDisplayName(user) : id;
        })
        .join(', ');
    }
    if (fieldType === FormFieldType.MULTI_SELECT) {
      return jsonToStringArray(effectiveValue).join(', ');
    }
    return jsonToDisplayString(effectiveValue);
  }, [effectiveValue, fieldType, users]);

  const selectOptions = useMemo(
    () => (fieldEnum ?? []).map(value => ({ value, label: value })),
    [fieldEnum],
  );

  const booleanOptions = useMemo(
    () => [
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ],
    [],
  );

  const openEditor = useCallback((): void => {
    if (readOnly) return;
    switch (fieldType) {
      case FormFieldType.BOOLEAN:
        setEditor('boolean');
        break;
      case FormFieldType.SINGLE_SELECT:
        setEditor('single');
        break;
      case FormFieldType.MULTI_SELECT:
        setEditor('multi');
        break;
      case FormFieldType.DATE:
        setEditor('date');
        break;
      case FormFieldType.USER:
        setEditor('user');
        break;
      case FormFieldType.TICKET:
        setDraftText(jsonToDisplayString(effectiveValue));
        setEditor('ticket');
        break;
      case FormFieldType.NUMBER:
      case FormFieldType.STRING:
      case FormFieldType.DOC:
      default:
        setDraftText(jsonToDisplayString(effectiveValue));
        setEditor('text');
        break;
    }
  }, [effectiveValue, fieldType, readOnly]);

  const closeEditor = useCallback((): void => setEditor('none'), []);

  const commitText = useCallback((): void => {
    const trimmed = draftText.trim();
    onSave(trimmed ? [trimmed] : []);
    setEditor('none');
  }, [draftText, onSave]);

  const userOptions = useMemo(
    () =>
      users.map(user => ({
        value: user.id,
        label: getUserDisplayName(user),
        subtitle: user.email ?? undefined,
      })),
    [users],
  );

  const selectedUserIds = useMemo(
    () => jsonToStringArray(effectiveValue).map(stripUserPrefix),
    [effectiveValue],
  );

  const selectedMulti = useMemo(() => jsonToStringArray(effectiveValue), [effectiveValue]);

  const booleanSelected = useMemo(() => {
    return normalizeBooleanSaveValue(jsonToDisplayString(effectiveValue));
  }, [effectiveValue]);

  return (
    <View className='border-b border-ticket-overview-divider py-3'>
      <View className='flex-row items-start'>
        <View className='w-[186px] pr-3 pt-0.5 flex-row items-center gap-1.5'>
          {readOnly ? <Lock size={12} color={iconColor} /> : null}
          <Text className='flex-1 text-[13px] font-medium text-ticket-meta-left-text'>
            {fieldName}
          </Text>
        </View>
        <View className='min-w-0 flex-1'>
          {editor === 'text' || editor === 'ticket' ? (
            <View className='gap-2'>
              <TextInput
                autoFocus
                value={draftText}
                onChangeText={setDraftText}
                keyboardType={fieldType === FormFieldType.NUMBER ? 'numeric' : 'default'}
                placeholder='Empty'
                placeholderTextColor={mutedColor}
                className='rounded-lg border border-ticket-overview-divider px-3 py-2 text-[14px] font-medium text-foreground'
                onSubmitEditing={commitText}
              />
              <View className='flex-row justify-end gap-2'>
                <Pressable
                  onPress={closeEditor}
                  className='rounded-full border border-ticket-overview-divider px-3 py-1.5'
                >
                  <Text className='text-xs font-medium text-ticket-overview-meta-text'>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={commitText}
                  className='rounded-full px-3 py-1.5'
                  style={{ backgroundColor: accentText }}
                >
                  <Text className='text-xs font-semibold text-white'>Save</Text>
                </Pressable>
              </View>
            </View>
          ) : readOnly ? (
            <Text
              className={`text-[14px] font-medium ${displayValue ? 'text-foreground' : 'text-ticket-meta-left-text'}`}
            >
              {displayValue || 'Empty'}
            </Text>
          ) : (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`${fieldName}: ${displayValue || 'Empty'}`}
              onPress={openEditor}
              className='active:opacity-70'
            >
              {fieldType === FormFieldType.USER && selectedUserIds.length > 0 ? (
                <View className='flex-row items-center gap-2'>
                  <Avatar userIds={selectedUserIds} size={20} />
                  <Text className='flex-1 text-[14px] font-medium text-foreground' numberOfLines={2}>
                    {displayValue}
                  </Text>
                </View>
              ) : (
                <Text
                  className={`text-[14px] font-medium ${displayValue ? 'text-foreground' : 'text-ticket-meta-left-text'}`}
                >
                  {displayValue || 'Empty'}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </View>

      {editor === 'boolean' ? (
        <SingleSelectPickerSheet
          isOpen
          title={fieldName}
          options={booleanOptions}
          selectedValue={booleanSelected}
          onClose={closeEditor}
          onSelect={value => {
            const normalized = normalizeBooleanSaveValue(value);
            if (!normalized) {
              closeEditor();
              return;
            }
            onSave([normalized]);
            closeEditor();
          }}
        />
      ) : null}

      {editor === 'single' ? (
        <SingleSelectPickerSheet
          isOpen
          title={fieldName}
          options={selectOptions}
          selectedValue={jsonToDisplayString(effectiveValue) || null}
          searchable={selectOptions.length > 8}
          onClose={closeEditor}
          onSelect={value => {
            onSave(value ? [value] : []);
            closeEditor();
          }}
        />
      ) : null}

      {editor === 'multi' ? (
        <MultiSelectPickerSheet
          isOpen
          title={fieldName}
          options={
            selectOptions.length > 0
              ? selectOptions
              : selectedMulti.map(value => ({ value, label: value }))
          }
          selectedValues={selectedMulti}
          searchable
          allowCreate={selectOptions.length === 0}
          onClose={closeEditor}
          onConfirm={values => {
            onSave(values);
            closeEditor();
          }}
        />
      ) : null}

      {editor === 'user' ? (
        <MultiSelectPickerSheet
          isOpen
          title={fieldName}
          options={userOptions}
          selectedValues={selectedUserIds}
          searchable
          searchPlaceholder='Search people'
          emptyLabel='No people found'
          onClose={closeEditor}
          onConfirm={values => {
            onSave(values);
            closeEditor();
          }}
        />
      ) : null}

      {editor === 'date' ? (
        <DatePickerSheet
          isOpen
          title={fieldName}
          value={parseDateMs(effectiveValue)}
          mode='date'
          allowClear
          onClose={closeEditor}
          onSelect={ms => {
            onSave(toDateSaveValue(ms));
            closeEditor();
          }}
        />
      ) : null}
    </View>
  );
});
