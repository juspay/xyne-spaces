import React, { useState, useEffect } from 'react';
import { useVSCode } from '../../../contexts/VSCodeContext';

export const WorkflowVSCodeOverlay: React.FC = () => {
  const { activeContainer, activeConfig } = useVSCode();
  const [style, setStyle] = useState<React.CSSProperties>({ display: 'none' });

  useEffect(() => {
    if (!activeContainer) {
      setStyle({
        display: 'none',
        visibility: 'hidden',
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
      });
      return;
    }

    const updatePosition = () => {
      if (!activeContainer.isConnected) {
        return;
      }

      // Use requestAnimationFrame to throttle and sync with paint cycles
      window.requestAnimationFrame(() => {
        const rect = activeContainer.getBoundingClientRect();

        // Verify visibility - if rect is all zeros or hidden, hide iframe
        if (
          rect.width === 0 ||
          rect.height === 0 ||
          window.getComputedStyle(activeContainer).display === 'none'
        ) {
          setStyle({ display: 'none' });
          return;
        }

        setStyle({
          position: 'fixed',
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          zIndex: 50, // Ensure it sits on top of the placeholder
          display: 'block',
          backgroundColor: '#1e1e1e', // Match theme to avoid flashes
        });
      });
    };

    updatePosition();

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(activeContainer);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [activeContainer]);

  if (!activeConfig) return null;

  return (
    <div style={style}>
      <iframe
        src={activeConfig.url}
        className='w-full h-full border-0 bg-[#1e1e1e]'
        title='VS Code Editor'
        allow='clipboard-read; clipboard-write'
      />
    </div>
  );
};
