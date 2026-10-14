import { type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { AgentCapabilityGroup } from '@/src/utils/flowAgentEditor';
import type { AgentPreviewListItem } from '@/src/utils/flowAgentUtils';

export type AgentPreviewPanel =
  | 'main'
  | 'model'
  | 'providers'
  | 'subagent-detail'
  | 'mcp-detail'
  | 'builtin-detail'
  | AgentCapabilityGroup;

export const DetailCard = ({ children }: { children: ReactNode }): ReactElement => (
  <View className='overflow-hidden rounded-lg border border-border bg-card'>{children}</View>
);

export const Section = ({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: ReactElement | null;
  children: ReactNode;
}): ReactElement => (
  <View style={{ gap: 8, minWidth: 0 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text className='text-sm font-semibold text-foreground'>{label}</Text>
      {trailing}
    </View>
    {children}
  </View>
);

export const Row = ({
  title,
  hint,
  value,
  last = false,
  onPress,
  accessory,
}: {
  title: string;
  hint?: string;
  value: string;
  last?: boolean;
  onPress?: () => void;
  accessory?: ReactElement | null;
}): ReactElement => {
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text className='text-sm font-semibold text-foreground'>{title}</Text>
        {hint ? <Text className='text-xs text-flow-card-header-title'>{hint}</Text> : null}
      </View>
      <Text className='shrink text-sm text-foreground'>{value}</Text>
      {accessory}
    </View>
  );

  return (
    <View className={last ? 'border-border' : 'border-b border-border'}>
      {onPress ? (
        <Pressable accessibilityRole='button' onPress={onPress}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
};

export const EmptyLine = ({ label }: { label: string }): ReactElement => (
  <Text className='text-sm text-flow-card-header-title'>{label}</Text>
);

export const ListCard = ({
  items,
  empty,
  canEdit,
  onRemove,
}: {
  items: AgentPreviewListItem[];
  empty: string;
  canEdit?: boolean;
  onRemove?: (item: AgentPreviewListItem) => void;
}): ReactElement => {
  const muted = useCSSVariable('--color-foreground') as string;

  if (items.length === 0) {
    return (
      <DetailCard>
        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <EmptyLine label={empty} />
        </View>
      </DetailCard>
    );
  }

  return (
    <DetailCard>
      {items.map((item, index) => (
        <View
          key={item.id}
          {...(index === items.length - 1 ? {} : { className: 'border-b border-border' })}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 8,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text className='text-sm font-semibold text-foreground'>{item.name}</Text>
            {item.description ? (
              <Text className='text-sm text-flow-card-header-title'>{item.description}</Text>
            ) : null}
          </View>
          {canEdit ? (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`Remove ${item.name}`}
              hitSlop={8}
              onPress={() => onRemove?.(item)}
            >
              <X size={16} color={muted} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </DetailCard>
  );
};
