import type { ReactElement } from 'react';
import { Lightbulb, PlayCircle } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { StepGuide, parseStep } from './StepPlayer';

interface FeatureCardProps {
  title: string;
  tagline: string;
  shortcut?: string;
  actions: string[];
  steps: string[];
  tip?: string;
  findIn: string;
  visualKey: string;
  featureId: string;
  videoUrl?: string;
  animationDelay?: number;
}

export const FeatureCard = ({
  title,
  tagline,
  shortcut,
  steps,
  tip,
  findIn,
  featureId,
  videoUrl,
  animationDelay = 0,
}: FeatureCardProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();

  const breadcrumbs = findIn.split('->').map(s => s.trim());

  return (
    <motion.article
      id={`guide-feature-${featureId}`}
      initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 14 }}
      whileInView={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-48px' }}
      transition={
        shouldReduceMotion ? {} : { duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: animationDelay }
      }
      className='py-6 first:pt-2'
    >
      {/* Title row */}
      <div className='flex items-start justify-between gap-4 mb-1.5'>
        <div className='flex items-center min-w-0'>
          <h3 className='text-xl font-semibold text-foreground leading-snug tracking-tight'>
            {title}
          </h3>
        </div>
        {shortcut && (
          <kbd className='text-xs px-1.5 py-0.5 rounded border border-border bg-muted/60 text-muted-foreground shrink-0 mt-1'>
            {shortcut}
          </kbd>
        )}
      </div>

      {/* Tagline */}
      <p className='text-base text-muted-foreground mb-2 leading-[1.7]'>{tagline}</p>

      {/* Find in path */}
      <div className='flex items-center gap-1 mb-3.5'>
        {breadcrumbs.map((crumb, i) => (
          <span
            key={i}
            className='flex items-center gap-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider'
          >
            {i > 0 && (
              <span
                aria-hidden='true'
                className='text-muted-foreground/35 normal-case tracking-normal'
              >
                ›
              </span>
            )}
            <span>{crumb}</span>
          </span>
        ))}
      </div>

      {/* Watch video — opens walkthrough in a new tab */}
      {videoUrl && (
        <a
          href={videoUrl}
          target='_blank'
          rel='noopener noreferrer'
          data-track-category='USER_GUIDE'
          data-track-name='Watch_Video'
          data-track-metadata={JSON.stringify({ featureId })}
          className='mb-3.5 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted'
        >
          <PlayCircle size={16} className='text-primary' />
          Watch video
        </a>
      )}

      {/* Steps */}
      {steps.length > 0 && <StepGuide steps={steps} />}

      {/* Tip */}
      {tip && (
        <div className='mt-4 flex items-start gap-3 rounded-lg bg-muted/60 px-3.5 py-3'>
          <Lightbulb size={14} className='text-amber-500 shrink-0 mt-[3px]' />
          <p className='text-sm text-foreground/80 leading-[1.7]'>
            <span className='font-semibold text-foreground'>Tip: </span>
            {parseStep(tip)}
          </p>
        </div>
      )}
    </motion.article>
  );
};
