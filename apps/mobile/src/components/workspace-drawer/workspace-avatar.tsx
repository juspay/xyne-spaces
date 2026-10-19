import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

const WORKSPACE_AVATAR_COLORS = [
  '#e05d44',
  '#e07b44',
  '#c0a030',
  '#4caf50',
  '#2196f3',
  '#9c27b0',
  '#e91e63',
  '#00bcd4',
  '#ff5722',
  '#607d8b',
] as const;

export function getWorkspaceInitialColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return WORKSPACE_AVATAR_COLORS[Math.abs(hash) % WORKSPACE_AVATAR_COLORS.length]!;
}

export function WorkspaceAvatar({
  name,
  size = 36,
  /** Draws the selection ring the active workspace carries in the drawer. */
  isSelected = false,
}: {
  name: string;
  size?: number;
  isSelected?: boolean;
}): ReactElement {
  const ringColor = useCSSVariable('--color-foreground') as string;
  const initial = name[0]?.toUpperCase() ?? '?';
  const backgroundColor = getWorkspaceInitialColor(name);

  const radius = Math.max(8, size * 0.24);

  return (
    <View style={{ width: size, height: size }}>
      {/* The ring is an overlay rather than a border or a padded wrapper, so a
          selected row's avatar occupies the same layout box as every other and
          the names stay aligned down the list. */}
      {isSelected ? (
        <View
          pointerEvents='none'
          style={{
            position: 'absolute',
            top: -3,
            left: -3,
            right: -3,
            bottom: -3,
            borderRadius: radius + 3,
            borderWidth: 2,
            borderColor: ringColor,
          }}
        />
      ) : null}
      <View
        className='items-center justify-center'
        style={{ width: size, height: size, borderRadius: radius, backgroundColor }}
      >
        <Text className='font-bold text-white' style={{ fontSize: Math.max(12, size * 0.4) }}>
          {initial}
        </Text>
      </View>
    </View>
  );
}
