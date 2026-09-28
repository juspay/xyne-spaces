import type { ReactElement } from 'react';

interface SparkleAiProps {
  className?: string;
  size?: number;
  'aria-hidden'?: boolean;
}

/**
 * Xyne's AI mark — the four-point sparkle.
 *
 * Lives here rather than in `@xyne/icons` because that package's `svg/` sources
 * are not in this repo: every file under `src/icons` carries a "do not edit by
 * hand" banner and is regenerated from a manifest we do not have. Hand-adding it
 * there would be undone by the next regen. When the shape reaches the icon
 * pipeline, delete this file and import `SparkleAi` from `@xyne/icons` instead —
 * the props below are deliberately the subset Pika icons expose, so that swap is
 * an import change and nothing else.
 *
 * `currentColor` rather than the #E1E4EA the export carried, so it inherits from
 * whatever it sits in and survives dark mode.
 */
export const SparkleAi = ({
  className,
  size = 20,
  'aria-hidden': ariaHidden = true,
}: SparkleAiProps): ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 20 20'
    fill='none'
    className={className}
    aria-hidden={ariaHidden}
    xmlns='http://www.w3.org/2000/svg'
  >
    <path
      d='M10 0.834961C10.1179 0.835022 10.2139 0.930924 10.2139 1.04883V3.37891C10.2139 6.91766 13.0823 9.78613 16.6211 9.78613H18.9512C19.0691 9.78613 19.165 9.88211 19.165 10C19.165 10.1177 19.0693 10.2139 18.9512 10.2139H16.6211C13.0823 10.2139 10.2139 13.0823 10.2139 16.6211V18.9512C10.2139 19.0689 10.1181 19.165 10 19.165C9.88201 19.165 9.78614 19.069 9.78613 18.9512V16.6211C9.78613 13.0823 6.91766 10.2139 3.37891 10.2139H1.04883C0.93084 10.2139 0.834964 10.1179 0.834961 10C0.835022 9.88197 0.93108 9.78614 1.04883 9.78613H3.37891C6.91766 9.78613 9.78613 6.91766 9.78613 3.37891V1.04883C9.78613 0.930747 9.88221 0.83497 10 0.834961Z'
      stroke='currentColor'
      strokeWidth='1.67'
    />
  </svg>
);

export default SparkleAi;
