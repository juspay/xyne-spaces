import { ReactElement } from 'react';
import { FormFieldType } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { TruncatedTooltip } from '../../ui/Tooltip/TruncatedTooltip';
import { useUsersById } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { toStringArray } from '../TicketTable/dynamicFieldValues';
import { getTimestampValue } from '../../../utils/board/dynamicFieldFilters';

interface DynamicFieldCellProps {
  fieldType: FormFieldType;
  value: unknown;
  className?: string | undefined;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatDateValue = (raw: string): string => {
  // Date-only values would parse as UTC midnight and render a day early west of UTC.
  const dateOnly = DATE_ONLY.exec(raw);
  const timestamp = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime()
    : getTimestampValue(raw);
  if (timestamp === null || Number.isNaN(timestamp)) return raw;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatBooleanValue = (raw: string): string => {
  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return 'Yes';
  if (normalized === 'false' || normalized === 'no') return 'No';
  return raw;
};

const CellText = ({
  text,
  className,
}: {
  text: string;
  className?: string | undefined;
}): ReactElement => (
  <TruncatedTooltip content={text}>
    <span
      className={cn(
        'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground',
        className,
      )}
    >
      {text}
    </span>
  </TruncatedTooltip>
);

const UserFieldValue = ({
  userIds,
  className,
}: {
  userIds: string[];
  className?: string | undefined;
}): ReactElement => {
  const usersById = useUsersById();
  const text = userIds
    .map(id => {
      const user = usersById.get(id);
      return user ? getUserDisplayName(user) : id;
    })
    .join(', ');
  return <CellText text={text} className={className} />;
};

export const DynamicFieldCell = ({
  fieldType,
  value,
  className,
}: DynamicFieldCellProps): ReactElement | null => {
  const values = toStringArray(value);
  if (values.length === 0) return null;
  if (fieldType === FormFieldType.USER) {
    return <UserFieldValue userIds={values} className={className} />;
  }
  const text =
    fieldType === FormFieldType.DATE
      ? values.map(formatDateValue).join(', ')
      : fieldType === FormFieldType.BOOLEAN
        ? values.map(formatBooleanValue).join(', ')
        : values.join(', ');
  return <CellText text={text} className={className} />;
};
