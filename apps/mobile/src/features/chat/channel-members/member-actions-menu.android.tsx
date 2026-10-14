import { MoreVertical, Trash2, UserMinus, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { Dropdown } from '@/src/components/ui/dropdown';
import type { MemberActionId } from '@/src/features/chat/channel-members/channel-member-actions';

import type { MemberActionsMenuProps } from './member-actions-menu.types';

const TRIGGER_SIZE = 36;
const ICON_SIZE = 18;

function ActionIcon({
  id,
  color,
  dangerColor,
}: {
  id: MemberActionId;
  color: string;
  dangerColor: string;
}) {
  if (id === 'make-admin') return <UserPlus size={ICON_SIZE} color={color} />;
  if (id === 'remove-admin') return <UserMinus size={ICON_SIZE} color={color} />;
  return <Trash2 size={ICON_SIZE} color={dangerColor} />;
}

export function MemberActionsMenu({
  userId,
  memberName,
  actions,
  onAction,
}: MemberActionsMenuProps) {
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const dangerColor = useCSSVariable('--color-status-danger') as string;
  const pendingRemoveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    pendingRemoveRef.current = null;
  }, [userId]);

  const handleClosed = useCallback(() => {
    const pending = pendingRemoveRef.current;
    pendingRemoveRef.current = null;
    pending?.();
  }, []);

  if (actions.length === 0) return null;

  return (
    <Dropdown key={userId} onClosed={handleClosed}>
      <Dropdown.Trigger
        accessibilityLabel={`Actions for ${memberName}`}
        hitSlop={8}
        style={styles.trigger}
      >
        <MoreVertical size={18} color={mutedColor} />
      </Dropdown.Trigger>
      <Dropdown.Content
        side='bottom'
        align='end'
        sideOffset={6}
        minWidth={200}
        maxWidth={280}
        scrollable={false}
        overlayColor='rgba(0,0,0,0.02)'
        contentStyle={{ paddingVertical: 6 }}
      >
        {actions.map(action => (
          <Dropdown.Item
            key={action.id}
            label={action.label}
            danger={action.destructive}
            left={<ActionIcon id={action.id} color={foregroundColor} dangerColor={dangerColor} />}
            onSelect={() => {
              if (action.id === 'remove') {
                pendingRemoveRef.current = () => onAction(action.id);
                return;
              }
              onAction(action.id);
            }}
          />
        ))}
      </Dropdown.Content>
    </Dropdown>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: TRIGGER_SIZE,
    height: TRIGGER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
