export const IFRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups';

const SANDBOX_PREVIEW_PATH = /^\/claw-(preview|code)\//;

export function iframeSandboxFor(url: string): string {
  try {
    const { pathname } = new URL(url, window.location.origin);
    return SANDBOX_PREVIEW_PATH.test(pathname)
      ? `${IFRAME_SANDBOX} allow-same-origin`
      : IFRAME_SANDBOX;
  } catch {
    return IFRAME_SANDBOX;
  }
}
