import { ReactElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { ThemeProvider } from '@juspay/blend-design-system';
import { cn } from '../../utils/classNames';

/* ------------------------------------------------------------------ */
/* Content model — shared by legal document screens (Terms, Privacy).  */
/* ------------------------------------------------------------------ */

export type LegalBlock =
  | { kind: 'paragraph'; number?: string; lead?: string; text: ReactNode }
  | { kind: 'list'; items: ReactNode[] };

export interface LegalSection {
  id: string;
  number: string;
  title: string;
  blocks: LegalBlock[];
}

interface LegalDocumentScreenProps {
  title: string;
  lastUpdated: string;
  intro: ReactNode;
  sections: LegalSection[];
  /** Optional boxed notice rendered directly under the header rules. */
  notice?: ReactNode;
  /** Optional block rendered after all sections (e.g. contact card). */
  appendix?: ReactNode;
  /** The other legal document, cross-linked from the top bar and footer. */
  siblingLink: { label: string; to: string };
}

const LIST_MARKERS = [
  '(a)',
  '(b)',
  '(c)',
  '(d)',
  '(e)',
  '(f)',
  '(g)',
  '(h)',
  '(i)',
  '(j)',
] as const;

/**
 * Classic editorial layout for legal documents — serif headings, numbered
 * sections with hanging indents, dotted-leader contents, and a quiet
 * scroll-reveal. Uses the app's Blend tokens so it matches the auth flow
 * in both light and dark themes.
 */
export const LegalDocumentScreen = ({
  title,
  lastUpdated,
  intro,
  sections,
  notice,
  appendix,
  siblingLink,
}: LegalDocumentScreenProps): ReactElement => {
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id;
          setRevealedIds(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
          observer.unobserve(entry.target);
        });
      },
      { root, rootMargin: '0px 0px -6% 0px', threshold: 0.05 },
    );

    targets.forEach(target => observer.observe(target));
    return (): void => observer.disconnect();
  }, []);

  const revealClass = (id: string): string =>
    cn(
      'transition-all duration-700 ease-out',
      revealedIds.has(id) ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
    );

  const scrollToTop = (): void => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <ThemeProvider>
      <div
        ref={scrollRef}
        className='relative h-[100dvh] w-full overflow-y-auto scroll-smooth bg-background'
      >
        {/* Section-sign watermark — the classic legal mark, laid faintly beside the text */}
        <span
          aria-hidden='true'
          className='pointer-events-none absolute -right-10 top-44 hidden select-none font-serif text-[340px] leading-none text-foreground opacity-[0.04] lg:block'
        >
          &sect;
        </span>

        {/* Top bar */}
        <header className='sticky top-0 z-40 border-b border-border bg-background'>
          <div className='mx-auto flex h-16 w-full max-w-[860px] items-center justify-between px-6 sm:px-10'>
            <Link
              to='/auth'
              aria-label='Back to Xyne Spaces'
              data-track-category='Legal'
              data-track-name='LegalDocumentLogo'
            >
              <img src='/svgs/xyne.svg' alt='Xyne' className='h-[22px] w-auto' />
            </Link>
            <div className='flex items-center gap-4'>
              <span className='text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground'>
                Legal
              </span>
              <span className='h-4 w-px bg-border' />
              <Link
                to={siblingLink.to}
                className='text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground'
                data-track-category='Legal'
                data-track-name='LegalDocumentSiblingNav'
              >
                {siblingLink.label}
              </Link>
            </div>
          </div>
        </header>

        <main className='relative mx-auto w-full max-w-[760px] px-6 pb-24 sm:px-10'>
          {/* Document header */}
          <div id='legal-hero' data-reveal className={revealClass('legal-hero')}>
            <p className='pt-14 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground sm:pt-16'>
              Legal
            </p>
            <h1 className='mt-4 font-serif text-[38px] font-bold leading-[1.12] text-foreground sm:text-[46px]'>
              {title}
            </h1>
            <p className='mt-4 font-serif text-sm italic text-muted-foreground'>
              Last updated {lastUpdated}
            </p>
            {/* Double rule — the classic imprint of a printed contract */}
            <div className='mt-8 border-t-2 border-foreground' />
            <div className='mt-[3px] border-t border-border' />
          </div>

          {/* Notice */}
          {notice ? (
            <div id='legal-notice' data-reveal className={cn('mt-10', revealClass('legal-notice'))}>
              <div className='rounded-lg border border-border bg-card p-5 sm:p-6'>{notice}</div>
            </div>
          ) : null}

          {/* Introduction */}
          <p
            id='legal-intro'
            data-reveal
            className={cn(
              'mt-8 text-[15px] leading-[1.8] text-foreground',
              revealClass('legal-intro'),
            )}
          >
            {intro}
          </p>

          {/* Contents */}
          <nav
            id='legal-contents'
            data-reveal
            className={cn('mt-12', revealClass('legal-contents'))}
            aria-label='Table of contents'
          >
            <p className='text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground'>
              Contents
            </p>
            <ol className='mt-5 grid grid-cols-1 gap-x-12 sm:grid-cols-2'>
              {sections.map(section => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className='group flex items-baseline gap-3 py-1.5'
                    data-track-category='Legal'
                    data-track-name='LegalDocumentContentsLink'
                    data-track-metadata={JSON.stringify({ sectionId: section.id })}
                  >
                    <span className='w-5 shrink-0 text-right font-serif text-[13px] text-muted-foreground'>
                      {section.number}.
                    </span>
                    <span className='text-[13.5px] font-medium text-foreground transition-colors group-hover:text-primary'>
                      {section.title}
                    </span>
                    <span className='flex-1 -translate-y-[3px] border-b border-dotted border-border transition-colors group-hover:border-foreground' />
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Sections */}
          <div className='mt-6'>
            {sections.map(section => (
              <section
                key={section.id}
                id={section.id}
                data-reveal
                className={cn('scroll-mt-28 pt-12', revealClass(section.id))}
              >
                <div className='flex items-baseline gap-4 border-b border-border pb-3.5'>
                  <span className='w-7 shrink-0 text-right font-serif text-[15px] text-muted-foreground'>
                    {section.number}.
                  </span>
                  <h2 className='font-serif text-[21px] font-bold leading-snug text-foreground sm:text-[23px]'>
                    {section.title}
                  </h2>
                </div>

                <div className='mt-5 flex flex-col gap-4'>
                  {section.blocks.map((block, blockIndex) =>
                    block.kind === 'paragraph' ? (
                      <div key={blockIndex} className='flex gap-4'>
                        <span className='w-9 shrink-0 pt-[3px] text-right font-serif text-[13px] leading-[1.8] text-muted-foreground'>
                          {block.number}
                        </span>
                        <p className='flex-1 text-[15px] leading-[1.8] text-foreground'>
                          {block.lead ? (
                            <strong className='font-semibold'>{block.lead} </strong>
                          ) : null}
                          {block.text}
                        </p>
                      </div>
                    ) : (
                      <div key={blockIndex} className='flex gap-4'>
                        <span className='w-9 shrink-0' />
                        <ul className='flex flex-1 flex-col gap-2.5'>
                          {block.items.map((item, itemIndex) => (
                            <li key={itemIndex} className='flex gap-3'>
                              <span className='shrink-0 pt-[2px] font-serif text-[13px] text-muted-foreground'>
                                {LIST_MARKERS[itemIndex]}
                              </span>
                              <span className='flex-1 text-[15px] leading-[1.8] text-foreground'>
                                {item}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>

          {/* Appendix */}
          {appendix ? (
            <div
              id='legal-appendix'
              data-reveal
              className={cn('mt-12', revealClass('legal-appendix'))}
            >
              {appendix}
            </div>
          ) : null}

          {/* Footer */}
          <footer
            id='legal-footer'
            data-reveal
            className={cn('mt-20 border-t border-border pt-8', revealClass('legal-footer'))}
          >
            <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
              <p className='font-serif text-[13px] italic text-muted-foreground'>
                &copy; {new Date().getFullYear()} Xyne Spaces. All rights reserved.
              </p>
              <div className='flex items-center gap-6'>
                <Link
                  to={siblingLink.to}
                  className='text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground'
                  data-track-category='Legal'
                  data-track-name='LegalDocumentFooterSibling'
                >
                  {siblingLink.label}
                </Link>
                <button
                  type='button'
                  onClick={scrollToTop}
                  className='flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground'
                  data-track-category='Legal'
                  data-track-name='LegalDocumentBackToTop'
                >
                  Back to top
                  <ArrowUp className='h-3.5 w-3.5' />
                </button>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </ThemeProvider>
  );
};
