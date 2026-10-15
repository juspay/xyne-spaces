import { Button, Host, Menu, RNHostView } from '@expo/ui/swift-ui';
import { MoreVertical } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';

import type { MemberActionsMenuProps } from './member-actions-menu.types';

const TRIGGER_SIZE = 36;

export function MemberActionsMenu({
  userId,
  memberName,
  actions,
  onAction,
}: MemberActionsMenuProps) {
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;

  if (actions.length === 0) return null;

  return (
    <Host key={userId} matchContents ignoreSafeArea='all' style={styles.host}>
      <Menu
        label={
          <RNHostView matchContents>
            <View
              accessibilityLabel={`Actions for ${memberName}`}
              pointerEvents='none'
              style={styles.trigger}
            >
              <MoreVertical size={18} color={mutedColor} />
            </View>
          </RNHostView>
        }
      >
        {actions.map(action => (
          <Button
            key={action.id}
            label={action.label}
            systemImage={action.systemImage}
            role={action.destructive ? 'destructive' : 'default'}
            onPress={() => {
              void haptics.selection();
              onAction(action.id);
            }}
          />
        ))}
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    width: TRIGGER_SIZE,
    height: TRIGGER_SIZE,
  },
  trigger: {
    width: TRIGGER_SIZE,
    height: TRIGGER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
