import type { ReactElement } from 'react';
import type { GuideCategoryInfo } from '../../routes/UserGuideScreen/features';

interface TableOfContentsCategoryEntry {
  category: GuideCategoryInfo;
  count: number;
  features: Array<{ id: string; title: string }>;
}

interface TableOfContentsProps {
  categories: TableOfContentsCategoryEntry[];
  activeSection?: string;
}

const scrollToSection = (id: string): void => {
  const target = document.getElementById(id);
  if (!target) return;

  // Walk up the DOM to find the scrollable container
  let container: HTMLElement | null = target.parentElement;
  while (container && container !== document.body) {
    const { overflowY } = window.getComputedStyle(container);
    if (overflowY === 'auto' || overflowY === 'scroll') break;
    container = container.parentElement;
  }

  if (container && container !== document.body) {
    const containerTop = container.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    const offset = targetTop - containerTop + container.scrollTop - 24;
    container.scrollTo({ top: offset, behavior: 'smooth' });
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

export const TableOfContents = ({
  categories,
  activeSection,
}: TableOfContentsProps): ReactElement => {
  const activeFeatureId = activeSection?.startsWith('feature-')
    ? activeSection.replace('feature-', '')
    : null;

  return (
    <aside className='sticky top-8 hidden lg:block h-[calc(100vh-4rem)] overflow-y-auto no-scrollbar pb-8 pr-1'>
      <p className='text-[11px] font-bold text-muted-foreground/55 uppercase tracking-[0.16em] mb-3 px-2.5'>
        Contents
      </p>
      <nav className='flex flex-col gap-0.5'>
        {categories.map(({ category, count, features }) => {
          const isCategoryActive =
            activeSection === category.id ||
            (activeFeatureId !== null && features.some(f => f.id === activeFeatureId));

          return (
            <div key={category.id}>
              {/* Category row — styled as a section label, not a peer of features */}
              <button
                type='button'
                onClick={() => scrollToSection(`guide-${category.id}`)}
                data-track-category='USER_GUIDE'
                data-track-name='JUMP_TO_CATEGORY'
                className={`w-full flex items-center gap-1.5 pt-3 pb-1 px-2.5 rounded-sm text-[11px] font-bold uppercase tracking-[0.12em] transition-colors duration-150 text-left ${
                  isCategoryActive
                    ? 'text-foreground'
                    : 'text-foreground/55 hover:text-foreground/80'
                }`}
              >
                <span className='flex-1 truncate'>{category.title}</span>
                <span
                  className={`tabular-nums shrink-0 ${isCategoryActive ? 'text-muted-foreground/60' : 'text-foreground/40'}`}
                >
                  {count}
                </span>
              </button>

              {/* Feature sub-items */}
              <div className='ml-2.5 border-l border-border pl-2.5 mb-1 flex flex-col gap-0'>
                {features.map(feature => {
                  const isFeatureActive = activeFeatureId === feature.id;
                  return (
                    <button
                      key={feature.id}
                      type='button'
                      onClick={() => scrollToSection(`guide-feature-${feature.id}`)}
                      data-track-category='USER_GUIDE'
                      data-track-name='JUMP_TO_FEATURE'
                      className={`w-full text-left py-1 px-2 rounded text-[12px] transition-colors duration-100 truncate ${
                        isFeatureActive
                          ? 'text-foreground font-medium bg-primary/[0.06]'
                          : 'text-foreground/60 hover:text-foreground hover:bg-muted/50'
                      }`}
                    >
                      {feature.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};
