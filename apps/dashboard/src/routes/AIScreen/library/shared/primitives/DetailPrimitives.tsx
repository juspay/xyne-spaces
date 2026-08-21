import { type ReactElement, type ReactNode } from 'react';
import { InformationCircle, LockClose, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';

export type DetailHeading = 'section' | 'title' | 'subcategory' | 'field';

/** Twin Configuration nested type scale. Library keeps 15px / 450. */
export type DetailTypeScale = 'library' | 'twin';

/**
 * Figma 1604:39993 type + chrome.
 * Field labels 14/500/1.2; body 14/450/20px −0.02em; boxes 16px pad, 16px radius, #fcfcfc, #e8e8e8.
 */
export const DETAIL_TEXT_FIELD_CLASS =
  'dt-details-text-field w-full overflow-hidden rounded-2xl border border-[#e8e8e8] bg-[#fcfcfc] p-4';

export const DETAIL_TEXT_VALUE_CLASS =
  'whitespace-pre-wrap break-words text-[14px] font-[450] leading-5 tracking-[-0.28px] text-foreground';

/** Twin Configuration hairline — compact controls, not gray fill surfaces. */
export const TWIN_STROKE_CLASS = 'border-[0.8px] border-solid border-foreground/10';

/** Twin / Xyne AI settings gray fill on white — containers, wells, Overview chips. */
export const TWIN_SURFACE_FILL_CLASS = 'bg-[#f7f7f7]';

/** Dropdown / compact control on a setting row (hug width, 12px radius, 15/450/1.2). */
export const DETAIL_CONTROL_CLASS =
  'flex h-9 w-auto min-w-0 shrink-0 items-center gap-3 rounded-xl border border-foreground/10 bg-white py-2 pl-3 pr-2 text-[15px] font-[450] leading-[1.2] text-foreground shadow-none';

export const DETAIL_CONTROL_CLASS_FOR: Record<DetailTypeScale, string> = {
  library: DETAIL_CONTROL_CLASS,
  twin: cn(DETAIL_CONTROL_CLASS, TWIN_STROKE_CLASS, 'bg-card'),
};

export const DETAIL_SELECT_TRIGGER_CLASS = cn(
  DETAIL_CONTROL_CLASS,
  'justify-between [&_svg]:size-5 [&_svg]:opacity-100 [&_svg]:text-foreground',
);

export const DETAIL_SELECT_TRIGGER_CLASS_FOR: Record<DetailTypeScale, string> = {
  library: DETAIL_SELECT_TRIGGER_CLASS,
  twin: cn(DETAIL_SELECT_TRIGGER_CLASS, TWIN_STROKE_CLASS, 'bg-card'),
};

export const DETAIL_TEXT_FIELD_CLASS_FOR: Record<DetailTypeScale, string> = {
  library: DETAIL_TEXT_FIELD_CLASS,
  twin: cn(
    'dt-details-text-field w-full overflow-hidden rounded-2xl bg-muted p-4',
    TWIN_STROKE_CLASS,
  ),
};

const HEADING_CLASS: Record<DetailHeading, string> = {
  section: 'text-[20px] font-semibold leading-[1.2] tracking-[-0.2px] text-foreground',
  title: 'text-[16px] font-semibold leading-[1.2] tracking-[-0.2px] text-foreground',
  subcategory: 'text-[14px] font-[450] leading-[1.35] text-foreground/60',
  field: 'text-[14px] font-medium leading-[1.2] text-foreground',
};

/** Twin Configuration section titles — 14px semibold, same leading/tracking as `title`. */
const TWIN_TITLE_CLASS =
  'text-[14px] font-semibold leading-[1.2] tracking-[-0.2px] text-foreground';

/**
 * Xyne AI settings Configuration titles (AI Providers, Agent Model Assignment,
 * Model, Credentials, Behaviour, Tools and Knowledge, People).
 * Local 16px override — Library agent-detail titles keep default heading classes.
 */
export const TWIN_SETTINGS_TITLE_CLASS = HEADING_CLASS.title;

/** Twin nested group labels (Verification, …) and hints: 14px Inter normal. */
const TWIN_SUBCATEGORY_CLASS = 'text-[14px] font-normal leading-[1.35] text-foreground/60';

export const DETAIL_NESTED_TITLE_CLASS: Record<DetailTypeScale, string> = {
  library: 'text-[15px] font-medium leading-[1.2] text-foreground',
  twin: HEADING_CLASS.field,
};

export const DETAIL_NESTED_HINT_CLASS: Record<DetailTypeScale, string> = {
  library: 'text-[15px] font-[450] leading-[1.35] text-foreground/60',
  twin: TWIN_SUBCATEGORY_CLASS,
};

export function nestedDetailHeading(typeScale: DetailTypeScale): DetailHeading {
  return typeScale === 'twin' ? 'field' : 'subcategory';
}

const SECTION_GAP: Record<DetailHeading, string> = {
  section: 'gap-6',
  title: 'gap-6',
  subcategory: 'gap-3',
  field: 'gap-3',
};

/** Twin nested subcategory: 8px heading-to-content. Library keeps `SECTION_GAP.subcategory`. */
const TWIN_SUBCATEGORY_GAP = 'gap-2';

export function DetailSectionHeading({
  label,
  info,
  trailing,
  trailingAlign = 'inline',
  heading = 'subcategory',
  typeScale = 'library',
  headingClassName,
}: {
  label: string;
  info?: string;
  trailing?: ReactNode;
  trailingAlign?: 'inline' | 'end';
  heading?: DetailHeading;
  typeScale?: DetailTypeScale;
  headingClassName?: string;
}): ReactElement {
  const headingClass =
    typeScale === 'twin' && heading === 'title'
      ? TWIN_TITLE_CLASS
      : typeScale === 'twin' && heading === 'subcategory'
        ? TWIN_SUBCATEGORY_CLASS
        : HEADING_CLASS[heading];
  return (
    <div className='flex w-full items-center gap-1.5'>
      <span className={cn('inline-flex items-center gap-1.5', headingClass, headingClassName)}>
        {label}
        {info && (
          <Tooltip side='top' content={info}>
            <span className='inline-flex'>
              <InformationCircle className='size-4 shrink-0' aria-hidden />
            </span>
          </Tooltip>
        )}
      </span>
      {trailing && (
        <span className={cn('flex shrink-0 items-center', trailingAlign === 'end' && 'ml-auto')}>
          {trailing}
        </span>
      )}
    </div>
  );
}

export function DetailCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cn('w-full rounded-2xl border border-border bg-card', className)}>
      {children}
    </div>
  );
}

/** Grouped setting rows — fill only, no stroke. Library #fafafa; Twin settings #f7f7f7. */
export function DetailGroup({
  className,
  typeScale = 'library',
  children,
}: {
  className?: string;
  typeScale?: DetailTypeScale;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-6 rounded-2xl p-4',
        typeScale === 'twin' ? TWIN_SURFACE_FILL_CLASS : 'bg-[#fafafa]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DetailStack({
  gap = 'category',
  className,
  children,
}: {
  gap?: 'page' | 'category';
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cn('flex w-full flex-col', gap === 'page' ? 'gap-12' : 'gap-6', className)}>
      {children}
    </div>
  );
}

export function DetailSection({
  label,
  info,
  trailing,
  trailingAlign,
  heading = 'subcategory',
  typeScale = 'library',
  headingClassName,
  className,
  children,
}: {
  label: string;
  info?: string;
  trailing?: ReactNode;
  trailingAlign?: 'inline' | 'end';
  heading?: DetailHeading;
  typeScale?: DetailTypeScale;
  headingClassName?: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const gap =
    heading === 'subcategory' && typeScale === 'twin' ? TWIN_SUBCATEGORY_GAP : SECTION_GAP[heading];
  return (
    <section className={cn('flex w-full flex-col', gap, className)}>
      <DetailSectionHeading
        label={label}
        heading={heading}
        typeScale={typeScale}
        {...(info === undefined ? {} : { info })}
        {...(trailing === undefined ? {} : { trailing })}
        {...(trailingAlign === undefined ? {} : { trailingAlign })}
        {...(headingClassName === undefined ? {} : { headingClassName })}
      />
      {children}
    </section>
  );
}

export function DetailTextField({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactElement {
  return <div className={cn(DETAIL_TEXT_FIELD_CLASS, className)}>{children}</div>;
}

export function DetailRow({
  title,
  hint,
  children,
  last = false,
  variant = 'plain',
  typeScale = 'library',
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
  last?: boolean;
  variant?: 'divided' | 'plain';
  typeScale?: DetailTypeScale;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex w-full items-center gap-8',
        variant === 'divided' && 'py-3',
        variant === 'divided' && !last && 'border-b border-border',
      )}
    >
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <span className={DETAIL_NESTED_TITLE_CLASS[typeScale]}>{title}</span>
        {hint && <span className={DETAIL_NESTED_HINT_CLASS[typeScale]}>{hint}</span>}
      </div>
      {children && <div className='flex shrink-0 items-center gap-2'>{children}</div>}
    </div>
  );
}

export function DetailProse({
  children,
  className,
}: {
  children: string;
  className?: string;
}): ReactElement {
  return <p className={cn(DETAIL_TEXT_VALUE_CLASS, className)}>{children}</p>;
}

export function DetailEmpty({
  children,
  className,
  typeScale = 'library',
}: {
  children: ReactNode;
  className?: string;
  typeScale?: DetailTypeScale;
}): ReactElement {
  return (
    <p
      className={cn(
        'text-sm leading-5 text-muted-foreground',
        typeScale === 'twin' ? 'font-normal' : 'font-[450]',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function ManageButton({
  label,
  onClick,
  trackName = 'Agent detail v2: manage',
}: {
  label: string;
  onClick: () => void;
  trackName?: string;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
    >
      <PlusDefault className='size-4' aria-hidden />
    </button>
  );
}

/**
 * Centred empty state for a whole card — an icon, a headline, a line of
 * explanation, and an optional call to action.
 */
export function DetailEmptyState({
  icon,
  title,
  description,
  action,
  typeScale = 'library',
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  typeScale?: DetailTypeScale;
}): ReactElement {
  return (
    <div className='flex w-full flex-col items-center justify-center gap-4 p-8 text-center'>
      <span
        className='flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground'
        aria-hidden
      >
        {icon}
      </span>
      <span className='flex flex-col gap-1.5'>
        <span className={DETAIL_NESTED_TITLE_CLASS[typeScale]}>{title}</span>
        <span className={DETAIL_NESTED_HINT_CLASS[typeScale]}>{description}</span>
      </span>
      {action}
    </div>
  );
}

export function DetailTabPlaceholder({ label }: { label: string }): ReactElement {
  return (
    <div className='flex w-full flex-col gap-3'>
      <DetailSectionHeading label={label} />
      <DetailEmpty>Coming next.</DetailEmpty>
    </div>
  );
}

export function ReadOnlyBadge(): ReactElement {
  return (
    <span className='flex h-4 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[10px] font-medium leading-4 tracking-[0.02em] text-muted-foreground'>
      <LockClose className='size-2.5 shrink-0' aria-hidden />
      Read only
    </span>
  );
}

export function DetailLockedNote({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className='flex w-full items-center gap-2'>
      <LockClose className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
      <span className='text-xs font-[450] leading-4 tracking-[-0.24px] text-muted-foreground'>
        {children}
      </span>
    </div>
  );
}

export function DetailValue({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className='max-w-[280px] truncate text-[15px] font-[450] leading-[1.2] text-foreground'>
      {children}
    </span>
  );
}
