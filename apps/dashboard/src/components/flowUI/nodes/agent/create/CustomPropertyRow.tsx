import { useRef, useState, type ReactElement } from 'react';
import {
  CalendarDefault,
  CalendarTimer,
  CheckTickSingle,
  ChevronRight,
  ListCheckBox,
  MultipleCrossCancelDefault,
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
import {
  PROPERTY_MENU_ITEM,
  PROPERTY_MENU_LABEL,
  PROPERTY_MENU_PANEL,
  PROPERTY_MENU_SEPARATOR,
} from './AddPropertyMenu';
import { EditablePropertyLabel } from './EditablePropertyLabel';
import { PropertyRow } from './PropertyRow';
import {
  CUSTOM_PROPERTY_LABEL,
  CUSTOM_PROPERTY_PLACEHOLDER,
  CUSTOM_PROPERTY_TYPES,
  copyPropertyValue,
  customPropertyTitleValue,
  joinTags,
  mergeTags,
  propertyHasValue,
  readPropertyValue,
  splitTags,
  tagsFromText,
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
            <DropdownMenuSubTrigger className={PROPERTY_MENU_ITEM}>
              <span className={PROPERTY_MENU_LABEL}>
                <span>Change type</span>
              </span>
              <ChevronRight aria-hidden />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={PROPERTY_MENU_PANEL} sideOffset={8}>
              {CUSTOM_PROPERTY_TYPES.map(type => {
                const Icon = TYPE_ICON[type];
                const selected = type === property.type;
                return (
                  <DropdownMenuItem
                    key={type}
                    className={PROPERTY_MENU_ITEM}
                    onSelect={() => setType(type)}
                  >
                    <span className={PROPERTY_MENU_LABEL}>
                      <Icon aria-hidden />
                      <span>{CUSTOM_PROPERTY_LABEL[type]}</span>
                    </span>
                    {selected ? <CheckTickSingle aria-hidden /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator className={PROPERTY_MENU_SEPARATOR} />
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
          <DropdownMenuSeparator className={PROPERTY_MENU_SEPARATOR} />
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

  if (property.type === 'tags') {
    return <TagsValue property={property} disabled={disabled} onValue={onValue} />;
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
 * Tags as chips. A space, comma or Enter turns what was typed into a tag, and
 * Backspace in the empty box takes the last one off. Stored as "a, b".
 */
function TagsValue({
  property,
  disabled,
  onValue,
}: {
  property: CustomProperty;
  disabled: boolean;
  onValue: (value: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState('');
  const tags = splitTags(property.value);
  const add = (text: string): void => {
    setDraft('');
    const next = mergeTags(tags, tagsFromText(text));
    if (next.length !== tags.length) onValue(joinTags(next));
  };
  const remove = (index: number): void => onValue(joinTags(tags.filter((_, i) => i !== index)));

  return (
    <div
      className='flex min-h-[1.3em] min-w-0 flex-wrap items-center gap-1'
      data-testid={`custom-property-tags-${property.id}`}
    >
      {tags.map((tag, index) => (
        <span
          key={tag}
          className='inline-flex h-[22px] max-w-full items-center gap-1 rounded-md bg-muted px-1.5 text-[13px] leading-none text-foreground'
        >
          <span className='truncate'>{tag}</span>
          {disabled ? null : (
            <button
              type='button'
              onClick={() => remove(index)}
              aria-label={`Remove ${tag}`}
              data-track-category='Claw Agents'
              data-track-name='Create agent: remove tag'
              className='flex shrink-0 items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground'
            >
              <MultipleCrossCancelDefault className='size-3' aria-hidden />
            </button>
          )}
        </span>
      ))}
      {disabled ? null : (
        <input
          type='text'
          value={draft}
          onChange={event => {
            // A space or comma, typed or pasted, ends the tag before it.
            if (/[\s,]/.test(event.target.value)) add(event.target.value);
            else setDraft(event.target.value);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add(draft);
            } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
              event.preventDefault();
              remove(tags.length - 1);
            }
          }}
          onBlur={() => add(draft)}
          data-track-category='Claw Agents'
          data-track-name='Create agent: custom property tags'
          placeholder={tags.length === 0 ? CUSTOM_PROPERTY_PLACEHOLDER.tags : ''}
          aria-label={property.title.trim() || CUSTOM_PROPERTY_LABEL.tags}
          data-testid={`custom-property-value-${property.id}`}
          className={cn(VALUE_CLASS, 'w-auto min-w-[6ch] flex-1')}
        />
      )}
    </div>
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
