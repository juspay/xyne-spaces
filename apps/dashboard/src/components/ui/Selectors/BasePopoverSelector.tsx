import { useState, useEffect, useRef, ReactNode, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { Editor } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import type { VirtualElement } from './Selectors.utils';
import { useOverlayZIndex } from '../../../contexts/OverlayZIndexContext';

export interface BaseSelectorItem {
  id: string;
}

export interface BaseSelectorPluginState<T extends BaseSelectorItem = BaseSelectorItem> {
  isOpen: boolean;
  selectedIndex: number;
  items: T[];
  shouldSelect: boolean;
}

export interface BasePopoverSelectorProps<T extends BaseSelectorItem> {
  editor: Editor | null;
  pluginKey: PluginKey<BaseSelectorPluginState<T>>;
  items: T[];
  detectTrigger: (editor: Editor) => { query: string } | null;
  getPosition: (editor: Editor, queryLength: number) => VirtualElement | null;
  onSelect: (item: T) => void;
  renderItem: (item: T, index: number, isSelected: boolean) => ReactNode;
  emptyMessage?: string;
  loadingMessage?: string | ReactNode;
  isLoading?: boolean;
  className?: string;
  triggerChar?: string;
  header?: ReactNode;
  footer?: ReactNode;
}

export function BasePopoverSelector<T extends BaseSelectorItem>({
  editor,
  pluginKey,
  items,
  detectTrigger,
  getPosition,
  onSelect,
  renderItem,
  emptyMessage = 'No items found',
  loadingMessage = 'Loading...',
  isLoading = false,
  className = 'w-80',
  triggerChar = '@',
  header,
  footer,
}: BasePopoverSelectorProps<T>): React.JSX.Element | null {
  const zIndexClass = useOverlayZIndex() ?? 'z-50';
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [queryLength, setQueryLength] = useState(0);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const isSelectingRef = useRef(false);
  const mentionedBasedPadding = triggerChar === '#' ? 'py-2' : 'p-2';
  const mentionedBasedRounding = triggerChar === '#' ? '' : 'rounded-xl';

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = (): void => {
      if (!editor.isFocused) {
        setIsOpen(false);
        setQueryLength(0);
        return;
      }

      const trigger = detectTrigger(editor);

      if (trigger && trigger.query.length >= 0) {
        setQueryLength(trigger.query.length);
        setIsOpen(true);
        setSelectedIndex(0);
      } else {
        setIsOpen(false);
        setQueryLength(0);
      }
    };

    editor.on('update', handleUpdate);
    editor.on('selectionUpdate', handleUpdate);

    return (): void => {
      editor.off('update', handleUpdate);
      editor.off('selectionUpdate', handleUpdate);
    };
  }, [editor, detectTrigger]);

  const virtualAnchor = useMemo(() => {
    if (!editor || !isOpen) return null;
    return getPosition(editor, queryLength);
  }, [editor, isOpen, queryLength, getPosition]);

  useEffect(() => {
    if (!editor) return;

    const { view } = editor;
    view.dispatch(
      view.state.tr.setMeta(pluginKey, {
        items,
        isOpen,
        selectedIndex: isOpen ? selectedIndex : 0,
      }),
    );
  }, [editor, pluginKey, items, isOpen, selectedIndex]);

  useEffect(() => {
    if (!editor) return;

    const updateHandler = (): void => {
      const { view } = editor;
      const pluginState = pluginKey.getState(view.state);
      if (!pluginState) return;

      setSelectedIndex(pluginState.selectedIndex);

      const selectedItem = items[pluginState.selectedIndex];
      if (pluginState.shouldSelect && selectedItem && !isSelectingRef.current) {
        isSelectingRef.current = true;

        view.dispatch(
          view.state.tr.setMeta(pluginKey, {
            shouldSelect: false,
            isOpen: false,
          }),
        );

        onSelect(selectedItem);

        setTimeout(() => {
          isSelectingRef.current = false;
        }, 0);
      }

      if (!pluginState.isOpen && isOpen) {
        setIsOpen(false);
      }
    };

    editor.on('transaction', updateHandler);
    return (): void => {
      editor.off('transaction', updateHandler);
    };
  }, [editor, pluginKey, items, onSelect, isOpen]);

  useEffect(() => {
    if (selectedItemRef.current && isOpen) {
      selectedItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex, isOpen]);

  // Update anchor position when position changes
  if (!isOpen || !virtualAnchor) return null;

  const handleClose = (): void => {
    if (!editor) return;
    const { view } = editor;
    view.dispatch(
      view.state.tr.setMeta(pluginKey, {
        isOpen: false,
        shouldSelect: false,
      }),
    );
    setIsOpen(false);
  };
  return (
    <Popover.Root
      modal={false}
      open={isOpen}
      onOpenChange={open => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <Popover.Anchor virtualRef={{ current: virtualAnchor }} />
      <Popover.Portal>
        <Popover.Content
          className={`p-0 ${className} rounded-2xl bg-popover border border-border shadow-lg ${zIndexClass} animate-slide-in-up`}
          side='top'
          align='start'
          sideOffset={8}
          avoidCollisions={true}
          collisionPadding={10}
          sticky='always'
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          data-testid={triggerChar === '#' ? 'channel-search-results' : 'user-search-results'}
        >
          {header}
          {isLoading ? (
            <div className='p-2 px-3 text-sm text-muted-foreground text-center'>
              {loadingMessage}
            </div>
          ) : items.length === 0 ? (
            <div className='p-2 px-3 text-sm text-muted-foreground text-center'>{emptyMessage}</div>
          ) : (
            <div
              className={`max-h-80 overflow-y-auto scroll-smooth flex flex-col gap-1 ${mentionedBasedPadding}`}
            >
              {items.map((item, index) => (
                <button
                  key={item.id}
                  ref={index === selectedIndex ? selectedItemRef : null}
                  type='button'
                  className={`w-full text-left border-none cursor-pointer transition-all ${mentionedBasedRounding} ${
                    index === selectedIndex ? 'bg-accent' : 'bg-transparent hover:bg-accent'
                  }`}
                  onMouseDown={e => {
                    e.preventDefault();
                    onSelect(item);
                  }}
                >
                  {renderItem(item, index, index === selectedIndex)}
                </button>
              ))}
            </div>
          )}
          {footer}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
