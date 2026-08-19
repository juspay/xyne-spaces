import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

type TextShimmerProps = {
  children: string;
  as?: React.ElementType;
  className?: string;
  duration?: number;
  spread?: number;
  glassEffect?: boolean;
};

function TextShimmerComponent({
  children,
  as: Component = 'p',
  className = '',
  duration = 2,
  spread = 2,
  glassEffect = true,
}: TextShimmerProps) {
  const MotionComponent = motion(Component);

  const dynamicSpread = useMemo(() => {
    return Math.min(children.length * spread, 200);
  }, [children, spread]);

  const baseClasses = glassEffect
    ? `relative inline-block
       backdrop-blur-xl bg-background/0 
       border border-foreground/20
       shadow-[0_8px_32px_0_hsl(var(--foreground)/0.1)]
       before:absolute before:inset-0 before:rounded-2xl
       before:bg-gradient-to-br before:from-foreground/60 before:to-transparent
       before:opacity-50 before:pointer-events-none
       after:absolute after:inset-0 after:rounded-2xl
       after:bg-gradient-to-tr after:from-transparent after:via-foreground/10 after:to-transparent
       after:opacity-30 after:pointer-events-none`
    : 'relative inline-block';

  const textClasses = `bg-[length:250%_100%,auto] bg-clip-text
    text-transparent shimmer-text-gradient
    [background-repeat:no-repeat,padding-box]`;

  return (
    <MotionComponent
      className={`${baseClasses} ${textClasses} ${className}`}
      initial={{ backgroundPosition: '100% center' }}
      animate={{ backgroundPosition: '0% center' }}
      transition={{
        repeat: Infinity,
        duration,
        ease: 'linear',
      }}
      style={{
        '--spread': `${dynamicSpread}px`,
        backgroundImage: `linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--base-gradient-color), transparent calc(50% + var(--spread))), linear-gradient(var(--base-color), var(--base-color))`,
      }}
    >
      {children}
    </MotionComponent>
  );
}

export const TextShimmer = React.memo(TextShimmerComponent);
