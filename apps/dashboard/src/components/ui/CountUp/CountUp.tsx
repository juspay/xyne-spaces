import { useInView, useMotionValue, useSpring } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef } from 'react';

interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  delay?: number;
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  abbreviate?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

export default function CountUp({
  to,
  from = 0,
  direction = 'up',
  delay = 0,
  duration = 2,
  className = '',
  startWhen = true,
  separator = '',
  abbreviate = true,
  onStart,
  onEnd,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isSettled = useRef(true);
  const motionValue = useMotionValue(direction === 'down' ? to : from);

  const springConfig = useMemo(
    () => ({
      damping: 20 + 40 * (1 / duration),
      stiffness: 100 * (1 / duration),
    }),
    [duration],
  );

  const springValue = useSpring(motionValue, springConfig);

  const isInView = useInView(ref, { once: true, margin: '0px' });

  const getDecimalPlaces = (num: number): number => {
    const str = num.toString();
    if (str.includes('.')) {
      const decimals = str.split('.')[1];
      if (decimals && parseInt(decimals, 10) !== 0) {
        return decimals.length;
      }
    }
    return 0;
  };

  const maxDecimals = Math.max(getDecimalPlaces(from), getDecimalPlaces(to));

  const abbreviateNumber = (num: number, decimals: number, stripTrailingZeros: boolean): string => {
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    const units = ['', 'k', 'M', 'B', 'T', 'P'];
    let value = abs;
    let unitIndex = 0;

    while (value >= 1000 && unitIndex < units.length - 1) {
      value /= 1000;
      unitIndex += 1;
    }

    const formatted =
      unitIndex === 0
        ? value.toFixed(decimals)
        : value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0);

    const result = stripTrailingZeros ? formatted.replace(/\.0+$/, '') : formatted;

    return `${sign}${result}${units[unitIndex]}`;
  };

  const formatValue = useCallback(
    (latest: number) => {
      if (abbreviate) {
        return abbreviateNumber(latest, maxDecimals, isSettled.current);
      }

      const hasDecimals = maxDecimals > 0;

      const options: Intl.NumberFormatOptions = {
        useGrouping: !!separator,
        minimumFractionDigits: hasDecimals ? maxDecimals : 0,
        maximumFractionDigits: hasDecimals ? maxDecimals : 0,
      };

      const formattedNumber = Intl.NumberFormat('en-US', options).format(latest);

      return separator ? formattedNumber.replace(/,/g, separator) : formattedNumber;
    },
    [abbreviate, maxDecimals, separator],
  );

  useEffect(() => {
    if (ref.current) {
      ref.current.textContent = formatValue(direction === 'down' ? to : from);
    }
  }, [from, to, direction, formatValue]);

  useEffect(() => {
    if (isInView && startWhen) {
      if (typeof onStart === 'function') {
        onStart();
      }

      isSettled.current = false;

      const timeoutId = setTimeout(() => {
        motionValue.set(direction === 'down' ? from : to);
      }, delay * 1000);

      const durationTimeoutId = setTimeout(
        () => {
          isSettled.current = true;
          if (ref.current) {
            ref.current.textContent = formatValue(direction === 'down' ? from : to);
          }
          if (typeof onEnd === 'function') {
            onEnd();
          }
        },
        delay * 1000 + duration * 1000,
      );

      return () => {
        clearTimeout(timeoutId);
        clearTimeout(durationTimeoutId);
      };
    }
    return undefined;
  }, [
    isInView,
    startWhen,
    motionValue,
    direction,
    from,
    to,
    delay,
    onStart,
    onEnd,
    duration,
    formatValue,
  ]);

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest: number) => {
      if (ref.current && !isSettled.current) {
        ref.current.textContent = formatValue(latest);
      }
    });

    return () => unsubscribe();
  }, [springValue, formatValue]);

  return <span className={`${className} tabular-nums`} ref={ref} />;
}
