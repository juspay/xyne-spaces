/** Raw source of the app-side context runtime, injected into every project. */
import XYNE_CONTEXT_RUNTIME_CODE from './xyneContextRuntime.source.ts?raw';

/** Reserved: a payload shipping this path is overwritten (see toSandpackFiles). */
export const XYNE_CONTEXT_RUNTIME_PATH = '/lib/xyne-context.ts';

export { XYNE_CONTEXT_RUNTIME_CODE };
