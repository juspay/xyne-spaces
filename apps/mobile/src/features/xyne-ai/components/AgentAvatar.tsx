import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { agentInitial, type AgentIdentity } from '../model/agentIdentity';

const DEFAULT_SIZE = 20;

/**
 * An agent's avatar — the mobile counterpart of the dashboard's `AgentGlyph`.
 *
 * Draws the agent's Spaces bot user when that user is in the directory (the
 * same picture channels show for it). Otherwise, or before the directory has
 * hydrated, a letter tile in the agent's colour; Ask AI has no colour and
 * follows the user's accent, as `AgentDot` does. The bot-user check matters:
 * `Avatar` on an unknown id draws an empty circle.
 */
export const AgentAvatar = memo(function AgentAvatar({
  identity,
  size = DEFAULT_SIZE,
}: {
  identity: AgentIdentity;
  size?: number;
}): ReactElement {
  const botUser = useUserSnapshot(identity.userId ?? '');
  const { accentBg } = useBubbleAccent();
  // Same corner as `AvatarFace` with `rounded={false}`, so both variants match.
  const radius = Math.min(8, size / 2);

  if (identity.userId && botUser) {
    return (
      <View testID='agent-avatar-image' style={{ width: size, height: size }}>
        <Avatar userIds={[identity.userId]} size={size} rounded={false} />
      </View>
    );
  }

  return (
    <View
      testID='agent-avatar-letter'
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: identity.color ?? accentBg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#ffffff', fontSize: Math.round(size * 0.5), fontWeight: '600' }}>
        {agentInitial(identity.name)}
      </Text>
    </View>
  );
});
