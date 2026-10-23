import { useState, type ImgHTMLAttributes, type ReactElement } from "react";
import type { Components } from "react-markdown";
import { frontendConfig } from "./config";

/**
 * Where an image in model-written markdown may load from on its own. Same
 * rule as the dashboard's markdownImageGuard: anything the browser fetches
 * automatically is an exfiltration channel, so an answer may auto-load images
 * only from this app, its APIs, the hosts an admin listed, and inline data.
 */
export interface AnswerImagePolicy {
  pageOrigin: string;
  allowedOrigins: ReadonlySet<string>;
  /** Hostnames that may serve images; a leading `*.` also matches subdomains. */
  allowedHosts: readonly string[];
}

const hostMatches = (host: string, pattern: string): boolean => {
  if (pattern.startsWith("*.")) {
    const bare = pattern.slice(2);
    return host === bare || host.endsWith(`.${bare}`);
  }
  return host === pattern;
};

export const isAllowedAnswerImageSrc = (src: string | undefined, policy: AnswerImagePolicy): boolean => {
  const trimmed = src?.trim();
  if (!trimmed) return false;
  if (/^(data|blob):/i.test(trimmed)) return true;
  let url: URL;
  try {
    url = new URL(trimmed, policy.pageOrigin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin === policy.pageOrigin || policy.allowedOrigins.has(url.origin)) return true;
  const host = url.hostname.toLowerCase();
  return policy.allowedHosts.some((pattern) => hostMatches(host, pattern.toLowerCase()));
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

const getAnswerImagePolicy = (): AnswerImagePolicy => {
  if (cachedPolicy) return cachedPolicy;
  const pageOrigin = window.location.origin;
  const allowedOrigins = new Set<string>();
  for (const value of [
    frontendConfig.spacesAuthBaseUrl,
    frontendConfig.clawApiBaseUrl,
    import.meta.env.VITE_SPACES_APP_URL as string | undefined,
    import.meta.env.VITE_XYNE_BACKEND_URL as string | undefined,
    import.meta.env.VITE_AUTH_API_URL as string | undefined,
  ]) {
    const origin = originOf(value, pageOrigin);
    if (origin) allowedOrigins.add(origin);
  }
  const allowedHosts = ((import.meta.env.VITE_ANSWER_IMAGE_HOSTS as string | undefined) ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  cachedPolicy = { pageOrigin, allowedOrigins, allowedHosts };
  return cachedPolicy;
};

const hostOf = (src: string | undefined): string => {
  try {
    return new URL(src ?? "").hostname || "an unknown source";
  } catch {
    return "an unknown source";
  }
};

type GuardedMarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

/** The `img` override for every markdown surface that shows model output. */
export function GuardedMarkdownImage({ node: _node, ...props }: GuardedMarkdownImageProps): ReactElement {
  const [loadAnyway, setLoadAnyway] = useState(false);
  if (loadAnyway || isAllowedAnswerImageSrc(props.src, getAnswerImagePolicy())) {
    return <img {...props} alt={props.alt ?? ""} loading="lazy" />;
  }
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-1 text-[11px] text-xyne-fg-muted">
      <span className="truncate">Image from {hostOf(props.src)} not loaded</span>
      <button
        type="button"
        className="shrink-0 font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary"
        onClick={() => setLoadAnyway(true)}
      >
        Load
      </button>
    </span>
  );
}

/** For surfaces whose only override is the image guard. */
export const GUARDED_IMAGE_COMPONENTS: Components = {
  img: (props) => <GuardedMarkdownImage {...props} />,
};
