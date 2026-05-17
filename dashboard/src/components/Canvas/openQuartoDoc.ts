import type React from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { Canvas } from './Canvas.types';

type QuartoOpenEvent = React.MouseEvent | KeyboardEvent;

export function openQuartoDoc(
  event: QuartoOpenEvent,
  canvas: Pick<Canvas, 'userRepo'>,
  navigate: NavigateFunction,
  isMobile: boolean,
): void {
  if (!canvas.userRepo) {
    return;
  }

  const isCmdClick = 'metaKey' in event && (event.metaKey || event.ctrlKey);
  const docsUrl = `/docs/${canvas.userRepo}`;

  if (!isMobile && isCmdClick) {
    window.open(docsUrl, '_blank');
  } else {
    void navigate(docsUrl);
  }
}
