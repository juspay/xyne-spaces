import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { TicketPriority } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

const PRIORITY_BAR_HEIGHTS = [6, 10, 14] as const;

function priorityIconVar(priority: TicketPriority): string {
  switch (priority) {
    case TicketPriority.LOW:
      return '--color-ticket-priority-low';
    case TicketPriority.MEDIUM:
      return '--color-ticket-priority-medium';
    case TicketPriority.HIGH:
      return '--color-ticket-priority-high';
    case TicketPriority.CRITICAL:
      return '--color-ticket-priority-critical';
  }
}

function priorityActiveBars(priority: TicketPriority): number {
  switch (priority) {
    case TicketPriority.LOW:
      return 1;
    case TicketPriority.MEDIUM:
      return 2;
    case TicketPriority.HIGH:
      return 3;
    case TicketPriority.CRITICAL:
      return 0;
  }
}

type TicketsPriorityIconProps = {
  priority: TicketPriority;
  size?: number;
};

/**
 * Dashboard-matching priority glyph: signal bars (Low/Medium/High) or alert (Critical).
 */
export const TicketsPriorityIcon = memo(function TicketsPriorityIcon({
  priority,
  size = 16,
}: TicketsPriorityIconProps): ReactElement {
  const color = useCSSVariable(priorityIconVar(priority)) as string;

  if (priority === TicketPriority.CRITICAL) {
    return <TriangleAlert size={size} color={color} strokeWidth={2} />;
  }

  const activeBars = priorityActiveBars(priority);
  const barWidth = Math.max(2.5, size * 0.2);
  const gap = Math.max(1.5, size * 0.12);

  return (
    <View className='flex-row items-end' style={{ height: size, gap }}>
      {PRIORITY_BAR_HEIGHTS.map((heightRatio, index) => (
        <View
          key={heightRatio}
          style={{
            width: barWidth,
            height: (heightRatio / 14) * size,
            borderRadius: barWidth / 2,
            backgroundColor: color,
            opacity: index < activeBars ? 1 : 0.25,
          }}
        />
      ))}
    </View>
  );
});
