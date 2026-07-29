import { useEffect, useState } from 'react';

export const useWindowWidth = (): number => {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = (): void => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return (): void => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return windowWidth;
};
