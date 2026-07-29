import type { ReactElement } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { FeatureCard } from './FeatureCard';
import type { GuideCategoryInfo, UserGuideFeature } from '../../routes/UserGuideScreen/features';

interface CategorySectionProps {
  category: GuideCategoryInfo;
  features: UserGuideFeature[];
}

export const CategorySection = ({ category, features }: CategorySectionProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section id={`guide-${category.id}`} className='scroll-mt-6'>
      <motion.div
        initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
        whileInView={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={shouldReduceMotion ? {} : { duration: 0.3, ease: 'easeOut' }}
        className='mb-8 pb-5 border-b border-border'
      >
        <h2 className='text-3xl font-bold text-foreground tracking-tight leading-tight'>
          {category.title}
        </h2>
        <p className='text-base text-muted-foreground mt-2 leading-[1.7]'>{category.description}</p>
      </motion.div>

      <div className='divide-y divide-border'>
        {features.map((feature, index) => (
          <FeatureCard
            key={feature.id}
            title={feature.title}
            tagline={feature.tagline}
            actions={feature.actions}
            steps={feature.steps}
            findIn={feature.findIn}
            visualKey={feature.visualKey}
            featureId={feature.id}
            animationDelay={index * 0.05}
            {...(feature.tip ? { tip: feature.tip } : {})}
            {...(feature.shortcut ? { shortcut: feature.shortcut } : {})}
            {...(feature.videoUrl ? { videoUrl: feature.videoUrl } : {})}
          />
        ))}
      </div>
    </section>
  );
};
