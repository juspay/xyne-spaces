import type { ReactElement } from 'react';
import {
  DetailListCard,
  type DetailListItem,
} from '../../../../../routes/AIScreen/library/shared/primitives/DetailListCard';

const noop = (): void => {};

export function PreviewReadOnlyList({
  items,
  emptyLabel,
}: {
  items: DetailListItem[];
  emptyLabel: string;
}): ReactElement {
  return (
    <DetailListCard
      items={items}
      loading={false}
      emptyLabel={emptyLabel}
      canEdit={false}
      removeLabel={item => `Remove ${item.name}`}
      onRemove={noop}
    />
  );
}
