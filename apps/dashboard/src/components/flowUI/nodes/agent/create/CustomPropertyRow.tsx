import { useRef, type ReactElement } from 'react';
import {
  CalendarDefault,
  CalendarTimer,
  CheckTickSingle,
  ChevronRight,
  ListCheckBox,
  Number123,
  Tag,
  Text,
} from '@xyne/icons';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/Checkbox/Checkbox';
import { cn } from '@/utils/classNames';
import { PROPERTY_MENU_ITEM, PROPERTY_MENU_PANEL } from './AddPropertyMenu';
import { EditablePropertyLabel } from './EditablePropertyLabel';
import { PropertyRow } from './PropertyRow';
import {
  CUSTOM_PROPERTY_LABEL,
  CUSTOM_PROPERTY_PLACEHOLDER,
  CUSTOM_PROPERTY_TYPES,
  copyPropertyValue,
  customPropertyTitleValue,
  propertyHasValue,
  readPropertyValue,
  type CustomProperty,
  type CustomPropertyType,
} from './customProperty';

const TYPE_ICON: Record<CustomPropertyType, typeof Text> = {
  text: Text,
  number: Number123,
  checkbox: ListCheckBox,
  tags: Tag,
  date: CalendarDefault,
  datetime: CalendarTimer,
};

const VALUE_CLASS =
  'block h-[1.3em] min-h-[1.3em] w-full border-0 bg-transparent p-0 text-sm font-normal leading-[1.3] tracking-[-0.1px] text-foreground outline-none placeholder:font-normal placeholder:text-fg-placeholder disabled:opacity-60';

interface CustomPropertyRowProps {
  property: CustomProperty;
  disabled?: boolean;
  onChange: (next: CustomProperty) => void;
  onRemove: () => void;
}

export function CustomPropertyRow({
  property,
  disabled = false,
  onChange,
  onRemove,
}: CustomPropertyRowProps): ReactElement {
  const typeLabel = CUSTOM_PROPERTY_LABEL[property.type];
  const titleValue = customPropertyTitleValue(property.title, property.type);
  const label = titleValue || typeLabel;
  // A row with a value is a real property even when its title is just the type
  // ("Tags: billing, refunds"), so its title reads as text, not a grey placeholder.
  const shownTitle = titleValue || (propertyHasValue(property) ? typeLabel : '');

  const setType = (type: CustomPropertyType): void => {
    const title = customPropertyTitleValue(
      customPropertyTitleValue(property.title, property.type),
      type,
    );
    onChange({
      ...property,
      type,
      title,
      value: type === 'checkbox' ? (property.value === 'true' ? 'true' : 'false') : property.value,
    });
  };

  return (
    <PropertyRow
      menuLabel={label}
      menuTestId={`custom-property-menu-${property.id}`}
      menuDisabled={disabled}
      menu={
        <>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={cn(PROPERTY_MENU_ITEM, 'justify-between')}>
              Change type
              <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={PROPERTY_MENU_PANEL} sideOffset={6}>
              {CUSTOM_PROPERTY_TYPES.map(type => {
                const Icon = TYPE_ICON[type];
                const selected = type === property.type;
                return (
                  <DropdownMenuItem
                    key={type}
                    className={PROPERTY_MENU_ITEM}
                    onSelect={() => setType(type)}
                  >
                    <Icon className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                    <span className='min-w-0 flex-1 truncate'>{CUSTOM_PROPERTY_LABEL[type]}</span>
                    {selected ? (
                      <CheckTickSingle className='size-4 shrink-0 text-foreground' aria-hidden />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={PROPERTY_MENU_ITEM}
            onSelect={() => {
              void copyPropertyValue(property.value).then(() =>
                onChange({ ...property, value: '' }),
              );
            }}
          >
            Cut
          </DropdownMenuItem>
          <DropdownMenuItem
            className={PROPERTY_MENU_ITEM}
            onSelect={() => {
              void copyPropertyValue(property.value);
            }}
          >
            Copy
          </DropdownMenuItem>
          <DropdownMenuItem
            className={PROPERTY_MENU_ITEM}
            onSelect={() => {
              void readPropertyValue().then(value => onChange({ ...property, value }));
            }}
          >
            Paste
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={PROPERTY_MENU_ITEM} onSelect={onRemove}>
            Remove
          </DropdownMenuItem>
        </>
      }
      label={
        <div className='min-w-0 max-w-full'>
          <EditablePropertyLabel
            value={shownTitle}
            placeholder={typeLabel}
            disabled={disabled}
            testId={`custom-property-label-${property.id}`}
            className='text-foreground'
            onCommit={title =>
              onChange({ ...property, title: customPropertyTitleValue(title, property.type) })
            }
          />
        </div>
      }
    >
      <CustomPropertyValue
        property={property}
        disabled={disabled}
        onValue={value => onChange({ ...property, value })}
      />
    </PropertyRow>
  );
}

function CustomPropertyValue({
  property,
  disabled,
  onValue,
}: {
  property: CustomProperty;
  disabled: boolean;
  onValue: (value: string) => void;
}): ReactElement {
  if (property.type === 'checkbox') {
    // The app's own checkbox, so it matches light and dark themes everywhere else.
    return (
      <Checkbox
        checked={property.value === 'true'}
        onChange={checked => onValue(checked ? 'true' : 'false')}
        disabled={disabled}
        label=''
        ariaLabel={property.title.trim() || CUSTOM_PROPERTY_LABEL.checkbox}
        data-track-category='Claw Agents'
        data-track-name='Create agent: custom property checkbox'
        data-testid={`custom-property-value-${property.id}`}
      />
    );
  }

  if (property.type === 'date' || property.type === 'datetime') {
    return <DateValue property={property} disabled={disabled} onValue={onValue} />;
  }

  const inputType = property.type === 'number' ? 'number' : 'text';

  return (
    <input
      type={inputType}
      value={property.value}
      disabled={disabled}
      onChange={event => onValue(event.target.value)}
      data-track-category='Claw Agents'
      data-track-name='Create agent: custom property value'
      placeholder={CUSTOM_PROPERTY_PLACEHOLDER[property.type]}
      aria-label={CUSTOM_PROPERTY_LABEL[property.type]}
      data-testid={`custom-property-value-${property.id}`}
      className={cn(VALUE_CLASS, property.type === 'number' && '[appearance:textfield]')}
    />
  );
}

/**
 * Date and date-with-time values: the field is only as wide as the date, and
 * the browser's own picker glyph is swapped for the app's calendar icon, sitting
 * right after the date and opening the same native picker.
 */
function DateValue({
  property,
  disabled,
  onValue,
}: {
  property: CustomProperty;
  disabled: boolean;
  onValue: (value: string) => void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const withTime = property.type === 'datetime';
  const Icon = withTime ? CalendarTimer : CalendarDefault;
  return (
    <div className='flex items-center gap-1.5'>
      <input
        ref={inputRef}
        type={withTime ? 'datetime-local' : 'date'}
        value={property.value}
        disabled={disabled}
        onChange={event => onValue(event.target.value)}
        data-track-category='Claw Agents'
        data-track-name='Create agent: custom property value'
        aria-label={property.title.trim() || CUSTOM_PROPERTY_LABEL[property.type]}
        data-testid={`custom-property-value-${property.id}`}
        className={cn(
          VALUE_CLASS,
          // Room for "dd/mm/yyyy" or "dd/mm/yyyy, hh:mm AM" and no more.
          withTime ? 'w-[21ch]' : 'w-[11ch]',
          '[&::-webkit-calendar-picker-indicator]:hidden',
        )}
      />
      <button
        type='button'
        disabled={disabled}
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          try {
            input.showPicker();
          } catch {
            input.focus();
          }
        }}
        aria-label={withTime ? 'Pick a date and time' : 'Pick a date'}
        data-track-category='Claw Agents'
        data-track-name='Create agent: custom property date picker'
        className='flex shrink-0 items-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60'
      >
        <Icon className='size-4' aria-hidden />
      </button>
    </div>
  );
}
