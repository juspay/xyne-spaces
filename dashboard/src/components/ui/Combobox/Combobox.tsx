import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Search } from 'lucide-react';
import { ComboboxProps, DropdownListItemType } from './Combobox.types';
import { forwardRef, useId, useImperativeHandle, useRef } from 'react';

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(
  (
    {
      queryString,
      label,
      items,
      value,
      placeholder,
      onInputValueChange,
      onValueChange,
      hintText,
      onBlur,
      open,
      onOpenChange,
      autoHighlight = false,
    },
    ref,
  ) => {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => {
      if (!inputRef.current) {
        throw new Error('Combobox input ref is not available');
      }
      return inputRef.current;
    }, []);

    return (
      <BaseCombobox.Root
        itemToStringLabel={() => ''}
        autoHighlight={autoHighlight}
        value={value}
        inputValue={queryString}
        onInputValueChange={onInputValueChange}
        onValueChange={(value: DropdownListItemType | null) => {
          onValueChange?.(value?.value ?? null);
          onInputValueChange('');
        }}
        filteredItems={items}
        {...(open !== undefined && { open })}
        {...(onOpenChange && { onOpenChange })}
      >
        {label && <span className='block text-sm font-medium text-foreground mb-1.5'>{label}</span>}
        <div className='relative flex items-center border border-gray-600 h-8 px-2 rounded-lg'>
          <div className='absolute text-gray-600'>
            <Search size={16} />
          </div>
          <BaseCombobox.Input
            id={id}
            ref={inputRef}
            placeholder={placeholder}
            onBlur={onBlur}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
              }
            }}
            style={{
              fieldSizing: 'content',
            }}
            className='text-[14px] w-full text-gray-700 font-normal bg-transparent pl-6 outline-none relative placeholder:text-gray-500'
          />
        </div>
        {hintText && <p className='text-xs text-muted-foreground mt-1.5'>{hintText}</p>}
        <BaseCombobox.Portal>
          <BaseCombobox.Positioner
            sideOffset={10}
            align='start'
            className='z-[100] pointer-events-none'
          >
            <BaseCombobox.Popup
              data-combobox-popup
              className='border border-[#E1E4EA] w-[var(--anchor-width)] max-h-[14rem] rounded-md bg-white text-gray-900 transition duration-100 origin-[var(--transform-origin)] data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 outline outline-1 outline-gray-200 shadow-lg pointer-events-auto'
              onWheel={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <BaseCombobox.Empty>
                <p className='text-sm text-gray-600 px-3 py-2'>No options found</p>
              </BaseCombobox.Empty>
              <BaseCombobox.List
                className='
                    max-h-[min(14rem,var(--available-height))]
                    overflow-y-auto overscroll-contain
                    py-1 outline-none cursor-pointer
                    data-[empty]:p-0 space-y-1 '
              >
                {(item: DropdownListItemType) => (
                  <BaseCombobox.Item
                    key={item.value}
                    value={item}
                    className='
                        relative flex justify-between
                        items-center
                        px-2 mx-1 py-1.5 leading-none
                        data-[highlighted]:bg-gray-200 rounded-md'
                  >
                    <div className='flex items-center gap-3'>
                      {item.leftSlot && (
                        <div className='size-6 flex items-center justify-center shrink-0'>
                          {item.leftSlot}
                        </div>
                      )}
                      <div className='flex flex-col min-w-0 flex-1'>
                        <span className='font-medium truncate text-sm'>{item.label}</span>
                        {item.description && (
                          <span className='text-xs text-muted-foreground truncate'>
                            {item.description}
                          </span>
                        )}
                      </div>
                      {item.rightSlot && (
                        <div className='flex items-center shrink-0'>{item.rightSlot}</div>
                      )}
                    </div>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
    );
  },
);

Combobox.displayName = 'Combobox';
