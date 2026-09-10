import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Search } from 'lucide-react';
import { GUIDE_CATEGORIES, USER_GUIDE_FEATURES } from './features';
import { CategorySection } from '../../components/UserGuide/CategorySection';
import { TableOfContents } from '../../components/UserGuide/TableOfContents';
import { usePlatform } from '../../hooks/usePlatform';

const UserGuideScreen = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string>('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const contentRef = useRef<HTMLElement>(null);

  const scrollToSection = (id: string): void => {
    const el = contentRef.current;
    const target = document.getElementById(id);
    if (!el || !target) return;
    const containerTop = el.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    el.scrollTo({ top: targetTop - containerTop + el.scrollTop - 24, behavior: 'smooth' });
  };

  const normalizedQuery = query.trim().toLowerCase();

  const filteredFeatures = useMemo(() => {
    if (!normalizedQuery) return USER_GUIDE_FEATURES;

    return USER_GUIDE_FEATURES.filter(feature => {
      return [
        feature.title,
        feature.tagline,
        feature.findIn,
        feature.actions.join(' '),
        feature.keywords.join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  const grouped = useMemo(() => {
    return GUIDE_CATEGORIES.map(category => ({
      category,
      features: filteredFeatures.filter(feature => feature.category === category.id),
    })).filter(section => section.features.length > 0);
  }, [filteredFeatures]);

  // Track active section via IntersectionObserver
  useEffect(() => {
    const scrollContainer = contentRef.current;
    if (!scrollContainer) return;

    const targets = scrollContainer.querySelectorAll('[id^="guide-"]');
    if (targets.length === 0) return;

    // Set first section active by default
    const firstId = targets[0]!.id.replace('guide-', '');
    setActiveSection(firstId);

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        setActiveSection(topmost.target.id.replace('guide-', ''));
      },
      {
        root: scrollContainer,
        threshold: 0.1,
        rootMargin: '-80px 0px -55% 0px',
      },
    );

    targets.forEach(t => observer.observe(t));
    return () => observer.disconnect();
  }, [grouped]);

  // Track scroll position for back-to-top button
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = (): void => setShowBackToTop(el.scrollTop > 300);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const totalFeatures = USER_GUIDE_FEATURES.length;
  const { isMac } = usePlatform();
  const shortcutLabel = isMac ? '⌘⇧/' : 'Ctrl+Shift+/';

  return (
    <main
      ref={contentRef}
      className='h-full w-full no-scrollbar overflow-auto bg-background md:rounded-2xl shadow-md'
    >
      {/* ── Centered page wrapper ── */}
      <div className='mx-auto w-full max-w-[1100px] px-6 lg:px-12 pt-12 lg:pt-14 pb-20'>
        {/* ── Page header ── */}
        <header className='max-w-[600px] mb-10'>
          <p className='text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60 font-bold'>
            Xyne Spaces Guide
          </p>
          <div className='flex items-baseline gap-3 mt-2'>
            <h1 className='text-[32px] lg:text-[40px] font-extrabold text-foreground leading-[1.1] tracking-[-0.022em] whitespace-nowrap'>
              Learn Xyne Spaces quickly
            </h1>
            <span className='text-xs font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-full shrink-0'>
              {totalFeatures} features
            </span>
          </div>
          <p className='text-md lg:text-[15px] text-muted-foreground mt-3 leading-[1.7] whitespace-nowrap'>
            Reference for every feature. Pick a section, open the feature, and follow along step by
            step.
          </p>
          <div className='mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/60 text-sm text-muted-foreground'>
            <BookOpen size={13} className='shrink-0 text-foreground/50' />
            <span>Keyboard Shortcuts</span>
            <kbd className='inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[12px] text-foreground font-semibold shadow-sm'>
              {shortcutLabel}
            </kbd>
          </div>

          <label className='mt-5 block'>
            <span className='sr-only'>Search features</span>
            <div className='relative'>
              <Search
                size={15}
                className='absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground'
              />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Try 'create ticket' or 'Xyne AI'"
                data-track-category='USER_GUIDE'
                data-track-name='SEARCH_FEATURES'
                className='w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-3.5 text-base text-foreground outline-none focus:ring-2 focus:ring-primary/35 placeholder:text-muted-foreground/55'
              />
            </div>
          </label>
          <div role='status' aria-live='polite' className='sr-only'>
            {normalizedQuery
              ? filteredFeatures.length === 0
                ? `No results for "${query}"`
                : `${filteredFeatures.length} result${filteredFeatures.length === 1 ? '' : 's'} found`
              : ''}
          </div>
        </header>

        {/* ── Main content ── */}
        {grouped.length === 0 ? (
          <div className='py-16 flex flex-col items-center gap-4 text-center'>
            <p className='text-base text-foreground font-medium'>
              No results for &quot;{query}&quot;
            </p>
            <p className='text-base text-muted-foreground'>Try one of these instead:</p>
            <div className='flex flex-wrap justify-center gap-2'>
              {['create ticket', 'Xyne AI', 'channels', 'thread panel', 'analytics'].map(
                suggestion => (
                  <button
                    key={suggestion}
                    type='button'
                    onClick={() => setQuery(suggestion)}
                    data-track-category='USER_GUIDE'
                    data-track-name='SEARCH_SUGGESTION'
                    className='text-sm px-3 py-1.5 rounded-lg border border-border bg-muted hover:bg-muted/80 text-foreground transition-colors'
                  >
                    {suggestion}
                  </button>
                ),
              )}
            </div>
            <button
              type='button'
              onClick={() => setQuery('')}
              data-track-category='USER_GUIDE'
              data-track-name='CLEAR_SEARCH'
              className='text-sm text-primary hover:underline mt-1'
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {/* ── Mobile section jump (hidden on lg+) ── */}
            <div className='lg:hidden mb-6'>
              <label htmlFor='mobile-section-jump' className='sr-only'>
                Jump to section
              </label>
              <select
                id='mobile-section-jump'
                value={activeSection}
                onChange={e => scrollToSection(`guide-${e.target.value}`)}
                data-track-category='USER_GUIDE'
                data-track-name='JUMP_TO_SECTION'
                className='w-full rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground focus:ring-2 focus:ring-primary/35 outline-none'
              >
                {grouped.map(({ category }) => (
                  <option key={category.id} value={category.id}>
                    {category.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Docs-style: sticky TOC left | content right */}
            <div className='grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-10 lg:gap-16 items-start'>
              <TableOfContents
                categories={grouped.map(section => ({
                  category: section.category,
                  count: section.features.length,
                  features: section.features.map(f => ({ id: f.id, title: f.title })),
                }))}
                activeSection={activeSection}
              />
              {/* Content column — constrained for comfortable reading */}
              <div className='min-w-0 max-w-[720px] space-y-16'>
                {grouped.map(section => (
                  <CategorySection
                    key={section.category.id}
                    category={section.category}
                    features={section.features}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Back to top ── */}
      {showBackToTop && (
        <button
          type='button'
          onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          data-track-category='USER_GUIDE'
          data-track-name='BACK_TO_TOP'
          className='fixed bottom-6 right-6 z-50 flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-opacity'
          aria-label='Back to top'
        >
          <ArrowUp size={16} />
        </button>
      )}
    </main>
  );
};

export default UserGuideScreen;
