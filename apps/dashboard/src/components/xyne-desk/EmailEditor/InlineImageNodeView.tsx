import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

const MIN_WIDTH = 60;

export const InlineImageNodeView = ({
  node,
  updateAttributes,
  selected,
}: NodeViewProps): ReactElement => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);

  const widthAttr = (node.attrs as { width?: number | string | null }).width;
  const persistedWidth =
    typeof widthAttr === 'number'
      ? widthAttr
      : typeof widthAttr === 'string' && widthAttr.trim() !== ''
        ? Number(widthAttr) || null
        : null;
  const renderedWidth = draftWidth ?? persistedWidth ?? undefined;

  const startResize = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>): void => {
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = rect.width;
      const startHeight = rect.height;
      const ratio = startHeight > 0 ? startWidth / startHeight : 1;

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - startX;
        const dy = (ev.clientY - startY) * ratio;
        const next = startWidth + (Math.abs(dx) >= Math.abs(dy) ? dx : dy);
        setDraftWidth(Math.max(MIN_WIDTH, Math.round(next)));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setDraftWidth(prev => {
          if (prev !== null) updateAttributes({ width: prev });
          return null;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [updateAttributes],
  );

  useEffect(() => {
    if (!selected) setDraftWidth(null);
  }, [selected]);

  const src = (node.attrs as { src?: string }).src ?? '';
  const alt = (node.attrs as { alt?: string }).alt ?? '';
  const crossorigin = (node.attrs as { crossorigin?: string }).crossorigin ?? 'use-credentials';

  return (
    <NodeViewWrapper
      as='span'
      className='inline-block relative align-middle'
      style={{ lineHeight: 0 }}
      data-att-id={(node.attrs as { dataAttId?: string }).dataAttId ?? undefined}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        crossOrigin={crossorigin as '' | 'anonymous' | 'use-credentials'}
        draggable={false}
        style={{
          maxWidth: '100%',
          height: 'auto',
          verticalAlign: 'middle',
          ...(renderedWidth ? { width: `${renderedWidth}px` } : {}),
          outline: selected ? '2px solid #3b82f6' : 'none',
          outlineOffset: '2px',
          borderRadius: '2px',
          cursor: 'default',
        }}
      />
      {selected && (
        <button
          type='button'
          contentEditable={false}
          onMouseDown={startResize}
          className='absolute -bottom-1 -right-1 size-3 bg-blue-500 border border-background rounded-sm p-0 cursor-nwse-resize'
          aria-label='Resize image'
          title='Drag to resize'
          data-track-category='Support'
          data-track-name='InlineImageResizeDrag'
        />
      )}
    </NodeViewWrapper>
  );
};
