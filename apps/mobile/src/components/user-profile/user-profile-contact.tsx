import { memo, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  Check,
  Edit2,
  Hash,
  Mail,
  MapPin,
  Phone,
  User as UserIcon,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import {
  ListRow,
  ListRowDivider,
  SectionCard,
  SectionLabel,
} from '@/src/components/ui/settings-list';
import { useEmployeeDetails } from '@/src/hooks/useEmployeeDetails';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { useUserProfile } from './user-profile-context';

type ContactProps = {
  className?: string;
};

type ContactRowProps = {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
};

const ContactRow = ({ icon, label, children }: ContactRowProps): ReactElement => (
  <ListRow icon={icon} label={label}>
    {children}
  </ListRow>
);

type EditableField = 'displayName' | 'phoneNumber';

const validateField = (field: EditableField, value: string): string | null => {
  if (!value.trim()) return null;
  if (field === 'phoneNumber' && !/^\+?[1-9]\d{9,14}$/.test(value)) {
    return 'Please enter a valid phone number';
  }
  if (field === 'displayName' && value.length > 50) {
    return 'Display name must be less than 50 characters';
  }
  return null;
};

const Contact = memo(({ className }: ContactProps): ReactElement | null => {
  const { accentText } = useBubbleAccent();
  const { userId, user, profile, isOwnProfile } = useUserProfile();
  const zero = useZero();
  const employeeLocation = useEmployeeDetails(user?.email);
  const mutedIconColor = useCSSVariable('--color-muted') as string;
  const primaryColor = useCSSVariable('--color-action-primary') as string;
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  if (!user) return null;

  const hasEmail = Boolean(user.email);
  const hasDisplayName = Boolean(profile?.displayName);
  const hasPhone = Boolean(profile?.phoneNumber);
  const hasLocation = Boolean(
    employeeLocation?.current_location || employeeLocation?.current_landmark,
  );

  const startEdit = (field: EditableField, value: string | null | undefined): void => {
    setEditingField(field);
    setEditValue(value ?? '');
    setEditError(null);
  };

  const cancelEdit = (): void => {
    setEditingField(null);
    setEditValue('');
    setEditError(null);
  };

  const saveEdit = async (): Promise<void> => {
    if (!editingField) return;
    const error = validateField(editingField, editValue);
    if (error) {
      setEditError(error);
      return;
    }

    setEditError(null);
    try {
      const result = await zero.mutate(
        mutators.userProfile.upsert({
          [editingField]: editValue.trim() || null,
          timestamp: Date.now(),
          profileId: profile?.id ?? uuidv4(),
        }),
      ).server;
      if (result.type === 'error') throw new Error(result.error.message);
      cancelEdit();
    } catch {
      setEditError('Failed to save. Please try again.');
    }
  };

  const editableValue = (
    field: EditableField,
    value: string | null | undefined,
    addLabel: string,
  ): ReactElement | null => {
    if (editingField === field && isOwnProfile) {
      return (
        <View className='mt-1'>
          <View className='flex-row items-center gap-2'>
            <TextInput
              className='flex-1 rounded-lg border border-settings-row-divider bg-settings-bg px-2.5 py-2 text-sm text-foreground'
              value={editValue}
              onChangeText={setEditValue}
              placeholder={field === 'phoneNumber' ? 'Enter phone number' : 'Enter display name'}
              placeholderTextColor={mutedIconColor}
              keyboardType={field === 'phoneNumber' ? 'phone-pad' : 'default'}
              autoCapitalize={field === 'phoneNumber' ? 'none' : 'words'}
              maxLength={field === 'phoneNumber' ? 15 : 50}
              onSubmitEditing={() => void saveEdit()}
            />
            <Pressable
              onPress={() => {
                void haptics.success();
                void saveEdit();
              }}
              className='p-2 active:opacity-60'
              accessibilityRole='button'
              accessibilityLabel={`Save ${field === 'phoneNumber' ? 'phone number' : 'display name'}`}
            >
              <Check size={17} color={primaryColor} />
            </Pressable>
            <Pressable
              onPress={() => {
                void haptics.buttonTap();
                cancelEdit();
              }}
              className='p-2 active:opacity-60'
              accessibilityRole='button'
              accessibilityLabel='Cancel editing'
            >
              <X size={17} color={mutedIconColor} />
            </Pressable>
          </View>
          {editError ? <Text className='mt-1 text-xs text-red-600'>{editError}</Text> : null}
        </View>
      );
    }

    if (value) {
      return (
        <View className='mt-1 flex-row items-center gap-2'>
          <Text className='flex-1 text-sm text-foreground' numberOfLines={1}>
            {value}
          </Text>
          {isOwnProfile ? (
            <Pressable
              onPress={() => {
                void haptics.buttonTap();
                startEdit(field, value);
              }}
              className='p-1 active:opacity-60'
              accessibilityRole='button'
              accessibilityLabel={`Edit ${field === 'phoneNumber' ? 'phone number' : 'display name'}`}
            >
              <Edit2 size={14} color={mutedIconColor} />
            </Pressable>
          ) : null}
        </View>
      );
    }

    return isOwnProfile ? (
      <Pressable
        onPress={() => {
          void haptics.buttonTap();
          startEdit(field, value);
        }}
        className='self-start py-1 active:opacity-60'
        accessibilityRole='button'
      >
        <Text className='text-sm' style={{ color: accentText }}>
          {addLabel}
        </Text>
      </Pressable>
    ) : null;
  };

  const rows: ReactElement[] = [
    <ContactRow key='userId' icon={Hash} label='User ID'>
      <CopyableValue
        value={userId}
        variant='row'
        monospace
        textClassName='text-xs'
        copyAccessibilityLabel='Copy user ID'
      />
    </ContactRow>,
    ...(hasEmail
      ? [
          <ContactRow key='email' icon={Mail} label='Email Address'>
            <CopyableValue
              value={user.email ?? ''}
              variant='row'
              textClassName='text-sm'
              copyAccessibilityLabel='Copy email address'
              richEmailCopy
            />
          </ContactRow>,
        ]
      : []),
    ...(hasDisplayName || isOwnProfile
      ? [
          <ContactRow key='displayName' icon={UserIcon} label='Display Name'>
            {editableValue('displayName', profile?.displayName, '+ Add Display Name')}
          </ContactRow>,
        ]
      : []),
    ...(hasPhone || isOwnProfile
      ? [
          <ContactRow key='phone' icon={Phone} label='Phone Number'>
            {editableValue('phoneNumber', profile?.phoneNumber, '+ Add Phone Number')}
          </ContactRow>,
        ]
      : []),
    ...(hasLocation
      ? [
          <ContactRow key='location' icon={MapPin} label='Current Location'>
            {employeeLocation?.current_location ? (
              <Text className='text-sm' style={{ color: labelColor }}>
                {employeeLocation.current_location}
              </Text>
            ) : null}
            {employeeLocation?.current_landmark ? (
              <Text className='mt-1 text-xs' style={{ color: descriptionColor }}>
                Landmark: {employeeLocation.current_landmark}
              </Text>
            ) : null}
          </ContactRow>,
        ]
      : []),
  ];

  return (
    <View className={cn(className)}>
      <SectionLabel>Contact Information</SectionLabel>
      <SectionCard>
        {rows.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? <ListRowDivider /> : null}
            {row}
          </View>
        ))}
      </SectionCard>
    </View>
  );
});
Contact.displayName = 'UserProfile.Contact';

export { Contact };
