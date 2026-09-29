import type { ReactElement } from 'react';
import {
  CalendarDefault,
  CalendarTimer,
  CheckTickSingle,
  ChevronRight,
  ListCheckBox,
  Number123,
  Tag,
  Text,
  ThreeDotsMenuVertical,
} from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
      className='group/proprow'
      label={
        <div className='relative min-w-0 max-w-full'>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              className='pointer-events-none absolute right-full top-1/2 z-10 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 pr-1.5 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/proprow:pointer-events-auto group-hover/proprow:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100'
              data-testid={`custom-property-menu-${property.id}`}
              aria-label={`${label} property options`}
            >
              <ThreeDotsMenuVertical className='size-4' aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' sideOffset={6} className={PROPERTY_MENU_PANEL}>
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
                        <span className='min-w-0 flex-1 truncate'>
                          {CUSTOM_PROPERTY_LABEL[type]}
                        </span>
                        {selected ? (
                          <CheckTickSingle
                            className='size-4 shrink-0 text-foreground'
                            aria-hidden
                          />
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
            </DropdownMenuContent>
          </DropdownMenu>
          <EditablePropertyLabel
            value={titleValue}
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
    return (
      <input
        type='checkbox'
        checked={property.value === 'true'}
        disabled={disabled}
        onChange={event => onValue(event.target.checked ? 'true' : 'false')}
        aria-label='Checkbox'
        data-track-category='Claw Agents'
        data-track-name='Create agent: custom property checkbox'
        className='size-4 accent-foreground'
        data-testid={`custom-property-value-${property.id}`}
      />
    );
  }

  const inputType =
    property.type === 'number'
      ? 'number'
      : property.type === 'date'
        ? 'date'
        : property.type === 'datetime'
          ? 'datetime-local'
          : 'text';

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
